/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

function declaredPaths(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(declaredPaths);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(declaredPaths);
  }
  return [];
}

function explicitlyShippedPaths(manifest: string): ReadonlySet<string> {
  if (!existsSync(manifest)) return new Set();
  const packageJson: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  if (packageJson === null || typeof packageJson !== 'object') {
    throw new Error(`Invalid package manifest: ${manifest}`);
  }
  return new Set(
    Object.entries(packageJson)
      .filter(([key]) => ['exports', 'main', 'bin'].includes(key))
      .flatMap(([, value]) => declaredPaths(value))
      .map((value) => value.replace(/^\.\//, '')),
  );
}

function matchesDeclaration(source: string, declaration: string): boolean {
  if (!existsSync(source)) return false;
  const expected = ts.transpileDeclaration(readFileSync(source, 'utf8'), {
    fileName: source,
    compilerOptions: {
      module: ts.ModuleKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const normalize = (value: string): string =>
    value.replace(/(import.*?from ['"])[^'"]+(['"])/g, '$1$2');
  return normalize(expected) === normalize(readFileSync(declaration, 'utf8'));
}

function matchesJavaScript(source: string, output: string): boolean {
  const map = `${output}.map`;
  if (!existsSync(source) || !existsSync(map)) return false;
  const file = output.slice(output.lastIndexOf('/') + 1);
  if (
    !readFileSync(output, 'utf8').includes(`//# sourceMappingURL=${file}.map`)
  ) {
    return false;
  }
  const parsed: unknown = JSON.parse(readFileSync(map, 'utf8'));
  if (parsed === null || typeof parsed !== 'object') return false;
  if (!('file' in parsed) || parsed.file !== file) return false;
  if (!('sources' in parsed) || !Array.isArray(parsed.sources)) return false;
  return (
    parsed.sources.length === 1 &&
    parsed.sources[0] === `${file.slice(0, -3)}.ts`
  );
}

function classifySibling(
  path: string,
  relativePath: string,
  packagePath: string,
  shipped: ReadonlySet<string>,
): string[] {
  if (shipped.has(packagePath)) return [];
  if (path.endsWith('.d.ts')) {
    return matchesDeclaration(path.slice(0, -5) + '.ts', path)
      ? [relativePath]
      : [];
  }
  if (
    !path.endsWith('.js') ||
    !matchesJavaScript(path.slice(0, -3) + '.ts', path)
  )
    return [];
  const declaration = path.slice(0, -3) + '.d.ts';
  const declarationPath = `${packagePath.slice(0, -3)}.d.ts`;
  return existsSync(declaration) && !shipped.has(declarationPath)
    ? [relativePath, relativePath.slice(0, -3) + '.d.ts']
    : [relativePath];
}

/** Excludes only compiler-proven MCP and core output; JS-only production remains checked. */
export function compilerEmittedSiblings(repoRoot: string): string[] {
  const output: string[] = [];
  for (const packageName of ['mcp', 'core']) {
    const packageRoot = join(repoRoot, 'packages', packageName);
    const explicitlyShipped = explicitlyShippedPaths(
      join(packageRoot, 'package.json'),
    );
    function visit(dir: string): void {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(path);
        } else if (entry.isFile()) {
          const relativePath = relative(repoRoot, path).replaceAll(
            String.fromCharCode(92),
            '/',
          );
          const packagePath = relative(packageRoot, path).replaceAll(
            String.fromCharCode(92),
            '/',
          );
          output.push(
            ...classifySibling(
              path,
              relativePath,
              packagePath,
              explicitlyShipped,
            ),
          );
        }
      }
    }
    visit(join(packageRoot, 'src'));
  }
  return [...new Set(output)].sort();
}

/** Prettier resolves ignore patterns from the ignore file's directory. */
export function emittedIgnoreEntries(
  repoRoot: string,
  ignoreFile: string,
  paths: readonly string[],
): string {
  return (
    paths
      .map((path) =>
        relative(dirname(ignoreFile), resolve(repoRoot, path)).replaceAll(
          '\\',
          '/',
        ),
      )
      .join('\n') + '\n'
  );
}
