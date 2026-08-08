/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { restoreEnv, setEnv } from './env-test-helpers.js';
import { TestRig } from './test-rig.js';
import { readLedger } from './model-request-ledger.js';

describe('TestRig setup and cleanup behavior', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    restoreEnv();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'test-rig-behavior-'));
    tempDirs.push(root);
    setEnv('INTEGRATION_TEST_FILE_DIR', root);
    return root;
  }

  it('preserves fake responses when setup is called again with settings only', () => {
    const root = createRoot();
    const fakeResponsesPath = join(root, 'responses.json');
    writeFileSync(fakeResponsesPath, '[]');
    const rig = new TestRig();

    rig.setup('repeated setup', { fakeResponsesPath });
    const firstCopiedPath = rig.fakeResponsesPath;

    rig.setup('repeated setup', { settings: { debug: true } });

    expect(rig.fakeResponsesPath).toBe(firstCopiedPath);
    expect(rig.originalFakeResponsesPath).toBe(fakeResponsesPath);
  });

  it('cleans test directories when KEEP_OUTPUT is unset or empty', async () => {
    createRoot();
    const rig = new TestRig();
    rig.setup('cleanup empty keep output');
    const testDir = rig.testDir;
    setEnv('KEEP_OUTPUT', '');

    await rig.cleanup();

    expect(testDir).not.toBeNull();
    expect(existsSync(testDir as string)).toBe(false);
  });

  it('keeps test directories when KEEP_OUTPUT is truthy', async () => {
    createRoot();
    const rig = new TestRig();
    rig.setup('cleanup truthy keep output');
    const testDir = rig.testDir;
    setEnv('KEEP_OUTPUT', '1');

    await rig.cleanup();

    expect(testDir).not.toBeNull();
    expect(existsSync(testDir as string)).toBe(true);
  });

  it('rejects overlapping run operations on one rig', async () => {
    createRoot();
    const rig = new TestRig();
    rig.setup('overlapping runs');

    const firstRun = rig.runCommand(['--version']);
    const secondRun = rig.runCommand(['--version']);

    await expect(secondRun).rejects.toThrow(/overlapping run operations/);

    await firstRun;
  });

  // The awaited run must exhaust the provider retry path against an
  // unreachable base URL, which outlives the default per-test timeout.
  it('records a real-provider run to the ledger when LLXPRT_E2E_MODEL_LEDGER is set', async () => {
    const root = createRoot();
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'openai');
    setEnv('LLXPRT_DEFAULT_MODEL', 'gpt-4o-mini');
    setEnv('OPENAI_API_KEY', 'test-key');
    setEnv('OPENAI_BASE_URL', 'http://127.0.0.1:1');
    setEnv('LLXPRT_TEST_PROFILE', undefined);

    const ledgerPath = join(root, 'ledger.jsonl');
    setEnv('LLXPRT_E2E_MODEL_LEDGER', ledgerPath);

    const rig = new TestRig();
    rig.setup('real-provider-ledger-test');

    // The ledger entry is written synchronously before the CLI is spawned, so
    // it is observable without waiting for the (unreachable) provider call to
    // fail. The run is still awaited afterwards so the child is reaped.
    const runPromise = rig.run({ args: 'test prompt' });

    const records = readLedger(ledgerPath);
    expect(records).toHaveLength(1);
    expect(records[0]?.testName).toBe('real-provider-ledger-test');
    const expectedDir = rig.testDir;
    if (expectedDir === null) {
      throw new Error('testDir should not be null after setup');
    }
    expect(records[0]?.testDir).toBe(expectedDir);

    await runPromise.catch(() => undefined);
  }, 30_000);

  it('refuses a real-provider run when setup() has not established a test name', () => {
    const root = createRoot();
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'openai');
    setEnv('LLXPRT_DEFAULT_MODEL', 'gpt-4o-mini');
    setEnv('OPENAI_API_KEY', 'test-key');
    setEnv('OPENAI_BASE_URL', 'http://127.0.0.1:1');
    setEnv('LLXPRT_TEST_PROFILE', undefined);
    setEnv('LLXPRT_E2E_MODEL_LEDGER', join(root, 'ledger.jsonl'));

    const rig = new TestRig();

    expect(rig.run({ args: 'test prompt' })).rejects.toThrow(
      /requires setup\(\) to be called first/,
    );
  });

  it('does not record to the ledger when fakeResponsesPath is set', async () => {
    const root = createRoot();
    const fixturePath = join(root, 'fake.jsonl');
    const fixture = JSON.stringify({
      chunks: [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'OK' }],
          metadata: {
            usage: {
              promptTokens: 1,
              completionTokens: 1,
              totalTokens: 2,
            },
          },
        },
      ],
    });
    writeFileSync(fixturePath, `${fixture}\n`);

    const ledgerPath = join(root, 'ledger.jsonl');
    setEnv('LLXPRT_E2E_MODEL_LEDGER', ledgerPath);
    setEnv('LLXPRT_TEST_PROFILE', undefined);

    const rig = new TestRig();
    rig.setup('fake-provider-ledger-test', {
      fakeResponsesPath: fixturePath,
    });

    await rig.run({ args: 'test prompt' }).catch(() => {});

    expect(existsSync(ledgerPath)).toBe(false);
  });
});
