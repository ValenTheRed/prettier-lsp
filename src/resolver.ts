import path from 'node:path';
import type Prettier from 'prettier';

export type ResolvedPrettier = {
  module: typeof Prettier;
  filePath: string;
};

export type ResolverOptions = {
  localOnly?: boolean;
  defaultConfig?: string;
};

/**
 * Resolves prettier module, preferring local installation over bundled version
 */
export async function resolvePrettier(
  filePath: string,
  options: ResolverOptions = {},
): Promise<ResolvedPrettier | undefined> {
  const { localOnly = false } = options;

  let resolvedPath: string;
  try {
    resolvedPath = require.resolve('prettier', { paths: [filePath] });
  } catch (e) {
    if (localOnly) {
      return undefined;
    }
    resolvedPath = require.resolve('prettier');
  }

  return import(resolvedPath).then((v) => {
    if (v !== undefined) {
      return {
        module: v,
        filePath: resolvedPath,
      };
    }
    return undefined;
  });
}

type CliOptions = {
  [key: string]: boolean | number | string | undefined;
  config?: false | string;
  editorconfig?: boolean;
};

/**
 * Resolves prettier configuration for a given file
 */
export async function resolveConfig(
  prettier: typeof Prettier,
  filepath: string,
  options: Pick<CliOptions, 'config' | 'editorconfig'> & ResolverOptions = {},
): Promise<Prettier.Options | null> {
  const { config, editorconfig = true, defaultConfig } = options;

  if (config === false) {
    return null;
  }

  let prettierConfig = await prettier.resolveConfig(filepath, {
    editorconfig,
    useCache: false,
  });

  if (!prettierConfig && defaultConfig) {
    prettierConfig = await prettier.resolveConfig(path.dirname(defaultConfig), {
      config: defaultConfig,
      editorconfig,
      useCache: false,
    });
  }

  return prettierConfig;
}

/**
 * Resolves file path (handles relative and absolute paths)
 */
export function resolveFile(cwd: string, fileName: string): string {
  if (path.isAbsolute(fileName)) {
    return fileName;
  }
  return path.join(cwd, fileName);
}
