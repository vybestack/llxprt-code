/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { IPty } from '@lydell/node-pty';
import { Terminal } from '@xterm/headless';
import {
  BoundedCombinedCollector,
  createByteBudget,
} from '@vybestack/llxprt-code-tools/acquisition.js';
import { createExitGuard } from './shellExitGuard.js';
import {
  buildPtyResult,
  PTY_QUEUE_HARD_LIMIT_BYTES,
  PTY_QUEUE_HARD_LIMIT_ITEMS,
  PTY_QUEUE_HIGH_WATER_ITEMS,
  registerPtyDataHandler,
} from './shellPtyExecution.js';
import type { PtyExecState } from './shellPtyState.js';

interface FakePtyHarness {
  state: PtyExecState;
  emitData(data: string): void;
  pauseCount(): number;
  resumeCount(): number;
}

function createFakePtyState(supportsBackpressure: boolean): FakePtyHarness {
  let dataListener: ((data: string) => void) | undefined;
  let pauses = 0;
  let resumes = 0;
  const ptyProcess = {
    pid: 12345,
    onData(listener: (data: string) => void) {
      dataListener = listener;
      return { dispose() {} };
    },
    pause() {
      pauses += 1;
    },
    resume() {
      resumes += 1;
    },
  } as unknown as IPty;
  const headlessTerminal = {
    buffer: {
      active: {
        length: 0,
        cursorY: 0,
        getLine: () => undefined,
      },
    },
    write(_data: string, callback: () => void) {
      callback();
    },
  };
  const inactivityAbortController = new AbortController();
  const budget = createByteBudget(1024);
  const state = {
    ptyProcess,
    headlessTerminal,
    activePtyEntry: {
      ptyProcess,
      headlessTerminal,
      supportsProcessGroupKill: true,
    },
    isWindows: false,
    abortSignal: new AbortController().signal,
    onOutputEvent: () => undefined,
    shellExecutionConfig: {},
    ptyInfo: { name: 'node-pty', module: {} },
    supportsProcessGroupKill: true,
    inactivityAbortController,
    resetInactivityTimer: () => undefined,
    exitedGuard: createExitGuard(),
    output: null,
    rawCollector: new BoundedCombinedCollector({ budget }),
    error: null,
    isStreamingRawContent: true,
    sniffedBytes: 0,
    isWriting: false,
    hasStartedOutput: false,
    hasResolved: false,
    abortFinalizeTimeout: null,
    processingChain: Promise.resolve(),
    pendingQueueBytes: 0,
    pendingQueueItems: 0,
    supportsBackpressure,
    backpressurePaused: false,
    queueOverflowed: false,
    terminalMaxBufferLines: 600024,
    terminalScrollbackCapacity: 600000,
    terminalScrollbackAtCapacity: false,
    terminalContentEvicted: false,
  } as unknown as PtyExecState;

  return {
    state,
    emitData(data: string) {
      if (!dataListener) {
        throw new Error('PTY data listener was not registered');
      }
      dataListener(data);
    },
    pauseCount: () => pauses,
    resumeCount: () => resumes,
  };
}

