/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ServerAgentStreamEvent, AgentEventType } from './turn.js';
import {
  filterTextWithEmoji,
  type ExecutionLoopContext,
} from './subagentExecution.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';

// Types, interfaces, enums, and ContextState are now in subagentTypes.ts
// Runtime setup helpers are now in subagentRuntimeSetup.ts

/**
 * Process a single interactive stream event, accumulating text and
 * dispatching emoji-filtered messages. Throws when content is blocked
 * or when the provider signals an error.
 *
 * Extracted from runInteractiveTurn to keep nesting within limits.
 */
export function processInteractiveStreamEvent(
  event: { type: AgentEventType; value?: unknown },
  execCtx: ExecutionLoopContext,
): string {
  if (
    event.type === AgentEventType.Content &&
    typeof event.value === 'string'
  ) {
    const value = event.value;
    const filtered = filterTextWithEmoji(value, execCtx);
    if (filtered.blocked) {
      execCtx.output.terminate_reason = SubagentTerminateMode.ERROR;
      throw new Error(filtered.error ?? 'Content blocked by emoji filter');
    }
    if (execCtx.onMessage && filtered.text) {
      execCtx.onMessage(filtered.text);
    }
    return value;
  }
  if (event.type === AgentEventType.Error) {
    const eventError = (event.value as { error?: Error | null } | undefined)
      ?.error;
    if (eventError != null) {
      execCtx.output.terminate_reason = SubagentTerminateMode.ERROR;
      throw new Error(eventError.message);
    }
  }
  return '';
}

/**
 * Counts characters generated over one interactive turn.
 *
 * Stateful for the same reason as `GeneratedOutputCounter` on the
 * non-interactive path: a provider that re-emits its accumulated reasoning on
 * every `Thought` event turns an N-character span into roughly N^2/2 counted
 * characters, which would trip the aggregate budget during legitimate work.
 * Thoughts carrying a subject are tracked by latest length and contribute once;
 * thoughts without one are true increments and sum.
 */
export class InteractiveOutputCounter {
  private plainCharacters = 0;
  private readonly latestThoughtLength = new Map<string, number>();

  add(event: ServerAgentStreamEvent): void {
    switch (event.type) {
      case AgentEventType.Content:
        this.plainCharacters += event.value.length;
        return;
      case AgentEventType.ToolCallRequest:
        this.plainCharacters += JSON.stringify(event.value).length;
        return;
      case AgentEventType.Thought:
        this.addThought(event.value);
        return;
      default:
        return;
    }
  }

  private addThought(value: unknown): void {
    const length = JSON.stringify(value).length;
    const subject = (value as { subject?: unknown } | undefined)?.subject;
    if (typeof subject !== 'string' || subject === '') {
      this.plainCharacters += length;
      return;
    }
    this.latestThoughtLength.set(subject, length);
  }

  get total(): number {
    let thoughts = 0;
    for (const length of this.latestThoughtLength.values()) {
      thoughts += length;
    }
    return this.plainCharacters + thoughts;
  }
}

/**
 * Provider-reported completion tokens for a turn, or undefined when the
 * provider did not report any.
 *
 * Only the Finished event is read. The UsageMetadata event carries the
 * Gemini-named public-wire usage keys, and this package is required to
 * stay provider-neutral, which the agents-neutral gate enforces. Finished
 * carries the same figure in neutral `UsageStats` form. A provider that reports
 * usage only through the other event falls back to the character estimate,
 * which is the intended behaviour for an absent report.
 */
export function readInteractiveOutputTokens(
  event: ServerAgentStreamEvent,
): number | undefined {
  return event.type === AgentEventType.Finished
    ? event.value.usageMetadata?.completionTokens
    : undefined;
}
