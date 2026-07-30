/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CEILING_RULES } from './constants.ts';
import {
  buildRuleState,
  countDiffBracketAndBraceDelta,
  extractRuleKey,
  isCompleteSingleLineRuleEntry,
  isMultilineArraySeverityEntry,
  isMultilineNumericSeverityEntry,
  isObjectFormMaxLine,
  isStandaloneMaxLine,
  isStandaloneNumericThresholdLine,
  openerExpectsFirstArrayElement,
} from './rule-config.ts';
import {
  countDiffBraceDelta,
  extractInlineRulesEntries,
  isArbitraryObjectOpener,
  isNonRuleContainerOpen,
  isRulesBlockOpen,
} from './diff-context.ts';
import type { DiffState } from './types.ts';

export function updateStructuralContext(state: DiffState, content: string) {
  if (state.file !== 'eslint.config.js') {
    return;
  }
  updateArbitraryObjectContext(state, content);
  updateNonRuleContainerContext(state, content);
  openRulesBlockIfNeeded(state, content);
  if (state.rulesBraceDepth !== null) {
    updateRulesBlockContext(state, content, state.rulesBraceDepth);
  }
}

function openRulesBlockIfNeeded(state: DiffState, content: string) {
  const rulesOpensHere =
    isRulesBlockOpen(content) &&
    state.rulesBraceDepth === null &&
    state.arbitraryObjectDepth === null &&
    state.nonRuleContainerDepth === null;
  if (rulesOpensHere) {
    state.rulesBraceDepth = 0;
    state.insideRuleEntry = false;
    state.expectingFirstSeverityElement = false;
    state.expectingCeilingThreshold = false;
  }
}

function updateArbitraryObjectContext(state: DiffState, content: string) {
  if (state.rulesBraceDepth !== null) {
    return;
  }
  if (
    state.arbitraryObjectDepth === null &&
    isArbitraryObjectOpener(content) &&
    !isRulesBlockOpen(content)
  ) {
    state.arbitraryObjectDepth = 0;
  }
  if (state.arbitraryObjectDepth !== null) {
    state.arbitraryObjectDepth += countDiffBraceDelta(content);
    if (state.arbitraryObjectDepth <= 0) {
      state.arbitraryObjectDepth = null;
    }
  }
}

function updateNonRuleContainerContext(state: DiffState, content: string) {
  if (state.rulesBraceDepth !== null) {
    return;
  }
  if (state.nonRuleContainerDepth === null && isNonRuleContainerOpen(content)) {
    state.nonRuleContainerDepth = 0;
  }
  if (state.nonRuleContainerDepth !== null) {
    state.nonRuleContainerDepth += countDiffBraceDelta(content);
    if (state.nonRuleContainerDepth <= 0) {
      state.nonRuleContainerDepth = null;
    }
  }
}

function updateRulesBlockContext(
  state: DiffState,
  content: string,
  rulesBraceDepth: number,
) {
  const nextRulesBraceDepth = rulesBraceDepth + countDiffBraceDelta(content);
  state.rulesBraceDepth = nextRulesBraceDepth;
  if (nextRulesBraceDepth <= 0) {
    resetRulesBlockState(state);
    return;
  }
  updateRuleEntryDepth(state, content);
  updateCurrentRuleKey(state, content);
}

function resetRulesBlockState(state: DiffState) {
  state.rulesBraceDepth = null;
  state.currentCeilingRuleKey = null;
  state.currentRuleKey = null;
  state.insideRuleEntry = false;
  state.expectingFirstSeverityElement = false;
  state.expectingCeilingThreshold = false;
}

function updateRuleEntryDepth(state: DiffState, content: string) {
  if (!state.insideRuleEntry || state.ruleEntryDepth === null) {
    return;
  }
  const isDuplicateOpener =
    state.currentRuleKey !== null &&
    extractRuleKey(content) === state.currentRuleKey;
  if (isDuplicateOpener) {
    return;
  }
  state.ruleEntryDepth += countDiffBracketAndBraceDelta(content);
  if (state.ruleEntryDepth <= 0) {
    resetRuleEntryState(state);
    return;
  }
  updateSeverityExpectation(state, content);
}

