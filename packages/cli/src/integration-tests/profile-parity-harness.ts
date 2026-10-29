/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared harness for the real noninteractive CLI profile authentication parity
 * suites (#3448, #3629, #2644). Each provider owns its own integration file so
 * that the files run as independent units of the shard runner; the launch,
 * isolation and assertion machinery they share lives here.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
} from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { scryptSync } from 'node:crypto';
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
import { windowsChildEnv } from '../__tests__/windows-child-env.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const preload = fileURLToPath(
  new URL('./__tests__/profile-auth-transport.preload.ts', import.meta.url),
);
const scratchRoot = resolve(root, '../../tmp/verify3448');

export const observationSchema = z.object({
  url: z.string(),
  model: z.string(),
  credentialHash: z.string(),
  accountId: z.string().nullable(),
  authorizationKind: z.enum(['bearer', 'other', 'absent']),
  apiKeyPresent: z.boolean(),
  oauthBeta: z.boolean(),
  promptPresent: z.boolean(),
});
export const networkEventSchema = z.object({
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

export const credential = 'sk-synthetic-profile-parity-3448';
export const probeCredential = 'synthetic-probe-secret';
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

export interface ProfileInput {
  readonly provider: string;
  readonly model: string;
  readonly ephemeralSettings?: Readonly<Record<string, unknown>>;
}
export interface ProviderParityInput extends ProfileInput {
  readonly host: string;
}
export interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly requests: ReadonlyArray<z.infer<typeof observationSchema>>;
  readonly events: ReadonlyArray<z.infer<typeof boundaryEventSchema>>;
}
export type ProcessOutcome = Omit<RunResult, 'requests' | 'events'>;

export const CHILD_TIMEOUT_MS = 60000;
/** Whole-case budget for a case that launches the CLI twice. */
export const PAIR_CASE_TIMEOUT_MS = 120000;

function isolatedEnv(
  dir: string,
  transpilerCachePath: string,
): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: dir,
    TMPDIR: join(dir, 'temp'),
    ...windowsChildEnv(dir, join(dir, 'temp')),
    LLXPRT_CONFIG_HOME: join(dir, 'config'),
    LLXPRT_DATA_HOME: join(dir, 'data'),
    LLXPRT_STATE_HOME: join(dir, 'state'),
    LLXPRT_CACHE_HOME: join(dir, 'cache'),
    LLXPRT_LOG_HOME: join(dir, 'logs'),
    XDG_CONFIG_HOME: join(dir, 'xdg-config'),
    XDG_DATA_HOME: join(dir, 'xdg-data'),
    XDG_STATE_HOME: join(dir, 'xdg-state'),
    XDG_CACHE_HOME: join(dir, 'xdg-cache'),
    // Bun keeps its transpiled-source cache under the cache/home directories
    // the line above isolates, so every launch would transpile the whole CLI
    // from scratch. A cache shared across one file's launches is keyed by
    // source content and carries no test state.
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: transpilerCachePath,
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

export interface RunProcessOptions {
  /**
   * Terminates the child from this process as soon as its stderr contains this
   * text. Windows reports a terminated child as an ordinary exit code with no
   * signal, so an intentional interruption must be recorded by the parent that
   * performed it rather than inferred from the exit status.
   */
  readonly terminateWhenStderrContains?: string;
}

/** Written by the preload the moment the child's test transport is installed. */
const PRELOAD_MARKER = 'preload-loaded';

/** Wall-clock stamps of one launch, used to say where a hung child stalled. */
interface LaunchTimeline {
  readonly spawnedAt: number;
  firstOutputAt?: number;
  exitedAt?: number;
  closedAt?: number;
}

/**
 * Ends a child together with every process it started. A descendant that
 * outlives its parent keeps the case directory open as its working directory,
 * which on Windows fails the later removal with EBUSY and hides the real error.
 * Windows has no process groups to signal, and `taskkill /T` finds descendants
 * only through a live parent, so the tree must be ended while the root runs.
 */
function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
    });
    if (result.error !== undefined) throw result.error;
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    // The group is already gone: the child exited between the decision to end
    // it and this call.
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
      throw error;
  }
}

