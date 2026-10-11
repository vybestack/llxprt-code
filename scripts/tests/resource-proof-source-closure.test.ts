/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { scanInstalled } from './runtime-service-shape-test-helpers.js';

const root = resolve(import.meta.dir, '../..');
function readSource(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}
function sanitizerSource(): string {
  return (
    readSource('packages/auth/src/types.ts') +
    readSource('packages/auth/src/token-sanitization.ts')
      .replace("import type { z } from 'zod';", '')
      .replace(
        "import { OAuthTokenSchema, type OAuthToken } from './types.js';",
        '',
      )
  );
}

it('completes the production token sanitizer schema and output proof', () => {
  expect(scanInstalled(sanitizerSource())).toEqual([]);
});

it('detects service-bearing output introduced into the same token transform', () => {
  const source = sanitizerSource().replace(
    'return rest;',
    'return { ...rest, clock: new Clock(), session: new Session() };',
  );
  expect(scanInstalled(source)).toContainEqual(
    expect.objectContaining({ rule: 'runtime-service-bundle' }),
  );
});

function credentialValidationSource(): string {
  return (
    sanitizerSource() +
    readSource(
      'packages/providers/src/auth/proxy/credential-request-validation.ts',
    )
      .replace(
        "import { SanitizedOAuthTokenSchema } from '@vybestack/llxprt-code-auth';",
        '',
      )
      .replace("import { z } from 'zod';", '')
  );
}

it('completes credential request validation with the real sanitizer schema', () => {
  expect(scanInstalled(credentialValidationSource())).toEqual([]);
});

it('detects service-bearing output in the credential save-token schema', () => {
  const source = credentialValidationSource().replace(
    'token: SanitizedOAuthTokenSchema,',
    'token: SanitizedOAuthTokenSchema, services: z.custom<{ clock: Clock; session: Session }>(),',
  );
  expect(scanInstalled(source)).toContainEqual(
    expect.objectContaining({ rule: 'runtime-service-bundle' }),
  );
});

const commandPaths = [
  'extensions/config',
  'extensions/disable',
  'extensions/enable',
  'extensions/install',
  'extensions/link',
  'extensions/new',
  'extensions/settings',
  'extensions/uninstall',
  'extensions/update',
  'extensions/validate',
  'hooks/migrate',
  'mcp/add',
  'mcp/remove',
  'skills/disable',
  'skills/enable',
  'skills/install',
  'skills/list',
  'skills/uninstall',
];
function builders(path: string): readonly string[] {
  const source = ts.createSourceFile(
    path,
    readSource(`packages/cli/src/commands/${path}.ts`),
    ts.ScriptTarget.Latest,
    true,
  );
  const result: string[] = [];
  function collectBuilder(node: ts.Node): void {
    if (
      !ts.isPropertyAssignment(node) ||
      node.name.getText(source) !== 'builder'
    ) {
      return;
    }
    if (
      !ts.isArrowFunction(node.initializer) &&
      !ts.isFunctionExpression(node.initializer)
    ) {
      return;
    }
    const builder = node.initializer.getText(source);
    if (
      builder.includes('.positional(') ||
      path === 'hooks/migrate' ||
      path === 'skills/list'
    ) {
      result.push(builder);
    }
  }
  function visit(node: ts.Node): void {
    collectBuilder(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
function commandSource(path: string): string {
  const helper = 'packages/cli/src/commands/command-configuration.ts';
  const port = existsSync(resolve(root, helper))
    ? readSource(helper).replace(/export /g, '')
    : '';
  return `${port}
import type { CommandModule, ArgumentsCamelCase } from 'yargs';
enum SettingScope { User = 'User', Workspace = 'Workspace', System = 'System', SystemDefaults = 'SystemDefaults' }
interface MigrateOptions { dryRun?: boolean; confirm?: boolean; }
interface AddCommandArgs { name: string; commandOrUrl:string; args?:Array<string|number>; '--'?:Array<string|number>; }
type ServerArgumentTail = { args?:Array<string|number>; '--'?:string[]; };
declare function getBoilerplateChoices():Promise<string[]>;
${builders(path)
  .map(
    (builder, index) =>
      `const command${index}: ${path === 'hooks/migrate' ? /CommandModule<[^>]+>/.exec(readSource('packages/cli/src/commands/hooks/migrate.ts'))?.[0] : 'CommandModule'} = { command: 'test', builder: ${builder}, handler: () => {} };`,
  )
  .join('\n')}`;
}

it.each(commandPaths)(
  'completes actual CLI configuration builders: %s',
  (path) => {
    expect(scanInstalled(commandSource(path))).toEqual([]);
  },
);

it.each(commandPaths)(
  'detects a service producer in the same CLI builder module: %s',
  (path) => {
    const source = `${commandSource(path)}\nexport const injectedCommand = { clock: new Clock(), session: new Session() };`;
    expect(scanInstalled(source)).toContainEqual(
      expect.objectContaining({ rule: 'runtime-service-bundle' }),
    );
  },
);

it('retains service returns under the void configuration callback context', () => {
  const source = `${commandSource('skills/enable')}
import yargs from 'yargs/yargs';
configureCommandOptions(yargs([]), () => ({ clock: new Clock(), session: new Session() }));`;
  expect(scanInstalled(source)).toContainEqual(
    expect.objectContaining({ rule: 'runtime-service-bundle' }),
  );
});

it('retains merged service-bearing external parser option declarations', () => {
  const source = `${commandSource('skills/enable')}
declare module 'yargs' { interface PositionalOptions { services?: { clock: Clock; session: Session }; } }`;
  expect(scanInstalled(source)).toContainEqual(
    expect.objectContaining({ rule: 'runtime-service-bundle' }),
  );
});

function launchSource(): string {
  const text = readSource('packages/cli/src/config/cliArgParser.ts');
  const source = ts.createSourceFile(
    'cliArgParser.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const launch = source.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'configureLaunchCommand',
  );
  if (!launch) throw new Error('Missing launch command configuration');
  return `${readSource('packages/cli/src/commands/command-configuration.ts')}
declare function applyInnerOptions(parser: Argv): Argv;
declare function applyDeprecations(parser: Argv): Argv;
declare function validateLaunchArgs(args: Record<string, unknown>): true;
${launch.getText(source)}`;
}

it('completes the actual launch positional builder expression', () => {
  expect(scanInstalled(launchSource())).toEqual([]);
});

it('detects a service producer in the launch configuration module', () => {
  expect(
    scanInstalled(
      `${launchSource()}\nexport const injectedLaunch = { clock: new Clock(), session: new Session() };`,
    ),
  ).toContainEqual(expect.objectContaining({ rule: 'runtime-service-bundle' }));
});
