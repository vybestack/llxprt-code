/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stand-in for the trusted wrapper that misbehaves on purpose, so the host's
 * frame validation, limits and process handling can be exercised. The start
 * frame's `source` selects the behavior.
 */

import { createInterface } from 'node:readline';

interface Start {
  readonly version: number;
  readonly runId: string;
  readonly source: string;
  readonly limits: { readonly maxConsoleLines: number };
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const lines = input[Symbol.asyncIterator]();
const first = await lines.next();
if (first.done === true) process.exit(1);
const start = JSON.parse(String(first.value)) as Start;
const envelope = { version: start.version, runId: start.runId };
const write = (frame: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ ...envelope, ...frame })}\n`);
};
const call = { type: 'call', callId: 1, tool: 'echo', args: {} };

switch (start.source) {
  case 'inspect-env':
    write({
      type: 'complete',
      callCount: 0,
      value: {
        keys: Object.keys(process.env),
        preloaded: 'codeModePreloaded' in globalThis,
      },
    });
    break;
  case 'call-without-id':
    write({ type: 'call', tool: 'echo', args: {} });
    break;
  case 'duplicate-call':
    write(call);
    write(call);
    break;
  case 'unrequested-tool':
    write({ ...call, tool: 'write_file' });
    break;
  case 'log-flood':
    for (let line = 0; line <= start.limits.maxConsoleLines; line += 1)
      write({ type: 'log', text: 'x' });
    break;
  case 'unterminated-frame':
    process.stdout.write('x'.repeat(4 * 1024 * 1024));
    break;
  case 'wrong-run-id':
    process.stdout.write(
      `${JSON.stringify({ ...envelope, runId: 'other-run', type: 'complete', value: 1, callCount: 0 })}\n`,
    );
    break;
  case 'invalid-json':
    process.stdout.write('{not json\n');
    break;
  case 'unknown-failure-code':
    write({ type: 'failure', code: 'MADE_UP', message: 'x' });
    break;
  case 'complete-with-pending-call':
    write(call);
    write({ type: 'complete', value: 1, callCount: 1 });
    break;
  case 'exit-without-frame':
    process.stderr.write('wrapper exploded\n');
    process.exit(3);
    break;
  default:
    throw new Error(`Unknown scripted behavior: ${start.source}`);
}

// Stay alive until the host closes stdin or kills the process, as a stuck or
// hostile wrapper would.
for await (const _line of lines) {
  // Ignore host frames.
}