describe('PTY bounded processing queue', () => {
  it('pauses at the item high-water mark and resumes after draining', async () => {
    const harness = createFakePtyState(true);
    const overflows: Error[] = [];
    registerPtyDataHandler(
      harness.state,
      () => undefined,
      createByteBudget(1024),
      (error) => overflows.push(error),
    );

    for (let i = 0; i < PTY_QUEUE_HIGH_WATER_ITEMS; i += 1) {
      harness.emitData('x');
    }

    expect(harness.pauseCount()).toBe(1);
    expect(harness.state.backpressurePaused).toBe(true);
    await harness.state.processingChain;
    expect(harness.resumeCount()).toBe(1);
    expect(harness.state.pendingQueueItems).toBe(0);
    expect(harness.state.pendingQueueBytes).toBe(0);
    expect(overflows).toHaveLength(0);
    expect(harness.state.error).toBeNull();
  });

  it('fails fast when tiny chunks exceed the hard item bound', async () => {
    const harness = createFakePtyState(false);
    const overflows: Error[] = [];
    registerPtyDataHandler(
      harness.state,
      () => undefined,
      createByteBudget(1024),
      (error) => overflows.push(error),
    );

    for (let i = 0; i <= PTY_QUEUE_HARD_LIMIT_ITEMS; i += 1) {
      harness.emitData('x');
    }

    expect(overflows).toHaveLength(1);
    expect(harness.state.queueOverflowed).toBe(true);
    expect(harness.state.rawCollector.observedByteCount).toBe(
      PTY_QUEUE_HARD_LIMIT_ITEMS + 1,
    );
    await harness.state.processingChain;
    expect(harness.state.pendingQueueItems).toBe(0);
    expect(harness.state.pendingQueueBytes).toBe(0);
  });
  it('fails fast on one oversized callback with bounded retained bytes', async () => {
    const harness = createFakePtyState(false);
    const overflows: Error[] = [];
    registerPtyDataHandler(
      harness.state,
      () => undefined,
      createByteBudget(1024),
      (error) => overflows.push(error),
    );
    const tailMarker = 'OVERSIZED_CALLBACK_TAIL';
    const output =
      'OVERSIZED_CALLBACK_HEAD' +
      'x'.repeat(PTY_QUEUE_HARD_LIMIT_BYTES) +
      tailMarker;

    harness.emitData(output);

    expect(overflows).toHaveLength(1);
    expect(harness.state.queueOverflowed).toBe(true);
    expect(harness.state.rawCollector.observedByteCount).toBe(
      Buffer.byteLength(output),
    );
    expect(
      harness.state.rawCollector.getResult().tailText.endsWith(tailMarker),
    ).toBe(true);
    await harness.state.processingChain;
    expect(harness.state.pendingQueueItems).toBe(0);
    expect(harness.state.pendingQueueBytes).toBe(0);
  });

  it('preserves a surrogate pair across the internal encoding slice boundary', async () => {
    const harness = createFakePtyState(true);
    const output = `${'x'.repeat(64 * 1024 - 1)}😀tail`;
    const budget = createByteBudget(128 * 1024);
    harness.state.rawCollector = new BoundedCombinedCollector({ budget });
    registerPtyDataHandler(
      harness.state,
      () => undefined,
      budget,
      () => {
        throw new Error('Unexpected PTY queue overflow');
      },
    );

    harness.emitData(output);
    await harness.state.processingChain;

    const result = harness.state.rawCollector.getResult();
    expect(result.metadata.observedBytes).toBe(Buffer.byteLength(output));
    expect(result.text).toBe(output);
    expect(result.text).not.toContain('�');
  });

  it('releases paused backpressure after a hard overflow drains the queue', async () => {
    const harness = createFakePtyState(true);
    const overflows: Error[] = [];
    registerPtyDataHandler(
      harness.state,
      () => undefined,
      createByteBudget(1024),
      (error) => overflows.push(error),
    );

    for (let i = 0; i <= PTY_QUEUE_HARD_LIMIT_ITEMS; i += 1) {
      harness.emitData('x');
    }

    expect(overflows).toHaveLength(1);
    expect(harness.pauseCount()).toBe(1);
    expect(harness.resumeCount()).toBe(1);
    expect(harness.state.backpressurePaused).toBe(false);
    expect(harness.state.queueOverflowed).toBe(true);

    await harness.state.processingChain;

    expect(harness.resumeCount()).toBe(1);
    expect(harness.state.pendingQueueItems).toBe(0);
    expect(harness.state.pendingQueueBytes).toBe(0);
  });

  describe('PTY bounded result', () => {
    it('reports truncation exactly once with structured metadata', async () => {
      const retentionBytes = 1024;
      const finalMarker = 'FINAL_PTY_MARKER';
      const output =
        'HEAD_PTY_MARKER' + 'x'.repeat(retentionBytes * 4) + finalMarker;
      const harness = createFakePtyState(true);
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        scrollback: 100,
        allowProposedApi: true,
      });
      harness.state.headlessTerminal = terminal;
      harness.state.rawCollector = new BoundedCombinedCollector({
        budget: createByteBudget(retentionBytes),
      });

      try {
        harness.state.rawCollector.append(Buffer.from(output), 'stdout');
        await new Promise<void>((resolve) => terminal.write(output, resolve));

        const result = buildPtyResult(harness.state, 0, null, false);
        const observedBytes = Buffer.byteLength(output);

        expect(result.rawOutput.length).toBeLessThanOrEqual(retentionBytes);
        expect(result.output).toContain('HEAD_PTY_MARKER');
        expect(result.output).toContain(finalMarker);
        expect(result.output.match(/LLXPRT output truncated/g)).toHaveLength(1);
        expect(result.outputTruncation).toEqual({
          observedBytes,
          retainedBytes: retentionBytes,
          omittedBytes: observedBytes - retentionBytes,
          truncated: true,
          budgetBytes: retentionBytes,
        });
      } finally {
        terminal.dispose();
      }
    });

    it('uses retained raw text when xterm scrollback evicts complete output', async () => {
      // Low-byte / high-line scenario: xterm evicts earlier screen content while
      // the raw collector remains within budget. The final model-facing result
      // must therefore recover the complete retained stream rather than claim
      // that output was lost.
      const harness = createFakePtyState(true);
      const terminal = new Terminal({
        cols: 80,
        rows: 4,
        scrollback: 4,
        allowProposedApi: true,
      });
      harness.state.headlessTerminal = terminal;
      harness.state.terminalMaxBufferLines = 8;
      // Collector budget large enough that the small output never truncates.
      harness.state.rawCollector = new BoundedCombinedCollector({
        budget: createByteBudget(4096),
      });

      try {
        // Write enough distinct short lines to force scrollback eviction.
        const lines: string[] = [];
        for (let i = 0; i < 40; i += 1) {
          lines.push(`line-${i}
`);
        }
        const data = lines.join('');
        harness.state.rawCollector.append(Buffer.from(data), 'stdout');
        await new Promise<void>((resolve) => terminal.write(data, resolve));
        harness.state.terminalContentEvicted = true;

        const result = buildPtyResult(harness.state, 0, null, false);
        expect(result.output).toContain('[Retained PTY output]');
        expect(result.output).toContain('line-0');
        expect(result.output).toContain('line-39');
        expect(result.output).not.toContain('LLXPRT output truncated');
        expect(result.outputTruncation).toBeUndefined();
        expect(result.rawOutput.toString('utf8')).toContain('line-0');
      } finally {
        terminal.dispose();
      }
    });

    it('preserves the raw collector head and tail bytes', () => {
      const retentionBytes = 1024;
      const harness = createFakePtyState(true);
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        scrollback: 100,
        allowProposedApi: true,
      });
      harness.state.headlessTerminal = terminal;
      harness.state.rawCollector = new BoundedCombinedCollector({
        budget: createByteBudget(retentionBytes),
      });

      try {
        const headMarker = 'PTY_RAW_HEAD_MARKER';
        const tailMarker = 'PTY_RAW_TAIL_MARKER';
        const output = headMarker + 'x'.repeat(retentionBytes * 8) + tailMarker;
        harness.state.rawCollector.append(Buffer.from(output), 'stdout');

        const result = buildPtyResult(harness.state, 0, null, false);
        // rawOutput carries the bounded raw head + tail.
        expect(result.rawOutput.length).toBeLessThanOrEqual(retentionBytes);
        const raw = result.rawOutput.toString('utf8');
        expect(raw).toContain(headMarker);
        expect(raw).toContain(tailMarker);
      } finally {
        terminal.dispose();
      }
    });

    it('preserves long wrapped lines without corruption', async () => {
      const harness = createFakePtyState(true);
      const terminal = new Terminal({
        cols: 20,
        rows: 24,
        scrollback: 1000,
        allowProposedApi: true,
      });
      harness.state.headlessTerminal = terminal;
      harness.state.rawCollector = new BoundedCombinedCollector({
        budget: createByteBudget(8192),
      });

      try {
        // A single line far longer than the 20-col terminal width wraps across
        // many visual rows; buildPtyResult must still surface the content.
        const longLine = 'W'.repeat(500);
        const data = `${longLine}
`;
        harness.state.rawCollector.append(Buffer.from(data), 'stdout');
        await new Promise<void>((resolve) => terminal.write(data, resolve));

        const result = buildPtyResult(harness.state, 0, null, false);
        expect(result.output).toContain('W'.repeat(20));
        expect(result.outputTruncation).toBeUndefined();
      } finally {
        terminal.dispose();
      }
    });

    it('marks queue-overflow byte loss as unquantifiable', () => {
      // High item / low byte overflow terminates acquisition before all producer
      // bytes can be observed. Retained accounting remains exact while metadata
      // explicitly marks the additional omission count as unknown.
      const harness = createFakePtyState(false);
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        scrollback: 100,
        allowProposedApi: true,
      });
      harness.state.headlessTerminal = terminal;
      harness.state.rawCollector = new BoundedCombinedCollector({
        budget: createByteBudget(1024),
      });
      harness.state.queueOverflowed = true;

      try {
        // Only a few bytes collected — well within budget.
        harness.state.rawCollector.append(Buffer.from('tiny output'), 'stdout');

        const result = buildPtyResult(harness.state, 0, null, false);
        expect(result.output.match(/LLXPRT output truncated/g)).toHaveLength(1);
        expect(result.outputTruncation).toEqual({
          observedBytes: 11,
          retainedBytes: 11,
          omittedBytes: 0,
          omittedBytesExact: false,
          truncated: true,
          budgetBytes: 1024,
        });
      } finally {
        terminal.dispose();
      }
    });
  });
});
