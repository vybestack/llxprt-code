/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Opts out of the preload's providerAliases stub (see bun-test-setup.ts) so
// the resolver reads real alias files.
const { getUserAliasDir } = await import(
  '@vybestack/llxprt-code-providers/composition.js'
);
const { resolveProviderAndModel } = await import(
  '../../src/config/providerModelResolver.js'
);

function resolveAlias(): ReturnType<typeof resolveProviderAndModel> {
  return resolveProviderAndModel({
    cliProvider: 'aliased',
    profileProvider: undefined,
    envDefaultProvider: undefined,
    cliModel: undefined,
    profileModel: undefined,
    settingsModel: undefined,
    envDefaultModel: undefined,
    envProviderModel: undefined,
  });
}

describe('resolveProviderAndModel with user alias files', () => {
  let aliasDir: string;

  beforeEach(() => {
    aliasDir = getUserAliasDir();
    fs.rmSync(aliasDir, { recursive: true, force: true });
    fs.mkdirSync(aliasDir, { recursive: true });
    fs.writeFileSync(
      path.join(aliasDir, 'aliased.config'),
      JSON.stringify({ baseProvider: 'openai', defaultModel: 'alias-model' }),
    );
  });

  afterEach(() => {
    fs.rmSync(aliasDir, { recursive: true, force: true });
  });

  it('uses the alias default model when every alias file parses', () => {
    expect(resolveAlias()).toStrictEqual({
      provider: 'aliased',
      model: 'alias-model',
    });
  });

  it('throws the alias file error when another alias file is malformed', () => {
    const badPath = path.join(aliasDir, 'bad.config');
    fs.writeFileSync(badPath, '{ not json');

    let thrown: unknown;
    try {
      resolveAlias();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      `Invalid provider alias file ${badPath}`,
    );
    expect((thrown as Error).cause).toBeInstanceOf(SyntaxError);
  });
});
