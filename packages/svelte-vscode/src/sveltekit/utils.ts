import { TextDecoder } from 'util';
import * as path from 'path';
import { Uri, workspace } from 'vscode';
import { IsSvelte5Plus, ProjectType } from './generateFiles/types';

export async function fileExists(file: string) {
    try {
        await workspace.fs.stat(Uri.file(file));
        return true;
    } catch (err) {
        return false;
    }
}

export async function findFile(searchPath: string, fileName: string) {
    for (;;) {
        const filePath = path.join(searchPath, fileName);
        if (await fileExists(filePath)) {
            return filePath;
        }
        const parentPath = path.dirname(searchPath);
        if (parentPath === searchPath) {
            return;
        }
        searchPath = parentPath;
    }
}

export async function checkProjectType(path: string): Promise<ProjectType> {
    const tsconfig = await findFile(path, 'tsconfig.json');
    const jsconfig = await findFile(path, 'jsconfig.json');
    const svelteVersion = await getVersionFromPackageJson('svelte');
    const isSv5Plus = isSvelte5Plus(svelteVersion);

    const svelteKitVersion = await getVersionFromPackageJson('@sveltejs/kit');
    // Props were introduced in 2.16.0 https://github.com/sveltejs/kit/blob/main/packages/kit/CHANGELOG.md#2160
    const withProps = versionAtLeast(svelteKitVersion, 2, { minor: 16, defaultReturn: true });

    const isTs = !!tsconfig && (!jsconfig || tsconfig.length >= jsconfig.length);
    let withSatisfies = false;
    if (isTs) {
        try {
            const packageJSONPath = require.resolve('typescript/package.json', {
                paths: [tsconfig]
            });
            const { version: typescriptVersion } = require(packageJSONPath);
            // Satisfies was introduced in 4.9
            withSatisfies = versionAtLeast(typescriptVersion, 4, { minor: 9, defaultReturn: true });
        } catch (e) {}
    }

    // Let's manage all cases now
    if (isTs && !withSatisfies && isSv5Plus && withProps) {
        return ProjectType.TS_SV5_PROPS;
    }
    if (isTs && withSatisfies && isSv5Plus && withProps) {
        return ProjectType.TS_SATISFIES_SV5_PROPS;
    }
    if (!isTs && isSv5Plus && withProps) {
        return ProjectType.TS_SV5_PROPS;
    }
    if (isTs && !withSatisfies && isSv5Plus && !withProps) {
        return ProjectType.TS_SV5;
    }
    if (isTs && withSatisfies && isSv5Plus && !withProps) {
        return ProjectType.TS_SATISFIES_SV5;
    }
    if (!isTs && isSv5Plus && !withProps) {
        return ProjectType.JS_SV5;
    }
    if (isTs && !withSatisfies && !isSv5Plus) {
        return ProjectType.TS;
    }
    if (isTs && withSatisfies && !isSv5Plus) {
        return ProjectType.TS_SATISFIES;
    }
    return ProjectType.JS;
}

function versionAtLeast(
    version: string | undefined,
    major: number,
    o?: {
        minor?: number;
        defaultReturn?: boolean;
    }
): boolean {
    const { minor = 0, defaultReturn = false } = o ?? {};

    if (!version) {
        return defaultReturn;
    }

    try {
        const [majorVersion, minorVersion] = version.split('.');
        return (
            (Number(majorVersion) === major && Number(minorVersion) >= (minor ?? 0)) ||
            Number(majorVersion) > major
        );
    } catch (e) {
        return defaultReturn;
    }
}

export function isSvelte5Plus(version: string | undefined): IsSvelte5Plus {
    if (!version) return IsSvelte5Plus.no;

    return version.split('.')[0] >= '5';
}

export async function getVersionFromPackageJson(packageName: string): Promise<string | undefined> {
    const packageJsonList = await workspace.findFiles('**/package.json', '**/node_modules/**');

    if (packageJsonList.length === 0) {
        return undefined;
    }

    for (const fileUri of packageJsonList) {
        try {
            const text = new TextDecoder().decode(await workspace.fs.readFile(fileUri));
            const pkg = JSON.parse(text);
            const svelteVersion =
                pkg.devDependencies?.[packageName] ?? pkg.dependencies?.[packageName];

            if (svelteVersion !== undefined) {
                return svelteVersion;
            }
        } catch (error) {
            console.error(error);
        }
    }

    return undefined;
}
