/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ContentMetadata } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponseOutcome } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import {
  PartialOutputRecorder,
  type PartialOutputSnapshot,
} from '../refusal/refusalAudit.js';

/** Terminal bookkeeping contains no response blocks, strings or AFC history. */
export class StreamTerminalState {
  finishReason: ModelStreamChunk['finishReason'];
  rawStopReason: string | undefined;
  stopDetails: ModelStreamChunk['stopDetails'];
  requestId: ModelStreamChunk['requestId'];
  dumpBaseId: string | undefined;
  firstByteToRefusalMs: ModelStreamChunk['firstByteToRefusalMs'];
  usage: ModelStreamChunk['usage'];
  responseId: string | undefined;
  responsesStored: boolean | undefined;
  semanticMediaPurgeCacheWriteEvidence: ModelStreamChunk['semanticMediaPurgeCacheWriteEvidence'];
  readonly outcome: ResponseOutcome = {
    hasVisibleText: false,
    hasThinking: false,
    hasToolCalls: false,
    isActionable: false,
  };
  responseTextLength = 0;
  private attemptId: string | undefined;
  private trailingWhitespace = 0;
  /** Bounded refusal-audit record of the attempt's output (#4101). */
  private output = new PartialOutputRecorder();

  add(chunk: ModelStreamChunk, includeThoughts: boolean): void {
    const attemptId = chunk.content.responseAttemptId;
    if (
      attemptId !== undefined &&
      this.attemptId !== undefined &&
      attemptId !== this.attemptId
    )
      this.reset();
    this.attemptId = attemptId ?? this.attemptId;
    this.finishReason = chunk.finishReason ?? this.finishReason;
    this.rawStopReason = chunk.rawStopReason ?? this.rawStopReason;
    this.stopDetails = chunk.stopDetails ?? this.stopDetails;
    if (chunk.requestId !== undefined) this.requestId = chunk.requestId;
    this.dumpBaseId = chunk.dumpBaseId ?? this.dumpBaseId;
    this.firstByteToRefusalMs =
      chunk.firstByteToRefusalMs ?? this.firstByteToRefusalMs;
    this.usage = chunk.usage ?? this.usage;
    this.output.add(chunk);
    this.responseId =
      chunk.responseId ?? chunk.content.metadata?.id ?? this.responseId;
    this.responsesStored =
      chunk.content.metadata?.responsesStored ?? this.responsesStored;
    this.semanticMediaPurgeCacheWriteEvidence =
      chunk.semanticMediaPurgeCacheWriteEvidence ??
      this.semanticMediaPurgeCacheWriteEvidence;
    for (const block of chunk.content.blocks) {
      if (block.type === 'text') {
        this.outcome.hasVisibleText ||= block.text !== '';
        this.addTextLength(block.text);
      } else if (block.type === 'thinking')
        this.outcome.hasThinking ||= includeThoughts;
      else if (block.type === 'tool_call') this.outcome.hasToolCalls = true;
    }
    this.outcome.isActionable =
      this.outcome.hasVisibleText || this.outcome.hasToolCalls;
  }

  partialOutput(): PartialOutputSnapshot {
    return this.output.snapshot();
  }

  private addTextLength(text: string): void {
    const effective = this.responseTextLength === 0 ? text.trimStart() : text;
    const withoutTrailing = effective.trimEnd();
    if (withoutTrailing.length > 0) {
      this.responseTextLength +=
        this.trailingWhitespace + withoutTrailing.length;
      this.trailingWhitespace = effective.length - withoutTrailing.length;
    } else if (this.responseTextLength > 0)
      this.trailingWhitespace += effective.length;
  }

  private reset(): void {
    this.finishReason = undefined;
    this.rawStopReason = undefined;
    this.stopDetails = undefined;
    this.requestId = undefined;
    this.dumpBaseId = undefined;
    this.firstByteToRefusalMs = undefined;
    this.output = new PartialOutputRecorder();
    this.usage = undefined;
    this.responseId = undefined;
    this.responsesStored = undefined;
    this.semanticMediaPurgeCacheWriteEvidence = undefined;
    this.outcome.hasVisibleText = false;
    this.outcome.hasThinking = false;
    this.outcome.hasToolCalls = false;
    this.outcome.isActionable = false;
    this.responseTextLength = 0;
    this.trailingWhitespace = 0;
  }

  metadata(): ContentMetadata {
    return {
      ...(this.responseId === undefined ? {} : { id: this.responseId }),
      ...(this.responsesStored === undefined
        ? {}
        : { responsesStored: this.responsesStored }),
      ...(this.usage === undefined ? {} : { usage: this.usage }),
      ...(this.finishReason === undefined
        ? {}
        : { finishReason: this.finishReason }),
      ...(this.rawStopReason === undefined
        ? {}
        : { rawStopReason: this.rawStopReason }),
    };
  }
}
