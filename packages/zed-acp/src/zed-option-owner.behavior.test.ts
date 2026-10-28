/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ZedPathResolver } from './zed-path-resolver.js';
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../cli/src/__tests__/command-owner-fixture.js';
import { buildZedConfigOptions } from './zed-config-options.js';

describe('ACP config option ownership', () => {
  const makeOwner = useCommandOwners();
  it('reads captured model and setting operations without selecting a conflicting owner', async () => {
    const owner = await makeOwner('option-owner');
    const sibling = await makeOwner('option-sibling');
    owner.setEphemeralSetting('reasoning.effort', 'high');
    sibling.setEphemeralSetting('reasoning.effort', 'low');
    const readModel = Object.assign(() => owner.getModel(), {
      getModel: () => sibling.getModel(),
      listAvailableModels: () => sibling.listAvailableModels(),
    });
    const listModels = Object.assign(() => owner.listAvailableModels(), {
      getEphemeralSetting: (key: string) => sibling.getEphemeralSetting(key),
      setEphemeralSetting: (key: string, value: unknown) =>
        sibling.setEphemeralSetting(key, value),
    });
    const options = await buildZedConfigOptions(
      readModel,
      listModels,
      (key: string) => owner.getEphemeralSetting(key),
    );
    expect(options.find((option) => option.id === 'model')?.currentValue).toBe(
      'option-owner-initial',
    );
    expect(
      options.find((option) => option.id === 'reasoning.effort')?.currentValue,
    ).toBe('high');
    await owner.dispose();
    const siblingOptions = await buildZedConfigOptions(
      () => sibling.getModel(),
      () => sibling.listAvailableModels(),
      (key: string) => sibling.getEphemeralSetting(key),
    );
    expect(
      siblingOptions.find((option) => option.id === 'reasoning.effort')
        ?.currentValue,
    ).toBe('low');
  });
});

describe('ACP referenced-file ownership', () => {
  const makeOwner = useCommandOwners();
  it('reads referenced files from captured workspace operations rather than a conflicting config', async () => {
    const owner = await makeOwner('path-owner');
    const sibling = await makeOwner('path-sibling');
    await writeFile(
      join(owner.workspace.getWorkingDirectory(), 'entry.txt'),
      'owned workspace text',
    );
    await writeFile(
      join(sibling.workspace.getWorkingDirectory(), 'entry.txt'),
      'sibling workspace text',
    );
    const filtering = Object.assign(
      () => ({ respectGitIgnore: true, respectLlxprtIgnore: true }),
      {
        getTargetDir: () => sibling.workspace.getWorkingDirectory(),
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectLlxprtIgnore: true,
        }),
        getEnableRecursiveFileSearch: () => false,
        readTextFile: (path: string) => readFile(path, 'utf8'),
        ignore: sibling.workspace,
      },
    );
    const resolver = new ZedPathResolver(
      filtering,
      () => owner.workspace.getWorkingDirectory(),
      () => false,
      (path: string) => readFile(path, 'utf8'),
      (path, options) => owner.workspace.shouldIgnoreFile(path, options),
      () => owner.workspace.getCoreIgnorePatterns(),
      () => {},
    );
    const parts = await resolver.resolvePrompt(
      [{ type: 'resource_link', uri: 'file://entry.txt', name: 'entry.txt' }],
      new AbortController().signal,
    );
    expect(JSON.stringify(parts)).toContain('owned workspace text');
    expect(JSON.stringify(parts)).not.toContain('sibling workspace text');
  });
});
