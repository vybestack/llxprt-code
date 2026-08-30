/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared shaping helpers for the GitHub broker op registry.
 *
 * Extracted from github-broker-ops.ts so per-op modules can reuse
 * defensive parsing of external data without code duplication.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-126
 */

import {
  mapGraphQLErrorType,
  makeBrokerError,
  BrokerErrorException,
} from './github-broker-errors.js';
import { resolveLimit } from './github-broker-validation.js';

/**
 * A page of shaped items plus whether the query had more to give.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-6
 * @issue 3407
 */
export interface WindowedItems<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
}

/**
 * Trims the over-fetched probe row (see `resolveFetchLimit`) and reports
 * whether more results exist.
 *
 * Without this, a list returning exactly `limit` rows is indistinguishable
 * from a list that happens to have exactly `limit` matches, so an agent
 * reports a page size as a total. That is the same class of silent wrong
 * answer as the missing milestone field: nothing errors, the number is just
 * incorrect.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-6
 * @issue 3407
 */
export function windowByLimit<T>(
  items: readonly T[],
  params: Record<string, unknown>,
): WindowedItems<T> {
  const limit = resolveLimit(params);
  return items.length > limit
    ? { items: items.slice(0, limit), hasMore: true }
    : { items, hasMore: false };
}

/**
 * The shaped comment in the issue.view / pr.view contract.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
export interface ShapedComment {
  readonly author: string;
  readonly createdAt: string;
  readonly body: string;
}

/**
 * Maximum bytes for a shaped body before truncation kicks in.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 125-126
 */
export const TRUNCATION_LIMIT_BYTES = 64 * 1024;

/**
 * Marker appended to a truncated field so the caller knows data was cut.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 125-126
 */
export const TRUNCATION_MARKER = '\n...[truncated]';

/**
 * Extracts a number from an unknown value, defaulting to 0.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
export function extractNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/**
 * Extracts a string from an unknown value, returning a default.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
export function extractString(value: unknown, def: string): string {
  return typeof value === 'string' ? value : def;
}

/**
 * Extracts an issue/PR state, normalised to lower case.
 *
 * gh reports `OPEN` from `issue list` and `pr list` but `open` from `search
 * issues`, so the same logical issue compared across two operations looked
 * like two different states. Lower case is the form the tool's own `state`
 * parameter accepts, so a shaped state now round-trips back into a request.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-7
 * @issue 3407
 */
export function extractState(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

/**
 * Extracts the author login from a gh author object (defensive).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
export function extractAuthor(value: unknown): string {
  if (typeof value === 'string') return normalizeLogin(value);
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.login === 'string') return normalizeLogin(obj.login);
  }
  return '';
}

/**
 * Normalises an app login to the `name[bot]` form GitHub itself displays.
 *
 * gh reports the same bot two ways: `gh issue list` says `app/cursor` while
 * `gh search issues` says `cursor[bot]`, so the same issue carried two
 * different authors depending on which operation returned it and equality
 * checks across operations failed. Both forms are accepted as `author:`
 * qualifiers, so neither round-trips better; the `[bot]` suffix wins because
 * it is the account's actual login.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-7
 * @issue 3407
 */
function normalizeLogin(login: string): string {
  return login.startsWith('app/')
    ? `${login.slice('app/'.length)}[bot]`
    : login;
}

/**
 * Extracts label names from a gh labels array (defensive).
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 */
export function extractLabels(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((label): string => {
      if (typeof label === 'string') return label;
      if (typeof label === 'object' && label !== null) {
        const obj = label as Record<string, unknown>;
        if (typeof obj.name === 'string') return obj.name;
      }
      return '';
    })
    .filter((name) => name.length > 0);
}

/**
 * Extracts assignee logins from a gh assignees array (defensive), reduced
 * to logins with empty ones dropped, exactly like `extractLabels` reduces
 * labels to names. Accepts a bare string element like `extractAuthor`
 * does. gh's assignee objects are `{ id, login, name, databaseId }` and
 * `[]` when none.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 */
export function extractAssignees(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((assignee): string => {
      if (typeof assignee === 'string') return assignee;
      if (typeof assignee === 'object' && assignee !== null) {
        const obj = assignee as Record<string, unknown>;
        if (typeof obj.login === 'string') return obj.login;
      }
      return '';
    })
    .filter((login) => login.length > 0);
}

/**
 * Extracts the milestone title from a gh milestone object (defensive).
 * Returns null when the milestone is unset (absent, null, or not an
 * object): the raw milestone carries a multi-paragraph `description`
 * that would otherwise be repeated on every list item, so only the title
 * is kept.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 */
export function extractMilestone(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return typeof obj.title === 'string' && obj.title.length > 0
      ? obj.title
      : null;
  }
  return null;
}

