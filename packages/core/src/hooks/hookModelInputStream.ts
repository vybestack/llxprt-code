/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import type { Writable } from 'node:stream';
import type { HookSnapshotRows } from './hookOutputSnapshot.js';
import type { HookLLMRequest } from './hookTranslator.js';
import { killProcessGroupSafe } from '../services/shellJobInternal.js';
import { taskkillTree } from '../services/shellProcessKill.js';

export function stopHookInputProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (process.platform === 'win32') taskkillTree(child.pid);
  else killProcessGroupSafe(child.pid, signal);
}
import type {
  AfterModelInput,
  BeforeModelInput,
  HookEventName,
} from './types.js';

type RequestRows = Omit<HookLLMRequest, 'contents'> & {
  readonly contents: HookSnapshotRows;
};
export type HookModelRowsInput =
  | (Omit<BeforeModelInput, 'llm_request' | 'hook_event_name'> & {
      hook_event_name: HookEventName.BeforeModel;
      llm_request: RequestRows;
    })
  | (Omit<AfterModelInput, 'llm_request' | 'hook_event_name'> & {
      hook_event_name: HookEventName.AfterModel;
      llm_request: RequestRows;
    });

async function* rowsJSON(
  rows: HookSnapshotRows,
  signal: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  yield '[';
  let separator = '';
  const reader = rows.openReader(signal);
  try {
    for await (const row of reader) {
      signal.throwIfAborted();
      yield separator;
      yield JSON.stringify(row);
      separator = ',';
    }
  } finally {
    await reader.return();
  }
  yield ']';
}

async function* requestJSON(
  request: RequestRows,
  signal: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  yield '{';
  let separator = '';
  const fields: Array<[string, unknown]> = Object.entries(request);
  for (const [key, value] of fields) {
    if (value === undefined) continue;
    yield `${separator}${JSON.stringify(key)}:`;
    separator = ',';
    if (key !== 'contents') yield JSON.stringify(value);
    else yield* rowsJSON(request.contents, signal);
  }
  yield '}';
}

async function* inputJSON(
  input: HookModelRowsInput,
  signal: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  yield '{';
  let separator = '';
  const fields: Array<[string, unknown]> = Object.entries(input);
  for (const [key, value] of fields) {
    if (value === undefined) continue;
    yield `${separator}${JSON.stringify(key)}:`;
    separator = ',';
    if (key === 'llm_request') yield* requestJSON(input.llm_request, signal);
    else yield JSON.stringify(value);
  }
  yield '}';
}

async function writeChunk(
  stdin: Writable,
  chunk: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    // A write callback acknowledges this chunk before producing another one.
    stdin.write(chunk, (error) => {
      signal.removeEventListener('abort', onAbort);
      if (error != null) reject(error);
      else resolve();
    });
  });
}

async function writeJSONChunk(
  stdin: Writable,
  chunk: string,
  signal: AbortSignal,
): Promise<void> {
  for (let offset = 0; offset < chunk.length; ) {
    let end = Math.min(offset + stdin.writableHighWaterMark, chunk.length);
    const last = chunk.charCodeAt(end - 1);
    if (end < chunk.length && last >= 0xd800 && last <= 0xdbff) end++;
    await writeChunk(stdin, chunk.slice(offset, end), signal);
    offset = end;
  }
}

export interface HookInputStream {
  readonly finished: Promise<Error | undefined>;
  cancel(reason: Error, kill?: boolean): void;
  close(): Promise<Error | undefined>;
}

/** The caller attaches stdout/stderr drains before starting the input producer. */
export function startHookInputStream(
  child: ChildProcess,
  input: HookModelRowsInput,
  signal?: AbortSignal,
): HookInputStream {
  const controller = new AbortController();
  let failure: Error | undefined;
  let inputFinished = false;
  const cancel = (reason: Error, kill = true): void => {
    failure ??= reason;
    controller.abort(reason);
    child.stdin?.destroy();
    if (kill) stopHookInputProcess(child, 'SIGKILL');
  };
  const onAbort = (): void => {
    cancel(
      signal?.reason instanceof Error
        ? signal.reason
        : new Error('Hook input cancelled', { cause: signal?.reason }),
    );
  };
  const onError = (error: Error): void => cancel(error);
  child.stdin?.on('error', onError);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted === true) onAbort();
  const finished = (async (): Promise<Error | undefined> => {
    try {
      const stdin = child.stdin;
      if (stdin === null) throw new Error('Hook stdin unavailable');
      for await (const chunk of inputJSON(input, controller.signal)) {
        controller.signal.throwIfAborted();
        await writeJSONChunk(stdin, chunk, controller.signal);
      }
      controller.signal.throwIfAborted();
      const flushed = once(stdin, 'finish', { signal: controller.signal });
      stdin.end();
      await flushed;
      inputFinished = true;
    } catch (error) {
      if (failure === undefined)
        cancel(
          error instanceof Error
            ? error
            : new Error('Hook input failed', { cause: error }),
        );
    }
    return failure;
  })();
  return {
    finished,
    cancel,
    close: async () => {
      if (!inputFinished && failure === undefined)
        cancel(new Error('Hook exited before stdin completed'), false);
      await finished;
      signal?.removeEventListener('abort', onAbort);
      child.stdin?.removeListener('error', onError);
      return failure;
    },
  };
}
