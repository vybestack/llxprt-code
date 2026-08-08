/**
 * @license
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';

export interface StatefulConversation {
  enabled: boolean;
  parentId: string | undefined;
  content: IContent[];
}

const RESPONSES_STATEFUL_KEY = 'responses-stateful';

/**
 * Normalize a raw `responses-stateful` value to a strict boolean, accepting
 * actual booleans and the strings `'true'`/`'false'` (the latter commonly
 * appears in hand-edited config). Anything else returns `undefined` so the
 * Codex default-ON / non-Codex default-OFF logic falls through correctly
 * instead of failing open. (#3134 Fix 8a)
 */
function normalizeStatefulValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/**
 * A stored response id is scoped to the endpoint that issued it, so a parent
 * from a different endpoint can never resolve (#3134).
 *
 * We reject only when the recorded endpoint is KNOWN and DIFFERENT. An absent
 * `providerBaseURL` is not evidence of a mismatch: `stampAiTurnModel` takes an
 * optional baseURL and skips the stamp when it is unavailable, so treating
 * "absent" as a mismatch would silently disable statefulness on any history
 * that predates the stamp or was produced without a resolvable baseURL.
 */
function isSameEndpoint(recorded: unknown, rawBaseURL: string): boolean {
  if (typeof recorded !== 'string' || recorded === '') return true;
  return stripTrailingSlashes(recorded) === stripTrailingSlashes(rawBaseURL);
}

function stripTrailingSlashes(value: string): string {
  let result = value;
  while (result.endsWith('/')) result = result.slice(0, -1);
  return result;
}

function hasStoredResponseId(metadata: IContent['metadata']): boolean {
  return (
    metadata?.responsesStored === true &&
    typeof metadata.id === 'string' &&
    metadata.id !== ''
  );
}

function isEligibleParent(entry: IContent, rawBaseURL: string): boolean {
  if (entry.speaker !== 'ai') return false;
  if (!hasStoredResponseId(entry.metadata)) return false;
  return isSameEndpoint(entry.metadata?.providerBaseURL, rawBaseURL);
}

/**
 * Determine whether the conversation should use OpenAI Responses server-side
 * statefulness (`store=true` + `previous_response_id`).
 *
 * When a stored parent AI turn exists in `content` (matching the endpoint),
 * the returned `content` is trimmed to just the turns AFTER that parent —
 * the server replays the parent's chain server-side. When no eligible parent
 * is found, full history is returned with `enabled: true` and no parent id,
 * starting a fresh stored chain.
 *
 * Parameters:
 * - `rawBaseURL` — the resolved endpoint URL; an AI entry's
 *   `metadata.providerBaseURL` must equal this to qualify as a parent, so a
 *   parent issued by one endpoint is never sent to another (#3134 Fix 2).
 * - `isRejectedParent` — reports whether a specific response id has already
 *   been refused by the backend. Such an id is skipped so the scan falls
 *   through to an older parent, or to none at all (#3134 Fix 1).
 *
 *   This is deliberately per-id rather than a session-wide switch. Codex
 *   parents are scoped to the WebSocket connection that produced them, so a
 *   resumed session (`--continue`) loads history whose stored markers are
 *   already dead. Suppressing statefulness for the whole session on the first
 *   rejection meant such a session replayed the full history on every
 *   subsequent turn and never started a new chain. Skipping only the dead id
 *   lets the retry send full history once; that response becomes the newest
 *   stored turn, and because the scan takes the NEWEST eligible parent the
 *   very next turn chains from it. The chain re-establishes itself.
 */
