/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import React, { act, useCallback, useSyncExternalStore } from 'react';
import { Text } from 'ink';
import {
  assembleSessionAuthentication,
  type AgentSessionAuthentication,
} from '@vybestack/llxprt-code-agents';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import * as browserLauncher from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';
import { AnthropicOAuthProvider } from '../../../../providers/src/auth/anthropic-oauth-provider.js';
import { ClipboardService } from '../../../../providers/src/auth/ClipboardService.js';
import { MemoryTokenStore } from '../../../../providers/src/auth/__tests__/behavioral/test-utils.js';
import { Colors } from '../colors.js';
import { createAppCommandBindings } from '../../__tests__/appCommandBindings.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { renderWithProviders, waitFor } from '../../__tests__/render.js';
import { useUpdateAndOAuthBridges } from '../containers/AppContainer/hooks/useUpdateAndOAuthBridges.js';
import { renderOAuthCodeDialog } from '../components/DialogManagerRenderers.js';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import { OAuthControlProvider } from '../contexts/OAuthControlContext.js';
import { submitOAuthCode } from '../oauth-submission.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';
import {
  createDialogStore,
  selectDialogOpen,
} from '../stores/dialog/dialogStore.js';
import { useOAuthOrchestration } from './useOAuthOrchestration.js';

const CLOSED = 'Code dialog closed';
const OPEN = 'Claudecode OAuth';
const REJECTED = /[Ee]xchange|400|[Aa]uthorization/;
const ACTIVE_PROVIDER = (): string => 'claudecode';
const WAIT = { timeout: 5000 };

interface Root {
  readonly manager: OAuthManager;
  readonly store: MemoryTokenStore;
  readonly control: AgentSessionAuthentication;
  readonly dialogStore: ReturnType<typeof createDialogStore>;
  readonly history: string[];
  readonly actions: string[];
  readonly authErrors: Array<string | null>;
  ui?: ReturnType<typeof renderWithProviders>;
}

const roots: Root[] = [];

function tokenResponse(accessToken: string): Response {
  return new Response(
    JSON.stringify({ access_token: accessToken, expires_in: 3600 }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * One root: its own manager, token store and registered Anthropic provider
 * (UI port bound by registerProvider), behind the real agents control port.
 * `exchange` is the local token endpoint the provider talks to.
 */
function createRoot(exchange: () => Response): Root {
  const store = new MemoryTokenStore();
  const manager = new OAuthManager(store);
  manager.registerProvider(
    new AnthropicOAuthProvider(async () => exchange(), store),
  );
  const root: Root = {
    manager,
    store,
    control: assembleSessionAuthentication(manager, () => undefined),
    dialogStore: createDialogStore(),
    history: [],
    actions: [],
    authErrors: [],
  };
  roots.push(root);
  return root;
}

function RootHost({ root }: { root: Root }): React.JSX.Element {
  const dialogs = React.useMemo(
    () => createDialogOpeners(root.dialogStore),
    [root],
  );
  const open = useSyncExternalStore(root.dialogStore.store.subscribe, () =>
    selectDialogOpen(root.dialogStore.store.getState(), 'oauthCode'),
  );
  const buffer = useTextBuffer({
    viewport: { width: 80, height: 20 },
    isValidPath: () => false,
  });
  const addItem = useCallback(
    (item: { text?: string }) => {
      if (typeof item.text === 'string') root.history.push(item.text);
      return 1;
    },
    [root],
  );
  const setUpdateInfo = useCallback(() => undefined, []);
  const appDispatch = useCallback(
    (action: { type: string }) => {
      root.actions.push(action.type);
    },
    [root],
  );
  const setAuthError = useCallback(
    (error: string | null) => {
      root.authErrors.push(error);
    },
    [root],
  );
  useUpdateAndOAuthBridges({
    addItem,
    setUpdateInfo,
    oauthControl: root.control,
  });
  useOAuthOrchestration({
    appDispatch,
    dialogs,
    isOAuthCodeDialogOpen: open,
    getActiveProviderName: ACTIVE_PROVIDER,
    oauth: root.control,
    setAuthError,
  });
  const commands = createAppCommandBindings(
    'two-root OAuth host',
    {
      buffer,
      generatePromptContent: null,
      commandContext: createMockCommandContext(),
      inputHistory: [],
    },
    { handleOAuthCodeDialogClose: () => dialogs.oauthCode.close() },
  );
  return (
    <OAuthControlProvider control={root.control}>
      {open ? (
        renderOAuthCodeDialog(commands, (code) =>
          submitOAuthCode(
            {
              submitCode: root.control.submitCode,
              getActiveProvider: () => root.control.getCodeRequest().provider,
            },
            code,
          ),
        )
      ) : (
        <Text color={Colors.Foreground}>{CLOSED}</Text>
      )}
    </OAuthControlProvider>
  );
}

function mount(root: Root): void {
  root.ui = renderWithProviders(<RootHost root={root} />);
}

function frame(root: Root): string {
  return root.ui?.lastFrame() ?? '';
}

function login(
  root: Root,
  bucket = 'default',
): Promise<'succeeded' | 'failed'> {
  return root.control
    .authenticate('claudecode', bucket, { signalAuthCompletion: true })
    .then(
      () => 'succeeded',
      () => 'failed',
    );
}

async function paste(root: Root, code: string): Promise<void> {
  await act(async () => {
    root.ui?.stdin.write(`\x1b[200~${code}\x1b[201~`);
  });
  await waitFor(() => expect(frame(root)).toContain(code), WAIT);
}

async function submitPasted(root: Root, code: string): Promise<void> {
  await paste(root, code);
  await act(async () => {
    root.ui?.stdin.write('\r');
  });
}

async function pressEscape(root: Root): Promise<void> {
  await act(async () => {
    root.ui?.stdin.write('\x1b');
  });
}

/** Lets every root's 100ms orchestration polls run before a negative check. */
async function letPollsRun(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 350));
  });
}