async function statIfPresent(
  path: string,
): Promise<{ readonly size: number; readonly mtimeMs: number } | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
}

/**
 * Names how far a launch got, so a hung child reports the stage that stalled:
 * Bun boot and preload, CLI startup up to the first inference request, CLI
 * shutdown up to process exit, and stdio drain up to close.
 */
async function describeStages(
  dir: string,
  timeline: LaunchTimeline,
): Promise<string> {
  const since = (at: number | undefined): string =>
    at === undefined
      ? 'not reached'
      : `+${Math.round(at - timeline.spawnedAt)}ms`;
  const preload = await statIfPresent(join(dir, PRELOAD_MARKER));
  // The log is emptied before each launch, so content means a request arrived.
  const requests = await statIfPresent(join(dir, 'requests.jsonl'));
  return [
    `preload loaded ${since(preload?.mtimeMs)}`,
    `first output ${since(timeline.firstOutputAt)}`,
    `last request logged ${since(requests !== undefined && requests.size > 0 ? requests.mtimeMs : undefined)}`,
    `exit ${since(timeline.exitedAt)}`,
    `close ${since(timeline.closedAt)}`,
  ].join(', ');
}

async function launchProcess(
  dir: string,
  transpilerCachePath: string,
  args: readonly string[],
  options: RunProcessOptions,
): Promise<ProcessOutcome> {
  await rm(join(dir, PRELOAD_MARKER), { force: true });
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--preload', preload, ...args], {
      cwd: dir,
      env: isolatedEnv(dir, transpilerCachePath),
      stdio: ['ignore', 'pipe', 'pipe'],
      // A POSIX group lets the whole tree be signalled; Windows ends it by pid.
      detached: process.platform !== 'win32',
    });
    const timeline: LaunchTimeline = { spawnedAt: Date.now() };
    let stdout = '';
    let stderr = '';
    let termination: string | undefined;
    const terminate = (reason: string): void => {
      if (termination !== undefined) return;
      termination = reason;
      killProcessTree(child);
    };
    const timer = setTimeout(
      () => terminate(`timeout after ${CHILD_TIMEOUT_MS}ms`),
      CHILD_TIMEOUT_MS,
    );
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      timeline.firstOutputAt ??= Date.now();
      stdout += data;
    });
    child.stderr.on('data', (data: string) => {
      timeline.firstOutputAt ??= Date.now();
      stderr += data;
      const marker = options.terminateWhenStderrContains;
      if (marker !== undefined && stderr.includes(marker)) {
        terminate('SIGTERM requested by the parent');
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', () => {
      timeline.exitedAt = Date.now();
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      timeline.closedAt = Date.now();
      const interruption =
        termination ?? (signal === null ? undefined : `signal ${signal}`);
      if (interruption === undefined) {
        resolvePromise({ stdout, stderr, exitCode: code ?? -1 });
        return;
      }
      describeStages(dir, timeline).then(
        (stages) =>
          reject(
            new Error(
              `Profile parity child terminated by ${interruption}\n` +
                `stages since spawn: ${stages}\n` +
                `stdout: ${stdout}\nstderr: ${stderr}`,
            ),
          ),
        reject,
      );
    });
  });
}

export function expectCredentialIdentity(
  observed: string,
  expectedCredential: string,
): void {
  expect(observed).toBe(
    scryptSync(
      expectedCredential,
      'synthetic-profile-parity-3448',
      32,
    ).toString('hex'),
  );
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

function parseJsonLines<T>(text: string, schema: z.ZodType<T>): T[] {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => schema.parse(JSON.parse(line)));
}

export type OAuthSettings = boolean | 'absent' | 'entry-absent';

