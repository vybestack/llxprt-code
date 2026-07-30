/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../ci-quota-check.ts';

const ORIGINAL_ENV = { ...process.env };
let testDir: string;

function readGithubOutput(): string {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error('GITHUB_OUTPUT not set');
  return readFileSync(outputPath, 'utf8');
}

function expectNoGithubOutputFile(): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  expect(existsSync(outputPath)).toBe(false);
}

function readGithubEnv(): string {
  const envPath = process.env.GITHUB_ENV;
  if (!envPath) throw new Error('GITHUB_ENV not set');
  return readFileSync(envPath, 'utf8');
}

function expectNoGithubEnvFile(): void {
  const envPath = process.env.GITHUB_ENV;
  if (!envPath) {
    return;
  }
  expect(existsSync(envPath)).toBe(false);
}

function quotaResponse(requests: number): Response {
  return new Response(
    JSON.stringify({ subscription: { limit: 100, requests } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function configureFiles(includeOutput = true) {
  process.env.GITHUB_ENV = join(testDir, 'github-env');
  if (includeOutput) {
    process.env.GITHUB_OUTPUT = join(testDir, 'github-output');
  } else {
    delete process.env.GITHUB_OUTPUT;
  }
}

function failingResponse(status = 500) {
  return new Response('error', { status });
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'ci-quota-check-'));
  process.env = { ...ORIGINAL_ENV };
  configureFiles();
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  rmSync(testDir, { recursive: true, force: true });
});

describe('ci quota key selection outputs', () => {
  it('reports primary when the primary Synthetic key has lower usage', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(quotaResponse(10))
        .mockResolvedValueOnce(quotaResponse(20)),
    );

    await main();

    expect(readGithubOutput()).toBe('selected_key=primary\n');
  });

  it('reports secondary when the secondary Synthetic key has lower usage', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(quotaResponse(20))
        .mockResolvedValueOnce(quotaResponse(10)),
    );

    await main();

    expect(readGithubOutput()).toBe('selected_key=secondary\n');
  });

  it('reports primary without a quota request for non-Synthetic providers', async () => {
    process.env.KEY_VAR_NAME = 'OPENAI_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await main();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(readGithubOutput()).toBe('selected_key=primary\n');
  });

  it('continues when GITHUB_OUTPUT is unavailable', async () => {
    configureFiles(false);
    process.env.KEY_VAR_NAME = 'OPENAI_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';

    await main();

    // GITHUB_OUTPUT is absent, but the selected key must still propagate to
    // GITHUB_ENV so the downstream agent step can authenticate.
    const envContent = readGithubEnv();
    expect(envContent).toContain('OPENAI_API_KEY');
    expect(envContent).toContain('primary-secret');
  });

  it('falls back to first configured key when both Synthetic quota probes fail', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(failingResponse(500))
        .mockResolvedValueOnce(failingResponse(500)),
    );

    await main();

    expect(readGithubOutput()).toBe('selected_key=primary\n');
    // The selected key must propagate to GITHUB_ENV for the agent step.
    expect(readGithubEnv()).toContain('primary-secret');
  });

  it('falls back to secondary when primary is absent and both probes fail', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(failingResponse(500))
        .mockResolvedValueOnce(failingResponse(500)),
    );

    await main();

    expect(readGithubOutput()).toBe('selected_key=secondary\n');
    // The selected key must propagate to GITHUB_ENV for the agent step.
    expect(readGithubEnv()).toContain('secondary-secret');
  });

  it('selects key2 when key1 probe fails but key2 succeeds', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(failingResponse(500))
        .mockResolvedValueOnce(quotaResponse(10)),
    );

    await main();

    expect(readGithubOutput()).toBe('selected_key=secondary\n');
  });

  it('selects key1 when key2 probe fails but key1 succeeds', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(quotaResponse(10))
        .mockResolvedValueOnce(failingResponse(500)),
    );

    await main();

    expect(readGithubOutput()).toBe('selected_key=primary\n');
  });

  it('selects key1 when only key1 is configured (key2 absent)', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    delete process.env.OPENAI_API_KEY_2;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(quotaResponse(10)));

    await main();

    expect(readGithubOutput()).toBe('selected_key=primary\n');
  });

  it('selects key2 when only key2 is configured (key1 absent)', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    // Only key2 is configured so checkQuota is called exactly once (for key2).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(quotaResponse(10)));

    await main();

    expect(readGithubOutput()).toBe('selected_key=secondary\n');
  });

  it('exits with error when no keys are configured', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY_2;

    // Production calls process.exit(1); vitest intercepts it as a thrown
    // error. Assert the specific exit code so the test does not silently pass
    // on an unrelated runtime error.
    await expect(main()).rejects.toThrow(
      'process.exit unexpectedly called with "1"',
    );
  });

  it('uses secondary for non-Synthetic when only key2 is configured', async () => {
    process.env.KEY_VAR_NAME = 'OPENAI_KEY';
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await main();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(readGithubOutput()).toBe('selected_key=secondary\n');
    // The selected key must propagate to GITHUB_ENV for the agent step.
    expect(readGithubEnv()).toContain('secondary-secret');
  });

  it('exits with error for non-Synthetic when no keys are configured', async () => {
    process.env.KEY_VAR_NAME = 'OPENAI_KEY';
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY_2;

    // Production calls process.exit(1); vitest intercepts it as a thrown
    // error. Assert the specific exit code so the test does not silently pass
    // on an unrelated runtime error.
    await expect(main()).rejects.toThrow(
      'process.exit unexpectedly called with "1"',
    );
  });

  it('rejects when primary is known over quota and the secondary probe fails', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(quotaResponse(95))
        .mockResolvedValueOnce(failingResponse()),
    );

    await expect(main()).rejects.toThrow('No verified API key');
    expectNoGithubOutputFile();
  });

  it('rejects when secondary is known over quota and the primary probe fails', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(failingResponse())
        .mockResolvedValueOnce(quotaResponse(95)),
    );

    await expect(main()).rejects.toThrow('No verified API key');
    expectNoGithubOutputFile();
  });

  it.each([
    ['negative requests', { limit: 100, requests: -1 }],
    ['fractional requests', { limit: 100, requests: 1.5 }],
    ['fractional limit', { limit: 100.5, requests: 1 }],
    ['nonfinite limit', { limit: null, requests: 1 }],
  ])(
    'rejects invalid %s counters in favor of a verified key',
    async (_label, subscription) => {
      process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
      process.env.OPENAI_API_KEY = 'primary-secret';
      process.env.OPENAI_API_KEY_2 = 'secondary-secret';
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ subscription }), { status: 200 }),
          )
          .mockResolvedValueOnce(quotaResponse(10)),
      );

      await main();

      expect(readGithubOutput()).toBe('selected_key=secondary\n');
    },
  );

  it('rejects without writing GITHUB_OUTPUT or GITHUB_ENV when both keys exceed 90% quota', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(quotaResponse(95))
        .mockResolvedValueOnce(quotaResponse(95)),
    );

    await expect(main()).rejects.toThrow();

    expectNoGithubOutputFile();
    expectNoGithubEnvFile();
  });

  it('accepts both keys when usage is exactly at the 90% threshold', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(quotaResponse(90))
        .mockResolvedValueOnce(quotaResponse(90)),
    );

    await main();

    expect(readGithubOutput()).toBe('selected_key=primary\n');
    // The selected key must propagate to GITHUB_ENV for the agent step.
    expect(readGithubEnv()).toContain('primary-secret');
  });

  it('writes no GITHUB_OUTPUT or GITHUB_ENV content when the quota check rejects', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'primary-secret';
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(quotaResponse(100))
        .mockResolvedValueOnce(quotaResponse(100)),
    );

    await expect(main()).rejects.toThrow();

    expectNoGithubOutputFile();
    expectNoGithubEnvFile();
  });

  it('rejects a CR/LF API key in the Synthetic path without writing files', async () => {
    process.env.KEY_VAR_NAME = 'SYNTHETIC_API_KEY';
    process.env.OPENAI_API_KEY = 'evil\nGITHUB_TOKEN=stolen';
    process.env.OPENAI_API_KEY_2 = 'secondary-secret';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(quotaResponse(10))
        .mockResolvedValueOnce(quotaResponse(10)),
    );

    await expect(main()).rejects.toThrow(/CR\/LF/);

    expectNoGithubOutputFile();
    expectNoGithubEnvFile();
  });

  it('rejects a CR/LF API key in the non-Synthetic path without writing files', async () => {
    process.env.KEY_VAR_NAME = 'OPENAI_KEY';
    process.env.OPENAI_API_KEY = 'evil\nGITHUB_TOKEN=stolen';

    await expect(main()).rejects.toThrow(/CR\/LF/);

    expectNoGithubOutputFile();
    expectNoGithubEnvFile();
  });

  it('rejects a CR-only API key in the non-Synthetic path without writing files', async () => {
    process.env.KEY_VAR_NAME = 'OPENAI_KEY';
    process.env.OPENAI_API_KEY = 'evil\r\nmalicious';

    await expect(main()).rejects.toThrow(/CR\/LF/);

    expectNoGithubOutputFile();
    expectNoGithubEnvFile();
  });
});
