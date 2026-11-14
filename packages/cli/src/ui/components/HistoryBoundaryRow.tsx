/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G4
 *
 * Boundary expander row (issue-854-design.md §4 P03): rendered at a
 * compression/rewind/density gap in the scrollback resident set, showing
 * the removal reason and the removed-entry count. The toggle is controlled:
 * the parent owns `expanded`/`onToggle` and the keystroke that drives it,
 * the row only fetches. The summary text is a journal re-read supplied by
 * `loadSummary`; it runs only on the collapse→expand transition and the
 * loaded text is dropped on collapse, so nothing is retained between reads
 * and a re-expand re-reads. Fetch state lives in this component, so when
 * the pager evicts the boundary's rows the element unmounts and the loaded
 * text dies with it: a re-added boundary mounts collapsed and re-reads on
 * its next expand.
 */

import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import type { RemovedInteriorReason } from '@vybestack/llxprt-code-core';

export interface HistoryBoundaryRowProps {
  reason: RemovedInteriorReason;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  loadSummary: () => Promise<string>;
}

function entryWord(count: number): string {
  return count === 1 ? 'entry' : 'entries';
}

export function HistoryBoundaryRow({
  reason,
  count,
  expanded,
  onToggle: _onToggle,
  loadSummary,
}: HistoryBoundaryRowProps): React.JSX.Element {
  const [summary, setSummary] = useState<string | null>(null);
  const wasExpandedRef = useRef(false);

  useEffect(() => {
    const transitioned = expanded !== wasExpandedRef.current;
    wasExpandedRef.current = expanded;
    if (!transitioned) return undefined;
    if (!expanded) {
      setSummary(null);
      return undefined;
    }
    let active = true;
    setSummary(null);
    loadSummary()
      .then((text) => {
        if (active) setSummary(text);
      })
      .catch(() => {
        if (active) setSummary('summary unavailable');
      });
    return () => {
      active = false;
    };
  }, [expanded, loadSummary]);

  const hint = expanded ? 'press x to collapse' : 'press x to expand';
  return (
    <Box flexDirection="column">
      <Text color={Colors.DimComment}>
        {`··· ${count} ${entryWord(count)} ${reason} · ${hint} ···`}
      </Text>
      {expanded && summary !== null ? (
        <Text color={Colors.Foreground}>{summary}</Text>
      ) : null}
    </Box>
  );
}