export interface ParityFixture {
  /** Isolated working directory of the running case. */
  readonly dir: string;
  runProcess(
    args: readonly string[],
    options?: RunProcessOptions,
  ): Promise<ProcessOutcome>;
  /** Clears the request and boundary-event logs before a launch. */
  resetObservations(): Promise<void>;
  readBoundaryEvents<T>(schema: z.ZodType<T>): Promise<T[]>;
  readRequestLog(): Promise<string>;
  configureOAuth(
    provider: string,
    settings: OAuthSettings,
    stored: boolean,
  ): Promise<void>;
  runPair(input: ProfileInput): Promise<readonly [RunResult, RunResult]>;
}

async function writeOAuthState(
  dir: string,
  provider: string,
  settings: OAuthSettings,
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

async function runProfilePair(
  fixture: ParityFixture,
  input: ProfileInput,
): Promise<readonly [RunResult, RunResult]> {
  const { dir } = fixture;
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
    await fixture.resetObservations();
    const { stdout, stderr, exitCode } = await fixture.runProcess([
      join(root, 'index.ts'),
      ...args,
      '--prompt',
      'Reply with exactly: PROFILE_PARITY_OK',
      '--yolo',
    ]);
    const requests = parseJsonLines(
      await fixture.readRequestLog(),
      observationSchema,
    );
    const events = await fixture.readBoundaryEvents(boundaryEventSchema);
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

/**
 * Registers the lifecycle hooks of one parity file and returns its fixture.
 * Call inside the file's top-level `describe`.
 */
export function installParityFixture(): ParityFixture {
  let dir = '';
  let transpilerCachePath = '';

  beforeAll(async () => {
    await mkdir(scratchRoot, { recursive: true });
    transpilerCachePath = await mkdtemp(join(scratchRoot, 'bun-cache-'));
  });

  afterAll(async () => {
    await rm(transpilerCachePath, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(scratchRoot, 'parity-'));
    await mkdir(join(dir, 'config/profiles'), { recursive: true });
    await mkdir(join(dir, 'temp'), { recursive: true });
    await writeFile(join(dir, 'keyring.json'), '{}');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const fixture: ParityFixture = {
    get dir(): string {
      return dir;
    },

    runProcess: (args, options = {}) =>
      launchProcess(dir, transpilerCachePath, args, options),

    async resetObservations(): Promise<void> {
      await writeFile(join(dir, 'requests.jsonl'), '');
      await writeFile(join(dir, 'boundary-events.jsonl'), '');
    },

    readBoundaryEvents: async (schema) =>
      parseJsonLines(
        await readFile(join(dir, 'boundary-events.jsonl'), 'utf8'),
        schema,
      ),

    readRequestLog: () => readFile(join(dir, 'requests.jsonl'), 'utf8'),

    configureOAuth: (provider, settings, stored) =>
      writeOAuthState(dir, provider, settings, stored),

    runPair: (input) => runProfilePair(fixture, input),
  };
  return fixture;
}

export function expectSuccess(
  result: RunResult,
  input: ProviderParityInput,
  oauth: boolean,
): void {
  expect({ code: result.exitCode, errors: result.stderr }).toStrictEqual({
    code: 0,
    errors: expect.any(String),
  });
  expect(result.stdout).toContain('PROFILE_PARITY_OK');
  expect(result.requests.length).toBeGreaterThan(0);
  for (const request of result.requests) {
    expect(new URL(request.url).hostname).toBe(input.host);
    expect(request.url).toBe(inferenceEndpoints[input.provider]);
    expect(request.model).toBe(input.model);
    expect(request.authorizationKind).toBe(
      oauth || input.provider === 'openai' ? 'bearer' : 'absent',
    );
    expect(request.apiKeyPresent).toBe(
      !oauth && input.provider === 'anthropic',
    );
    expect(request.oauthBeta).toBe(oauth && input.provider === 'claudecode');
    expectCredentialIdentity(
      request.credentialHash,
      oauth ? oauthCredentials[input.provider] : credential,
    );
    expect(request.accountId).toBe(
      oauth && input.provider === 'codex' ? accountId : null,
    );
    expect(request.promptPresent).toBe(true);
  }
}

export function expectAuthFailure(result: RunResult): void {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).not.toContain('PROFILE_PARITY_OK');
  expect(result.stderr).toMatch(
    /authentication|authenticate|OAuth|auth.*login/i,
  );
  expect(result.requests).toStrictEqual([]);
  expect(result.events).toStrictEqual([]);
}

interface OAuthFailureScenario {
  readonly name: string;
  readonly settings: OAuthSettings;
  readonly stored: boolean;
}

const oauthFailureScenarios: readonly OAuthFailureScenario[] = [
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
];

/** Registers every stored-OAuth case of one provider. */
export function registerOAuthProviderCases(
  fixture: ParityFixture,
  input: ProviderParityInput,
): void {
  it(
    `${input.provider}: enabled stored OAuth sends the same identity/model through named and inline profiles`,
    async () => {
      await fixture.configureOAuth(input.provider, true, true);
      const pair = await fixture.runPair(input);
      for (const result of pair) expectSuccess(result, input, true);
      expect(pair.map((result) => result.exitCode)).toStrictEqual([0, 0]);
    },
    PAIR_CASE_TIMEOUT_MS,
  );

  for (const scenario of oauthFailureScenarios) {
    it(
      `${input.provider}: ${scenario.name} fails terminally on both routes without login or persistence`,
      async () => {
        await fixture.configureOAuth(
          input.provider,
          scenario.settings,
          scenario.stored,
        );
        const pair = await fixture.runPair(input);
        for (const result of pair) expectAuthFailure(result);
        expect(pair.map((result) => result.exitCode)).toStrictEqual([1, 1]);
        expect(
          pair.every((result) =>
            result.stderr.includes('Non-interactive run failed: [API Error:'),
          ),
        ).toBe(true);
      },
      PAIR_CASE_TIMEOUT_MS,
    );
  }
}

const apiCredentialSources = ['auth-key', 'auth-keyfile', 'auth-key-name'];

/** Registers every API-credential-source case of one provider. */
export function registerApiProviderCases(
  fixture: ParityFixture,
  input: ProviderParityInput,
): void {
  for (const source of apiCredentialSources) {
    it(
      `${input.provider}: ${source} sends the same API credential/model through named and inline profiles`,
      async () => {
        const keyfile = join(fixture.dir, 'api-key');
        await writeFile(keyfile, `  ${credential}\n`, { mode: 0o600 });
        await writeFile(
          join(fixture.dir, 'keyring.json'),
          JSON.stringify({
            'llxprt-code-provider-keys/parity-key': credential,
          }),
        );
        const authSources: Readonly<Record<string, string>> = {
          'auth-key': credential,
          'auth-keyfile': keyfile,
          'auth-key-name': 'parity-key',
        };
        const pair = await fixture.runPair({
          ...input,
          ephemeralSettings: { [source]: authSources[source] },
        });
        for (const result of pair) expectSuccess(result, input, false);
        expect(pair.map((result) => result.exitCode)).toStrictEqual([0, 0]);
      },
      PAIR_CASE_TIMEOUT_MS,
    );
  }
}

export const claudecodeParity: ProviderParityInput = {
  provider: 'claudecode',
  model: 'claude-opus-4-1-20250805',
  host: 'api.anthropic.com',
  ephemeralSettings: { 'base-url': 'https://api.anthropic.com' },
};
export const codexParity: ProviderParityInput = {
  provider: 'codex',
  model: 'gpt-5.2-codex',
  host: 'chatgpt.com',
};
export const anthropicParity: ProviderParityInput = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  host: 'api.anthropic.com',
};
export const openaiParity: ProviderParityInput = {
  provider: 'openai',
  model: 'gpt-4o',
  host: 'api.openai.com',
};

export const parityDescription =
  'real noninteractive CLI profile authentication parity (#3448, #3629, #2644)';
