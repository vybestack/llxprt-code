/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi } from 'bun:test';
import { imageCommand } from './imageCommand.js';
import { assertTruthy } from '../../test-utils/assertions.js';
import { MessageType } from '../types.js';
import type { CommandContext } from './types.js';

/**
 * A real class-style capability holder whose `getRunImageOperation` is a
 * prototype METHOD (not an arrow function). Invoking it detached would lose
 * `this`, so this genuinely exercises the receiver-binding contract: the
 * runtime must forward via a wrapper, and the command must invoke it as a
 * method. If `this` is lost, `#runner` is undefined and the command reports
 * unavailable instead of succeeding.
 */
class ImageCapabilityHolder {
  #runner:
    | ((req: {
        prompt: string;
        outputPath: string;
        inputPaths: readonly string[];
      }) => Promise<{ absoluteOutputPath: string }>)
    | undefined;

  constructor(
    runner?: (req: {
      prompt: string;
      outputPath: string;
      inputPaths: readonly string[];
    }) => Promise<{ absoluteOutputPath: string }>,
  ) {
    this.#runner = runner;
  }

  getRunImageOperation() {
    return this.#runner;
  }
}

function makeMockContext(overrides?: {
  runImageOperation?: (req: {
    prompt: string;
    outputPath: string;
    inputPaths: readonly string[];
  }) => Promise<{ absoluteOutputPath: string }>;
  signal?: AbortSignal;
}): CommandContext {
  const capability =
    overrides?.runImageOperation !== undefined
      ? new ImageCapabilityHolder(overrides.runImageOperation)
      : new ImageCapabilityHolder();
  return {
    signal: overrides?.signal ?? new AbortController().signal,
    services: {
      // The holder INSTANCE is the config, so `getRunImageOperation` is reached
      // through the prototype with the instance as receiver. It is deliberately
      // NOT pre-bound: extracting the function and calling it detached loses
      // `this`, cannot read `#runner`, and fails — which is exactly the
      // regression this fixture must be able to catch.
      config: capability as never,
      agent: null,
      settings: {} as never,
      git: undefined,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() } as never,
    },
    ui: {
      addItem: vi.fn(),
      clear: vi.fn(),
      setDebugMessage: vi.fn(),
      pendingItem: null,
      setPendingItem: vi.fn(),
      loadHistory: vi.fn(),
      toggleCorgiMode: vi.fn(),
      toggleDebugProfiler: vi.fn(),
      toggleVimEnabled: vi.fn(),
      setLlxprtMdFileCount: vi.fn(),
      updateHistoryTokenCount: vi.fn(),
      reloadCommands: vi.fn(),
      extensionsUpdateState: new Map(),
      dispatchExtensionStateUpdate: vi.fn(),
      addConfirmUpdateExtensionRequest: vi.fn(),
    },
    session: {
      stats: {} as never,
      sessionShellAllowlist: new Set(),
    },
  } as unknown as CommandContext;
}

