/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DebugLogger } from '../../debug/index.js';
import type { IContent, ToolCallBlock, ToolResponseBlock } from './IContent.js';

const diagnosticSampleLimit = 32;
const diagnosticStringLimit = 256;

export function logReconstructedCalls(
  logger: DebugLogger,
  blocks: Readonly<IContent['blocks']>,
): void {
  let callCount = 0;
  const sample: ToolCallBlock[] = [];
  for (const block of blocks) {
    if (block.type !== 'tool_call') continue;
    callCount++;
    if (sample.length < diagnosticSampleLimit) sample.push(block);
  }
  logger.warn('Synthesizing missing tool_call for responses', {
    callIds: sample.map((block) =>
      block.id.substring(0, diagnosticStringLimit),
    ),
    toolNames: sample.map((block) =>
      block.name.substring(0, diagnosticStringLimit),
    ),
    ...(callCount > diagnosticSampleLimit
      ? { callCount, callsTruncated: true }
      : {}),
    ...(sample.some(
      (block) =>
        block.id.length > diagnosticStringLimit ||
        block.name.length > diagnosticStringLimit,
    )
      ? { callDetailsTruncated: true }
      : {}),
  });
}

export function logUnmatchedResponse(
  logger: DebugLogger,
  response: ToolResponseBlock,
): void {
  logger.warn('Tool response missing matching tool call', {
    callId: response.callId.substring(0, diagnosticStringLimit),
    toolName: response.toolName.substring(0, diagnosticStringLimit),
    ...(response.callId.length > diagnosticStringLimit ||
    response.toolName.length > diagnosticStringLimit
      ? { callDetailsTruncated: true }
      : {}),
  });
}

export class ProviderAnchorDiagnostics {
  private inputCount = 0;
  private anchorCount = 0;
  private readonly indexes: number[] = [];
  private outputCount = 0;
  private outputHasAnchor = false;

  input(hasAnchor: boolean): void {
    if (hasAnchor) {
      this.anchorCount++;
      if (this.indexes.length < diagnosticSampleLimit)
        this.indexes.push(this.inputCount);
    }
    this.inputCount++;
  }

  output(hasAnchor: boolean): void {
    this.outputCount++;
    this.outputHasAnchor ||= hasAnchor;
  }

  log(logger: DebugLogger): void {
    if (this.anchorCount === 0 || this.outputHasAnchor) return;
    logger.warn('Provider history normalization removed a cache anchor', {
      inputAnchorIndexes: this.indexes,
      ...(this.anchorCount > diagnosticSampleLimit
        ? {
            inputAnchorCount: this.anchorCount,
            inputAnchorIndexesTruncated: true,
          }
        : {}),
      inputContentCount: this.inputCount,
      outputContentCount: this.outputCount,
    });
  }
}