/**
 * Extracts shaped comments from a gh comments array (defensive). Returns
 * null when there is no comments array, so the caller can distinguish
 * "not requested" from "zero comments".
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
export function extractComments(
  value: unknown,
): readonly ShapedComment[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((comment): ShapedComment => {
    const obj = (comment ?? {}) as Record<string, unknown>;
    return {
      author: extractAuthor(obj.author),
      createdAt: extractString(obj.createdAt, ''),
      body: extractString(obj.body, ''),
    };
  });
}

/**
 * Throws a structured error if the raw JSON contains both data and errors
 * (GraphQL partial success). This is defensive parsing of a GitHub API
 * response, which is genuinely external input.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-004
 * @pseudocode 003-github-broker.md lines 75-76
 */
export function assertNotPartialSuccess(rawJson: unknown): void {
  if (rawJson === null || typeof rawJson !== 'object') return;
  const raw = rawJson as Record<string, unknown>;
  if (
    raw.data !== undefined &&
    Array.isArray(raw.errors) &&
    raw.errors.length > 0
  ) {
    // The array contents come from GitHub, so treat entries as unknown
    // shape. A null or non-object first element previously threw a
    // TypeError here and replaced a useful GraphQL error with a crash.
    const first =
      typeof raw.errors[0] === 'object' && raw.errors[0] !== null
        ? (raw.errors[0] as Record<string, unknown>)
        : {};
    const type = typeof first.type === 'string' ? first.type : undefined;
    const message =
      typeof first.message === 'string' ? first.message : 'GraphQL error';
    throw new Error(`${mapGraphQLErrorType(type)}: ${message}`);
  }
}

/**
 * Truncates a string field if it exceeds the byte budget. Returns the
 * (possibly truncated) string and an optional truncation metadata object
 * for the caller to attach to the response.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 125-126
 */
export function truncateWithMarker(
  value: string,
  field: string,
  limit: number = TRUNCATION_LIMIT_BYTES,
): {
  value: string;
  truncated: { field: string; originalBytes: number } | null;
} {
  const originalBytes = Buffer.byteLength(value, 'utf8');
  if (originalBytes <= limit) {
    return { value, truncated: null };
  }
  // The budget is measured in UTF-8 bytes, so the cut must be too. Slicing
  // by UTF-16 code units would under-cut multi-byte text (leaving the result
  // over budget) and can split a surrogate pair, producing a replacement
  // character. Cutting the encoded buffer and decoding with a stream-aware
  // decoder drops any partial trailing sequence cleanly instead.
  const budget = Math.max(0, limit - Buffer.byteLength(TRUNCATION_MARKER));
  // `stream: true` makes the decoder hold back an incomplete trailing
  // sequence instead of emitting U+FFFD for it. Without it the replacement
  // character both corrupts the text and costs three bytes we did not
  // budget for, pushing the result back over the limit.
  const cut = new TextDecoder('utf-8').decode(
    Buffer.from(value, 'utf8').subarray(0, budget),
    { stream: true },
  );
  return {
    value: cut + TRUNCATION_MARKER,
    truncated: { field, originalBytes },
  };
}

/**
 * Asserts that a list-shaped gh response really is a list.
 *
 * Returning an empty array for a non-array response makes an authentication
 * failure, a CLI error or an unexpected payload look identical to "no
 * results", which is the worst possible reading of it. The partial-success
 * guard runs first, so anything reaching here that is not an array is a
 * genuine surprise and should surface.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-013
 */
export function assertListShape(
  rawJson: unknown,
  op: string,
): asserts rawJson is unknown[] {
  if (!Array.isArray(rawJson)) {
    throw new BrokerErrorException(
      makeBrokerError(
        'GITHUB_ERROR',
        `${op}: expected a list from gh but received ${typeof rawJson}`,
      ),
    );
  }
}
