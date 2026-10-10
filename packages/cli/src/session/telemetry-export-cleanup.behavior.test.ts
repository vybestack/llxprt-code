/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  cleanupLeaves,
  runCleanupFailure,
} from './__tests__/telemetry-cleanup.fixture.js';
import { spawn } from 'node:child_process';
import { describe, it, expect, vi } from 'bun:test';
import {
  mkdtempSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  buildAgent,
  internalConfig,
  internalSettingsOwner,
} from '../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { dispatchInteractiveOrNonInteractive } from './nonInteractiveSession.js';
import { LoadedSettings } from '../config/settings.js';
import {
  registerCleanup,
  __resetCleanupStateForTesting,
} from '../utils/cleanup.js';
const repositoryRoot = resolve(import.meta.dirname, '../../../..');

describe('headless selected telemetry export cleanup', () => {
  it('surfaces direct-created Agent retirement failure instead of logging and returning success', async () => {
    const [result] = await Promise.allSettled([runCleanupFailure(false)]);
    if (result.status !== 'rejected')
      throw new Error('Agent cleanup failure was silently swallowed');
    expect(cleanupLeaves(result.reason).join('\n')).toContain(
      'oauth cleanup failed',
    );
  });

  it('preserves the primary and both cleanup leaves through public CLI execution', async () => {
    const [result] = await Promise.allSettled([runCleanupFailure(true)]);
    if (result.status !== 'rejected')
      throw new Error('Expected primary and cleanup rejection');
    const leaves = cleanupLeaves(result.reason);
    expect(leaves.join('\n')).toContain('local provider primary failure');
    expect(leaves.join('\n')).toContain('oauth cleanup failed');
    expect(leaves.some((leaf) => leaf.includes('EISDIR'))).toBe(true);
  });

  it('exits the native public CLI subprocess nonzero with primary and cleanup failures on stderr', async () => {
    const child = spawn(
      process.execPath,
      [
        'run',
        '--preload',
        join(repositoryRoot, 'scripts/tests/storage-isolation-guard.ts'),
        '--preload',
        join(repositoryRoot, 'scripts/tests/browser-launch-guard.ts'),
        join(
          repositoryRoot,
          'packages/cli/src/session/__tests__/telemetry-cleanup.fixture.ts',
        ),
      ],
      {
        cwd: repositoryRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout.resume();
    const exit = await new Promise<number | null>((resolveValue, reject) => {
      child.on('error', reject);
      child.on('close', resolveValue);
    });
    expect(exit).toBe(1);
    expect(stderr).toContain('local provider primary failure');
    expect(stderr).toContain('oauth cleanup failed');
    expect(stderr).toContain('EISDIR');
  });

  it('retires the actual CLI owner after accepted file export fails during headless finalization', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'headless-export-failure-'));
    const built = await buildAgent('plain-text.jsonl', {
      sessionId: 'headless-failure',
      model: 'headless-failure',
      tools: [],
      coreTools: [],
      mcpEnabled: false,
      extensionsEnabled: false,
      interactive: false,
      harness: {
        forceInteractive: false,
        forceConfirmations: false,
        includeProcessCwd: false,
      },
      telemetry: {
        enabled: true,
        logPrompts: false,
        outfile: join(directory, 'headless-failure.jsonl'),
      },
    });
    const config = internalConfig(built.agent);
    const owner = internalSettingsOwner(built.agent);
    const outfile = join(directory, 'headless-failure.jsonl');
    const marker = join(directory, 'cleanup-joined.txt');
    const settingsFile = {
      path: join(directory, 'unused-settings.json'),
      settings: {},
    };
    const settings = new LoadedSettings(
      settingsFile,
      settingsFile,
      settingsFile,
      settingsFile,
      true,
    );
    __resetCleanupStateForTesting();
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Unexpected headless process exit');
    });
    unlinkSync(outfile);
    mkdirSync(outfile);
    registerCleanup(async () => {
      writeFileSync(marker, 'accepted cleanup');
      rmSync(outfile, { recursive: true, force: true });
      await built.agent.dispose();
    });
    let cleanupFailures: unknown[] = [];
    try {
      const outcomes = await Promise.allSettled([
        dispatchInteractiveOrNonInteractive({
          config,
          agent: built.agent,
          settings,
          workspaceRoot: directory,
          hasPipedInput: true,
          readStdinData: () => Promise.resolve('local fake response'),
          runtimeSettings: { owner, store: new SettingsService() },
        }),
      ]);
      expect(outcomes[0].status).toBe('rejected');
      expect(existsSync(marker)).toBe(true);
      expect(owner.telemetry.isEnabled()).toBe(false);
    } finally {
      exit.mockRestore();
      rmSync(outfile, { recursive: true, force: true });
      __resetCleanupStateForTesting();
      const cleanup = await Promise.allSettled([
        Promise.resolve().then(() => built.agent.dispose()),
        Promise.resolve().then(() => built.cleanup()),
      ]);
      cleanupFailures = cleanup.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      rmSync(directory, { recursive: true, force: true });
    }
    if (cleanupFailures.length > 0)
      throw new AggregateError(cleanupFailures, 'Headless test cleanup failed');
  });
});
