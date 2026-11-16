/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Operational record of one code mode run (issue #4084). The journal turns
 * the run's lifecycle into `tool_script_event` records, publishes each one
 * (the session recording and any observer receive it), keeps the folded view
 * the script card is drawn from, and exports the run's lifecycle metrics when
 * the run ends. Nothing here reaches model history.
 */

import {
  TOOL_SCRIPT_ARGS_SUMMARY_MAX,
  TOOL_SCRIPT_ERROR_MESSAGE_MAX,
  type ToolScriptApproval,
  type ToolScriptEventPayload,
} from '@vybestack/llxprt-code-core';
import { ToolScriptRunEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import type { NestedCallStatus } from './nested-call-outcome.js';
import type {
  CodeModeRunResult,
  JsonObject,
  ScriptToolResult,
} from './runtime-contract.js';
import {
  applyToolScriptEvent,
  type ToolScriptRunView,
} from './tool-script-card.js';

export interface ScriptRunIdentity {
  readonly runId: string;
  readonly parentCallId: string;
  readonly promptId: string;
  readonly agentId: string;
  readonly purpose: string;
  readonly tools: readonly string[];
}

export interface NestedCallRecordInput {
  readonly sequence: number;
  readonly callId: string;
  readonly tool: string;
  readonly args: JsonObject;
  readonly approval: ToolScriptApproval;
  readonly status: NestedCallStatus;
  readonly result: ScriptToolResult | undefined;
}

export interface ScriptRunJournalSinks {
  /** Receives every record (recording, observers). */
  readonly publish: (event: ToolScriptEventPayload) => void;
  /** Receives the folded view after every record (the live card). */
  readonly progress: (view: ToolScriptRunView) => void;
  /** Exports the run's lifecycle metrics once, when it ends. */
  readonly logRun: (event: ToolScriptRunEvent) => void;
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function bounded(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export class ScriptRunJournal {
  private view: ToolScriptRunView | undefined;
  private inputBytes = 0;
  private readonly startedAt = performance.now();

  constructor(
    private readonly identity: ScriptRunIdentity,
    private readonly sinks: ScriptRunJournalSinks,
  ) {}

  started(): void {
    this.emit({
      phase: 'started',
      ...this.ids(),
      agentId: this.identity.agentId,
      purpose: this.identity.purpose,
      tools: [...this.identity.tools],
    });
  }

  call(input: NestedCallRecordInput): void {
    const resultBytes = input.result === undefined ? 0 : bytes(input.result);
    this.inputBytes += resultBytes;
    this.emit({
      phase: 'call',
      ...this.ids(),
      sequence: input.sequence,
      callId: input.callId,
      tool: input.tool,
      argsSummary: bounded(
        JSON.stringify(input.args),
        TOOL_SCRIPT_ARGS_SUMMARY_MAX,
      ),
      approval: input.approval,
      status: input.status,
      ...(input.result?.ok === true
        ? { completeness: input.result.completeness }
        : {}),
      resultBytes,
    });
  }

  finished(result: CodeModeRunResult, partial: boolean): void {
    const durationMs = performance.now() - this.startedAt;
    const finalBytes = result.ok ? bytes(result.value) : 0;
    this.emit({
      phase: 'finished',
      ...this.ids(),
      ok: result.ok,
      ...(result.ok
        ? {}
        : {
            errorCode: result.error.code,
            errorMessage: bounded(
              result.error.message,
              TOOL_SCRIPT_ERROR_MESSAGE_MAX,
            ),
          }),
      callCount: result.callCount,
      partial,
      inputBytes: this.inputBytes,
      finalBytes,
      durationMs,
    });
    this.sinks.logRun(
      new ToolScriptRunEvent({
        promptId: this.identity.promptId,
        agentId: this.identity.agentId,
        parentCallId: this.identity.parentCallId,
        scriptRunId: this.identity.runId,
        durationMs,
        nestedCallCount: result.callCount,
        inputBytes: this.inputBytes,
        finalBytes,
        partial,
        success: result.ok,
        terminationReason: result.ok ? 'completed' : result.error.code,
        purpose: this.identity.purpose,
      }),
    );
  }

  private ids() {
    return {
      runId: this.identity.runId,
      parentCallId: this.identity.parentCallId,
      time: new Date().toISOString(),
    };
  }

  private emit(event: ToolScriptEventPayload): void {
    this.view = applyToolScriptEvent(this.view, event);
    this.sinks.publish(event);
    this.sinks.progress(this.view);
  }
}
