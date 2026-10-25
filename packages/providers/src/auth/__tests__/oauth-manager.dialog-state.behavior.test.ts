/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyringTokenStore } from '@vybestack/llxprt-code-auth';
import * as browserLauncher from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';
import { AnthropicOAuthProvider } from '../anthropic-oauth-provider.js';
import { OAuthManager } from '../oauth-manager.js';
import { ClipboardService } from '../ClipboardService.js';

const directories: string[] = [];
const managers: OAuthManager[] = [];

function memoryStore(): KeyringTokenStore {
  const tempRoot = resolve(import.meta.dir, '../../../../../tmp');
  mkdirSync(tempRoot, { recursive: true });
  const lockDir = mkdtempSync(resolve(tempRoot, 'dialog-state-'));
  directories.push(lockDir);
  const values = new Map<string, string>();
  return new KeyringTokenStore({
    lockDir,
    secureStore: {
      async get(key): Promise<string | null> {
        return values.get(key) ?? null;
      },
      async set(key, value): Promise<void> {
        values.set(key, value);
      },
      async delete(key): Promise<boolean> {
        return values.delete(key);
      },
      async list(): Promise<string[]> {
        return [...values.keys()];
      },
      async has(key): Promise<boolean> {
        return values.has(key);
      },
    },
  });
}

const tokenResponse = (): Response =>
  new Response(
    JSON.stringify({ access_token: 'synthetic-session-token', expires_in: 60 }),
    { headers: { 'Content-Type': 'application/json' } },
  );

interface LiveOwner {
  readonly manager: OAuthManager;
  readonly provider: AnthropicOAuthProvider;
  readonly awaitingCode: () => Promise<void>;
}

function liveOwner(): LiveOwner {
  const store = memoryStore();
  const manager = new OAuthManager(store, undefined, undefined, 'owned');
  managers.push(manager);
  const provider = new AnthropicOAuthProvider(
    async () => tokenResponse(),
    store,
  );
  manager.registerProvider(provider);
  let announce: () => void = () => {};
  const urlShown = new Promise<void>((resolveShown) => {
    announce = resolveShown;
  });
  manager.attachInteractiveAuthMessages((event) => {
    if (event.type === 'oauth_url') announce();
    return undefined;
  });
  return { manager, provider, awaitingCode: () => urlShown };
}

function login(owner: LiveOwner): Promise<string> {
  return owner.manager
    .authenticate('claudecode', 'default', { signalAuthCompletion: true })
    .then(
      () => 'succeeded',
      () => 'failed',
    );
}

describe('OAuth dialog state per owner', () => {
  beforeEach(() => {
    vi.spyOn(browserLauncher, 'shouldLaunchBrowser').mockReturnValue(false);
    vi.spyOn(ClipboardService, 'copyToClipboard').mockResolvedValue();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const manager of managers.splice(0)) await manager.dispose();
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it('shows a dialog only to the owner whose login asked for a code', async () => {
    const a = liveOwner();
    const b = liveOwner();
    const loginA = login(a);
    await a.awaitingCode();

    expect(a.manager.getCodeRequest()).toStrictEqual({
      needsCode: true,
      provider: 'claudecode',
    });
    expect(a.manager.getDialog()?.status).toBe('pending');
    expect(b.manager.getCodeRequest()).toStrictEqual({
      needsCode: false,
      provider: undefined,
    });
    expect(b.manager.getDialog()).toBeUndefined();

    a.provider.cancelAuth();
    expect(await loginA).toBe('failed');
  });

  it('keeps the other owner dialog when one owner dismisses its own', async () => {
    const a = liveOwner();
    const b = liveOwner();
    const loginA = login(a);
    const loginB = login(b);
    await Promise.all([a.awaitingCode(), b.awaitingCode()]);

    const dialogA = a.manager.getDialog();
    expect(dialogA).toBeDefined();
    a.manager.dismissDialog(dialogA?.id ?? '');

    expect(a.manager.getDialog()).toBeUndefined();
    expect(b.manager.getDialog()?.status).toBe('pending');
    expect(b.manager.getCodeRequest().needsCode).toBe(true);

    a.provider.cancelAuth();
    b.provider.cancelAuth();
    expect(await Promise.all([loginA, loginB])).toStrictEqual([
      'failed',
      'failed',
    ]);
  });

  it('lets the surviving owner finish its code entry after the other owner is torn down', async () => {
    const a = liveOwner();
    const b = liveOwner();
    const loginA = login(a);
    const loginB = login(b);
    await Promise.all([a.awaitingCode(), b.awaitingCode()]);

    await a.manager.dispose();
    expect(await loginA).toBe('failed');

    expect(b.manager.getDialog()?.status).toBe('pending');
    expect(b.manager.getCodeRequest().needsCode).toBe(true);

    expect(b.provider.submitAuthCode('code-for-b')).toBeUndefined();
    expect(await loginB).toBe('succeeded');
    expect(b.manager.getDialog()?.status).toBe('succeeded');
    expect(b.manager.getCodeRequest().needsCode).toBe(false);
    expect(b.manager.takeAuthOutcome()).toStrictEqual({
      complete: true,
      error: undefined,
    });
  });
});
