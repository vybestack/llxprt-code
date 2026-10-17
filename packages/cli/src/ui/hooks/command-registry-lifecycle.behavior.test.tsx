/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { act, useState } from 'react';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { useCommandReload } from './slashCommandProcessorSupport.js';
import {
  createBuiltinCommandLoaderFactory,
  createRegisteredCommandLoader,
  createCommandChangeSubscription,
} from '../../services/commandRegistryOperations.js';
import { coreEvents } from '@vybestack/llxprt-code-core';
import type { SlashCommand } from '../commands/types.js';

const owners = createUnconfiguredBuiltinOwners();
const createBuiltin = createBuiltinCommandLoaderFactory(
  () => false,
  () => false,
  () => true,
  () => null,
);
const loadRegistry = createRegisteredCommandLoader(
  createBuiltin,
  () => ({ loadCommands: async () => [] }),
  () => ({ loadCommands: async () => [] }),
);

function deferred() {
  let resolve: (() => void) | undefined;
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    ready,
    finish: () => {
      if (!resolve) throw new Error('Deferred input unavailable');
      resolve();
    },
  };
}

describe('captured command registry lifecycle', () => {
  it('does not publish an aborted discovery after a newer registry has loaded', async () => {
    const first = deferred();
    const started = deferred();
    const signals: AbortSignal[] = [];
    const load = async (bindings: typeof owners, signal: AbortSignal) => {
      const result = await loadRegistry(bindings, signal);
      signals.push(signal);
      if (signals.length === 1) {
        started.finish();
        await first.ready;
      }
      return result;
    };
    const subscribe = () => undefined;
    const mounted = renderHook(
      ({ revision }: { revision: number }) => {
        const [commands, setCommands] = useState<readonly SlashCommand[]>([]);
        useCommandReload(
          owners,
          load,
          subscribe,
          revision,
          true,
          () => {},
          setCommands,
        );
        return commands;
      },
      { initialProps: { revision: 0 } },
    );
    try {
      await started.ready;
      mounted.rerender({ revision: 1 });
      await waitFor(() =>
        expect(mounted.result.current.length).toBeGreaterThan(0),
      );
      await act(async () => first.finish());
      expect(
        mounted.result.current.some((command) => command.name === 'model'),
      ).toBe(true);
      expect(signals[0]?.aborted).toBe(true);
    } finally {
      mounted.unmount();
    }
  });

  it('retires IDE, MCP and trust subscriptions in owner order', () => {
    const events: string[] = [];
    const subscribe = createCommandChangeSubscription(
      () => {
        events.push('ide-open');
        return () => {
          events.push('ide-close');
        };
      },
      () => {
        events.push('mcp-open');
        return () => {
          events.push('mcp-close');
        };
      },
    );
    const remove = subscribe(() => events.push('reload'));
    coreEvents.emitFolderTrustChanged(true);
    remove?.();
    coreEvents.emitFolderTrustChanged(false);
    expect(events).toStrictEqual([
      'ide-open',
      'mcp-open',
      'reload',
      'ide-close',
      'mcp-close',
    ]);
    expect(events.filter((event) => event === 'reload')).toHaveLength(1);
  });
});
