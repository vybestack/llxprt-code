/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  parentHitOf,
  planStatefulConversation,
  selectStatefulParent,
  type StatefulPlan,
} from './openAIResponsesStateful.js';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

function options(): { invocation: { modelBehavior: Record<string, unknown> } } {
  return {
    invocation: {
      modelBehavior: {},
    },
  };
}

function historyWithStoredParent(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'first question' }],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'first answer' }],
      metadata: {
        id: 'resp_stored',
        responsesStored: true,
        providerBaseURL: CODEX_BASE_URL,
      },
    },
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'second question' }],
    },
  ];
}

const logger = { debug: vi.fn() } as unknown as DebugLogger;

function plan(
  overrides: {
    readonly explicitUserStore?: boolean;
    readonly statefulTransportSupported?: boolean;
    readonly forceParentless?: boolean;
  } = {},
): StatefulPlan {
  return planStatefulConversation(
    options(),
    {},
    overrides.explicitUserStore,
    /* isCodex */ true,
    CODEX_BASE_URL,
    () => false,
    overrides.statefulTransportSupported ?? true,
    logger,
    overrides.forceParentless ?? false,
  );
}

/** The decision a send makes after scanning the stored history for a parent. */
function selectParent(scan: Extract<StatefulPlan, { kind: 'scan' }>) {
  const history = historyWithStoredParent();
  let hit: ReturnType<typeof parentHitOf>;
  history.forEach((row, index) => {
    hit = parentHitOf(row, index, scan) ?? hit;
  });
  return selectStatefulParent(hit, history.length, logger);
}

describe('planStatefulConversation forceParentless @issue:3446', () => {
  it('skips the parent scan with statefulness enabled when an eligible parent exists', () => {
    const result = plan({ forceParentless: true });

    expect(result).toStrictEqual({ kind: 'settled', enabled: true });
  });

  it('scans for the stored parent without forceParentless', () => {
    const result = plan();

    expect(result.kind).toBe('scan');
    if (result.kind !== 'scan') return;
    const selection = selectParent(result);
    expect(selection.parentId).toBe('resp_stored');
    // The rows up to and including the parent are replayed server-side.
    expect(selection.skipRows).toBe(2);
  });

  it('stays disabled when the transport cannot carry statefulness, even with forceParentless', () => {
    const result = plan({
      statefulTransportSupported: false,
      forceParentless: true,
    });

    expect(result).toStrictEqual({ kind: 'settled', enabled: false });
  });

  it('stays disabled when the user set store=false, even with forceParentless', () => {
    const result = plan({ explicitUserStore: false, forceParentless: true });

    expect(result).toStrictEqual({ kind: 'settled', enabled: false });
  });
});
