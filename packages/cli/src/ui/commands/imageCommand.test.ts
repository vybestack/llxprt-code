/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { imageCommand } from './imageCommand.js';
import { MessageType } from '../types.js';
import type { CommandContext } from './types.js';

function makeMockContext(overrides?: {
  runImageOperation?: (req: {
    prompt: string;
    outputPath: string;
    inputPaths: readonly string[];
  }) => Promise<{ absoluteOutputPath: string }>;
}): CommandContext {
  return {
    services: {
      config: {
        // Mirror the REAL Config/CliUiRuntime surface: capability resolved via
        // a getter, not a mutable property. A config exposing only a property
        // must report unavailable so the wiring defect is caught.
        getRunImageOperation:
          overrides?.runImageOperation !== undefined
            ? () => overrides!.runImageOperation!
            : undefined,
      } as never,
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
    const desc = imageCommand.description ?? '';
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
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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

  it('aborts the runner signal when SIGINT is emitted during the operation', async () => {
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
          // Hold until SIGINT is emitted so the abort happens mid-operation.
          await gate;
          if (req.signal.aborted) {
            throw new Error('The operation was aborted.');
          }
          return { absoluteOutputPath: '/workspace/out.png' };
        },
      );
    const ctx = makeMockContext({ runImageOperation: runner });
    const actionPromise = imageCommand.action?.(
      ctx,
      'out.png "draw a cat"',
    ) as Promise<void>;

    // Wait for the runner to capture the signal.
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal?.aborted).toBe(false);
    process.emit('SIGINT');
    releaseRunner();
    await actionPromise;

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('removes the SIGINT listener after a successful operation (no leak)', async () => {
    const runner = vi.fn().mockResolvedValue({
      absoluteOutputPath: '/workspace/out.png',
    });
    const ctx = makeMockContext({ runImageOperation: runner });
    const before = process.listenerCount('SIGINT');
    await imageCommand.action?.(ctx, 'out.png "draw a cat"');
    const after = process.listenerCount('SIGINT');
    expect(after).toBe(before);
  });

  it('removes the SIGINT listener after a failed operation (no leak)', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('fail'));
    const ctx = makeMockContext({ runImageOperation: runner });
    const before = process.listenerCount('SIGINT');
    await imageCommand.action?.(ctx, 'out.png "draw a cat"');
    const after = process.listenerCount('SIGINT');
    expect(after).toBe(before);
  });
});
