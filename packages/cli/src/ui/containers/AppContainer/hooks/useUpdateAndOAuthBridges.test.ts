/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { oauthUIBridge, type OAuthUIEvent } from '@vybestack/llxprt-code-auth';
import {
  InteractiveAuthHostUnavailableError,
  interactiveAuthCoordinator,
  type AuthCompletionOptions,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  resetRuntimeScopeForTesting,
  runWithRuntimeScope,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { getActiveRuntimeKind } from '@vybestack/llxprt-code-providers/runtime/runtimeAccessors.js';
import {
  resetCliRuntimeRegistryForTesting,
  upsertRuntimeEntry,
} from '@vybestack/llxprt-code-providers/runtime/runtimeRegistry.js';
import { renderHook } from '../../../../test-utils/render.js';
import type { HistoryItemWithoutId } from '../../../types.js';
import type { UpdateObject } from '../../../utils/updateCheck.js';
import { useUpdateAndOAuthBridges } from './useUpdateAndOAuthBridges.js';

interface AuthenticationCall {
  readonly provider: string;
  readonly bucket: string | undefined;
  readonly signal: AbortSignal | undefined;
}

type AuthenticationHandler = (signal: AbortSignal | undefined) => Promise<void>;

class RecordingOAuthManager {
  readonly providers = new Map<string, unknown>();
  readonly authenticationCalls: AuthenticationCall[] = [];

  constructor(private readonly authenticationHandler?: AuthenticationHandler) {}

  async authenticate(
    provider: string,
    bucket?: string,
    options?: AuthCompletionOptions,
  ): Promise<void> {
    this.authenticationCalls.push({
      provider,
      bucket,
      signal: options?.signal,
    });
    await this.authenticationHandler?.(options?.signal);
  }
}

function createHookHarness(
  manager: RecordingOAuthManager,
  runInInteractiveHostScope: <T>(callback: () => T) => T = (callback) =>
    callback(),
  getCliOAuthManagerOverride?: () => unknown,
): {
  readonly items: Array<Omit<HistoryItemWithoutId, 'id'>>;
  readonly renderResult: ReturnType<typeof renderHook>;
} {
  const items: Array<Omit<HistoryItemWithoutId, 'id'>> = [];
  const addItem = (
    item: Omit<HistoryItemWithoutId, 'id'>,
    _timestamp?: number,
  ): number => {
    items.push(item);
    return items.length;
  };
  const setUpdateInfo: Dispatch<SetStateAction<UpdateObject | null>> = (
    _value,
  ): void => undefined;
  const renderResult = renderHook(() =>
    useUpdateAndOAuthBridges({
      addItem,
      setUpdateInfo,
      getCliOAuthManager: getCliOAuthManagerOverride ?? (() => manager),
      runInInteractiveHostScope,
    }),
  );
  return { items, renderResult };
}

/**
 * @plan PLAN-20260827-ISSUE2562.P05
 * @requirement REQ-2562-4
 */
describe('useUpdateAndOAuthBridges interactive authentication integration', () => {
  beforeEach(async () => {
    await interactiveAuthCoordinator.dispose();
    interactiveAuthCoordinator.unbindHost();
    oauthUIBridge.clearCallback();
    oauthUIBridge.clearPending();
    resetRuntimeScopeForTesting();
    resetCliRuntimeRegistryForTesting();
  });

  afterEach(async () => {
    await interactiveAuthCoordinator.dispose();
    interactiveAuthCoordinator.unbindHost();
    oauthUIBridge.clearCallback();
    oauthUIBridge.clearPending();
    resetRuntimeScopeForTesting();
    resetCliRuntimeRegistryForTesting();
  });

  it('maps waiting and settled events to visible authentication messages', () => {
    const manager = new RecordingOAuthManager();
    const { items, renderResult } = createHookHarness(manager);
    const events: readonly OAuthUIEvent[] = [
      {
        type: 'oauth_waiting',
        provider: 'codex',
        bucket: 'work',
        requesterRuntimeKind: 'subagent',
        correlationId: 'waiting-correlation',
        waiterCount: 2,
      },
      {
        type: 'oauth_settled',
        provider: 'codex',
        bucket: 'work',
        requesterRuntimeKind: 'subagent',
        correlationId: 'waiting-correlation',
        waiterCount: 2,
        kind: 'cancelled',
      },
    ];

    act(() => {
      for (const event of events) {
        oauthUIBridge.emit(event);
      }
    });

    expect(items).toEqual([
      {
        type: 'info',
        text: 'Waiting for codex/work authentication (requested by subagent)…',
      },
      {
        type: 'info',
        text: 'Authentication for codex/work was cancelled',
      },
    ]);
    renderResult.unmount();
  });

  it('binds the interactive host to the OAuth manager and unbinds on cleanup', async () => {
    const manager = new RecordingOAuthManager();
    const { renderResult } = createHookHarness(manager);

    expect(interactiveAuthCoordinator.hasHost()).toBe(true);
    const outcome = await interactiveAuthCoordinator.requestAuth({
      provider: 'codex',
      bucket: 'work',
      requester: { runtimeKind: 'subagent' },
      reason: 'reauthentication-required',
      correlationId: 'host-binding-correlation',
    });

    expect(outcome).toEqual({
      kind: 'succeeded',
      correlationId: 'host-binding-correlation',
    });
    expect(manager.authenticationCalls).toHaveLength(1);
    expect(manager.authenticationCalls[0]?.provider).toBe('codex');
    expect(manager.authenticationCalls[0]?.bucket).toBe('work');
    expect(manager.authenticationCalls[0]?.signal).toBeInstanceOf(AbortSignal);

    renderResult.unmount();
    expect(interactiveAuthCoordinator.hasHost()).toBe(false);
  });

  it('settles host authentication as failed when the OAuth manager is unresolvable', async () => {
    const manager = new RecordingOAuthManager();
    // The mount effect wires provider callbacks through the same getter, so
    // the getter must succeed at mount and only fail when the host handler
    // resolves the manager for an incoming challenge.
    let throwOnResolve = false;
    const { renderResult } = createHookHarness(manager, undefined, () => {
      if (throwOnResolve) {
        throw new Error('runtime context not ready');
      }
      return manager;
    });

    expect(interactiveAuthCoordinator.hasHost()).toBe(true);
    throwOnResolve = true;
    const outcome = await interactiveAuthCoordinator.requestAuth(
      {
        provider: 'codex',
        bucket: 'work',
        requester: { runtimeKind: 'subagent' },
        reason: 'reauthentication-required',
        correlationId: 'host-throwing-correlation',
      },
      { timeoutMs: 2000 },
    );

    expect(outcome.kind).toBe('failed');
    expect(outcome.correlationId).toBe('host-throwing-correlation');
    expect(outcome.error).toBeInstanceOf(InteractiveAuthHostUnavailableError);
    expect(manager.authenticationCalls).toHaveLength(0);
    renderResult.unmount();
  });

  it('settles host authentication as failed when the OAuth manager does not support authentication', async () => {
    const manager = new RecordingOAuthManager();
    const { renderResult } = createHookHarness(manager, undefined, () => ({
      providers: new Map(),
    }));

    expect(interactiveAuthCoordinator.hasHost()).toBe(true);
    const outcome = await interactiveAuthCoordinator.requestAuth(
      {
        provider: 'codex',
        bucket: 'work',
        requester: { runtimeKind: 'subagent' },
        reason: 'reauthentication-required',
        correlationId: 'host-nonconforming-correlation',
      },
      { timeoutMs: 2000 },
    );

    expect(outcome.kind).toBe('failed');
    expect(outcome.correlationId).toBe('host-nonconforming-correlation');
    expect(outcome.error).toBeInstanceOf(InteractiveAuthHostUnavailableError);
    expect(manager.authenticationCalls).toHaveLength(0);
    renderResult.unmount();
  });

  it('runs the complete host authentication flow in the interactive host runtime scope', async () => {
    upsertRuntimeEntry('interactive-host', {
      runtimeKind: 'cli-interactive',
    });
    upsertRuntimeEntry('requesting-subagent', { runtimeKind: 'subagent' });
    const observedRuntimeKinds: Array<ReturnType<typeof getActiveRuntimeKind>> =
      [];
    const manager = new RecordingOAuthManager(async () => {
      await Promise.resolve();
      observedRuntimeKinds.push(getActiveRuntimeKind());
    });
    const { renderResult } = createHookHarness(manager, (callback) =>
      runWithRuntimeScope(
        { runtimeId: 'interactive-host', metadata: {} },
        callback,
      ),
    );

    const outcome = await runWithRuntimeScope(
      { runtimeId: 'requesting-subagent', metadata: {} },
      () =>
        interactiveAuthCoordinator.requestAuth({
          provider: 'codex',
          bucket: 'work',
          requester: {
            runtimeKind: 'subagent',
            runtimeId: 'requesting-subagent',
          },
          reason: 'authentication-required',
          correlationId: 'host-scope-correlation',
        }),
    );

    expect(outcome).toEqual({
      kind: 'succeeded',
      correlationId: 'host-scope-correlation',
    });
    expect(observedRuntimeKinds).toEqual(['cli-interactive']);
    renderResult.unmount();
  });

  it('cancels active authentication before unbinding the host on cleanup', async () => {
    let sessionSignal: AbortSignal | undefined;
    const manager = new RecordingOAuthManager(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          sessionSignal = signal;
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const { renderResult } = createHookHarness(manager);
    const waiter = interactiveAuthCoordinator.requestAuth(
      {
        provider: 'codex',
        bucket: 'work',
        requester: { runtimeKind: 'subagent' },
        reason: 'authentication-required',
        correlationId: 'host-cleanup-correlation',
      },
      // Bounds a cleanup regression to a fast timeout instead of hanging for
      // the production default.
      { timeoutMs: 2000 },
    );
    await Promise.resolve();
    await Promise.resolve();

    renderResult.unmount();

    await expect(waiter).resolves.toEqual({
      kind: 'cancelled',
      correlationId: 'host-cleanup-correlation',
    });
    expect(sessionSignal?.aborted).toBe(true);
    expect(interactiveAuthCoordinator.hasHost()).toBe(false);
    expect(interactiveAuthCoordinator.getActiveSessions()).toEqual([]);
  });

  it('survives bridge identity churn across re-renders and still cancels on unmount', async () => {
    // @plan PLAN-20260827-ISSUE2562.P05
    // @requirement REQ-2562-4
    // The runtime context hands out fresh function identities on every
    // render. The host binding must survive that churn (no mid-auth
    // cancellation, no unbind), resolve the CURRENT manager, and only tear
    // down on a real unmount.
    const items: Array<Omit<HistoryItemWithoutId, 'id'>> = [];
    const addItem = (
      item: Omit<HistoryItemWithoutId, 'id'>,
      _timestamp?: number,
    ): number => {
      items.push(item);
      return items.length;
    };
    const setUpdateInfo: Dispatch<SetStateAction<UpdateObject | null>> = (
      _value,
    ): void => undefined;

    const firstManager = new RecordingOAuthManager();
    const secondManager = new RecordingOAuthManager(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    // Fresh identities on every render, like the runtime bridge produces.
    // initialProps are required: without them the first render runs the hook
    // with undefined props, the mount effect throws dereferencing them, and
    // the reconciler drops the unmount cleanup for the whole tree.
    const renderResult = renderHook(
      (props: { manager: RecordingOAuthManager }) =>
        useUpdateAndOAuthBridges({
          addItem,
          setUpdateInfo,
          getCliOAuthManager: () => props.manager,
          runInInteractiveHostScope: (callback) => callback(),
        }),
      { initialProps: { manager: firstManager } },
    );

    // A session started after the churn must hit the CURRENT manager and
    // keep running across further re-renders.
    renderResult.rerender({ manager: secondManager });
    expect(interactiveAuthCoordinator.hasHost()).toBe(true);

    const waiter = interactiveAuthCoordinator.requestAuth(
      {
        provider: 'codex',
        bucket: 'work',
        requester: { runtimeKind: 'subagent' },
        reason: 'authentication-required',
        correlationId: 'rerender-churn-correlation',
      },
      // Bounds a cleanup regression to a fast 'timed_out' failure instead
      // of hanging until the production default (20 minutes).
      { timeoutMs: 2000 },
    );
    let settled = false;
    void waiter.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    renderResult.rerender({ manager: secondManager });
    await Promise.resolve();

    expect(interactiveAuthCoordinator.hasHost()).toBe(true);
    expect(interactiveAuthCoordinator.getActiveSessions()).toHaveLength(1);
    expect(settled).toBe(false);
    expect(firstManager.authenticationCalls).toHaveLength(0);
    expect(secondManager.authenticationCalls).toHaveLength(1);
    expect(
      items.some(
        (item) =>
          item.type === 'info' &&
          item.text?.includes('Waiting for codex/work') === true,
      ),
    ).toBe(true);

    renderResult.unmount();

    await expect(waiter).resolves.toEqual({
      kind: 'cancelled',
      correlationId: 'rerender-churn-correlation',
    });
    expect(interactiveAuthCoordinator.hasHost()).toBe(false);
    expect(interactiveAuthCoordinator.getActiveSessions()).toEqual([]);
  });
});