function announcedAuthorizationUrl(root: Root): boolean {
  return root.history.some((text) => text.includes('authorize with Claude'));
}

function pendingAttemptId(root: Root): string {
  const attempt = root.control.getDialog();
  expect(attempt).toMatchObject({ provider: 'claudecode', status: 'pending' });
  return attempt?.id ?? '';
}

describe('OAuth dialog and outcomes across two live roots', () => {
  beforeEach(() => {
    vi.spyOn(browserLauncher, 'shouldLaunchBrowser').mockReturnValue(false);
    vi.spyOn(ClipboardService, 'copyToClipboard').mockResolvedValue();
  });

  afterEach(async () => {
    for (const root of roots) root.ui?.unmount();
    await Promise.all(roots.map((root) => root.manager.dispose()));
    roots.length = 0;
    vi.restoreAllMocks();
  });

  it('keeps each root dialog, outcome and code entry its own through settlement, dismissal and teardown', async () => {
    let bExchanges = 0;
    const a = createRoot(() => new Response('Rejected', { status: 400 }));
    const b = createRoot(() => tokenResponse(`token-b-${++bExchanges}`));
    mount(a);
    mount(b);

    const loginA = login(a);
    const loginB = login(b);
    await waitFor(() => {
      expect(announcedAuthorizationUrl(a)).toBe(true);
      expect(announcedAuthorizationUrl(b)).toBe(true);
    }, WAIT);
    const firstAttemptA = pendingAttemptId(a);
    const firstAttemptB = pendingAttemptId(b);
    expect(firstAttemptA).not.toBe(firstAttemptB);
    await waitFor(() => {
      expect(frame(a)).toContain(OPEN);
      expect(frame(b)).toContain(OPEN);
    }, WAIT);

    await submitPasted(a, 'alpha-rejected-code');
    expect(await loginA).toBe('failed');
    await waitFor(() => expect(frame(a)).toMatch(REJECTED), WAIT);
    expect(a.control.getDialog()).toMatchObject({
      id: firstAttemptA,
      provider: 'claudecode',
      status: 'failed',
    });
    expect(b.control.getDialog()).toMatchObject({
      id: firstAttemptB,
      status: 'pending',
    });
    expect(frame(b)).toContain(OPEN);

    await submitPasted(b, 'bravo-code-one');
    expect(await loginB).toBe('succeeded');
    await waitFor(() => {
      expect(frame(b)).toContain(CLOSED);
      expect(b.control.getDialog()).toBeUndefined();
      expect(b.actions).toStrictEqual(['SET_NEEDS_RELOGIN']);
    }, WAIT);
    expect((await b.store.getToken('claudecode'))?.access_token).toBe(
      'token-b-1',
    );
    await letPollsRun();

    expect(frame(a)).toContain(OPEN);
    expect(frame(a)).toMatch(REJECTED);
    expect(frame(a)).not.toContain('bravo');
    expect(a.control.getDialog()).toMatchObject({
      id: firstAttemptA,
      status: 'failed',
    });
    expect(a.actions).toStrictEqual([]);
    expect(a.authErrors).toStrictEqual([]);
    expect(await a.store.getToken('claudecode')).toBeNull();
    expect(b.authErrors.every((error) => error === null)).toBe(true);

    const secondLoginA = login(a);
    const secondLoginB = login(b, 'second');
    await waitFor(() => {
      expect(a.control.getDialog()).toMatchObject({ status: 'pending' });
      expect(b.control.getDialog()).toMatchObject({ status: 'pending' });
    }, WAIT);
    const secondAttemptB = pendingAttemptId(b);
    expect(pendingAttemptId(a)).not.toBe(firstAttemptA);
    expect(secondAttemptB).not.toBe(firstAttemptB);
    await waitFor(() => expect(frame(b)).toContain(OPEN), WAIT);

    await pressEscape(a);
    await waitFor(() => {
      expect(frame(a)).toContain(CLOSED);
      expect(a.control.getDialog()).toBeUndefined();
    }, WAIT);
    await letPollsRun();
    expect(frame(b)).toContain(OPEN);
    expect(b.control.getDialog()).toMatchObject({
      id: secondAttemptB,
      status: 'pending',
    });

    a.ui?.unmount();
    await a.manager.dispose();
    expect(await secondLoginA).toBe('failed');
    await letPollsRun();

    expect(frame(b)).toContain(OPEN);
    expect(b.control.getDialog()).toMatchObject({
      id: secondAttemptB,
      status: 'pending',
    });
    await submitPasted(b, 'bravo-code-two');
    expect(await secondLoginB).toBe('succeeded');
    await waitFor(() => {
      expect(frame(b)).toContain(CLOSED);
      expect(b.control.getDialog()).toBeUndefined();
      expect(b.actions).toStrictEqual([
        'SET_NEEDS_RELOGIN',
        'SET_NEEDS_RELOGIN',
      ]);
    }, WAIT);
    expect((await b.store.getToken('claudecode', 'second'))?.access_token).toBe(
      'token-b-2',
    );
    expect(b.authErrors.every((error) => error === null)).toBe(true);
    expect(a.actions).toStrictEqual([]);
  });
});