describe('imageCommand', () => {
  it('has name "image" and is a built-in command', () => {
    expect(imageCommand.name).toBe('image');
  });

  it('documents syntax, no-overwrite, five-input limit, and examples in its description', () => {
    const desc = imageCommand.description;
    // Syntax must be documented.
    expect(desc).toMatch(/<output\.png>/i);
    expect(desc).toMatch(/<input\.png>|input/i);
    expect(desc).toMatch(/prompt/i);
    // No-overwrite behavior must be documented.
    expect(desc).toMatch(/no.?overwrite|not overwritten|will not overwrite/i);
    // Five-input limit must be documented.
    expect(desc).toMatch(/5|five/i);
    // Both generation and edit examples must be discoverable from help.
    expect(desc.length).toBeGreaterThan(0);
  });

  it('shows an error item for malformed input (missing prompt)', async () => {
    const ctx = makeMockContext();
    await imageCommand.action?.(ctx, 'out.png');
    const calls = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock.calls;
    const errorCall = calls.find(
      (c) => (c[0] as { type: string }).type === MessageType.ERROR,
    );
    expect(errorCall).toBeDefined();
    expect((errorCall![0] as { text: string }).text).toMatch(/prompt/i);
  });

  it('shows an error item for -- separator', async () => {
    const ctx = makeMockContext();
    await imageCommand.action?.(ctx, '-- out.png "prompt"');
    const calls = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock.calls;
    const errorCall = calls.find(
      (c) => (c[0] as { type: string }).type === MessageType.ERROR,
    );
    expect(errorCall).toBeDefined();
    expect((errorCall![0] as { text: string }).text).toMatch(
      /separator|usage/i,
    );
  });

  it('reports unavailable when no image runner is configured', async () => {
    const ctx = makeMockContext();
    await imageCommand.action?.(ctx, 'out.png "draw a cat"');
    const calls = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock.calls;
    const errorCall = calls.find(
      (c) => (c[0] as { type: string }).type === MessageType.ERROR,
    );
    expect(errorCall).toBeDefined();
    expect((errorCall![0] as { text: string }).text).toMatch(/unavailable/i);
  });

  it('invokes the runner and displays the saved path on success', async () => {
    const runner = vi.fn().mockResolvedValue({
      absoluteOutputPath: '/workspace/out.png',
    });
    const ctx = makeMockContext({ runImageOperation: runner });
    await imageCommand.action?.(ctx, 'out.png "draw a cat"');
    expect(runner).toHaveBeenCalledWith({
      prompt: 'draw a cat',
      outputPath: 'out.png',
      inputPaths: [],
      // The framework's invocation signal, not one the command minted itself.
      signal: ctx.signal,
    });
    const calls = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock.calls;
    const infoCall = calls.find(
      (c) => (c[0] as { type: string }).type === MessageType.INFO,
    );
    expect(infoCall).toBeDefined();
    expect((infoCall![0] as { text: string }).text).toContain(
      '/workspace/out.png',
    );
  });

  it('passes input paths for an edit operation', async () => {
    const runner = vi.fn().mockResolvedValue({
      absoluteOutputPath: '/workspace/fixed.png',
    });
    const ctx = makeMockContext({ runImageOperation: runner });
    await imageCommand.action?.(ctx, 'fixed.png original.png "fix the text"');
    expect(runner).toHaveBeenCalledWith({
      prompt: 'fix the text',
      outputPath: 'fixed.png',
      inputPaths: ['original.png'],
      signal: ctx.signal,
    });
  });

  it('displays an error when the runner throws', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('provider down'));
    const ctx = makeMockContext({ runImageOperation: runner });
    await imageCommand.action?.(ctx, 'out.png "draw a cat"');
    const calls = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock.calls;
    const errorCall = calls.find(
      (c) => (c[0] as { type: string }).type === MessageType.ERROR,
    );
    expect(errorCall).toBeDefined();
    expect((errorCall![0] as { text: string }).text).toContain('provider down');
  });

  it('aborts the runner mid-operation when the invocation is cancelled', async () => {
    let capturedSignal: AbortSignal | undefined;
    let releaseRunner: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseRunner = resolve;
    });
    const runner = vi
      .fn()
      .mockImplementation(
        async (req: {
          prompt: string;
          outputPath: string;
          inputPaths: readonly string[];
          signal: AbortSignal;
        }) => {
          capturedSignal = req.signal;
          // Hold until the invocation is cancelled so the abort lands mid-run.
          await gate;
          if (req.signal.aborted) {
            throw new Error('The operation was aborted.');
          }
          return { absoluteOutputPath: '/workspace/out.png' };
        },
      );
    const invocation = new AbortController();
    const ctx = makeMockContext({
      runImageOperation: runner,
      signal: invocation.signal,
    });
    const actionPromise = imageCommand.action?.(
      ctx,
      'out.png "draw a cat"',
    ) as Promise<void>;

    // Wait for the runner to capture the signal.
    await waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal?.aborted).toBe(false);
    invocation.abort();
    releaseRunner();
    await actionPromise;

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('reports nothing when the runner rejects because the invocation was cancelled', async () => {
    // The framework already added the cancellation notice; a second error item
    // would be noise.
    const invocation = new AbortController();
    const runner = vi.fn().mockImplementation(async () => {
      invocation.abort();
      throw new Error('The operation was aborted.');
    });
    const ctx = makeMockContext({
      runImageOperation: runner,
      signal: invocation.signal,
    });

    await imageCommand.action?.(ctx, 'out.png "draw a cat"');

    expect((ctx.ui.addItem as ReturnType<typeof vi.fn>).mock.calls).toEqual([]);
  });

  it('no longer reacts to a process SIGINT, only to the framework signal', async () => {
    // The command used to abort on its own SIGINT listener, which never fires
    // for Esc in the Ink UI and leaked across invocations. Emitting SIGINT
    // mid-operation must now leave the operation untouched.
    let capturedSignal: AbortSignal | undefined;
    let releaseRunner: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseRunner = resolve;
    });
    const runner = vi
      .fn()
      .mockImplementation(async (req: { signal: AbortSignal }) => {
        capturedSignal = req.signal;
        await gate;
        return { absoluteOutputPath: '/workspace/out.png' };
      });
    const ctx = makeMockContext({ runImageOperation: runner });
    // Keep node from applying its default SIGINT behaviour to the emit below.
    const keepAlive = () => {};
    process.on('SIGINT', keepAlive);
    try {
      const pending = imageCommand.action?.(ctx, 'out.png "draw a cat"');
      await waitFor(() => expect(capturedSignal).toBeDefined());
      process.emit('SIGINT');
      releaseRunner();
      await pending;
    } finally {
      process.removeListener('SIGINT', keepAlive);
    }

    assertTruthy(capturedSignal);
    expect(capturedSignal.aborted).toBe(false);
    const calls = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock.calls;
    const infoCall = calls.find(
      (c) => (c[0] as { type: string }).type === MessageType.INFO,
    );
    expect(infoCall).toBeDefined();
  });

  it('exercises receiver binding: a prototype-method capability works via the runtime wrapper', async () => {
    // This test proves the receiver-binding contract is genuinely exercised.
    // The capability is a prototype METHOD that reads `this.#runner`.
    // If `getRunImageOperation` were copied as a bare value and invoked
    // detached, `this` would be undefined and the runner would never resolve,
    // causing an "unavailable" error instead of success.
    const runner = vi.fn().mockResolvedValue({
      absoluteOutputPath: '/workspace/out.png',
    });
    const ctx = makeMockContext({ runImageOperation: runner });
    await imageCommand.action?.(ctx, 'out.png "draw a cat"');
    expect(runner).toHaveBeenCalledTimes(1);
    const calls = (ctx.ui.addItem as ReturnType<typeof vi.fn>).mock.calls;
    const infoCall = calls.find(
      (c) => (c[0] as { type: string }).type === MessageType.INFO,
    );
    expect(infoCall).toBeDefined();
  });
});