function resetRuleEntryState(state: DiffState) {
  state.currentCeilingRuleKey = null;
  state.currentRuleKey = null;
  state.insideRuleEntry = false;
  state.ruleEntryDepth = null;
  state.expectingFirstSeverityElement = false;
  state.expectingCeilingThreshold = false;
}

function updateSeverityExpectation(state: DiffState, content: string) {
  if (!state.expectingFirstSeverityElement) {
    if (
      state.expectingCeilingThreshold &&
      isStandaloneNumericThresholdLine(content)
    ) {
      state.expectingCeilingThreshold = false;
    }
    return;
  }
  const isSeverity =
    isMultilineArraySeverityEntry(content) ||
    isMultilineNumericSeverityEntry(content);
  if (isSeverity) {
    state.expectingFirstSeverityElement = false;
    state.expectingCeilingThreshold = state.currentCeilingRuleKey !== null;
  }
}

function updateCurrentRuleKey(state: DiffState, content: string) {
  if (state.insideRuleEntry) {
    return;
  }
  const key = extractRuleKey(content);
  if (key === null) {
    return;
  }
  state.currentRuleKey = key;
  state.currentCeilingRuleKey = CEILING_RULES.has(key) ? key : null;
  if (isCompleteSingleLineRuleEntry(content)) {
    return;
  }
  state.insideRuleEntry = true;
  state.ruleEntryDepth = countDiffBracketAndBraceDelta(content);
  state.expectingFirstSeverityElement = openerExpectsFirstArrayElement(content);
  state.expectingCeilingThreshold =
    !state.expectingFirstSeverityElement &&
    state.currentCeilingRuleKey !== null;
}

export function updateRemovedStructuralContext(
  state: DiffState,
  content: string,
) {
  if (state.file !== 'eslint.config.js') {
    return;
  }
  updateRemovedArbitraryObjectContext(state, content);
  updateRemovedNonRuleContainerContext(state, content);
  openRemovedRulesBlockIfNeeded(state, content);
  if (state.removedRulesBraceDepth !== null) {
    updateRemovedRulesBlockContext(
      state,
      content,
      state.removedRulesBraceDepth,
    );
  }
}

function openRemovedRulesBlockIfNeeded(state: DiffState, content: string) {
  const rulesOpensHere =
    isRulesBlockOpen(content) &&
    state.removedRulesBraceDepth === null &&
    state.removedArbitraryObjectDepth === null &&
    state.removedNonRuleContainerDepth === null;
  if (rulesOpensHere) {
    state.removedRulesBraceDepth = 0;
    state.removedInsideRuleEntry = false;
    state.removedExpectingFirstSeverityElement = false;
    state.removedExpectingCeilingThreshold = false;
  }
}

function updateRemovedArbitraryObjectContext(
  state: DiffState,
  content: string,
) {
  if (state.removedRulesBraceDepth !== null) {
    return;
  }
  if (
    state.removedArbitraryObjectDepth === null &&
    isArbitraryObjectOpener(content) &&
    !isRulesBlockOpen(content)
  ) {
    state.removedArbitraryObjectDepth = 0;
  }
  if (state.removedArbitraryObjectDepth !== null) {
    state.removedArbitraryObjectDepth += countDiffBraceDelta(content);
    if (state.removedArbitraryObjectDepth <= 0) {
      state.removedArbitraryObjectDepth = null;
    }
  }
}

function updateRemovedNonRuleContainerContext(
  state: DiffState,
  content: string,
) {
  if (state.removedRulesBraceDepth !== null) {
    return;
  }
  if (
    state.removedNonRuleContainerDepth === null &&
    isNonRuleContainerOpen(content)
  ) {
    state.removedNonRuleContainerDepth = 0;
  }
  if (state.removedNonRuleContainerDepth !== null) {
    state.removedNonRuleContainerDepth += countDiffBraceDelta(content);
    if (state.removedNonRuleContainerDepth <= 0) {
      state.removedNonRuleContainerDepth = null;
    }
  }
}

function updateRemovedRulesBlockContext(
  state: DiffState,
  content: string,
  removedRulesBraceDepth: number,
) {
  const nextRemovedRulesBraceDepth =
    removedRulesBraceDepth + countDiffBraceDelta(content);
  state.removedRulesBraceDepth = nextRemovedRulesBraceDepth;
  if (nextRemovedRulesBraceDepth <= 0) {
    resetRemovedRulesBlockState(state);
    return;
  }
  updateRemovedRuleEntryDepth(state, content);
  updateRemovedCurrentRuleKey(state, content);
}

