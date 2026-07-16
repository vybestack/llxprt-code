/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { CoreSubagentServiceAdapter } from './CoreSubagentServiceAdapter.js';
import type {
  CoreSubagentLauncher,
  CoreSubagentLaunchResult,
} from './CoreSubagentServiceAdapter.js';
import { SubagentTerminateMode } from '../core/subagentTypes.js';
import type { Config } from '../config/config.js';
import type { SubagentManager } from '../config/subagentManager.js';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';

interface StreamingScope {
  output: {
    terminate_reason: SubagentTerminateMode;
    emitted_vars: Record<string, string>;
  };
  onMessage?: (message: string) => void;
  runInteractive: ReturnType<typeof vi.fn>;
  runNonInteractive: ReturnType<typeof vi.fn>;
}

function createStreamingAdapter(emit: (scope: StreamingScope) => void): {
  adapter: CoreSubagentServiceAdapter;
} {
  const scope: StreamingScope = {
    output: {
      terminate_reason: SubagentTerminateMode.GOAL,
      emitted_vars: {},
    },
    onMessage: undefined,
    runInteractive: vi.fn().mockImplementation(async () => {
      emit(scope);
    }),
    runNonInteractive: vi.fn(),
  };

  const launchResult: CoreSubagentLaunchResult = {
    agentId: 'agent-stream',
    scope,
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as CoreSubagentLaunchResult;

  const fakeOrchestrator = {
    launch: vi.fn().mockResolvedValue(launchResult),
  } as unknown as CoreSubagentLauncher;

  const config = {
    getEphemeralSettings: () => ({}),
    getSessionId: () => 'session-test',
    isInteractive: () => true,
  } as unknown as Config;

  const adapter = new CoreSubagentServiceAdapter({
    managerProvider: () => ({}) as unknown as SubagentManager,
    profileManagerProvider: () => ({}) as unknown as ProfileManager,
    config,
    isInteractiveEnvironment: () => true,
    orchestratorFactory: () => fakeOrchestrator,
  });
  return { adapter };
}

function extractMessageDeltas(
  calls: ReturnType<typeof vi.fn>['mock']['calls'],
): string[] {
  return calls
    .map((c) => c[0] as string)
    .filter((s) => !s.startsWith('<subagent') && !s.startsWith('</subagent'));
}

describe('CoreSubagentServiceAdapter lossless text streaming', () => {
  it('preserves standalone newline chunks instead of dropping them', async () => {
    const { adapter } = createStreamingAdapter((scope) => {
      scope.onMessage?.('Hello');
      scope.onMessage?.('\n');
      scope.onMessage?.('World');
    });
    const updateOutput = vi.fn();

    await adapter.executeSubagent(
      { name: 'helper', prompt: 'Do work' },
      { updateOutput },
    );

    const messageDeltas = extractMessageDeltas(updateOutput.mock.calls);
    expect(messageDeltas.join('')).toBe('Hello\nWorld');
  });

  it('preserves standalone spaces and tabs', async () => {
    const { adapter } = createStreamingAdapter((scope) => {
      scope.onMessage?.('a');
      scope.onMessage?.(' ');
      scope.onMessage?.('b');
      scope.onMessage?.('\t');
      scope.onMessage?.('c');
    });
    const updateOutput = vi.fn();

    await adapter.executeSubagent(
      { name: 'helper', prompt: 'Do work' },
      { updateOutput },
    );

    const messageDeltas = extractMessageDeltas(updateOutput.mock.calls);
    expect(messageDeltas.join('')).toBe('a b\tc');
  });

  it('normalizes CR and CRLF to LF', async () => {
    const { adapter } = createStreamingAdapter((scope) => {
      scope.onMessage?.('line1\r');
      scope.onMessage?.('line2\r\n');
      scope.onMessage?.('\r');
    });
    const updateOutput = vi.fn();

    await adapter.executeSubagent(
      { name: 'helper', prompt: 'Do work' },
      { updateOutput },
    );

    const messageDeltas = extractMessageDeltas(updateOutput.mock.calls);
    expect(messageDeltas.join('')).toBe('line1\nline2\n\n');
  });

  it('filters out only the truly empty string', async () => {
    const { adapter } = createStreamingAdapter((scope) => {
      scope.onMessage?.('');
      scope.onMessage?.('real');
    });
    const updateOutput = vi.fn();

    await adapter.executeSubagent(
      { name: 'helper', prompt: 'Do work' },
      { updateOutput },
    );

    const messageDeltas = extractMessageDeltas(updateOutput.mock.calls);
    expect(messageDeltas).toStrictEqual(['real']);
  });

  it('does not invent separators at fragment boundaries', async () => {
    const { adapter } = createStreamingAdapter((scope) => {
      for (const token of 'Hello World'.match(/(\w+|\s)/g) ?? []) {
        scope.onMessage?.(token);
      }
    });
    const updateOutput = vi.fn();

    await adapter.executeSubagent(
      { name: 'helper', prompt: 'Do work' },
      { updateOutput },
    );

    const messageDeltas = extractMessageDeltas(updateOutput.mock.calls);
    expect(messageDeltas.join('')).toBe('Hello World');
  });

  it('forwards raw messages to the existing handler', async () => {
    const existingHandler = vi.fn();
    const scope: StreamingScope = {
      output: {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: {},
      },
      onMessage: existingHandler,
      runInteractive: vi.fn().mockImplementation(async () => {
        scope.onMessage?.('raw\r\nmessage');
      }),
      runNonInteractive: vi.fn(),
    };
    const launchResult: CoreSubagentLaunchResult = {
      agentId: 'agent-raw',
      scope,
      dispose: vi.fn().mockResolvedValue(undefined),
    } as unknown as CoreSubagentLaunchResult;
    const fakeOrchestrator = {
      launch: vi.fn().mockResolvedValue(launchResult),
    } as unknown as CoreSubagentLauncher;
    const config = {
      getEphemeralSettings: () => ({}),
      getSessionId: () => 'session-test',
      isInteractive: () => true,
    } as unknown as Config;
    const adapter = new CoreSubagentServiceAdapter({
      managerProvider: () => ({}) as unknown as SubagentManager,
      profileManagerProvider: () => ({}) as unknown as ProfileManager,
      config,
      isInteractiveEnvironment: () => true,
      orchestratorFactory: () => fakeOrchestrator,
    });
    const updateOutput = vi.fn();

    await adapter.executeSubagent(
      { name: 'helper', prompt: 'Do work' },
      { updateOutput },
    );

    expect(existingHandler).toHaveBeenCalledWith('raw\r\nmessage');
  });
});
