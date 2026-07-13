/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';
import {
  SESSION_TITLE_MAX_LENGTH,
  type IContent,
} from '@vybestack/llxprt-code-core';

/**
 * Derives a human-readable title from the first user prompt by concatenating
 * its text blocks (ignoring media/resources) and truncating to the bounded
 * length the session listing uses. Returns null when the prompt carries no
 * text. No LLM call — consistent with the durable listing convention.
 *
 * Normalization intentionally matches the durable path
 * (SessionDiscovery.readFirstUserMessage → extractUserMessageText): text blocks
 * are joined with an empty separator and truncated — NO trimming or newline
 * collapsing — so the live title is byte-identical to the on-disk listing
 * title for the same first user message.
 */
export function deriveSessionTitle(
  prompt: readonly acp.ContentBlock[],
): string | null {
  return extractTitleText(prompt);
}

function extractTitleText(
  blocks: ReadonlyArray<{ readonly type: string; readonly text?: unknown }>,
): string | null {
  const text = blocks
    .filter(
      (block): block is { readonly type: 'text'; readonly text: string } =>
        block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('');
  if (text.length === 0) {
    return null;
  }
  return text.length > SESSION_TITLE_MAX_LENGTH
    ? text.slice(0, SESSION_TITLE_MAX_LENGTH)
    : text;
}

/**
 * Extracts the first human-speaker text from a resumed history, using the SAME
 * join + truncate normalization as {@link deriveSessionTitle} and the durable
 * SessionDiscovery.readFirstUserMessage. Returns null when the history has no
 * human text block, so a restored session with only ai/tool entries is not
 * titled (matching the durable listing, which shows no title for such sessions).
 */
export function deriveTitleFromHistory(
  history: readonly IContent[],
): string | null {
  for (const item of history) {
    if (item.speaker !== 'human') {
      continue;
    }
    const title = extractTitleText(item.blocks);
    if (title !== null) {
      return title;
    }
  }
  return null;
}

/**
 * Builds an ACP `session_info_update` {@link acp.SessionUpdate} using the SDK's
 * discriminated-union variant directly (no casts). Only the supplied fields are
 * carried so partial title/updatedAt updates are emitted without nulling the
 * other.
 */
export function buildSessionInfoUpdate(fields: {
  readonly title?: string;
  readonly updatedAt?: string;
}): acp.SessionInfoUpdate & { sessionUpdate: 'session_info_update' } {
  const update: acp.SessionInfoUpdate & {
    sessionUpdate: 'session_info_update';
  } = {
    sessionUpdate: 'session_info_update',
  };
  if (fields.title !== undefined) {
    update.title = fields.title;
  }
  if (fields.updatedAt !== undefined) {
    update.updatedAt = fields.updatedAt;
  }
  return update;
}

export interface TitleEligibilityResult {
  /**
   * True when THIS call won the title — i.e. the derived title was freshly set.
   * The caller emits a session_info_update carrying the title exactly once.
   */
  readonly wonTitle: boolean;
  /**
   * The current title (undefined until the first text-bearing prompt wins or
   * hydration sets it from history).
   */
  readonly title: string | undefined;
}

export interface SessionInfoRecordResult {
  /**
   * The session_info_update notifications to emit for this turn: always an
   * updatedAt update, optionally preceded by a pending title retry.
   */
  readonly updates: ReadonlyArray<
    acp.SessionInfoUpdate & { sessionUpdate: 'session_info_update' }
  >;
  /**
   * The current title (undefined until the first text-bearing prompt wins or
   * hydration sets it from history).
   */
  readonly title: string | undefined;
}

/**
 * Tracks per-session title (derived once from the first text-bearing prompt)
 * and updatedAt (refreshed every turn). Keeping this state in a cohesive
 * helper lets zedIntegration.ts stay within its max-lines budget and makes the
 * externally observable session_info_update semantics unit-testable in
 * isolation.
 *
 * Title eligibility is consumed SYNCHRONOUSLY at prompt-acceptance time via
 * {@link consumeTitleEligibility}, not deferred to turn completion, so
 * overlapping prompts cannot both claim the title (race-safety, issue #1611
 * finding 1). Restored sessions hydrate the title from history via
 * {@link hydrateFromHistory} so later prompts never retitle them (finding 2).
 */
export class SessionTitleTracker {
  private title: string | undefined;
  private updatedAt: string | undefined;
  /**
   * Once consumed, no future call can win the title — even if the winning
   * prompt had no text (so a no-text first prompt still suppresses a later
   * retitle).
   */
  private titleEligibilityConsumed = false;
  /**
   * A title that won eligibility but whose session_info_update notification
   * failed transport. Retried (prepended) on the next turn's metadata emission
   * so a transient transport error doesn't permanently lose the title.
   * Issue #1611: pending title notification retry after transport failure.
   */
  private pendingTitle: string | undefined;

  /**
   * Synchronously consumes title eligibility for a prompt: on the FIRST call
   * (whether or not the prompt has text), eligibility is permanently consumed.
   * If the prompt has text and no title is set yet, the title is derived and
   * set. Returns whether THIS call won the title (so the caller emits the
   * session_info_update exactly once) and the current title.
   */
  consumeTitleEligibility(
    prompt: readonly acp.ContentBlock[],
  ): TitleEligibilityResult {
    if (this.titleEligibilityConsumed) {
      return { wonTitle: false, title: this.title };
    }
    this.titleEligibilityConsumed = true;
    if (this.title !== undefined) {
      return { wonTitle: false, title: this.title };
    }
    const derived = deriveSessionTitle(prompt);
    if (derived === null) {
      return { wonTitle: false, title: undefined };
    }
    this.title = derived;
    return { wonTitle: true, title: this.title };
  }

  hydrateFromMetadata(title: string | null): string | undefined {
    if (this.titleEligibilityConsumed) {
      return this.title;
    }
    this.titleEligibilityConsumed = true;
    if (title !== null) {
      this.title = title;
    }
    return this.title;
  }

  /**
   * Hydrates the title from a resumed history (issue #1611 finding 2). Called
   * after a load/resume replays the conversation, BEFORE any new prompt. If the
   * history's first human text yields a title, it is set AND eligibility is
   * consumed, so the next live prompt can never retitle the session. Idempotent:
   * a no-op if a title was already set or eligibility already consumed.
   */
  hydrateFromHistory(history: readonly IContent[]): string | undefined {
    if (this.title !== undefined || this.titleEligibilityConsumed) {
      return this.title;
    }
    const derived = deriveTitleFromHistory(history);
    this.titleEligibilityConsumed = true;
    if (derived === null) {
      return undefined;
    }
    this.title = derived;
    return this.title;
  }

  /**
   * Records a completed turn: advances updatedAt and returns the
   * session_info_update notification the caller should push. Title is handled
   * separately via {@link consumeTitleEligibility} at acceptance time.
   *
   * If a pending title exists (from a previous transport failure), it is
   * prepended to the updates so the caller retries it this turn.
   */
  recordTurn(updatedAt: string): SessionInfoRecordResult {
    this.updatedAt = updatedAt;
    const updates: Array<
      acp.SessionInfoUpdate & { sessionUpdate: 'session_info_update' }
    > = [];
    if (this.pendingTitle !== undefined) {
      updates.push(
        buildSessionInfoUpdate({
          title: this.pendingTitle,
          updatedAt,
        }),
      );
      this.pendingTitle = undefined;
    }
    updates.push(buildSessionInfoUpdate({ updatedAt }));
    return { updates, title: this.title };
  }

  /**
   * Marks a title as pending for retry (issue #1611). Called by the caller
   * when the title-bearing session_info_update notification fails transport.
   * The next {@link recordTurn} will prepend the title to its updates.
   */
  markPendingTitle(title: string): void {
    this.pendingTitle = title;
  }

  /**
   * Returns the pending title (for testing) or undefined when none is pending.
   */
  getPendingTitle(): string | undefined {
    return this.pendingTitle;
  }

  getTitle(): string | undefined {
    return this.title;
  }

  getUpdatedAt(): string | undefined {
    return this.updatedAt;
  }
}
