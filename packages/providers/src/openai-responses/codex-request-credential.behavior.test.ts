import { withFetchPreconnect } from '../../../test-utils/src/fetch-test-helpers.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3991: a Codex request carries ONE authorization result.
 *
 * Real graph: SecureStore -> KeyringTokenStore -> OAuthManager (real Codex
 * flow registration) -> AuthPrecedenceResolver -> Codex provider -> Responses
 * executor. Only the OS keyring and the network (WebSocket transport and
 * `fetch`) are doubled. Observations are made on the wire: the Authorization
 * and ChatGPT-Account-ID headers of WS handshakes and HTTP POSTs, the request
 * dump files, and the number of credential-store reads.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
  type Mock,
} from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CredentialResolutionError,
  KeyringTokenStore,
} from '@vybestack/llxprt-code-auth';
import type { CodexOAuthToken, OAuthToken } from '@vybestack/llxprt-code-auth';
import {
  SecureStore,
  Storage,
  type KeyringAdapter,
} from '@vybestack/llxprt-code-storage';
import { resetOsKeyringSessionForTesting } from '@vybestack/llxprt-code-storage/storage/secure-store.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Profile } from '@vybestack/llxprt-code-settings/profiles/types.js';
import { restoreEnv, setEnv } from '@vybestack/llxprt-code-test-utils';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { streamCallOptions as createProviderCallOptions } from '../__tests__/streamCallOptions.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import { registerStandardOAuthProviders } from '../composition/oauth-provider-registration.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import type {
  StreamResponseOptions,
  WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const ACCOUNT_BY_BEARER: Readonly<Record<string, string>> = {
  'access-A': 'acct-A',
  'access-B': 'acct-B',
  'access-team-a': 'acct-team-a',
  'access-team-b': 'acct-team-b',
};

type Label = 'A' | 'B' | 'team-a' | 'team-b';

function token(label: Label): CodexOAuthToken {
  return {
    access_token: `access-${label}`,
    refresh_token: `refresh-${label}`,
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    scope: 'openid',
    account_id: `acct-${label}`,
  };
}

/** A keyring whose reads can be counted, blanked, failed, or held open. */
class ScriptedKeyring implements KeyringAdapter {
  private readonly entries = new Map<string, string>();
  reads = 0;
  private nullFrom = Number.POSITIVE_INFINITY;
  private nullCount = 0;
  private readFailure: Error | undefined;
  private readGate: Promise<void> | undefined;

  nullReads(first: number, count: number): void {
    this.nullFrom = first;
    this.nullCount = count;
  }
  failReads(error: Error): void {
    this.readFailure = error;
  }
  holdReads(): () => void {
    let release = (): void => {};
    this.readGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }
  async getPassword(service: string, account: string): Promise<string | null> {
    this.reads += 1;
    await this.readGate;
    if (this.readFailure !== undefined) throw this.readFailure;
    if (
      this.reads >= this.nullFrom &&
      this.reads < this.nullFrom + this.nullCount
    ) {
      return null;
    }
    return this.entries.get(`${service}:${account}`) ?? null;
  }
  async setPassword(
    service: string,
    account: string,
    pw: string,
  ): Promise<void> {
    this.entries.set(`${service}:${account}`, pw);
  }
  async deletePassword(service: string, account: string): Promise<boolean> {
    return this.entries.delete(`${service}:${account}`);
  }
}

interface Wire {
  readonly transport: 'ws' | 'http';
  readonly authorization: string | undefined;
  readonly accountId: string | undefined;
}

class ScriptedWebSocket implements WebSocketTransport {
  constructor(
    private readonly wire: Wire[],
    private readonly mode: 'ok' | 'refuse',
    private readonly onAttempt: () => Promise<void>,
  ) {}
  async *streamResponse(
    _request: unknown,
    options: StreamResponseOptions,
  ): AsyncIterableIterator<IContent> {
    const h = new Headers(options.headers);
    this.wire.push({
      transport: 'ws',
      authorization: h.get('Authorization') ?? undefined,
      accountId: h.get('ChatGPT-Account-ID') ?? undefined,
    });
    await this.onAttempt();
    if (this.mode === 'refuse') throw new TypeError('connect ECONNREFUSED');
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] };
  }
  close(): void {}
}

