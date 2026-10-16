/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the stateful parent and the cursor of the Responses
 * length model, as journal-level facts. When the provider sends a previous
 * response id, only the units after that response's own unit are sent, and an
 * output needs no local call.
 *
 * The facts are the row-header flag "this row can be a parent" and its
 * endpoint class, written when the row is appended. The newest usable parent
 * of the request endpoint is chosen from them, skipping the parents the
 * server rejected. `ParentIndex` and `rejected` are STAND-INS for the
 * versioned meta-map keys (`parent:W:k`, `parent:E:<endpoint>:k`) and the
 * state-map rejection entries; they are heap structures here and stay
 * test-only.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export const REQUEST_URL = 'https://api.openai.com/v1';

export function stripTrailingSlashes(value: string): string {
  let stripped = value;
  while (stripped.endsWith('/')) stripped = stripped.slice(0, -1);
  return stripped;
}

/** The row has a unit of its own in the stream (it is not only tool results). */
function hasSelfUnit(row: IContent): boolean {
  if (!row.blocks.some((block) => block.type === 'tool_response')) return true;
  const kept = row.blocks.filter(
    (block) => block.type !== 'tool_response' && block.type !== 'media',
  );
  return !(row.speaker === 'tool' || kept.length === 0);
}

interface ParentFact {
  /** Source row ordinal. */
  readonly row: number;
  readonly id: string;
}

/** The row-header facts written at append, or undefined for a non-parent. */
function parentFactOf(
  row: IContent,
  ordinal: number,
): { fact: ParentFact; endpoint: string | undefined } | undefined {
  const metadata = row.metadata;
  if (row.speaker !== 'ai' || metadata?.responsesStored !== true) {
    return undefined;
  }
  const id = metadata.id;
  if (typeof id !== 'string' || id === '' || !hasSelfUnit(row)) {
    return undefined;
  }
  const recorded: unknown = metadata.providerBaseURL;
  const endpoint =
    typeof recorded !== 'string' || recorded === ''
      ? undefined
      : stripTrailingSlashes(recorded);
  return { fact: { row: ordinal, id }, endpoint };
}

/** The parent rule. `exactUrl` is the control that ignores wildcard and slash URLs. */
export type ParentRule = 'newest' | 'exactUrl';

function newestUsable(
  list: readonly ParentFact[] | undefined,
  rejected: ReadonlySet<string>,
): ParentFact | undefined {
  if (list === undefined) return undefined;
  for (let at = list.length - 1; at >= 0; at -= 1) {
    if (!rejected.has(list[at].id)) return list[at];
  }
  return undefined;
}

export class ParentIndex {
  private readonly wildcard: ParentFact[] = [];
  private readonly byEndpoint = new Map<string, ParentFact[]>();

  static from(rows: readonly IContent[]): ParentIndex {
    const index = new ParentIndex();
    rows.forEach((row, ordinal) => {
      const parent = parentFactOf(row, ordinal);
      if (parent === undefined) return;
      if (parent.endpoint === undefined) {
        index.wildcard.push(parent.fact);
        return;
      }
      const list = index.byEndpoint.get(parent.endpoint) ?? [];
      index.byEndpoint.set(parent.endpoint, [...list, parent.fact]);
    });
    return index;
  }

  /**
   * The newest usable parent: walk each applicable list from its end while the
   * candidate is rejected; the larger row wins.
   */
  select(
    requestUrl: string,
    rejected: ReadonlySet<string>,
  ): ParentFact | undefined {
    const wildcard = newestUsable(this.wildcard, rejected);
    const endpoint = newestUsable(
      this.byEndpoint.get(stripTrailingSlashes(requestUrl)),
      rejected,
    );
    if (wildcard === undefined) return endpoint;
    if (endpoint === undefined) return wildcard;
    return wildcard.row > endpoint.row ? wildcard : endpoint;
  }

  /** The control: only parents recorded with exactly the request URL. */
  selectExactUrl(
    rows: readonly IContent[],
    requestUrl: string,
    rejected: ReadonlySet<string>,
  ): ParentFact | undefined {
    const exact = rows.map((row) =>
      row.metadata?.providerBaseURL === requestUrl
        ? row
        : { ...row, metadata: {} },
    );
    return newestUsable(
      ParentIndex.from(exact).byEndpoint.get(requestUrl),
      rejected,
    );
  }
}

/** Where the cursor goes. `afterWholeRow` is the control that skips the adjacent result. */
export type CursorRule = 'afterParentUnit' | 'afterWholeRow';

export interface StatefulPlan {
  readonly parentId: string | undefined;
  /** The first unit that is sent. */
  readonly cursor: number;
  readonly serverSideParent: boolean;
}

export interface StatefulRules {
  readonly parent: ParentRule;
  readonly cursor: CursorRule;
}

export const CORRECT_RULES: StatefulRules = {
  parent: 'newest',
  cursor: 'afterParentUnit',
};

function isAdjacentResult(
  parentUnit: IContent,
  next: IContent | undefined,
): boolean {
  if (next === undefined || next.speaker !== 'tool') return false;
  const callIds = new Set(
    parentUnit.blocks.flatMap((block) =>
      block.type === 'tool_call' ? [block.id] : [],
    ),
  );
  return next.blocks.some(
    (block) => block.type === 'tool_response' && callIds.has(block.callId),
  );
}

const FULL_HISTORY: StatefulPlan = {
  parentId: undefined,
  cursor: 0,
  serverSideParent: false,
};

/**
 * The plan for a stateful send. `rows` are the rows as the journal holds them
 * (the parent facts are written from these); `units` are the unit stream the
 * provider converts. A parent with nothing after it sends the full history.
 */
export function statefulPlan(
  rows: readonly IContent[],
  units: readonly IContent[],
  rejected: ReadonlySet<string>,
  rules: StatefulRules = CORRECT_RULES,
): StatefulPlan {
  const parent =
    rules.parent === 'newest'
      ? ParentIndex.from(rows).select(REQUEST_URL, rejected)
      : ParentIndex.from(rows).selectExactUrl(rows, REQUEST_URL, rejected);
  if (parent === undefined) return FULL_HISTORY;
  const own = units.findIndex(
    (unit) => unit.speaker === 'ai' && unit.metadata?.id === parent.id,
  );
  if (own < 0) throw new Error(`parent ${parent.id} has no unit of its own`);
  const after =
    rules.cursor === 'afterWholeRow' &&
    isAdjacentResult(units[own], units[own + 1])
      ? own + 2
      : own + 1;
  if (own + 1 >= units.length) return FULL_HISTORY;
  return { parentId: parent.id, cursor: after, serverSideParent: true };
}
