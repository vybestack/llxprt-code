/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { throwAfterFailedTurnCleanup } from './turnMediaAdmissionLifecycle.js';
import type { TurnReceipt } from '@vybestack/llxprt-code-core/core/turnReceipt.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import type { TurnProcessorRuntime } from './chatSessionPorts.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponseArrival } from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';
import type { MediaAdmissionRelease } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import {
  toModelStreamChunk,
  type ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { resolveStreamIdleTimeoutMs } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import { appendResponseChunk, openResponseArrival } from './responseArrival.js';
import { StreamTerminalState } from './streamTerminalState.js';
import {
  filterHookRestrictedBlocks,
  filterAfcByHookRestrictions,
} from './hookToolRestrictions.js';
import {
  admitStreamChunkForHistory,
  streamMediaAdmissions,
  type PreparedUserTurn,
} from './mediaAdmissionSeam.js';
import { readProviderStreamResponse } from './turnLogging.js';
import { syncAndRecordTurnUsage } from './tokenUsageActualLogger.js';

export async function failDirectTurn(
  error: unknown,
  response: DirectResponseArrival | undefined,
  prepared: PreparedUserTurn,
  semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
): Promise<never> {
  let failure = error;
  try {
    await response?.release();
  } catch (cleanupError) {
    failure = new AggregateError(
      [error, cleanupError],
      'Direct response cleanup failed',
    );
  }
  return throwAfterFailedTurnCleanup(failure, prepared, semanticMediaPurge);
}

export class DirectResponseArrival {
  readonly terminal = new StreamTerminalState();
  private readonly admissions: MediaAdmissionRelease[] = [];
  constructor(
    private readonly arrival: ResponseArrival,
    private readonly runtime: TurnProcessorRuntime,
    private readonly history: HistoryService,
    private readonly turnId: string,
    private readonly allowedNames: string[] | undefined,
  ) {}
  get usage(): ModelOutput['usage'] {
    return this.terminal.usage;
  }
  get semanticMediaPurgeCacheWriteEvidence(): ModelOutput['semanticMediaPurgeCacheWriteEvidence'] {
    return this.terminal.semanticMediaPurgeCacheWriteEvidence;
  }
  async append(content: IContent): Promise<void> {
    const chunk = toModelStreamChunk(content);
    chunk.content = {
      ...chunk.content,
      blocks: filterHookRestrictedBlocks(
        chunk.content.blocks,
        this.allowedNames,
      ),
    };
    if (chunk.afcHistory !== undefined)
      chunk.afcHistory = filterAfcByHookRestrictions(
        chunk.afcHistory,
        this.allowedNames,
      );
    if (this.allowedNames !== undefined)
      chunk.hookRestrictions = { allowedToolNames: this.allowedNames };
    const admitted = await admitStreamChunkForHistory(
      this.runtime,
      chunk,
      chunk.content,
      this.turnId,
    );
    this.admissions.push(...streamMediaAdmissions(admitted, this.turnId));
    const includeThoughts =
      this.runtime.ephemerals.reasoning.includeInContext();
    await appendResponseChunk(this.arrival, admitted, includeThoughts);
    this.terminal.add(admitted, includeThoughts);
    const afc = admitted.afcHistory;
    if (afc !== undefined) {
      const start = await this.history.matchingCuratedPrefix(afc);
      await this.arrival.replaceAfcHistory(
        (async function* () {
          for (let index = start; index < afc.length; index++) yield afc[index];
        })(),
      );
    }
  }
  async release(): Promise<void> {
    await this.arrival.interrupt('error');
    await this.runtime.mediaAdmission?.releaseAdmissions(this.admissions);
    this.admissions.length = 0;
  }
  async fail(error: unknown): Promise<never> {
    try {
      await this.release();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Direct response media cleanup failed',
      );
    }
    throw error;
  }
  async commit(
    prepared: PreparedUserTurn,
    compression: CompressionHandler,
    promptId: string,
    attemptIndex: number,
  ): Promise<TurnReceipt> {
    try {
      await this.arrival.seal(this.terminal.metadata(), undefined, async () => {
        await prepared.transferToHistory();
        await this.runtime.mediaAdmission?.releaseAdmissions(this.admissions);
        this.admissions.length = 0;
      });
      await syncAndRecordTurnUsage({
        history: this.history,
        usageLogger: compression.tokenUsageLogger,
        usage: this.usage,
        lastPromptTokenCount: compression.lastPromptTokenCount,
        attemptIndex,
        promptId,
      });
      return {
        status: 'published',
        promptId,
        turnId: this.turnId,
        responseId: this.terminal.responseId,
        finishReason: this.terminal.finishReason,
        rawStopReason: this.terminal.rawStopReason,
        usage: this.terminal.usage,
      };
    } catch (error) {
      return this.fail(error);
    }
  }
}

export async function consumeDirectResponse(input: {
  readonly stream:
    | AsyncIterable<IContent>
    | ((arrival: ResponseArrival) => AsyncIterable<IContent>);
  readonly runtime: TurnProcessorRuntime;
  readonly history: HistoryService;
  readonly promptId: string;
  readonly turnId: string;
  readonly origin?: object;
  readonly allowedNames: string[] | undefined;
  readonly timeoutController: AbortController;
  readonly upstreamAbortSignal: AbortSignal | undefined;
  readonly trackUsage: (content: IContent) => void;
}): Promise<DirectResponseArrival> {
  const arrival = await openResponseArrival(
    input.history,
    input.runtime,
    input.promptId,
    input.turnId,
    input.origin,
  );
  const response = new DirectResponseArrival(
    arrival,
    input.runtime,
    input.history,
    input.turnId,
    input.allowedNames,
  );
  const stream =
    typeof input.stream === 'function' ? input.stream(arrival) : input.stream;
  const iterator = stream[Symbol.asyncIterator]();
  const timeout = resolveStreamIdleTimeoutMs(
    input.runtime.readStreamTimeoutPolicy(),
  );
  let received = false;
  try {
    for (;;) {
      const next = await readProviderStreamResponse(
        iterator,
        input.timeoutController,
        input.upstreamAbortSignal,
        timeout,
      );
      if (next.done === true) break;
      received = true;
      input.trackUsage(next.value);
      await response.append(next.value);
    }
    if (!received) throw new Error('No response from provider');
    return response;
  } catch (error) {
    return response.fail(error);
  }
}
