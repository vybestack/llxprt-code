/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preload = fileURLToPath(
  new URL('./__tests__/profile-auth-transport.preload.ts', import.meta.url),
);
const observationSchema = z.object({
  url: z.string(),
  model: z.string(),
  credentialHash: z.string(),
  accountId: z.string().nullable(),
  authorizationKind: z.enum(['bearer', 'other', 'absent']),
  apiKeyPresent: z.boolean(),
  oauthBeta: z.boolean(),
  promptPresent: z.boolean(),
});
const networkEventSchema = z.object({
  operation: z.literal('unexpected-network'),
  transport: z.enum(['http', 'websocket']),
  method: z.string(),
  endpoint: z.string(),
});
const boundaryEventSchema = z.union([
  networkEventSchema,
  z.object({
    operation: z.enum(['browser', 'credential-write', 'credential-delete']),
  }),
]);
const oauthProviders = [
  {
    provider: 'claudecode',
    model: 'claude-opus-4-1-20250805',
    host: 'api.anthropic.com',
    ephemeralSettings: { 'base-url': 'https://api.anthropic.com' },
  },
  { provider: 'codex', model: 'gpt-5.2-codex', host: 'chatgpt.com' },
];
const apiProviders = [
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    host: 'api.anthropic.com',
  },
  { provider: 'openai', model: 'gpt-4o', host: 'api.openai.com' },
];
const credential = 'sk-synthetic-profile-parity-3448';
const probeCredential = 'synthetic-probe-secret';
const accountId = 'synthetic-account-3448';
const oauthCredentials: Readonly<Record<string, string>> = {
  claudecode: 'sk-ant-oat-synthetic-profile-parity-3448',
  codex: 'synthetic-codex-oauth-profile-parity-3448',
};
const inferenceEndpoints: Readonly<Record<string, string>> = {
  claudecode: 'https://api.anthropic.com/v1/messages',
  codex: 'wss://chatgpt.com/backend-api/codex/responses',
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
};

interface ProfileInput {
  readonly provider: string;
  readonly model: string;
  readonly ephemeralSettings?: Readonly<Record<string, unknown>>;
}
interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly requests: ReadonlyArray<z.infer<typeof observationSchema>>;
  readonly events: ReadonlyArray<z.infer<typeof boundaryEventSchema>>;
}

function isolatedEnv(dir: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: dir,
    USERPROFILE: dir,
    TMPDIR: join(dir, 'temp'),
    LLXPRT_CONFIG_HOME: join(dir, 'config'),
    LLXPRT_DATA_HOME: join(dir, 'data'),
    LLXPRT_STATE_HOME: join(dir, 'state'),
    LLXPRT_CACHE_HOME: join(dir, 'cache'),
    LLXPRT_LOG_HOME: join(dir, 'logs'),
    XDG_CONFIG_HOME: join(dir, 'xdg-config'),
    XDG_DATA_HOME: join(dir, 'xdg-data'),
    XDG_STATE_HOME: join(dir, 'xdg-state'),
    XDG_CACHE_HOME: join(dir, 'xdg-cache'),
    LLXPRT_TEST_DISABLE_OS_KEYRING: '0',
    LLXPRT_CLI_NO_RELAUNCH: 'true',
    LLXPRT_TELEMETRY: 'false',
    LLXPRT_NO_BROWSER_AUTH: 'true',
    PROFILE_PARITY_DIR: dir,
    NODE_ENV: 'production',
    CI: 'true',
    NO_COLOR: '1',
  };
}

async function runProcess(
  dir: string,
  args: readonly string[],
): Promise<Omit<RunResult, 'requests' | 'events'>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--preload', preload, ...args], {
      cwd: dir,
      env: isolatedEnv(dir),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      stdout += data;
    });
    child.stderr.on('data', (data: string) => {
      stderr += data;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ stdout, stderr, exitCode: code ?? -1 }),
    );
  });
}