export function computeStatefulConversation(
  options: NormalizedGenerateChatOptions,
  content: IContent[],
  invocationEphemerals: Record<string, unknown>,
  explicitUserStore: boolean | undefined,
  isCodex: boolean,
  rawBaseURL: string,
  isRejectedParent: (responseId: string) => boolean,
  statefulTransportSupported: boolean,
  logger: DebugLogger,
): StatefulConversation {
  // Codex statefulness is bound to the WebSocket transport. The ChatGPT
  // backend rejects `store: true` (400 "Store must be set to false"), so a
  // parent id only resolves on the socket that produced it; sending one over
  // HTTP is rejected and wastes a round trip.
  if (!statefulTransportSupported) {
    logger.debug(
      () =>
        'responses-stateful skipped: the active transport cannot resolve a previous_response_id.',
    );
    return { enabled: false, parentId: undefined, content };
  }

  const ephemeralValue = invocationEphemerals[RESPONSES_STATEFUL_KEY];
  const explicitStateful =
    normalizeStatefulValue(ephemeralValue) ??
    normalizeStatefulValue(
      options.invocation.getModelBehavior(RESPONSES_STATEFUL_KEY),
    );
  // B2: statefulness defaults ON for Codex (opt-out only via explicit
  // responses-stateful:false or store:false). Non-Codex keeps its explicit
  // opt-in via the responses-stateful ephemeral / model-behavior key (B8).
  const requested = isCodex
    ? explicitStateful !== false
    : explicitStateful === true;
  if (!requested || explicitUserStore === false) {
    return { enabled: false, parentId: undefined, content };
  }

  // Scan from the newest entry backwards for the most recent stored AI turn
  // from the SAME endpoint. Capturing `parentId` inside the loop guarantees
  // it is a non-empty string, removing the need for a `!== undefined`
  // re-check on the trimmed return (#3134 Fix 8b).
  let parentId: string | undefined = undefined;
  let parentIndex = -1;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const entry = content[index];
    if (!isEligibleParent(entry, rawBaseURL)) continue;
    const candidate = entry.metadata!.id as string;
    // A parent the backend already refused is dead; skip it so a resumed
    // session cannot keep re-sending it (#3134 Fix 1).
    if (isRejectedParent(candidate)) {
      logger.debug(
        () =>
          `responses-stateful skipping previously rejected parent ${candidate}.`,
      );
      continue;
    }
    parentId = candidate;
    parentIndex = index;
    break;
  }

  if (parentIndex === -1) {
    logger.debug(
      () => 'responses-stateful starting a new stored conversation.',
    );
    return { enabled: true, parentId: undefined, content };
  }

  const trimmedContent = content.slice(parentIndex + 1);
  if (trimmedContent.length === 0) {
    logger.debug(
      () =>
        'responses-stateful has no content after its parent; using full history.',
    );
    // Fix 7: return enabled: true so store is set — the asymmetry with the
    // no-parent branch was unjustified (both send full history, no parent
    // id). With store=true this response can become a future parent.
    return { enabled: true, parentId: undefined, content };
  }

  return {
    enabled: true,
    parentId,
    content: trimmedContent,
  };
}

/**
 * Apply the stateful conversation result to the outgoing request.
 *
 * DESIGN RATIONALE (moved from applyCodexRequestSettings, #3134 Fix 8c):
 *
 * `applyCodexRequestSettings` sets `store=false` as the Codex DEFAULT. This
 * function runs after it and raises `store` to `true` whenever statefulness is
 * active. Storing server-side is the design assumption that makes
 * `previous_response_id` resolvable, and resolvable server-side state is what
 * lets a turn send just the delta instead of replaying the whole conversation.
 * It is also assumed to make the parent durable across a WebSocket reconnect
 * and across a WebSocket→HTTP demotion. Codex CLI keeps store=false for Zero
 * Data Retention and therefore forgoes statefulness on HTTP; issue #3134
 * deliberately takes the opposite trade-off. Users who need the old behavior
 * opt out with store=false, which this function honours by leaving store
 * false. `responsesStored` (= `request.store === true`) then becomes true for
 * stateful Codex turns, which is what makes `parseResponsesStream` stamp
 * `metadata.responsesStored` + `metadata.id` so the NEXT turn can chain.
 *
 * Fix 4: `previous_response_id` is deleted unconditionally as the FIRST
 * statement. It is user-settable via `/set modelparam` and would otherwise
 * survive next to a full history (duplicating context). It is re-assigned
 * ONLY on the stateful path below.
 */
export function applyStatefulConversation(
  request: OpenAIResponsesRequest,
  stateful: StatefulConversation,
  explicitUserStore: boolean | undefined,
  isCodex: boolean,
  logger: DebugLogger,
): void {
  delete request.previous_response_id;

  if (explicitUserStore === false) {
    request.store = false;
    logger.debug(
      () => 'responses-stateful disabled because the user set store=false.',
    );
    return;
  }
  if (!stateful.enabled) return;

  // The Codex backend REJECTS store=true outright:
  //   HTTP 400 {"detail":"Store must be set to false"}
  // (verified against chatgpt.com/backend-api/codex). Its continuation state
  // is held by the live WebSocket connection, not by durable server-side
  // storage, which is why upstream sends `store: false` alongside
  // `previous_response_id` on the WS payload. Raising store here would break
  // every Codex request, so Codex keeps store=false and relies on the
  // connection-scoped parent instead.
  if (!isCodex) {
    request.store = true;
  }
  if (stateful.parentId !== undefined) {
    request.previous_response_id = stateful.parentId;
  }
  logger.debug(
    () =>
      `responses-stateful activated: previous_response_id=${stateful.parentId ?? 'none'}, store=${String(request.store === true)}.`,
  );
}
