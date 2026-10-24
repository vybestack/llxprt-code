/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import {
  CallerRequestLineage,
  type CallerLineageState,
} from './caller-request-lineage.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  measureRequestRow,
  serializeRequestRow,
  stableStringify,
  type RequestRowMeasurement,
  type TokenCountFn,
} from '@vybestack/llxprt-code-core/services/history/token-usage-measurement.js';
import {
  BoundedToolCallNames,
  fullRequestToolCallNames,
  type ToolCallNames,
} from './tokenUsageToolCallNames.js';

export { TOOL_OUTPUT_TRUNCATION_MARKER } from '@vybestack/llxprt-code-core/services/history/token-usage-measurement.js';
export type { TokenCountFn } from '@vybestack/llxprt-code-core/services/history/token-usage-measurement.js';
export const UNRESOLVED_TOOL_NAME = '__unresolved_tool__';
export const FINGERPRINT_HEX_LENGTH = 16;
export const FINGERPRINT_PREFIX_CHAR_BUDGET = 8192;

export interface RequestShapeInput {
  readonly requestContents: readonly IContent[];
  readonly tools: unknown;
  readonly instructionsText: string | undefined;
  readonly countTokens: TokenCountFn;
  readonly lastSendSequence: bigint;
  readonly previousFingerprint?: string;
  readonly callerOwned?: boolean;
  readonly previousCallerLineage?: CallerLineageState;
}

export interface ToolCallAttribution {
  readonly callId: string;
  readonly toolName: string;
  readonly resultTokens: number;
  readonly wasTruncated: boolean;
}

export interface RequestShapeResult {
  readonly instructionsTokens: number;
  readonly toolsSchemaTokens: number;
  readonly historyTokens: number;
  readonly mediaTokens: number;
  readonly injectedTokens: number;
  readonly toolCalls: readonly ToolCallAttribution[];
  readonly newToolResultTokens: number;
  readonly carriedToolResultTokens: number;
  readonly prefixFingerprint: string;
  readonly prefixFingerprintChanged: boolean | null;
}

interface FingerprintContribution {
  readonly text: string;
  readonly consumed: number;
}

function nonempty(value: string | undefined): string | undefined {
  return value === '' ? undefined : value;
}

class RequestShapeAccumulator {
  private historyTokens = 0;
  private mediaTokens = 0;
  private injectedTokens = 0;
  private readonly toolCalls: ToolCallAttribution[] = [];
  private newToolResultTokens = 0;
  private carriedToolResultTokens = 0;
  fingerprintBudget = FINGERPRINT_PREFIX_CHAR_BUDGET;
  sequence = 0n;
  private readonly fingerprint = createHash('sha256');
  private readonly toolsJson: string;
  readonly callerLineage: CallerRequestLineage | undefined;

  constructor(
    private readonly input: Omit<RequestShapeInput, 'requestContents'>,
    private readonly toolCallNames: ToolCallNames,
  ) {
    this.callerLineage =
      input.callerOwned === true
        ? new CallerRequestLineage(input.previousCallerLineage)
        : undefined;
    this.toolsJson = stableStringify(input.tools);
    this.fingerprint.update(`I:${input.instructionsText ?? ''}`);
    this.fingerprint.update(`\u0000T:${this.toolsJson}`);
  }

  add(content: IContent, sequence: bigint): void {
    this.callerLineage?.observe(content);
    const measurement = measureRequestRow(content, this.input.countTokens);
    let part: FingerprintContribution | null = null;
    if (this.fingerprintBudget > 0) {
      if (measurement.fingerprintKey !== null) {
        const text = `C#${measurement.fingerprintKey}`;
        part = { text, consumed: text.length };
      } else {
        const serialized = serializeRequestRow(content);
        const synthetic = content.metadata?.synthetic === true ? 1 : 0;
        part = {
          text: `C:${content.speaker}:${synthetic}:${serialized.slice(0, this.fingerprintBudget)}`,
          consumed: serialized.length,
        };
      }
    }
    this.addMeasured(measurement, sequence, part);
  }

  addMeasured(
    measurement: RequestRowMeasurement,
    sequence: bigint,
    part: FingerprintContribution | null,
  ): void {
    this.toolCallNames.observe({
      speaker: 'ai',
      blocks: measurement.toolCalls.map((call) => ({
        type: 'tool_call',
        id: call.id,
        name: call.name,
        parameters: {},
      })),
    });
    if (measurement.bucket === 'injected')
      this.injectedTokens += measurement.tokens;
    else if (measurement.bucket === 'media')
      this.mediaTokens += measurement.tokens;
    else this.historyTokens += measurement.tokens;
    for (const result of measurement.toolResults) {
      this.toolCalls.push({
        callId: result.callId,
        toolName:
          nonempty(this.toolCallNames.get(result.callId)) ??
          nonempty(result.blockToolName) ??
          UNRESOLVED_TOOL_NAME,
        resultTokens: result.resultTokens,
        wasTruncated: result.wasTruncated,
      });
      if (sequence <= this.input.lastSendSequence)
        this.carriedToolResultTokens += result.resultTokens;
      else this.newToolResultTokens += result.resultTokens;
    }
    if (sequence > this.sequence) this.sequence = sequence;
    if (part !== null) {
      this.fingerprint.update(`\u0000${part.text}`);
      this.fingerprintBudget -= part.consumed;
    }
  }

