/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Repository-level package-boundary regressions for #3305. */

import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  checkAllWorkspaces,
  discoverPublishedWorkspaces,
} from '../check-runtime-dependency-declarations.ts';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const corePackage = '@vybestack/llxprt-code-core';

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

interface PackageReference {
  readonly file: string;
  readonly specifier: string;
}

function readManifest(workspaceDir: string): Manifest {
  return JSON.parse(
    readFileSync(join(repoRoot, workspaceDir, 'package.json'), 'utf8'),
  ) as Manifest;
}

function parseTypeScriptConfig(configPath: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic): never => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        );
      },
    },
  );
  if (parsed === undefined) {
    throw new Error(`Unable to parse TypeScript config: ${configPath}`);
  }
  return parsed;
}

function isInsideDirectory(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent !== '..' &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

function stripWildcard(path: string): string {
  const wildcardIndex = path.indexOf('*');
  return wildcardIndex === -1 ? path : path.slice(0, wildcardIndex);
}

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'dist' && entry.name !== 'node_modules') {
          visit(fullPath);
        }
      } else if (isTypeScriptFile(entry)) {
        files.push(fullPath);
      }
    }
  };
  visit(directory);
  return files;
}

function isTypeScriptFile(entry: Dirent): boolean {
  return (
    entry.isFile() &&
    (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
  );
}

function stringLiteralText(node: ts.Node | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node)
    ? node.text
    : undefined;
}

function findPackageReferences(directory: string): PackageReference[] {
  const references: PackageReference[] = [];
  for (const file of listTypeScriptFiles(directory)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const record = (specifier: string | undefined): void => {
      if (
        specifier === corePackage ||
        specifier?.startsWith(`${corePackage}/`)
      ) {
        references.push({ file: relative(repoRoot, file), specifier });
      }
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        record(stringLiteralText(node.moduleSpecifier));
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        record(stringLiteralText(node.moduleReference.expression));
      } else if (ts.isImportTypeNode(node)) {
        const argument = node.argument;
        if (ts.isLiteralTypeNode(argument)) {
          record(stringLiteralText(argument.literal));
        }
      } else if (ts.isCallExpression(node)) {
        const isDynamicImport =
          node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire =
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require';
        if (isDynamicImport || isRequire) {
          record(stringLiteralText(node.arguments[0]));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return references;
}

describe('workspace runtime dependency declarations (#3305)', () => {
  it('scans every published workspace', () => {
    const workspaces = discoverPublishedWorkspaces(repoRoot);
    expect(workspaces.length).toBeGreaterThan(0);
    expect(workspaces.map(({ workspaceDir }) => workspaceDir)).toContain(
      'packages/mcp',
    );
  });

  it('has no published package importing an undeclared package at runtime', () => {
    const violations = checkAllWorkspaces(repoRoot);
    expect(
      violations.map((violation) => violation.message),
      'Published packages must declare every package they import at ' +
        'runtime. Workspace hoisting and tsconfig paths can hide this until ' +
        'the tarball is installed standalone:\n  - ' +
        violations.map((violation) => violation.message).join('\n  - '),
    ).toEqual([]);
  }, 120_000);

  it('keeps the MCP source and tests independent of core for every import form', () => {
    expect(findPackageReferences(join(repoRoot, 'packages/mcp'))).toEqual([]);
  });

  it('does not declare core in any MCP dependency section', () => {
    const manifest = readManifest('packages/mcp');
    const sections = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
      manifest.peerDependencies,
    ];
    expect(
      sections.flatMap((section) => Object.keys(section ?? {})),
    ).not.toContain(corePackage);
  });

  it('does not map, include, or reference core in the MCP TypeScript program', () => {
    const configPath = join(repoRoot, 'packages/mcp/tsconfig.json');
    const config = parseTypeScriptConfig(configPath);
    const coreDirectory = join(repoRoot, 'packages/core');
    const baseUrl = config.options.baseUrl ?? dirname(configPath);
    const corePathMappings = Object.entries(config.options.paths ?? {}).filter(
      ([specifier, targets]) =>
        specifier === corePackage ||
        specifier.startsWith(`${corePackage}/`) ||
        targets.some((target) =>
          isInsideDirectory(
            coreDirectory,
            resolve(baseUrl, stripWildcard(target)),
          ),
        ),
    );
    const coreProgramFiles = config.fileNames.filter((file) =>
      isInsideDirectory(coreDirectory, file),
    );
    const coreProjectReferences = (config.projectReferences ?? []).filter(
      (reference) => isInsideDirectory(coreDirectory, reference.path),
    );

    expect(corePathMappings).toEqual([]);
    expect(coreProgramFiles).toEqual([]);
    expect(coreProjectReferences).toEqual([]);
  });

  it('keeps the package edge one-way from core to MCP', () => {
    expect(
      Object.keys(readManifest('packages/core').dependencies ?? {}),
    ).toContain('@vybestack/llxprt-code-mcp');
    expect(
      Object.keys(readManifest('packages/mcp').dependencies ?? {}),
    ).not.toContain(corePackage);
  });
});
