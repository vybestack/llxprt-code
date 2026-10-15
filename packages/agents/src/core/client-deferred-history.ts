/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DeferredHistorySourceOptions } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ChatSession } from './chatSession.js';
import {
  createChatSessionSafe,
  type CreateChatSessionDeps,
} from './ChatSessionFactory.js';
import {
  replaceClientArrayHistory,
  replaceClientHistorySource,
  replaceDeferredClientSource,
} from './clientHistoryReplacement.js';
import { isHistorySource } from './deferredHistorySource.js';
import type { DeferredHistoryDeps } from './deferredHistorySource.js';
import {
  releaseDeferredArray,
  replaceDeferredArray,
  type RetainedHistoryAdmission,
  type RetainedHistoryAdmissions,
} from './retainedHistoryAdmissions.js';

/**
 * The client state that deferred history publication reads and writes.
 * The client owns the state; this module only acts through the port.
 */
export interface DeferredHistoryPort {
  readonly admissions: RetainedHistoryAdmissions;
  readonly runtime: AgentRuntimeState;
  deps(): DeferredHistoryDeps;
  chat(): ChatSession | undefined;
  setChat(chat: ChatSession): void;
  admission(): RetainedHistoryAdmission | undefined;
  setAdmission(admission: RetainedHistoryAdmission | undefined): void;
  release(): (() => Promise<void>) | undefined;
  setRelease(release: (() => Promise<void>) | undefined): void;
  stored(): HistoryService | undefined;
  setStored(journal: HistoryService | undefined): void;
  markStreamed(): void;
  resetIdeContext(): void;
}

export type ChatSessionInputs = Omit<
  CreateChatSessionDeps,
  'storedHistoryService' | 'clearStoredHistoryService' | 'extraHistory'
>;

export async function releaseDeferredSource(
  port: DeferredHistoryPort,
): Promise<void> {
  await port.release()?.();
  port.setRelease(undefined);
}

export async function setClientHistory(
  port: DeferredHistoryPort,
  history: readonly IContent[],
  stripThoughts: boolean,
  historyOrigin?: object,
): Promise<void> {
  await replaceClientArrayHistory(
    history,
    port.chat(),
    port.admissions,
    port.admission(),
    (rows) => replaceDeferredHistory(port, rows),
    () => {
      port.markStreamed();
    },
    stripThoughts,
    historyOrigin,
  );
  if (port.chat() !== undefined) port.setAdmission(undefined);
  port.resetIdeContext();
}

export async function setHistoryFromSource(
  port: DeferredHistoryPort,
  source: AsyncIterable<IContent>,
  options: DeferredHistorySourceOptions,
): Promise<void> {
  await replaceClientHistorySource(source, options, port.chat() !== undefined, {
    deps: port.deps(),
    runtime: port.runtime,
    existing: port.chat()?.getHistoryService() ?? port.stored(),
    admissions: port.admissions,
    prior: port.admission(),
    priorRelease: port.release(),
    publish: (journal, release) => {
      port.setRelease(release);
      port.setAdmission(undefined);
      if (port.chat() === undefined) {
        port.setStored(journal);
        port.markStreamed();
      }
      port.resetIdeContext();
    },
  });
}

export async function storeHistoryForLaterUse(
  port: DeferredHistoryPort,
  history: readonly IContent[] | AsyncIterable<IContent>,
  options: DeferredHistorySourceOptions,
): Promise<void> {
  if (!isHistorySource(history)) {
    return replaceDeferredHistory(port, history, options);
  }
  if (port.chat() !== undefined)
    throw new Error('Streamed deferred history requires an inactive chat');
  return replaceDeferredClientSource(history, options, {
    deps: port.deps(),
    runtime: port.runtime,
    existing: port.stored(),
    admissions: port.admissions,
    prior: port.admission(),
    priorRelease: port.release(),
    publish: (journal, release) => {
      port.setStored(journal);
      port.markStreamed();
      port.setAdmission(undefined);
      port.setRelease(release);
    },
  });
}

export async function discardDeferredHistory(
  port: DeferredHistoryPort,
): Promise<void> {
  await releaseDeferredSource(port);
  const admission = port.admission();
  if (admission) {
    const failures = await port.admissions.release([admission]);
    if (failures.length > 0)
      throw new AggregateError(failures, 'Deferred history cleanup failed');
  }
  port.setAdmission(undefined);
}

/**
 * Deliberately not an async function: a suspended async frame would keep the
 * caller's array alive for the whole admission, so the input is handed to the
 * admission and nothing here retains it while the operation is pending.
 */
function replaceDeferredHistory(
  port: DeferredHistoryPort,
  history: readonly IContent[],
  options: DeferredHistorySourceOptions = {},
): Promise<void> {
  return replaceDeferredArray(
    port.admissions,
    history,
    port.admission(),
    port.stored(),
    options,
  ).then(async (next) => {
    const priorRelease = port.release();
    port.setAdmission(next.retained);
    port.setStored(next.journal);
    port.setRelease(undefined);
    port.markStreamed();
    await priorRelease?.();
  });
}

/**
 * Builds a chat and settles the deferred history the client held: array
 * admissions transfer to the new chat, streamed sources are released once the
 * chat has settled their media ownership.
 */
export async function startChatWithDeferredHistory(
  port: DeferredHistoryPort,
  inputs: () => ChatSessionInputs,
  extraHistory: readonly IContent[] | undefined,
): Promise<ChatSession> {
  const deferredAdmission = port.admission();
  let chat: ChatSession;
  try {
    chat = await createChatSessionSafe({
      ...inputs(),
      storedHistoryService: port.stored(),
      clearStoredHistoryService: () => {
        if (port.release() === undefined) port.setStored(undefined);
      },
      extraHistory:
        deferredAdmission === undefined || port.stored()?.isEmpty() === true
          ? extraHistory
          : [],
    });
  } catch (error: unknown) {
    if (deferredAdmission === undefined) throw error;
    port.setAdmission(undefined);
    return port.admissions.releaseAfterFailure(
      error,
      [deferredAdmission],
      'Chat startup failed and deferred history cleanup was incomplete',
    );
  }

  if (deferredAdmission === undefined) {
    if (port.release() !== undefined) {
      await chat.getHistoryService().settleMediaOwnership();
      await releaseDeferredSource(port);
      port.setStored(undefined);
    }
    port.setChat(chat);
    return chat;
  }
  try {
    await chat.getHistoryService().settleMediaOwnership();
  } catch (error: unknown) {
    port.setAdmission(undefined);
    return port.admissions.releaseAfterFailure(
      error,
      [deferredAdmission],
      'Chat startup failed and deferred history cleanup was incomplete',
      () => chat.clearHistory(),
    );
  }
  port.setChat(chat);
  port.markStreamed();
  await releaseDeferredArray(
    port.admissions,
    deferredAdmission,
    'Deferred history ownership transfer to chat was incomplete',
  );
  port.setAdmission(undefined);
  return chat;
}