function resetRemovedRulesBlockState(state: DiffState) {
  state.removedRulesBraceDepth = null;
  state.removedCurrentCeilingRuleKey = null;
  state.removedCurrentRuleKey = null;
  state.removedInsideRuleEntry = false;
  state.removedExpectingFirstSeverityElement = false;
  state.removedExpectingCeilingThreshold = false;
}

function updateRemovedRuleEntryDepth(state: DiffState, content: string) {
  if (!state.removedInsideRuleEntry || state.removedRuleEntryDepth === null) {
    return;
  }
  const isDuplicateOpener =
    state.removedCurrentRuleKey !== null &&
    extractRuleKey(content) === state.removedCurrentRuleKey;
  if (isDuplicateOpener) {
    return;
  }
  state.removedRuleEntryDepth += countDiffBracketAndBraceDelta(content);
  if (state.removedRuleEntryDepth <= 0) {
    resetRemovedRuleEntryState(state);
    return;
  }
  updateRemovedSeverityExpectation(state, content);
}

function resetRemovedRuleEntryState(state: DiffState) {
  state.removedCurrentCeilingRuleKey = null;
  state.removedCurrentRuleKey = null;
  state.removedInsideRuleEntry = false;
  state.removedRuleEntryDepth = null;
  state.removedExpectingFirstSeverityElement = false;
  state.removedExpectingCeilingThreshold = false;
}

function updateRemovedSeverityExpectation(state: DiffState, content: string) {
  if (!state.removedExpectingFirstSeverityElement) {
    if (
      state.removedExpectingCeilingThreshold &&
      isStandaloneNumericThresholdLine(content)
    ) {
      state.removedExpectingCeilingThreshold = false;
    }
    return;
  }
  const isSeverity =
    isMultilineArraySeverityEntry(content) ||
    isMultilineNumericSeverityEntry(content);
  if (isSeverity) {
    state.removedExpectingFirstSeverityElement = false;
    state.removedExpectingCeilingThreshold =
      state.removedCurrentCeilingRuleKey !== null;
  }
}

function updateRemovedCurrentRuleKey(state: DiffState, content: string) {
  if (state.removedInsideRuleEntry) {
    return;
  }
  const key = extractRuleKey(content);
  if (key === null) {
    return;
  }
  state.removedCurrentRuleKey = key;
  state.removedCurrentCeilingRuleKey = CEILING_RULES.has(key) ? key : null;
  if (isCompleteSingleLineRuleEntry(content)) {
    return;
  }
  state.removedInsideRuleEntry = true;
  state.removedRuleEntryDepth = countDiffBracketAndBraceDelta(content);
  state.removedExpectingFirstSeverityElement =
    openerExpectsFirstArrayElement(content);
  state.removedExpectingCeilingThreshold =
    !state.removedExpectingFirstSeverityElement &&
    state.removedCurrentCeilingRuleKey !== null;
}

export function bufferRemovedConfig(
  state: DiffState,
  content: string,
  currentLine: number,
) {
  if (state.file !== 'eslint.config.js') {
    return;
  }
  bufferKeyedConfig(state, content, currentLine);
  bufferMultilineSeverity(state, content, currentLine);
  bufferMultilineMax(state, content, currentLine);
  bufferMultilineNumericThreshold(state, content, currentLine);
  bufferInlineRules(state, content, currentLine);
  bufferRemovedRuleState(state, content, currentLine);
  updateRemovedStructuralContext(state, content);
}

function bufferKeyedConfig(
  state: DiffState,
  content: string,
  currentLine: number,
) {
  if (!state.removedInsideRuleEntry && extractRuleKey(content) !== null) {
    state.pendingRemovedConfigs.push({ content, lineNumber: currentLine });
  }
}

