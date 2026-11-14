/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Trusted entrypoint of the code mode subprocess. The host launches it by
 * absolute path with an empty environment. It reads one start frame, runs the
 * guest in QuickJS, answers nothing on its own, and writes exactly one
 * terminal frame (`complete` or `failure`). If the host closes stdin, the
 * wrapper stops without a terminal frame.
 */

import {
  LineFramer,
  PROTOCOL_VERSION,
  encodeFrame,
  parseResultFrame,
  parseStartFrame,
  type ChildFrame,
  type StartFrame,
} from './ipc-frames.js';
import { GuestRun, type GuestOutcome } from './quickjs-guest.js';

/** Host frames come from trusted code; this only bounds buffering. */
const MAX_HOST_FRAME_BYTES = 64 * 1024 * 1024;

class HostLines {
  private readonly queued: string[] = [];
  private waiter: ((line: string | undefined) => void) | undefined;
  private ended = false;

  constructor(input: NodeJS.ReadableStream) {
    const framer = new LineFramer(MAX_HOST_FRAME_BYTES);
    input.on('data', (chunk: Buffer) => {
      const lines = framer.push(chunk);
      if (lines === 'oversized') {
        this.close();
        return;
      }
      for (const line of lines) this.offer(line);
    });
    input.on('end', () => this.close());
  }

  next(): Promise<string | undefined> {
    const line = this.queued.shift();
    if (line !== undefined || this.ended) return Promise.resolve(line);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  private offer(line: string): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    if (waiter) waiter(line);
    else this.queued.push(line);
  }

  private close(): void {
    this.ended = true;
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.(undefined);
  }
}

function emit(frame: ChildFrame): void {
  process.stdout.write(encodeFrame(frame));
}

async function runToOutcome(
  start: StartFrame,
  guest: GuestRun,
  lines: HostLines,
): Promise<GuestOutcome | undefined> {
  let outcome = guest.begin();
  while (outcome === undefined) {
    const line = await lines.next();
    if (line === undefined) return undefined;
    const frame = parseResultFrame(line, start.runId);
    const delivered =
      frame === undefined ? 'invalid-frame' : guest.deliver(frame);
    if (delivered === 'invalid-frame' || delivered === 'unknown-call') {
      return {
        kind: 'failure',
        code: 'PROTOCOL_ERROR',
        message: `Host sent an ${delivered === 'invalid-frame' ? 'invalid' : 'unknown or duplicate'} result frame.`,
      };
    }
    outcome = delivered;
  }
  return outcome;
}

async function main(): Promise<void> {
  const lines = new HostLines(process.stdin);
  const first = await lines.next();
  const start = first === undefined ? undefined : parseStartFrame(first);
  if (start === undefined) {
    process.exitCode = 2;
    process.stdin.destroy();
    return;
  }
  const guest = await GuestRun.create(start, emit);
  // The QuickJS heap is released with the process rather than disposed:
  // JS_FreeRuntime aborts on objects still referenced by queued jobs, which a
  // run stopped mid-flight (for example a microtask storm) leaves behind.
  const outcome = await runToOutcome(start, guest, lines);
  const callCount = guest.calls;
  if (outcome?.kind === 'complete') {
    emit({
      version: PROTOCOL_VERSION,
      runId: start.runId,
      type: 'complete',
      value: outcome.value,
      callCount,
    });
  } else if (outcome !== undefined) {
    emit({
      version: PROTOCOL_VERSION,
      runId: start.runId,
      type: 'failure',
      code: outcome.code,
      message: outcome.message,
    });
  }
  process.stdin.destroy();
}

await main();