class Codex extends OpenAIResponsesProvider {
  constructor(
    oauth: OAuthManager,
    private readonly transport: WebSocketTransport,
    apiKey?: string,
  ) {
    super(apiKey, CODEX_BASE_URL, undefined, oauth, undefined, 'codex');
  }
  protected override createWebSocketTransport(): WebSocketTransport {
    return this.transport;
  }
}

function sse(): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          enc.encode(
            'data: {"type":"response.output_text.delta","delta":"done"}\n\n',
          ),
        );
        c.enqueue(
          enc.encode(
            'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
          ),
        );
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function codexProfile(buckets: string[]): Profile {
  return {
    version: 1,
    provider: 'codex',
    model: 'gpt-5.6-sol',
    modelParams: {},
    ephemeralSettings: {},
    auth: { type: 'oauth', buckets },
  };
}

interface Harness {
  readonly keyring: ScriptedKeyring;
  readonly secureStore: SecureStore;
  readonly tokenStore: KeyringTokenStore;
  readonly oauth: OAuthManager;
  readonly wire: Wire[];
  send(options?: SendOptions): Promise<SendResult>;
}

interface SendOptions {
  readonly ephemerals?: Record<string, unknown>;
  readonly abortSignal?: AbortSignal;
}

interface SendResult {
  readonly error: unknown;
  readonly readsDelta: number;
}

interface BuildOptions {
  readonly mode: 'ok' | 'refuse';
  readonly onAttempt?: (harness: Harness) => Promise<void>;
  readonly buckets?: readonly string[];
  readonly fallbackPolicy?: 'allow' | 'deny';
  readonly constructorApiKey?: string;
  readonly authKey?: string;
}

