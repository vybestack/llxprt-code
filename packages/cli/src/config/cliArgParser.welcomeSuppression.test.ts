/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { parseArguments } from './cliArgParser.js';
import type { Settings } from './settings.js';

const emptySettings: Settings = {};

function parseInSubprocess(args: string[]) {
  const parserUrl = new URL('./cliArgParser.ts', import.meta.url).href;
  const script = `process.argv = ${JSON.stringify(['node', 'llxprt', ...args])}; const { parseArguments } = await import(${JSON.stringify(parserUrl)}); await parseArguments({});`;
  return spawnSync(process.execPath, ['--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, LLXPRT_JSP_BOOTSTRAP_FILE: '' },
  });
}

describe('parseArguments selector and non-selector parsing', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('parses --provider into CliArgs.provider', async () => {
    process.argv = ['node', 'llxprt', '--provider', 'gemini'];
    const argv = await parseArguments(emptySettings);
    expect(argv.provider).toBe('gemini');
    expect(argv.profile).toBeUndefined();
    expect(argv.profileLoad).toBeUndefined();
  });

  it('parses --profile into CliArgs.profile', async () => {
    const inline = '{"provider":"x"}';
    process.argv = ['node', 'llxprt', '--profile', inline];
    const argv = await parseArguments(emptySettings);
    expect(argv.profile).toBe(inline);
    expect(argv.provider).toBeUndefined();
    expect(argv.profileLoad).toBeUndefined();
  });

  it('parses --profile-load into CliArgs.profileLoad', async () => {
    process.argv = ['node', 'llxprt', '--profile-load', 'my-profile'];
    const argv = await parseArguments(emptySettings);
    expect(argv.profileLoad).toBe('my-profile');
    expect(argv.provider).toBeUndefined();
    expect(argv.profile).toBeUndefined();
  });

  it('keeps only the last value when --profile is repeated', async () => {
    process.argv = [
      'node',
      'llxprt',
      '--profile',
      'first',
      '--profile',
      'last',
    ];
    const argv = await parseArguments(emptySettings);
    expect(argv.profile).toBe('last');
  });

  it('parses no selector when none is supplied', async () => {
    process.argv = ['node', 'llxprt'];
    const argv = await parseArguments(emptySettings);
    expect(argv.provider).toBeUndefined();
    expect(argv.profile).toBeUndefined();
    expect(argv.profileLoad).toBeUndefined();
  });

  it('parses --model without populating any selector', async () => {
    process.argv = ['node', 'llxprt', '--model', 'gemini-2.5-flash'];
    const argv = await parseArguments(emptySettings);
    expect(argv.model).toBe('gemini-2.5-flash');
    expect(argv.provider).toBeUndefined();
    expect(argv.profile).toBeUndefined();
    expect(argv.profileLoad).toBeUndefined();
  });

  it('parses --provider with an empty string value', async () => {
    process.argv = ['node', 'llxprt', '--provider', ''];
    const argv = await parseArguments(emptySettings);
    expect(argv.provider).toBe('');
  });

  it('parses --provider with a whitespace-only value', async () => {
    process.argv = ['node', 'llxprt', '--provider', '   '];
    const argv = await parseArguments(emptySettings);
    expect(argv.provider).toBe('   ');
  });

  it('parses --profile with an empty string value', async () => {
    process.argv = ['node', 'llxprt', '--profile', ''];
    const argv = await parseArguments(emptySettings);
    expect(argv.profile).toBe('');
  });

  it('parses --profile-load with an empty string value', async () => {
    process.argv = ['node', 'llxprt', '--profile-load', ''];
    const argv = await parseArguments(emptySettings);
    expect(argv.profileLoad).toBe('');
  });

  it('keeps only the last value when --provider is repeated', async () => {
    process.argv = [
      'node',
      'llxprt',
      '--provider',
      'gemini',
      '--provider',
      'openai',
    ];
    const argv = await parseArguments(emptySettings);
    expect(argv.provider).toBe('openai');
  });

  it('keeps only the last value when --profile-load is repeated', async () => {
    process.argv = [
      'node',
      'llxprt',
      '--profile-load',
      'first',
      '--profile-load',
      'last',
    ];
    const argv = await parseArguments(emptySettings);
    expect(argv.profileLoad).toBe('last');
  });

  it('rejects --profile-load when --profile is repeated', () => {
    const result = parseInSubprocess([
      '--profile',
      'first',
      '--profile',
      'last',
      '--profile-load',
      'named',
    ]);
    expect({
      status: result.status,
      hasConflictMessage: `${result.stdout}${result.stderr}`.includes(
        'Cannot use both --profile and --profile-load',
      ),
    }).toEqual({ status: 1, hasConflictMessage: true });
  });

  it('rejects --profile when --profile-load is repeated', () => {
    const result = parseInSubprocess([
      '--profile',
      'inline',
      '--profile-load',
      'first',
      '--profile-load',
      'last',
    ]);
    expect({
      status: result.status,
      hasConflictMessage: `${result.stdout}${result.stderr}`.includes(
        'Cannot use both --profile and --profile-load',
      ),
    }).toEqual({ status: 1, hasConflictMessage: true });
  });
});
