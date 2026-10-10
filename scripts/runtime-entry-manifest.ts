/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  workspaceSourcePath,
  type EntryManifest,
} from './runtime-source-discovery.js';

export const productionPackages = [
  'a2a-server',
  'agents',
  'auth',
  'cli',
  'core',
  'ide-integration',
  'lsp',
  'mcp',
  'policy',
  'providers',
  'settings',
  'storage',
  'telemetry',
  'tools',
  'vscode-ide-companion',
  'zed-acp',
].map((name) => `packages/${name}`);
export const productionPlugins = [
  'plugins/google-gemini',
  'plugins/google-mcp-auth',
];
const packageIndexes = productionPackages
  .filter(
    (pkg) => !['packages/lsp', 'packages/vscode-ide-companion'].includes(pkg),
  )
  .map((pkg) => `${pkg}/index.ts`);
const memoryEntries = [
  'launcher',
  'preload',
  'request',
  'report',
  'analyze',
].map(
  (name) =>
    `scripts/memory/installed-${name}${name === 'preload' ? '' : '-entry'}.ts`,
);
const bundleEntries = [
  'packages/a2a-server/src/http/server.ts',
  'packages/cli/index.ts',
  ...memoryEntries,
];

function bundleEntry(
  entry: ts.Expression,
  source: ts.SourceFile,
): { path: string; profiler: boolean } {
  if (ts.isStringLiteral(entry)) return { path: entry.text, profiler: false };
  if (
    !ts.isCallExpression(entry) ||
    !ts.isIdentifier(entry.expression) ||
    entry.expression.text !== 'join'
  )
    throw new Error('Unsupported bundle entry derivation');
  if (entry.arguments[0]?.getText(source) !== 'root')
    throw new Error('Unsupported bundle entry derivation: root');
  const args = entry.arguments.slice(1);
  if (args.every(ts.isStringLiteral))
    return { path: args.map((arg) => arg.text).join('/'), profiler: false };
  if (
    args.length === 2 &&
    args[0] &&
    ts.isStringLiteral(args[0]) &&
    args[1]?.getText(source) === 'sourceName'
  )
    return { path: args[0].text, profiler: true };
  throw new Error('Unsupported bundle entry derivation: join');
}

export function verifyBundleEntryDeclarations(
  text: string,
  expected: readonly string[],
): void {
  const source = ts.createSourceFile(
    'bun-build.config.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const entries: string[] = [];
  const profilerNames: string[] = [];
  let profilerDirectory: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'profilerBundleConfig'
    ) {
      const name = node.arguments[0];
      if (!name || !ts.isStringLiteral(name))
        throw new Error(
          'Unsupported bundle entry derivation: profilerBundleConfig',
        );
      profilerNames.push(name.text);
    }
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === 'entrypoints'
    ) {
      if (!ts.isArrayLiteralExpression(node.initializer))
        throw new Error('Unsupported bundle entry derivation: entrypoints');
      for (const entry of node.initializer.elements) {
        const parsed = bundleEntry(entry, source);
        if (parsed.profiler) profilerDirectory = parsed.path;
        else entries.push(parsed.path);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (profilerNames.length && !profilerDirectory)
    throw new Error('Missing profiler bundle entry derivation');
  entries.push(...profilerNames.map((name) => `${profilerDirectory}/${name}`));
  if (
    JSON.stringify([...entries].sort()) !== JSON.stringify([...expected].sort())
  )
    throw new Error(
      `Shipped bundle entry manifest drift: ${entries.join(', ')}`,
    );
}

export const productionEntryManifest: EntryManifest = {
  packages: [...productionPackages, ...productionPlugins],
  packageDirectories: ['packages', 'plugins'],
  testPackages: ['packages/test-utils'],
  files: [
    ...packageIndexes,
    ...memoryEntries,
    ...['launcher', 'request-cli', 'report', 'heapanalyze'].map(
      (name) => `scripts/memory/${name}-entry.ts`,
    ),
    'packages/cli/scripts/install-native-launchers.cjs',
    'packages/cli/scripts/verify-sandbox-runtime.ts',
  ],
  generated: {
    'packages/a2a-server/dist/a2a-server.mjs':
      'packages/a2a-server/src/http/server.ts',
    'packages/vscode-ide-companion/dist/extension.cjs':
      'packages/vscode-ide-companion/src/extension.ts',
  },
  requiredClosure: [
    ...packageIndexes,
    'scripts/lib/node-options.ts',
    'scripts/utils/error-guards.ts',
    ...[
      'entrypoint',
      'heapanalyze',
      'installed-analyze',
      'installed-launcher',
      'installed-preload',
      'installed-report',
      'installed-request',
      'launcher',
      'lease',
      'paths',
      'perms',
      'probe-preload',
      'probe',
      'report',
      'request-cli',
      'request',
      'runtime-paths',
      'sample',
    ].map((name) => `scripts/memory/${name}.ts`),
    ...[
      'GeminiMessageConverter',
      'GeminiProvider',
      'finishReasonMapping',
      'geminiAiSdkConverters',
      'geminiApiClientFactory',
      'geminiAuth',
      'geminiDumpConversion',
      'geminiGenerationExecution',
      'geminiGenerationSetup',
      'geminiModels',
      'geminiReasoningConfig',
      'geminiReasoningTranslation',
      'geminiRequestBuilding',
      'geminiResponseMapper',
      'geminiSchemaHelpers',
      'geminiWireTypes',
      'modelClassification',
      'thoughtSignatures',
    ].map((name) => `plugins/google-gemini/src/gemini/${name}.ts`),
    ...productionPlugins.map((pkg) => `${pkg}/src/index.ts`),
    'packages/cli/bin/llxprt.mjs',
    'packages/cli/scripts/install-native-launchers.cjs',
    'packages/cli/scripts/verify-sandbox-runtime.ts',
  ],
  identities: productionPlugins.map((pkg) => ({
    compilerConfig: `${pkg}/tsconfig.json`,
    from: `${pkg}/src/index.ts`,
    specifier: '@vybestack/llxprt-code-providers/composition.js',
    source: 'packages/providers/src/composition/index.ts',
  })),
  verify(workspace): void {
    verifyBundleEntryDeclarations(
      readFileSync(
        workspaceSourcePath(workspace, 'scripts/bun-build.config.ts'),
        'utf8',
      ),
      bundleEntries,
    );
  },
};
