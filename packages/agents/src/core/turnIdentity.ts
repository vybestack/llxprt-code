/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Canonical turn identity for a single send.
 *
 * The token-usage record for a request is written before that request's turn
 * reaches history, so an identity derived from history at send time would name
 * the *previous* turn — and nothing at all on the first send. Minting the id
 * up front and stamping it on the content that gets persisted is what makes the
 * usage log joinable to the conversation in both directions (#3130 AC-1/AC-2).
 *
 * An id already present on the content wins, so a caller that has already
 * established a turn identity (a paired tool call/response, for example) keeps
 * it rather than being split across two ids.
 */
export interface TurnIdentity {
  readonly promptId: string;
  readonly turnId: string;
}

function stampOne(content: IContent, identity: TurnIdentity): IContent {
  return {
    ...content,
    metadata: {
      ...(content.metadata ?? {}),
      promptId: identity.promptId,
      turnId: content.metadata?.turnId ?? identity.turnId,
    },
  };
}

/** Stamp the identity on every content item that will be persisted. */
export function stampTurnIdentity(
  contents: readonly IContent[],
  identity: TurnIdentity,
): IContent[] {
  return contents.map((content) => stampOne(content, identity));
}

/** The subset of HistoryService needed to mint a turn identity. */
interface TurnKeySource {
  generateTurnKey(): string;
  getIdGeneratorCallback(turnKey?: string): () => string;
}

/**
 * Prepare the two views of a non-streamed user turn: the contents that will be
 * PERSISTED (carrying the canonical turn identity) and the contents sent to the
 * provider (those same items plus a per-item history id).
 *
 * Both views share one turn identity, so the persisted turn and the turn named
 * by the token-usage record are the same turn.
 */
export function prepareUserTurnContents(
  contents: readonly IContent[],
  history: TurnKeySource,
  promptId: string,
): { userContents: IContent[]; userIContents: IContent[]; turnId: string } {
  const turnId = history.generateTurnKey();
  const userContents = stampTurnIdentity(contents, { promptId, turnId });
  const idGen = history.getIdGeneratorCallback();
  const userIContents = userContents.map((content) => ({
    ...content,
    metadata: { ...content.metadata, id: idGen() },
  }));
  return { userContents, userIContents, turnId };
}

/**
 * Stamp the identity on a single content item or an array of them, preserving
 * the caller's shape.
 */
export function stampTurnIdentityOnInput(
  userContent: IContent | IContent[],
  identity: TurnIdentity,
): IContent | IContent[] {
  if (Array.isArray(userContent)) {
    return stampTurnIdentity(userContent, identity);
  }
  return stampOne(userContent, identity);
}