function bufferMultilineSeverity(
  state: DiffState,
  content: string,
  currentLine: number,
) {
  const ruleKey = state.removedCurrentRuleKey;
  const inRulesBlock = state.removedRulesBraceDepth !== null;
  const isExpecting = state.removedExpectingFirstSeverityElement;
  const isSeverityEntry =
    isMultilineArraySeverityEntry(content) ||
    isMultilineNumericSeverityEntry(content);
  const shouldBuffer =
    inRulesBlock && ruleKey !== null && isExpecting && isSeverityEntry;
  if (shouldBuffer) {
    state.pendingRemovedMultilineSeverity.push({
      content,
      lineNumber: currentLine,
      ruleKey,
    });
  }
}

function bufferMultilineMax(
  state: DiffState,
  content: string,
  currentLine: number,
) {
  const ruleKey = state.removedCurrentCeilingRuleKey;
  const shouldBuffer =
    state.removedRulesBraceDepth !== null &&
    ruleKey !== null &&
    (isStandaloneMaxLine(content) || isObjectFormMaxLine(content));
  if (shouldBuffer) {
    state.pendingRemovedMultilineMax.push({
      content,
      lineNumber: currentLine,
      ruleKey,
    });
  }
}

function bufferMultilineNumericThreshold(
  state: DiffState,
  content: string,
  currentLine: number,
) {
  const ruleKey = state.removedCurrentCeilingRuleKey;
  const shouldBuffer =
    state.removedRulesBraceDepth !== null &&
    ruleKey !== null &&
    state.removedExpectingCeilingThreshold &&
    isStandaloneNumericThresholdLine(content);
  if (shouldBuffer) {
    state.pendingRemovedMultilineNumericThreshold.push({
      content,
      lineNumber: currentLine,
      ruleKey,
    });
  }
}

function bufferInlineRules(
  state: DiffState,
  content: string,
  currentLine: number,
) {
  if (
    state.removedArbitraryObjectDepth !== null ||
    state.removedNonRuleContainerDepth !== null
  ) {
    return;
  }
  for (const entry of extractInlineRulesEntries(content)) {
    state.pendingRemovedInlineRules.push({
      key: entry.key,
      content: entry.content,
      lineNumber: currentLine,
    });
  }
}

function bufferRemovedRuleState(
  state: DiffState,
  content: string,
  currentLine: number,
) {
  const shouldBuffer =
    state.removedRulesBraceDepth !== null ||
    (!state.removedInsideRuleEntry && extractRuleKey(content) !== null);
  if (!shouldBuffer) {
    return;
  }
  const isStandaloneSeverity = getRemovedStandaloneSeverityFlag(state, content);
  const isStandaloneNumeric = getRemovedStandaloneNumericFlag(state, content);
  const isStandaloneMax = getRemovedStandaloneMaxFlag(state, content);
  const ruleState = buildRuleState(
    content,
    state.removedCurrentRuleKey,
    isStandaloneSeverity,
    isStandaloneNumeric,
    isStandaloneMax,
  );
  if (ruleState !== null && ruleState.ruleKey !== null) {
    const ruleKey = ruleState.ruleKey;
    state.pendingRemovedRuleState.push({
      ...ruleState,
      ruleKey,
      content,
      lineNumber: currentLine,
      consumed: false,
      severityConsumed: false,
      thresholdConsumed: false,
    });
  }
}

function getRemovedStandaloneSeverityFlag(state: DiffState, content: string) {
  const inRulesBlock = state.removedRulesBraceDepth !== null;
  const hasRuleKey = state.removedCurrentRuleKey !== null;
  const isExpecting = state.removedExpectingFirstSeverityElement;
  const isSeverityEntry =
    isMultilineArraySeverityEntry(content) ||
    isMultilineNumericSeverityEntry(content);
  return inRulesBlock && hasRuleKey && isExpecting && isSeverityEntry;
}

function getRemovedStandaloneNumericFlag(state: DiffState, content: string) {
  return (
    state.removedRulesBraceDepth !== null &&
    state.removedCurrentCeilingRuleKey !== null &&
    state.removedExpectingCeilingThreshold &&
    isStandaloneNumericThresholdLine(content)
  );
}

function getRemovedStandaloneMaxFlag(state: DiffState, content: string) {
  return (
    state.removedRulesBraceDepth !== null &&
    state.removedCurrentCeilingRuleKey !== null &&
    (isStandaloneMaxLine(content) || isObjectFormMaxLine(content))
  );
}
