/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { restoreEnv, setEnv } from './env-test-helpers.js';
import { TestRig } from './test-rig.js';
import { readLedger } from './model-request-ledger.js';

function requireTestDir(testDir: string | null): string {
  if (testDir === null) {
    throw new Error('testDir should not be null after setup');
  }
  return testDir;
}

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

  it('writes bounded context and output settings into an opt-in test profile', () => {
    createRoot();
    setEnv('LLXPRT_TEST_PROFILE', 'local-model-pilot');
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'openai');
    setEnv('LLXPRT_DEFAULT_MODEL', 'qwen3.5:2b');
    setEnv('LLXPRT_CONTEXT_LIMIT', '32768');
    setEnv('LLXPRT_MAX_OUTPUT_TOKENS', '8192');
    const rig = new TestRig();

    rig.setup('local model pilot profile');

    const testDir = requireTestDir(rig.testDir);
    const profile = JSON.parse(
      readFileSync(
        join(testDir, '.llxprt', 'profiles', 'local-model-pilot.json'),
        'utf8',
      ),
    );
    expect(profile).toMatchObject({
      provider: 'openai',
      model: 'qwen3.5:2b',
      ephemeralSettings: {
        'context-limit': 32768,
        maxOutputTokens: 8192,
      },
    });
  });

  it('loads the generated local pilot profile in the real CLI without a global profile', async () => {
    const root = createRoot();
    setEnv('LLXPRT_CONFIG_HOME', join(root, 'global-config'));
    setEnv('LLXPRT_LOCAL_MODEL_PILOT', 'true');
    setEnv('LLXPRT_TEST_PROFILE', 'local-model-pilot');
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'openai');
    setEnv('LLXPRT_DEFAULT_MODEL', 'qwen3.5:2b');
    setEnv('OPENAI_API_KEY', 'local-test-only');
    setEnv('LLXPRT_CONTEXT_LIMIT', '32768');
    setEnv('LLXPRT_MAX_OUTPUT_TOKENS', '8192');

    const requests: Array<{ path: string | undefined; body: string }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.push({
          path: request.url,
          body: Buffer.concat(chunks).toString(),
        });
        const chunk = JSON.stringify({
          id: 'chatcmpl-local-profile-test',
          object: 'chat.completion.chunk',
          choices: [
            {
              delta: { content: 'OK' },
              index: 0,
              finish_reason: 'stop',
            },
          ],
        });
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(`data: ${chunk}\n\ndata: [DONE]\n\n`);
      });
    });
    server.listen(0, '127.0.0.1');
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Local test server has no TCP port');
      }
      setEnv('OPENAI_BASE_URL', `http://127.0.0.1:${address.port}/v1`);
      const rig = new TestRig();
      rig.setup('real CLI local pilot profile');

      await rig.run({ args: 'Respond with OK', timeoutMs: 20_000 });

      const completionRequest = requests.find(
        (request) => request.path === '/v1/chat/completions',
      );
      expect({
        path: completionRequest?.path,
        model:
          completionRequest === undefined
            ? undefined
            : JSON.parse(completionRequest.body).model,
      }).toStrictEqual({
        path: '/v1/chat/completions',
        model: 'qwen3.5:2b',
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }, 30_000);

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

  // The run is recorded before the CLI is spawned. Emptying PATH makes the
  // spawn fail with ENOENT straight away, so the recording is observable
  // without a real provider call and without leaving a child process behind.
  it('records a real-provider run to the ledger when LLXPRT_E2E_MODEL_LEDGER is set', async () => {
    const root = createRoot();
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'openai');
    setEnv('LLXPRT_DEFAULT_MODEL', 'gpt-4o-mini');
    setEnv('OPENAI_API_KEY', 'test-key');
    setEnv('OPENAI_BASE_URL', 'http://127.0.0.1:1');
    setEnv('LLXPRT_TEST_PROFILE', undefined);
    setEnv('PATH', join(root, 'no-executables-here'));

    const ledgerPath = join(root, 'ledger.jsonl');
    setEnv('LLXPRT_E2E_MODEL_LEDGER', ledgerPath);

    const rig = new TestRig();
    rig.setup('real-provider-ledger-test');
    const expectedDir = requireTestDir(rig.testDir);

    // Bun reports an unresolvable executable as "Executable not found ..."
    // while Node reports ENOENT; accept either so the test is runtime-agnostic.
    await expect(rig.run({ args: 'test prompt' })).rejects.toThrow(
      /Executable not found|ENOENT/,
    );

    const records = readLedger(ledgerPath);
    expect(records).toHaveLength(1);
    expect(records[0]?.testName).toBe('real-provider-ledger-test');
    expect(records[0]?.testDir).toBe(expectedDir);
  });

  it('refuses a real-provider run when setup() has not established a test name', async () => {
    const root = createRoot();
    setEnv('LLXPRT_DEFAULT_PROVIDER', 'openai');
    setEnv('LLXPRT_DEFAULT_MODEL', 'gpt-4o-mini');
    setEnv('OPENAI_API_KEY', 'test-key');
    setEnv('OPENAI_BASE_URL', 'http://127.0.0.1:1');
    setEnv('LLXPRT_TEST_PROFILE', undefined);
    setEnv('LLXPRT_E2E_MODEL_LEDGER', join(root, 'ledger.jsonl'));

    const rig = new TestRig();

    await expect(rig.run({ args: 'test prompt' })).rejects.toThrow(
      /requires setup\(\) to be called first/,
    );
    expect(existsSync(join(root, 'ledger.jsonl'))).toBe(false);
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

  it('uses a per-run deadline without changing the default TestRig timeout', async () => {
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
    setEnv('LLXPRT_TEST_PROFILE', undefined);
    const rig = new TestRig();
    rig.setup('scoped run timeout', { fakeResponsesPath: fixturePath });

    await expect(
      rig.run({ args: 'test prompt', timeoutMs: 1 }),
    ).rejects.toThrow('TestRig.run() timed out after 1ms');
  });
});
