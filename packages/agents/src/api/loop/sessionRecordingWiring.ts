/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { HookControl } from '../control/hooks.js';
import type { SessionControl } from '../control/sessionControl.js';
import type { HookSystem } from '@vybestack/llxprt-code-core/hooks/hookSystem.js';
import type { HookRecordingReader } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { RecordingPort } from '@vybestack/llxprt-code-core/session/sessionExecutionServices.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { AgentClient } from '../../core/client.js';

export function createSessionHookControl(
  deps: {
    readonly config: Config;
    readonly messageBus: MessageBus;
    readonly runtimeId: string;
  },
  session: Pick<SessionControl, 'getActiveRecording'>,
): HookControl {
  return new HookControl({
    config: deps.config,
    messageBus: deps.messageBus,
    sessionId: () => deps.runtimeId,
    cwd: () => deps.config.getTargetDir(),
    readRecording: () => session.getActiveRecording(),
  });
}

export function bindClientRecording(
  client: AgentClientContract,
  readRecording: () => RecordingPort | undefined,
): void {
  if (client instanceof AgentClient) {
    client.setRecordingReader(readRecording);
  }
}

export function scopeSessionHookRecording<T>(
  events: AsyncIterable<T>,
  hooks: HookSystem | undefined,
  reader: HookRecordingReader,
): AsyncIterable<T> {
  return hooks ? withSessionHookRecording(events, hooks, reader) : events;
}

async function* withSessionHookRecording<T>(
  events: AsyncIterable<T>,
  hooks: HookSystem,
  reader: HookRecordingReader,
): AsyncGenerator<T> {
  const iterator = events[Symbol.asyncIterator]();
  try {
    for (;;) {
      const result = await hooks.runWithRecordingReader(reader, () =>
        iterator.next(),
      );
      if (result.done === true) return;
      yield result.value;
    }
  } finally {
    await hooks.runWithRecordingReader(reader, () => iterator.return?.());
  }
}
