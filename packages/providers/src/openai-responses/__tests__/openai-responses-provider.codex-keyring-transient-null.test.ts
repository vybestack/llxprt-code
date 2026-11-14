import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3965: Codex subagent requests aborted with "Codex mode requires OAuth
 * authentication - no token available" when the native keyring reported a
 * transient null for a stored, unexpired token. Codex resolves the bearer token
 * and the account ID through separate lookups, so a null on either one used to
 * fail the request.
 *
 * Real graph: SecureStore -> KeyringTokenStore -> OAuthManager ->
 * OpenAIResponsesProvider (Codex). Only the OS keyring and the network are
 * stubbed.
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
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyringTokenStore } from '@vybestack/llxprt-code-auth';
import type { OAuthToken } from '@vybestack/llxprt-code-auth';
import {
  SecureStore,
  type KeyringAdapter,
} from '@vybestack/llxprt-code-storage';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { restoreEnv, setEnv } from '@vybestack/llxprt-code-test-utils';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { streamCallOptions as createProviderCallOptions } from '../../__tests__/streamCallOptions.js';
import { withFetchPreconnect } from '../../../../test-utils/src/fetch-test-helpers.js';
import { OAuthManager } from '../../auth/oauth-manager.js';
import { registerStandardOAuthProviders } from '../../composition/oauth-provider-registration.js';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { WebSocketTransport } from '../openAIResponsesWebSocketTransport.js';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const ACCOUNT_ID = 'acct_keyring_3965';
const ACCESS_TOKEN = 'codex-access-token-3965';
const LOGIN_REMEDIATION = '/auth codex';

/** In-memory keyring that can answer individual reads with null. */
class FlakyKeyring implements KeyringAdapter {
  private readonly entries = new Map<string, string>();
  private reads = 0;
  private nullFromRead = Number.POSITIVE_INFINITY;
  private nullCount = 0;

  get readCount(): number {
    return this.reads;
  }

  /** Reads numbered `firstRead` .. `firstRead + count - 1` report null. */
  nullReads(firstRead: number, count: number): void {
    this.nullFromRead = firstRead;
    this.nullCount = count;
  }

  async getPassword(service: string, account: string): Promise<string | null> {
    this.reads += 1;
    const inNullWindow =
      this.reads >= this.nullFromRead &&
      this.reads < this.nullFromRead + this.nullCount;
    return inNullWindow
      ? null
      : (this.entries.get(`${service}:${account}`) ?? null);
  }

  async setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void> {
    this.entries.set(`${service}:${account}`, password);
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    return this.entries.delete(`${service}:${account}`);
  }
}

/** Fails before any output, which the provider recovers over HTTP. */
class RefusedWebSocketTransport implements WebSocketTransport {
  private readonly refusal: Error | undefined = new TypeError(
    'connect ECONNREFUSED',
  );

  async *streamResponse(): AsyncIterableIterator<IContent> {
    if (this.refusal !== undefined) throw this.refusal;
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unreachable' }] };
  }

  close(): void {}
}

/** Forces the HTTP transport so the request headers are observable. */
class HttpOnlyCodexProvider extends OpenAIResponsesProvider {
  constructor(oauthManager: OAuthManager) {
    super(
      undefined,
      CODEX_BASE_URL,
      undefined,
      oauthManager,
      undefined,
      'codex',
    );
  }

  protected override createWebSocketTransport(): WebSocketTransport {
    return new RefusedWebSocketTransport();
  }
}

function validToken(): OAuthToken & { account_id: string } {
  return {
    access_token: ACCESS_TOKEN,
    refresh_token: 'refresh-3965',
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    scope: 'openid',
    account_id: ACCOUNT_ID,
  };
}

function sseResponse(): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"response.output_text.delta","delta":"done"}\n\n',
        ),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
        ),
      );
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