async function optionalFile(
  path: string,
): Promise<{ readonly content: string; readonly mtimeNs: bigint } | null> {
  try {
    const content = await readFile(path, 'utf8');
    const metadata = await stat(path, { bigint: true });
    return { content, mtimeNs: metadata.mtimeNs };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return null;
    throw error;
  }
}

describe('real noninteractive CLI profile authentication parity (#3448, #3629, #2644)', () => {
  let dir: string;

  beforeEach(async () => {
    await mkdir(resolve(root, '../../tmp/verify3448'), { recursive: true });
    dir = await mkdtemp(resolve(root, '../../tmp/verify3448/parity-'));
    await mkdir(join(dir, 'config/profiles'), { recursive: true });
    await mkdir(join(dir, 'temp'), { recursive: true });
    await writeFile(join(dir, 'keyring.json'), '{}');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function configureOAuth(
    provider: string,
    settings: boolean | 'absent' | 'entry-absent',
    stored: boolean,
  ): Promise<void> {
    if (settings !== 'absent') {
      await writeFile(
        join(dir, 'config/settings.json'),
        JSON.stringify({
          oauthEnabledProviders:
            settings === 'entry-absent' ? {} : { [provider]: settings },
        }),
      );
    }
    await writeFile(
      join(dir, 'keyring.json'),
      JSON.stringify(
        stored
          ? {
              [`llxprt-code-oauth/${provider}:default`]: JSON.stringify({
                access_token: oauthCredentials[provider],
                refresh_token: 'synthetic-refresh-never-used',
                expiry: Math.floor(Date.now() / 1000) + 86400,
                token_type: 'Bearer',
                scope: 'user:inference',
                account_id: accountId,
              }),
            }
          : {},
      ),
    );
  }

  async function runPair(
    input: ProfileInput,
  ): Promise<readonly [RunResult, RunResult]> {
    const profile = JSON.stringify({
      version: 1,
      provider: input.provider,
      model: input.model,
      modelParams: {},
      ephemeralSettings: input.ephemeralSettings ?? {},
    });
    await writeFile(join(dir, 'config/profiles/parity.json'), profile);
    const authorityBefore = {
      settings: await optionalFile(join(dir, 'config/settings.json')),
      credentials: await optionalFile(join(dir, 'keyring.json')),
    };
    const results: RunResult[] = [];
    for (const args of [
      ['--profile-load', 'parity'],
      ['--profile', profile],
    ]) {
      await writeFile(join(dir, 'requests.jsonl'), '');
      await writeFile(join(dir, 'boundary-events.jsonl'), '');
      const { stdout, stderr, exitCode } = await runProcess(dir, [
        join(root, 'index.ts'),
        ...args,
        '--prompt',
        'Reply with exactly: PROFILE_PARITY_OK',
        '--yolo',
      ]);
      const requests = (await readFile(join(dir, 'requests.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => observationSchema.parse(JSON.parse(line)));
      const events = (
        await readFile(join(dir, 'boundary-events.jsonl'), 'utf8')
      )
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => boundaryEventSchema.parse(JSON.parse(line)));
      results.push({ stdout, stderr, exitCode, requests, events });
      expect({
        settings: await optionalFile(join(dir, 'config/settings.json')),
        credentials: await optionalFile(join(dir, 'keyring.json')),
      }).toStrictEqual(authorityBefore);
      expect(events).toStrictEqual([]);
      for (const secret of [
        credential,
        ...Object.values(oauthCredentials),
        'synthetic-refresh-never-used',
      ]) {
        expect(
          stdout + stderr + JSON.stringify({ requests, events }),
        ).not.toContain(secret);
      }
    }
    const [named, inline] = results;
    expect({ code: inline.exitCode, stderr: inline.stderr }).toStrictEqual({
      code: named.exitCode,
      stderr: expect.any(String),
    });
    expect(inline.requests).toStrictEqual(named.requests);
    return [named, inline];
  }

  function expectSuccess(
    result: RunResult,
    input: ProfileInput,
    host: string,
    oauth: boolean,
  ): void {
    expect({ code: result.exitCode, errors: result.stderr }).toStrictEqual({
      code: 0,
      errors: expect.any(String),
    });
    expect(result.stdout).toContain('PROFILE_PARITY_OK');
    expect(result.requests.length).toBeGreaterThan(0);
    for (const request of result.requests) {
      expect(new URL(request.url).hostname).toBe(host);
      expect(request.url).toBe(inferenceEndpoints[input.provider]);
      expect(request.model).toBe(input.model);
      expect(request.authorizationKind).toBe(
        oauth || input.provider === 'openai' ? 'bearer' : 'absent',
      );
      expect(request.apiKeyPresent).toBe(
        !oauth && input.provider === 'anthropic',
      );
      expect(request.oauthBeta).toBe(oauth && input.provider === 'claudecode');
      expect(request.credentialHash).toBe(
        createHash('sha256')
          .update(oauth ? oauthCredentials[input.provider] : credential)
          .digest('hex'),
      );
      expect(request.accountId).toBe(
        oauth && input.provider === 'codex' ? accountId : null,
      );
      expect(request.promptPresent).toBe(true);
    }
  }

  function expectAuthFailure(result: RunResult): void {
    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('PROFILE_PARITY_OK');
    expect(result.stderr).toMatch(
      /authentication|authenticate|OAuth|auth.*login/i,
    );
    expect(result.requests).toStrictEqual([]);
    expect(result.events).toStrictEqual([]);
  }

  describe('test transport boundary sensitivity', () => {
    async function probe(source: string): Promise<{
      readonly outcome: Omit<RunResult, 'requests' | 'events'>;
      readonly events: ReadonlyArray<z.infer<typeof networkEventSchema>>;
      readonly requests: string;
    }> {
      await writeFile(join(dir, 'requests.jsonl'), '');
      await writeFile(join(dir, 'boundary-events.jsonl'), '');
      const outcome = await runProcess(dir, [
        '--eval',
        `try { ${source} } catch (error) {
          process.stderr.write((error instanceof Error ? error.message : 'Boundary rejection') + '\\n');
          process.exit(1);
        }`,
      ]);
      const events = (
        await readFile(join(dir, 'boundary-events.jsonl'), 'utf8')
      )
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => networkEventSchema.parse(JSON.parse(line)));
      const requests = await readFile(join(dir, 'requests.jsonl'), 'utf8');
      expect(JSON.stringify({ outcome, events, requests })).not.toContain(
        probeCredential,
      );
      return { outcome, events, requests };
    }

    const transports: ReadonlyArray<
      z.infer<typeof networkEventSchema>['transport']
    > = ['http', 'websocket'];

    for (const transport of transports) {
      it(`${transport}: rejects and records a wrong Codex endpoint before returning inference`, async () => {
        const endpoint =
          transport === 'http'
            ? 'https://chatgpt.com/not-codex/responses'
            : 'wss://chatgpt.com/not-codex/responses';
        const source =
          transport === 'http'
            ? `await fetch('${endpoint}', { method: 'POST', body: JSON.stringify({model: 'gpt-5.2-codex'}) });`
            : `const { WebSocket } = await import('undici');
               const socket = new WebSocket('${endpoint}', { headers: { Authorization: 'Bearer ${probeCredential}' } });
               socket.addEventListener('open', () => socket.send(JSON.stringify({model: 'gpt-5.2-codex'})));`;
        const result = await probe(source);
        expect(result.outcome.exitCode).toBe(1);
        expect(result.outcome.stderr).toContain('Unexpected network endpoint');
        expect(result.events).toStrictEqual([
          {
            operation: 'unexpected-network',
            transport,
            method: transport === 'http' ? 'POST' : 'CONNECT',
            endpoint,
          },
        ]);
        expect(result.requests).toBe('');
      });
    }

    it('records an external GET before rejecting it without leaking URL credentials', async () => {
      const result = await probe(
        `await fetch('https://auth.openai.com/authorize?code=${probeCredential}');`,
      );
      expect(result.outcome.exitCode).toBe(1);
      expect(result.outcome.stderr).toContain('Unexpected network request');
      expect(result.events).toStrictEqual([
        {
          operation: 'unexpected-network',
          transport: 'http',
          method: 'GET',
          endpoint: 'https://auth.openai.com/authorize',
        },
      ]);
      expect(result.requests).toBe('');
    });

    it('records an OAuth POST before attempting inference model parsing', async () => {
      const result = await probe(
        `await fetch('https://auth.openai.com/oauth/token?code=${probeCredential}', {
          method: 'POST',
          headers: { Authorization: 'Bearer ${probeCredential}' },
          body: JSON.stringify({grant_type: 'refresh_token', refresh_token: '${probeCredential}'})
        });`,
      );
      expect(result.outcome.exitCode).toBe(1);
      expect(result.outcome.stderr).toContain('Unexpected network endpoint');
      expect(result.outcome.stderr).not.toContain('ZodError');
      expect(result.events).toStrictEqual([
        {
          operation: 'unexpected-network',
          transport: 'http',
          method: 'POST',
          endpoint: 'https://auth.openai.com/oauth/token',
        },
      ]);
      expect(result.requests).toBe('');
    });

    it('reads a local data URL without classifying it as an external network attempt', async () => {
      const result = await probe(
        `const response = await fetch('data:text/plain,local-fixture');
         if (response.status !== 200 || await response.text() !== 'local-fixture') throw new Error('Local data URL failed');`,
      );
      expect(result.outcome.exitCode).toBe(0);
      expect(result.outcome.stderr).toBe('');
      expect(result.events).toStrictEqual([]);
      expect(result.requests).toBe('');
    });
  });

  for (const input of oauthProviders) {
    it(`${input.provider}: enabled stored OAuth sends the same identity/model through named and inline profiles`, async () => {
      await configureOAuth(input.provider, true, true);
      const pair = await runPair(input);
      for (const result of pair) expectSuccess(result, input, input.host, true);
      expect(pair.map((result) => result.exitCode)).toStrictEqual([0, 0]);
    }, 120000);

    for (const scenario of [
      {
        name: 'explicitly disabled with stored token',
        settings: false,
        stored: true,
      },
      { name: 'enabled with missing token', settings: true, stored: false },
      {
        name: 'absent settings with stored token',
        settings: 'absent',
        stored: true,
      },
      {
        name: 'absent provider entry with stored token',
        settings: 'entry-absent',
        stored: true,
      },
    ]) {
      it(`${input.provider}: ${scenario.name} fails terminally on both routes without login or persistence`, async () => {
        const settings = scenario.settings;
        if (
          settings !== true &&
          settings !== false &&
          settings !== 'absent' &&
          settings !== 'entry-absent'
        )
          throw new Error('Invalid scenario');
        await configureOAuth(input.provider, settings, scenario.stored);
        const pair = await runPair(input);
        for (const result of pair) expectAuthFailure(result);
        expect(pair.map((result) => result.exitCode)).toStrictEqual([1, 1]);
        expect(
          pair.every((result) =>
            result.stderr.includes('Non-interactive run failed: [API Error:'),
          ),
        ).toBe(true);
      }, 120000);
    }
  }

  for (const input of apiProviders) {
    for (const source of ['auth-key', 'auth-keyfile', 'auth-key-name']) {
      it(`${input.provider}: ${source} sends the same API credential/model through named and inline profiles`, async () => {
        const keyfile = join(dir, 'api-key');
        await writeFile(keyfile, `  ${credential}\n`, { mode: 0o600 });
        await writeFile(
          join(dir, 'keyring.json'),
          JSON.stringify({
            'llxprt-code-provider-keys/parity-key': credential,
          }),
        );
        const authSources: Readonly<Record<string, string>> = {
          'auth-key': credential,
          'auth-keyfile': keyfile,
          'auth-key-name': 'parity-key',
        };
        const profile = {
          ...input,
          ephemeralSettings: { [source]: authSources[source] },
        };
        const pair = await runPair(profile);
        for (const result of pair)
          expectSuccess(result, input, input.host, false);
        expect(pair.map((result) => result.exitCode)).toStrictEqual([0, 0]);
      }, 120000);
    }
  }
});