  finish(): RequestShapeResult {
    if (this.callerLineage?.continuesPrevious() === false) {
      this.newToolResultTokens += this.carriedToolResultTokens;
      this.carriedToolResultTokens = 0;
    }
    const prefixFingerprint = this.fingerprint
      .digest('hex')
      .slice(0, FINGERPRINT_HEX_LENGTH);
    return {
      instructionsTokens: this.input.instructionsText
        ? this.input.countTokens(this.input.instructionsText)
        : 0,
      toolsSchemaTokens:
        this.toolsJson === 'null' || this.toolsJson.length <= 2
          ? 0
          : this.input.countTokens(this.toolsJson),
      historyTokens: this.historyTokens,
      mediaTokens: this.mediaTokens,
      injectedTokens: this.injectedTokens,
      toolCalls: this.toolCalls,
      newToolResultTokens: this.newToolResultTokens,
      carriedToolResultTokens: this.carriedToolResultTokens,
      prefixFingerprint,
      prefixFingerprintChanged:
        this.input.previousFingerprint === undefined
          ? null
          : this.input.previousFingerprint !== prefixFingerprint,
    };
  }
}

export function computeRequestShape(
  input: RequestShapeInput,
): RequestShapeResult {
  return arrayShape(input).shape;
}

function arrayShape(input: RequestShapeInput): {
  readonly shape: RequestShapeResult;
  readonly callerLineage: CallerLineageState | undefined;
} {
  const accumulator = new RequestShapeAccumulator(
    input,
    fullRequestToolCallNames(input.requestContents),
  );
  input.requestContents.forEach((content, index) =>
    accumulator.add(content, BigInt(index + 1)),
  );
  return {
    shape: accumulator.finish(),
    callerLineage: accumulator.callerLineage?.finish(),
  };
}

export interface SourceRequestShapeInput
  extends Omit<RequestShapeInput, 'requestContents'> {
  readonly requestRows: ProviderRequestRows;
  readonly signal?: AbortSignal;
}

async function sourceShape(input: SourceRequestShapeInput): Promise<{
  readonly shape: RequestShapeResult;
  readonly sequence: bigint;
  readonly callerLineage: CallerLineageState | undefined;
}> {
  const accumulator = new RequestShapeAccumulator(
    input,
    new BoundedToolCallNames(2000),
  );
  const native = input.requestRows.native;
  if (native !== undefined) {
    for await (const fact of native.indexed.openTokenUsageReader(
      input.countTokens,
      input.signal,
    )) {
      accumulator.addMeasured(
        fact.measurement,
        fact.sequence,
        await fact.fingerprint(accumulator.fingerprintBudget),
      );
    }
  } else {
    let index = 0;
    for await (const row of input.requestRows.openReader(input.signal)) {
      input.signal?.throwIfAborted();
      accumulator.add(row, BigInt(++index));
    }
  }
  input.signal?.throwIfAborted();
  const shape = accumulator.finish();
  input.signal?.throwIfAborted();
  return {
    shape,
    sequence: accumulator.sequence,
    callerLineage: accumulator.callerLineage?.finish(),
  };
}

export async function computeSourceRequestShape(
  input: SourceRequestShapeInput,
): Promise<RequestShapeResult> {
  return (await sourceShape(input)).shape;
}

type ShapeOptions = Omit<
  RequestShapeInput,
  'lastSendSequence' | 'previousFingerprint'
>;
type SourceShapeOptions = Omit<
  SourceRequestShapeInput,
  'lastSendSequence' | 'previousFingerprint'
>;

export class RequestShapeTracker {
  private lastSequence = 0n;
  private lastFp: string | undefined;
  private lastCallerLineage: CallerLineageState | undefined;

  snapshot(): {
    readonly sequence: bigint;
    readonly fingerprint: string | undefined;
  } {
    return { sequence: this.lastSequence, fingerprint: this.lastFp };
  }

  recordRequestShape(input: ShapeOptions): RequestShapeResult {
    const result = arrayShape({
      ...input,
      lastSendSequence: this.lastSequence,
      previousFingerprint: this.lastFp,
      callerOwned: true,
      previousCallerLineage: this.lastCallerLineage,
    });
    this.lastSequence = BigInt(input.requestContents.length);
    this.lastFp = result.shape.prefixFingerprint;
    this.lastCallerLineage = result.callerLineage;
    return result.shape;
  }

  async recordSourceRequestShape(
    input: SourceShapeOptions,
  ): Promise<RequestShapeResult> {
    const result = await sourceShape({
      ...input,
      lastSendSequence: this.lastSequence,
      previousFingerprint: this.lastFp,
      callerOwned: input.requestRows.callerOwned === true,
      previousCallerLineage: this.lastCallerLineage,
    });
    if (
      input.requestRows.callerOwned === true ||
      result.sequence > this.lastSequence
    )
      this.lastSequence = result.sequence;
    this.lastFp = result.shape.prefixFingerprint;
    this.lastCallerLineage = result.callerLineage;
    return result.shape;
  }
}
