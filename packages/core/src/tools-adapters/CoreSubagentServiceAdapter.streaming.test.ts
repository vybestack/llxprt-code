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

function createStreamingAdapter(
  emit: (scope: StreamingScope) => void,
  options: { existingHandler?: (message: string) => void } = {},
): {
  adapter: CoreSubagentServiceAdapter;
} {
  const scope: StreamingScope = {
    output: {
      terminate_reason: SubagentTerminateMode.GOAL,
      emitted_vars: {},
    },
    onMessage: options.existingHandler,
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

/**
 * Asserts the exact XML wrapper tags then returns the interior deltas only.
 * Avoids prefix filtering so model text starting with `<subagent ` is not dropped.
 */
function extractMessageDeltas(
  calls: ReturnType<typeof vi.fn>['mock']['calls'],
): string[] {
  const all = calls.map((c) => c[0] as string);
  expect(all.length).toBeGreaterThanOrEqual(2);
  expect(all[0].startsWith('<subagent name="')).toBe(true);
  expect(all[0].endsWith('">\n')).toBe(true);
  expect(all[all.length - 1].startsWith('</subagent name="')).toBe(true);
  expect(all[all.length - 1].endsWith('">\n')).toBe(true);
  return all.slice(1, -1);
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
    const { adapter } = createStreamingAdapter(
      (scope) => {
        scope.onMessage?.('raw\r\nmessage');
      },
      { existingHandler },
    );
    const updateOutput = vi.fn();

    await adapter.executeSubagent(
      { name: 'helper', prompt: 'Do work' },
      { updateOutput },
    );

    expect(existingHandler).toHaveBeenCalledWith('raw\r\nmessage');
  });

  it('preserves CRLF semantics across split chunk boundaries', async () => {
    const { adapter } = createStreamingAdapter((scope) => {
      scope.onMessage?.('a\r');
      scope.onMessage?.('\nb');
    });
    const updateOutput = vi.fn();

    await adapter.executeSubagent(
      { name: 'helper', prompt: 'Do work' },
      { updateOutput },
    );

    const messageDeltas = extractMessageDeltas(updateOutput.mock.calls);
    expect(messageDeltas.join('')).toBe('a\nb');
  });

  it('flushes a pending CR as LF when the stream ends in a lone CR', async () => {
    const { adapter } = createStreamingAdapter((scope) => {
      scope.onMessage?.('hello\r');
    });
    const updateOutput = vi.fn();

    await adapter.executeSubagent(
      { name: 'helper', prompt: 'Do work' },
      { updateOutput },
    );

    const messageDeltas = extractMessageDeltas(updateOutput.mock.calls);
    expect(messageDeltas.join('')).toBe('hello\n');
  });

  it('preserves model text that begins with exact subagent wrapper prefixes verbatim', async () => {
    const { adapter } = createStreamingAdapter((scope) => {
      scope.onMessage?.('<subagent name="not-wrapper">begin');
      scope.onMessage?.('</subagent name="not-wrapper">end');
    });
    const updateOutput = vi.fn();

    await adapter.executeSubagent(
      { name: 'helper', prompt: 'Do work' },
      { updateOutput },
    );

    const messageDeltas = extractMessageDeltas(updateOutput.mock.calls);
    expect(messageDeltas.join('')).toBe(
      '<subagent name="not-wrapper">begin</subagent name="not-wrapper">end',
    );
  });
});