describe('Codex request credential: one authorization result per request', () => {
  let root: string;
  let fetchSpy: Mock<typeof fetch>;
  let wire: Wire[];
  const managers: OAuthManager[] = [];

  beforeEach(() => {
    resetOsKeyringSessionForTesting();
    setEnv('OPENAI_API_KEY', undefined);
    root = mkdtempSync(join(tmpdir(), 'codex-request-credential-'));
    setEnv('LLXPRT_CONFIG_HOME', join(root, 'config'));
    setEnv('LLXPRT_CACHE_HOME', join(root, 'cache'));
    wire = [];
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      withFetchPreconnect(async (_i, init) => {
        const h = new Headers(init?.headers);
        wire.push({
          transport: 'http',
          authorization: h.get('Authorization') ?? undefined,
          accountId: h.get('ChatGPT-Account-ID') ?? undefined,
        });
        return sse();
      }),
    );
  });
  afterEach(async () => {
    await Promise.all(managers.splice(0).map((m) => m.dispose()));
    fetchSpy.mockRestore();
    rmSync(root, { recursive: true, force: true });
    restoreEnv();
    resetOsKeyringSessionForTesting();
  });

  async function build(options: BuildOptions): Promise<Harness> {
    const keyring = new ScriptedKeyring();
    const lockDir = join(root, 'locks');
    mkdirSync(lockDir, { recursive: true });
    const store = new SecureStore('codex-request-credential', {
      fallbackDir: join(root, 'fallback'),
      lockDir,
      keyringLoader: async () => keyring,
      fallbackPolicy: options.fallbackPolicy ?? 'allow',
      machineSecretLoader: async () => null,
    });
    const tokenStore = new KeyringTokenStore({ secureStore: store, lockDir });
    const oauth = new OAuthManager(tokenStore, undefined, {
      profileReads: {
        loadProfile: async () => codexProfile([...(options.buckets ?? [])]),
      },
    });
    managers.push(oauth);
    registerStandardOAuthProviders(
      oauth,
      (i, n) => globalThis.fetch(i, n),
      tokenStore,
    );
    const flow = oauth.getProvider('codex');
    if (flow === undefined) throw new Error('codex flow missing');
    flow.initiateAuth = async () => {
      throw new Error('interactive login unavailable');
    };
    await oauth.toggleOAuthEnabled('codex');
    const settings = new SettingsService();
    if (options.authKey !== undefined)
      settings.set('auth-key', options.authKey);
    const built: { harness?: Harness } = {};
    const transport = new ScriptedWebSocket(wire, options.mode, async () => {
      if (built.harness !== undefined) await options.onAttempt?.(built.harness);
    });
    const provider = new Codex(oauth, transport, options.constructorApiKey);
    const send = async (sendOptions: SendOptions = {}): Promise<SendResult> => {
      const before = keyring.reads;
      const callOptions = createProviderCallOptions({
        providerName: provider.name,
        settings,
        config: createRuntimeConfigStub(settings),
        runtimeId: 'codex-request-credential',
        ephemerals: { retries: 1, retrywait: 1, ...sendOptions.ephemerals },
        ...(sendOptions.abortSignal === undefined
          ? {}
          : { metadata: { abortSignal: sendOptions.abortSignal } }),
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
        ],
      });
      let error: unknown;
      try {
        for await (const _chunk of provider.generateChatCompletion(
          callOptions,
        )) {
          // drain
        }
      } catch (caught) {
        error = caught;
      }
      return { error, readsDelta: keyring.reads - before };
    };
    built.harness = {
      keyring,
      secureStore: store,
      tokenStore,
      oauth,
      wire,
      send,
    };
    return built.harness;
  }

  function pairingViolations(): Wire[] {
    return wire.filter((w) => {
      const bearer = w.authorization?.replace('Bearer ', '') ?? '';
      return ACCOUNT_BY_BEARER[bearer] !== w.accountId;
    });
  }

  function credentialFailure(error: unknown): CredentialResolutionError {
    if (error instanceof CredentialResolutionError) return error;
    throw new Error(
      `expected a CredentialResolutionError, got: ${String(error)}`,
    );
  }

  describe('bearer and account identity', () => {
    it("never pairs a bearer with another token's account when the store rotates between the WS attempt and the HTTP fallback", async () => {
      const h = await build({
        mode: 'refuse',
        onAttempt: async (self) =>
          self.tokenStore.saveToken('codex', token('B')),
      });
      await h.tokenStore.saveToken('codex', token('A'));
      await h.send();
      expect(wire.map((w) => w.transport)).toStrictEqual(['ws', 'http']);
      expect(pairingViolations()).toStrictEqual([]);
      expect(wire.map((w) => w.authorization)).toStrictEqual([
        'Bearer access-A',
        'Bearer access-A',
      ]);
    });

    it('reads the credential store once per request on the WS path', async () => {
      const h = await build({ mode: 'ok' });
      await h.tokenStore.saveToken('codex', token('A'));
      const { readsDelta, error } = await h.send();
      expect(error).toBeUndefined();
      expect(wire).toHaveLength(1);
      expect(readsDelta).toBe(1);
    });

    it('reads the credential store once per request across WS refusal and HTTP fallback', async () => {
      const h = await build({ mode: 'refuse' });
      await h.tokenStore.saveToken('codex', token('A'));
      const { readsDelta } = await h.send();
      expect(wire.map((w) => w.transport)).toStrictEqual(['ws', 'http']);
      expect(readsDelta).toBe(1);
    });

    it('is unaffected by keyring nulls that begin after the bearer was resolved', async () => {
      const h = await build({ mode: 'ok' });
      await h.tokenStore.saveToken('codex', token('A'));
      // The bearer resolves with one read; nulls start at the next read and
      // exceed SecureStore's two-read confirmation budget.
      h.keyring.nullReads(h.keyring.reads + 2, 3);
      const { error } = await h.send();
      expect(error).toBeUndefined();
      expect(wire).toHaveLength(1);
      expect(wire[0]?.accountId).toBe('acct-A');
    });

    it('sends the identity of the profile bucket the bearer came from on WS and on the HTTP fallback', async () => {
      const h = await build({
        mode: 'refuse',
        buckets: ['team-a', 'team-b'],
        // Rotating the unused bucket mid-request must not leak into this request.
        onAttempt: async (self) =>
          self.tokenStore.saveToken('codex', token('B'), 'team-b'),
      });
      await h.tokenStore.saveToken('codex', token('team-a'), 'team-a');
      await h.tokenStore.saveToken('codex', token('team-b'), 'team-b');
      const { error } = await h.send({
        ephemerals: { currentProfile: 'work' },
      });
      expect(error).toBeUndefined();
      expect(
        wire.map((w) => [w.transport, w.authorization, w.accountId]),
      ).toStrictEqual([
        ['ws', 'Bearer access-team-a', 'acct-team-a'],
        ['http', 'Bearer access-team-a', 'acct-team-a'],
      ]);
    });

    it('pins an in-flight request to its pair while the next request observes the rotation', async () => {
      let attempts = 0;
      const h = await build({
        mode: 'refuse',
        onAttempt: async (self) => {
          attempts += 1;
          // The first request is mid-flight (its WS attempt) when the account rotates.
          if (attempts === 1) {
            await self.tokenStore.saveToken('codex', token('B'));
          }
        },
      });
      await h.tokenStore.saveToken('codex', token('A'));
      const first = h.send();
      await first;
      const second = await h.send();
      expect(second.error).toBeUndefined();
      const byBearer = (bearer: string): string[] =>
        wire
          .filter((w) => w.authorization === `Bearer ${bearer}`)
          .map((w) => `${w.transport}:${w.accountId}`);
      expect(byBearer('access-A')).toStrictEqual(['ws:acct-A', 'http:acct-A']);
      expect(byBearer('access-B')).toStrictEqual(['ws:acct-B', 'http:acct-B']);
    });

    it('lets two truly concurrent requests each keep their own pair', async () => {
      const gates: Array<() => void> = [];
      const h = await build({
        mode: 'refuse',
        onAttempt: async () => {
          await new Promise<void>((resolve) => gates.push(resolve));
        },
      });
      await h.tokenStore.saveToken('codex', token('A'));
      const first = h.send();
      while (gates.length < 1) await new Promise((r) => setTimeout(r, 1));
      await h.tokenStore.saveToken('codex', token('B'));
      const second = h.send();
      while (gates.length < 2) await new Promise((r) => setTimeout(r, 1));
      for (const release of gates) release();
      await Promise.all([first, second]);
      expect(pairingViolations()).toStrictEqual([]);
      const bearers = wire.map((w) => w.authorization);
      expect(bearers.filter((b) => b === 'Bearer access-A')).toHaveLength(2);
      expect(bearers.filter((b) => b === 'Bearer access-B')).toHaveLength(2);
    });

    it('lets a later request observe rotation and a request after logout fail before the wire', async () => {
      const h = await build({ mode: 'ok' });
      await h.tokenStore.saveToken('codex', token('A'));
      await h.send();
      await h.tokenStore.saveToken('codex', token('B'));
      await h.send();
      expect(wire.map((w) => [w.authorization, w.accountId])).toStrictEqual([
        ['Bearer access-A', 'acct-A'],
        ['Bearer access-B', 'acct-B'],
      ]);
      await h.oauth.logout('codex');
      wire.length = 0;
      const { error } = await h.send();
      expect(wire).toStrictEqual([]);
      expect(credentialFailure(error).remediation).toContain(
        '/auth codex login',
      );
    });

    it('rejects before the wire when the stored credential has no account identity', async () => {
      const h = await build({ mode: 'ok' });
      const full = token('A');
      const withoutIdentity: OAuthToken = {
        access_token: full.access_token,
        refresh_token: full.refresh_token,
        token_type: full.token_type,
        expiry: full.expiry,
        scope: full.scope,
      };
      await h.tokenStore.saveToken('codex', withoutIdentity);
      const { error, readsDelta } = await h.send();
      expect(wire).toStrictEqual([]);
      // The admitted read already resolved the full credential and found no
      // identity; a second lookup could only observe a different credential.
      expect(readsDelta).toBe(1);
      const failure = credentialFailure(error);
      expect(failure.kind).toBe('credential-not-found');
      expect(failure.remediation).toContain('/auth codex login');
    });

    it.each([
      ['constructor API key', { constructorApiKey: 'access-other' }],
      ['auth-key setting', { authKey: 'access-other' }],
    ] as const)(
      'rejects before the wire when a pre-resolved %s does not match the stored credential',
      async (_label, scenario) => {
        const h = await build({ mode: 'ok', ...scenario });
        await h.tokenStore.saveToken('codex', token('A'));
        const { error, readsDelta } = await h.send();
        expect(wire).toStrictEqual([]);
        expect(readsDelta).toBe(1);
        const failure = credentialFailure(error);
        expect(failure.kind).toBe('credential-not-found');
        expect(failure.remediation).toContain('could not be matched');
        expect(failure.remediation).toContain('/auth codex login');
      },
    );

    it('pairs a matching constructor bearer using one legacy identity read', async () => {
      const h = await build({ mode: 'ok', constructorApiKey: 'access-A' });
      await h.tokenStore.saveToken('codex', token('A'));
      const { error, readsDelta } = await h.send();
      expect(error).toBeUndefined();
      expect(readsDelta).toBe(1);
      expect(wire).toStrictEqual([
        {
          transport: 'ws',
          authorization: 'Bearer access-A',
          accountId: 'acct-A',
        },
      ]);
    });
  });

  describe('request dumps', () => {
    function dumpedHeaders(): Array<Record<string, unknown>> {
      const dir = join(Storage.getGlobalCacheDir(), 'dumps');
      return readdirSync(dir)
        .filter((file) => file.endsWith('-request.json'))
        .sort()
        .map((file) => {
          const parsed: unknown = JSON.parse(
            readFileSync(join(dir, file), 'utf-8'),
          );
          if (
            typeof parsed !== 'object' ||
            parsed === null ||
            !('request' in parsed)
          ) {
            throw new Error(`malformed dump ${file}`);
          }
          const request = parsed.request;
          if (
            typeof request !== 'object' ||
            request === null ||
            !('headers' in request)
          ) {
            throw new Error(`dump ${file} has no headers`);
          }
          const headers = request.headers;
          if (typeof headers !== 'object' || headers === null) {
            throw new Error(`dump ${file} headers malformed`);
          }
          return { ...headers };
        });
    }

    it('dumps both transports without credential material and adds no credential reads', async () => {
      const h = await build({ mode: 'refuse' });
      await h.tokenStore.saveToken('codex', token('A'));
      const { error, readsDelta } = await h.send({
        ephemerals: { dumpcontext: 'on' },
      });
      expect(error).toBeUndefined();
      expect(readsDelta).toBe(1);
      const headers = dumpedHeaders();
      expect(headers.length).toBeGreaterThanOrEqual(2);
      expect(headers.map((x) => x['Authorization'])).toStrictEqual(
        headers.map(() => '[REDACTED]'),
      );
      expect(headers.map((x) => x['ChatGPT-Account-ID'])).toStrictEqual(
        headers.map(() => '[REDACTED]'),
      );
      expect(JSON.stringify(headers)).not.toContain('access-A');
      expect(JSON.stringify(headers)).not.toContain('acct-A');
      expect(JSON.stringify(headers)).not.toContain('refresh-A');
    });
  });

  describe('cancellation and manager lifetime', () => {
    it('rejects before the wire when the manager refuses admission', async () => {
      const h = await build({ mode: 'ok' });
      await h.tokenStore.saveToken('codex', token('A'));
      await h.oauth.dispose();
      const { error } = await h.send();
      expect(wire).toStrictEqual([]);
      expect(error).toBeInstanceOf(Error);
    });

    it('cancels a request whose credential read is in flight when the manager is disposed', async () => {
      const h = await build({ mode: 'ok' });
      await h.tokenStore.saveToken('codex', token('A'));
      const release = h.keyring.holdReads();
      const sending = h.send();
      while (h.keyring.reads < 1) await new Promise((r) => setTimeout(r, 1));
      const disposing = h.oauth.dispose();
      release();
      const { error } = await sending;
      await disposing;
      expect(wire).toStrictEqual([]);
      expect(error).toBeInstanceOf(Error);
    });

    it('does not touch the disposed manager again after the credential was admitted', async () => {
      const h = await build({
        mode: 'refuse',
        onAttempt: async (self) => self.oauth.dispose(),
      });
      await h.tokenStore.saveToken('codex', token('A'));
      const { readsDelta } = await h.send();
      // The credential is a value held by the request: no manager access, no
      // store read, and no mixed identity after retirement began.
      expect(readsDelta).toBe(1);
      expect(pairingViolations()).toStrictEqual([]);
    });

    it('does not send when the request is cancelled while its credential is being resolved', async () => {
      const h = await build({ mode: 'ok' });
      await h.tokenStore.saveToken('codex', token('A'));
      const controller = new AbortController();
      const release = h.keyring.holdReads();
      const sending = h.send({ abortSignal: controller.signal });
      while (h.keyring.reads < 1) await new Promise((r) => setTimeout(r, 1));
      controller.abort(new Error('user cancelled'));
      release();
      const { error } = await sending;
      expect(wire).toStrictEqual([]);
      expect(error).toBeDefined();
    });
  });

  describe('credential-store failures versus an absent login', () => {
    it('does not tell the user to log in when the credential store is locked', async () => {
      const h = await build({ mode: 'ok', fallbackPolicy: 'deny' });
      await h.tokenStore.saveToken('codex', token('A'));
      h.keyring.failReads(new Error('The keychain is locked'));
      const { error } = await h.send();
      expect(wire).toStrictEqual([]);
      const failure = credentialFailure(error);
      expect(failure.kind).toBe('credential-source-failed');
      expect(failure.remediation ?? '').not.toContain('/auth codex login');
      expect(failure.remediation).toContain('credential store');
    });

    it('still asks for login when no credential is stored', async () => {
      const h = await build({ mode: 'ok' });
      const { error } = await h.send();
      expect(wire).toStrictEqual([]);
      const failure = credentialFailure(error);
      expect(failure.remediation).toContain('/auth codex login');
    });

    it('asks for login when the stored credential is corrupt', async () => {
      const h = await build({ mode: 'ok' });
      await h.tokenStore.saveToken('codex', token('A'));
      await h.secureStore.set('codex:default', '{not json');
      const { error } = await h.send();
      expect(wire).toStrictEqual([]);
      expect(credentialFailure(error).remediation).toContain(
        '/auth codex login',
      );
    });

    it('reports a disabled login as unconfigured instead of a login failure', async () => {
      const h = await build({ mode: 'ok' });
      await h.tokenStore.saveToken('codex', token('A'));
      await h.oauth.toggleOAuthEnabled('codex');
      const { error } = await h.send();
      expect(wire).toStrictEqual([]);
      expect(credentialFailure(error).kind).toBe('no-credential-configured');
    });
  });
});
