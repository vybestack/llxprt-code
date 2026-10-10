/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { HookSystem } from '@vybestack/llxprt-code-core/hooks/hookSystem.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { sourceBeforeModelHook } from './source-before-model-hook.js';
import { fireSourceAfterModelHook } from './source-after-model-hook.js';

interface Calls {
  beforeSnapshot: number;
  afterSnapshot: number;
  rowsOpened: number;
  closed: number;
}

function system(calls: Calls): HookSystem {
  const fake = {
    getRegistry: () => ({ getHooksForEvent: () => [] }),
    fireBeforeModelSnapshotEvent: () => {
      calls.beforeSnapshot++;
      throw new Error('no hook is registered; no context may be opened');
    },
    fireAfterModelSnapshotEvent: () => {
      calls.afterSnapshot++;
      throw new Error('no hook is registered; no context may be opened');
    },
  };
  return fake as unknown as HookSystem;
}

describe('calls with no registered model hooks', () => {
  it('BeforeModel passes the pinned snapshot through without a hook context', async () => {
    const calls: Calls = {
      beforeSnapshot: 0,
      afterSnapshot: 0,
      rowsOpened: 0,
      closed: 0,
    };
    const snapshot: ProviderRequestSnapshot = {
      count: 1,
      pending: { inputCount: 0, firstOutputIndex: undefined },
      isPending: () => false,
      openReader: () => {
        calls.rowsOpened++;
        throw new Error('rows must stay unread');
      },
      close: () => {
        calls.closed++;
      },
    };
    const hooks = system(calls);
    const config = {
      getEnableHooks: () => true,
      getHookSystem: () => hooks,
    };
    const selection = await sourceBeforeModelHook({
      config: config as never,
      snapshot,
      pending: [],
      model: 'm',
      tools: undefined,
      log: () => undefined,
    });
    expect(selection.count).toBe(1);
    expect(selection.pendingSelection?.kind).not.toBe('hook-recovered-input');
    expect(calls).toStrictEqual({
      beforeSnapshot: 0,
      afterSnapshot: 0,
      rowsOpened: 0,
      closed: 0,
    });
  });

  it('AfterModel neither reads the pinned rows nor opens a hook context', async () => {
    const calls: Calls = {
      beforeSnapshot: 0,
      afterSnapshot: 0,
      rowsOpened: 0,
      closed: 0,
    };
    const result = await fireSourceAfterModelHook({
      system: system(calls),
      request: {
        rows: () => {
          calls.rowsOpened++;
          throw new Error('rows must stay unread');
        },
        tools: undefined,
      },
      model: 'm',
      response: { content: { speaker: 'ai', blocks: [] } },
      omitTools: false,
      log: () => undefined,
    });
    expect(result).toBeUndefined();
    expect(calls.afterSnapshot).toBe(0);
    expect(calls.rowsOpened).toBe(0);
  });
});