interface CodexHarness {
  readonly keyring: FlakyKeyring;
  readonly store: SecureStore;
  readonly tokenStore: KeyringTokenStore;
  readonly fallbackDir: string;
  readonly oauthManager: OAuthManager;
  /** Sends one request and reports the headers the network saw. */
  readonly send: () => Promise<SentRequest>;
}

interface SentRequest {
  readonly authorization: string | undefined;
  readonly accountId: string | undefined;
}

function headerOf(
  init: RequestInit | undefined,
  name: string,
): string | undefined {
  const headers = new Headers(init?.headers);
  return headers.get(name) ?? undefined;
}

async function buildCodexHarness(
  root: string,
  fetchSpy: Mock<typeof fetch>,
): Promise<CodexHarness> {
  const keyring = new FlakyKeyring();
  const fallbackDir = join(root, 'fallback');
  const lockDir = join(root, 'locks');
  mkdirSync(lockDir, { recursive: true });
  const store = new SecureStore('issue3965-codex', {
    fallbackDir,
    lockDir,
    keyringLoader: async () => keyring,
    fallbackPolicy: 'allow',
    machineSecretLoader: async () => null,
  });
  const tokenStore = new KeyringTokenStore({ secureStore: store, lockDir });
  const oauthManager = new OAuthManager(tokenStore);
  registerStandardOAuthProviders(
    oauthManager,
    (input, init) => globalThis.fetch(input, init),
    tokenStore,
  );
  const browserFlow = oauthManager.getProvider('codex');
  if (browserFlow === undefined) {
    throw new Error('codex OAuth provider was not registered');
  }
  browserFlow.initiateAuth = async (): Promise<OAuthToken> => {
    throw new Error('interactive Codex login is unavailable in tests');
  };
  await oauthManager.toggleOAuthEnabled('codex');
  const provider = new HttpOnlyCodexProvider(oauthManager);
  const settings = new SettingsService();

  const send = async (): Promise<SentRequest> => {
    const runtime = createProviderRuntimeContext({
      runtimeId: 'codex-keyring-3965',
    });
    const ephemerals = { retries: 1, retrywait: 1 };
    const options = createProviderCallOptions({
      providerName: provider.name,
      settings,
      config: createRuntimeConfigStub(settings),
      runtime,
      invocation: createRuntimeInvocationContext({
        fetch: (input, init) => globalThis.fetch(input, init),
        runtimeId: runtime.runtimeId,
        runtimeMetadata: runtime.metadata,
        providerName: provider.name,
        ephemeralsSnapshot: ephemerals,
      }),
      contents: callerOwnedRawProviderSource([
        { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
      ]),
    });
    const callsBefore = fetchSpy.mock.calls.length;
    for await (const _chunk of provider.generateChatCompletion(options)) {
      // drain the stream so the request completes
    }
    const init = fetchSpy.mock.calls[callsBefore]?.[1];
    return {
      authorization: headerOf(init, 'Authorization'),
      accountId: headerOf(init, 'ChatGPT-Account-ID'),
    };
  };

  return { keyring, store, tokenStore, fallbackDir, oauthManager, send };
}

describe('Codex requests with transient native-keyring null reads (issue #3965)', () => {
  let root: string;
  let fetchSpy: Mock<typeof fetch>;
  let oauthManagers: OAuthManager[];

  /** Builds a harness whose OAuthManager is disposed in teardown. */
  async function newHarness(): Promise<CodexHarness> {
    const harness = await buildCodexHarness(root, fetchSpy);
    oauthManagers.push(harness.oauthManager);
    return harness;
  }

  beforeEach(() => {
    // The auth precedence chain ranks an ambient OPENAI_API_KEY (set in CI and
    // on developer machines) above the stored OAuth token, which would replace
    // the bearer token these tests assert on.
    setEnv('OPENAI_API_KEY', undefined);
    oauthManagers = [];
    root = mkdtempSync(join(tmpdir(), 'codex-keyring-3965-'));
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      withFetchPreconnect(async () => sseResponse()),
    );
  });

  afterEach(async () => {
    await Promise.all(oauthManagers.map((manager) => manager.dispose()));
    fetchSpy.mockRestore();
    rmSync(root, { recursive: true, force: true });
    restoreEnv();
  });

  /**
   * Counts the keyring reads one healthy request performs, so a test can aim a
   * null at a specific lookup (the account-ID lookup is the last one).
   */
  async function readsPerHealthyRequest(
    harness: CodexHarness,
  ): Promise<number> {
    const before = harness.keyring.readCount;
    await harness.send();
    return harness.keyring.readCount - before;
  }

  it('sends the stored token and account ID when nothing goes wrong', async () => {
    const harness = await newHarness();
    await harness.tokenStore.saveToken('codex', validToken());

    const sent = await harness.send();

    expect(sent).toStrictEqual({
      authorization: `Bearer ${ACCESS_TOKEN}`,
      accountId: ACCOUNT_ID,
    });
  });

  it('completes the request when the account-ID lookup reads one transient null', async () => {
    const harness = await newHarness();
    await harness.tokenStore.saveToken('codex', validToken());
    const perRequest = await readsPerHealthyRequest(harness);
    harness.keyring.nullReads(harness.keyring.readCount + perRequest, 1);

    const sent = await harness.send();

    expect(sent).toStrictEqual({
      authorization: `Bearer ${ACCESS_TOKEN}`,
      accountId: ACCOUNT_ID,
    });
  });

  it('completes the request when the account-ID lookup reads consecutive transient nulls', async () => {
    const harness = await newHarness();
    await harness.tokenStore.saveToken('codex', validToken());
    const perRequest = await readsPerHealthyRequest(harness);
    harness.keyring.nullReads(harness.keyring.readCount + perRequest, 2);

    const sent = await harness.send();

    expect(sent).toStrictEqual({
      authorization: `Bearer ${ACCESS_TOKEN}`,
      accountId: ACCOUNT_ID,
    });
  });

  it('completes the request when the first lookup of a request reads a transient null', async () => {
    const harness = await newHarness();
    await harness.tokenStore.saveToken('codex', validToken());
    harness.keyring.nullReads(harness.keyring.readCount + 1, 1);

    const sent = await harness.send();

    expect(sent).toStrictEqual({
      authorization: `Bearer ${ACCESS_TOKEN}`,
      accountId: ACCOUNT_ID,
    });
  });

  it('does not use an obsolete fallback token when the keyring read is a transient null', async () => {
    const harness = await newHarness();
    await harness.tokenStore.saveToken('codex', validToken());
    const obsolete = { ...validToken(), account_id: 'acct_obsolete_fallback' };
    const fallbackWriter = new SecureStore('issue3965-codex', {
      fallbackDir: harness.fallbackDir,
      lockDir: join(root, 'locks'),
      keyringLoader: async () => null,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => null,
    });
    await fallbackWriter.set('codex:default', JSON.stringify(obsolete));
    const perRequest = await readsPerHealthyRequest(harness);
    harness.keyring.nullReads(harness.keyring.readCount + perRequest, 1);

    const sent = await harness.send();

    expect(sent.accountId).toBe(ACCOUNT_ID);
  });

  it('still fails with the authentication error when the token is genuinely absent', async () => {
    const harness = await newHarness();

    const failure = await harness.send().then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure instanceof Error ? failure.message : '').toContain(
      LOGIN_REMEDIATION,
    );
    expect(fetchSpy.mock.calls.length).toBe(0);
  });

  it('does not resurrect a logged-out token when the keyring also reads transient nulls', async () => {
    const harness = await newHarness();
    await harness.tokenStore.saveToken('codex', validToken());
    await harness.send();
    await harness.tokenStore.removeToken('codex');
    harness.keyring.nullReads(harness.keyring.readCount + 1, 1);

    const failure = await harness.send().then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(fetchSpy.mock.calls.length).toBe(1);
  });
});
