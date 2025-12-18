/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import { CommandContext } from '../ui/commands/types.js';
import { LoadedSettings } from '../config/settings.js';
import { GitService, Config } from '@vybestack/llxprt-code-core';
import { SessionStatsState } from '../ui/contexts/SessionContext.js';

// A utility type to make all properties of an object, and its nested objects, partial.
type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

/**
 * Creates a deep, fully-typed mock of the CommandContext for use in tests.
 * All functions are pre-mocked with `vi.fn()`.
 *
 * @param overrides - A deep partial object to override any default mock values.
 * @returns A complete, mocked CommandContext object.
 */
export const createMockCommandContext = (
  overrides: DeepPartial<CommandContext> = {},
): CommandContext => {
  const defaultMocks: CommandContext = {
    invocation: {
      raw: '',
      name: '',
      args: '',
    },
    services: {
      config: {
        getEphemeralSetting: vi.fn(),
        setEphemeralSetting: vi.fn(),
      } as unknown as Config,
      settings: { merged: {} } as LoadedSettings,
      git: undefined as GitService | undefined,
      logger: {
        log: vi.fn(),
        logMessage: vi.fn(),
        saveCheckpoint: vi.fn(),
        loadCheckpoint: vi.fn().mockResolvedValue([]),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, // Cast because Logger is a class.
      // TODO: Add profileManager and subagentManager when CommandContext interface is updated
      // @plan:PLAN-20250117-SUBAGENTCONFIG.P07
    },
    ui: {
      addItem: vi.fn(),
      clear: vi.fn(),
      setDebugMessage: vi.fn(),
      pendingItem: null,
      setPendingItem: vi.fn(),
      loadHistory: vi.fn(),
      toggleCorgiMode: vi.fn(),
      toggleVimEnabled: vi.fn(),
      setLlxprtMdFileCount: vi.fn(),
      updateHistoryTokenCount: vi.fn(),
      extensionsUpdateState: new Map(),
      setExtensionsUpdateState: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    session: {
      sessionShellAllowlist: new Set<string>(),
      stats: {
        sessionStartTime: new Date(),
        lastPromptTokenCount: 0,
        metrics: {
          models: {},
          tools: {
            totalCalls: 0,
            totalSuccess: 0,
            totalFail: 0,
            totalDurationMs: 0,
            totalDecisions: { accept: 0, reject: 0, modify: 0 },
            byName: {},
          },
        },
      } as SessionStatsState,
    },
  };

  // Deep merge that preserves special objects (Dates, vitest mocks, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merge = (target: any, source: any): any => {
    const output = { ...target };

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = output[key];

        if (
          // We only want to recursively merge plain objects
          Object.prototype.toString.call(sourceValue) === '[object Object]' &&
          Object.prototype.toString.call(targetValue) === '[object Object]'
        ) {
          output[key] = merge(targetValue, sourceValue);
        } else {
          // If not, we do a direct assignment. This preserves Date objects, vitest mocks, and others.
          output[key] = sourceValue;
        }
      }
    }
    return output;
  };

  return merge(defaultMocks, overrides);
};
