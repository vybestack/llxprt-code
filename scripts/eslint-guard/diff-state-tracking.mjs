/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CEILING_RULES } from './constants.mjs';
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
} from './rule-config.mjs';
import {
  countDiffBraceDelta,
  extractInlineRulesEntries,
  isArbitraryObjectOpener,
  isNonRuleContainerOpen,
  isRulesBlockOpen,
} from './diff-context.mjs';

export function updateStructuralContext(state, content) {
  if (state.file !== 'eslint.config.js') {
    return;
  }
  updateArbitraryObjectContext(state, content);
  updateNonRuleContainerContext(state, content);
  openRulesBlockIfNeeded(state, content);
  if (state.rulesBraceDepth !== null) {
    updateRulesBlockContext(state, content);
  }
}

function openRulesBlockIfNeeded(state, content) {
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

function updateArbitraryObjectContext(state, content) {
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

function updateNonRuleContainerContext(state, content) {
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

function updateRulesBlockContext(state, content) {
  state.rulesBraceDepth += countDiffBraceDelta(content);
  if (state.rulesBraceDepth <= 0) {
    resetRulesBlockState(state);
    return;
  }
  updateRuleEntryDepth(state, content);
  updateCurrentRuleKey(state, content);
}

function resetRulesBlockState(state) {
  state.rulesBraceDepth = null;
  state.currentCeilingRuleKey = null;
  state.currentRuleKey = null;
  state.insideRuleEntry = false;
  state.expectingFirstSeverityElement = false;
  state.expectingCeilingThreshold = false;
}

function updateRuleEntryDepth(state, content) {
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

function resetRuleEntryState(state) {
  state.currentCeilingRuleKey = null;
  state.currentRuleKey = null;
  state.insideRuleEntry = false;
  state.ruleEntryDepth = null;
  state.expectingFirstSeverityElement = false;
  state.expectingCeilingThreshold = false;
}

function updateSeverityExpectation(state, content) {
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

function updateCurrentRuleKey(state, content) {
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

export function updateRemovedStructuralContext(state, content) {
  if (state.file !== 'eslint.config.js') {
    return;
  }
  updateRemovedArbitraryObjectContext(state, content);
  updateRemovedNonRuleContainerContext(state, content);
  openRemovedRulesBlockIfNeeded(state, content);
  if (state.removedRulesBraceDepth !== null) {
    updateRemovedRulesBlockContext(state, content);
  }
}

function openRemovedRulesBlockIfNeeded(state, content) {
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

function updateRemovedArbitraryObjectContext(state, content) {
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

function updateRemovedNonRuleContainerContext(state, content) {
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

function updateRemovedRulesBlockContext(state, content) {
  state.removedRulesBraceDepth += countDiffBraceDelta(content);
  if (state.removedRulesBraceDepth <= 0) {
    resetRemovedRulesBlockState(state);
    return;
  }
  updateRemovedRuleEntryDepth(state, content);
  updateRemovedCurrentRuleKey(state, content);
}

function resetRemovedRulesBlockState(state) {
  state.removedRulesBraceDepth = null;
  state.removedCurrentCeilingRuleKey = null;
  state.removedCurrentRuleKey = null;
  state.removedInsideRuleEntry = false;
  state.removedExpectingFirstSeverityElement = false;
  state.removedExpectingCeilingThreshold = false;
}

function updateRemovedRuleEntryDepth(state, content) {
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

function resetRemovedRuleEntryState(state) {
  state.removedCurrentCeilingRuleKey = null;
  state.removedCurrentRuleKey = null;
  state.removedInsideRuleEntry = false;
  state.removedRuleEntryDepth = null;
  state.removedExpectingFirstSeverityElement = false;
  state.removedExpectingCeilingThreshold = false;
}

function updateRemovedSeverityExpectation(state, content) {
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

function updateRemovedCurrentRuleKey(state, content) {
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

export function bufferRemovedConfig(state, content, currentLine) {
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

function bufferKeyedConfig(state, content, currentLine) {
  if (!state.removedInsideRuleEntry && extractRuleKey(content) !== null) {
    state.pendingRemovedConfigs.push({ content, lineNumber: currentLine });
  }
}

function bufferMultilineSeverity(state, content, currentLine) {
  const inRulesBlock = state.removedRulesBraceDepth !== null;
  const hasRuleKey = state.removedCurrentRuleKey !== null;
  const isExpecting = state.removedExpectingFirstSeverityElement;
  const isSeverityEntry =
    isMultilineArraySeverityEntry(content) ||
    isMultilineNumericSeverityEntry(content);
  const shouldBuffer =
    inRulesBlock && hasRuleKey && isExpecting && isSeverityEntry;
  if (shouldBuffer) {
    state.pendingRemovedMultilineSeverity.push({
      content,
      lineNumber: currentLine,
      ruleKey: state.removedCurrentRuleKey,
    });
  }
}

function bufferMultilineMax(state, content, currentLine) {
  const shouldBuffer =
    state.removedRulesBraceDepth !== null &&
    state.removedCurrentCeilingRuleKey !== null &&
    (isStandaloneMaxLine(content) || isObjectFormMaxLine(content));
  if (shouldBuffer) {
    state.pendingRemovedMultilineMax.push({
      content,
      lineNumber: currentLine,
      ruleKey: state.removedCurrentCeilingRuleKey,
    });
  }
}

function bufferMultilineNumericThreshold(state, content, currentLine) {
  const shouldBuffer =
    state.removedRulesBraceDepth !== null &&
    state.removedCurrentCeilingRuleKey !== null &&
    state.removedExpectingCeilingThreshold &&
    isStandaloneNumericThresholdLine(content);
  if (shouldBuffer) {
    state.pendingRemovedMultilineNumericThreshold.push({
      content,
      lineNumber: currentLine,
      ruleKey: state.removedCurrentCeilingRuleKey,
    });
  }
}

function bufferInlineRules(state, content, currentLine) {
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

function bufferRemovedRuleState(state, content, currentLine) {
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
    state.pendingRemovedRuleState.push({
      ...ruleState,
      content,
      lineNumber: currentLine,
      consumed: false,
      severityConsumed: false,
      thresholdConsumed: false,
    });
  }
}

function getRemovedStandaloneSeverityFlag(state, content) {
  const inRulesBlock = state.removedRulesBraceDepth !== null;
  const hasRuleKey = state.removedCurrentRuleKey !== null;
  const isExpecting = state.removedExpectingFirstSeverityElement;
  const isSeverityEntry =
    isMultilineArraySeverityEntry(content) ||
    isMultilineNumericSeverityEntry(content);
  return inRulesBlock && hasRuleKey && isExpecting && isSeverityEntry;
}

function getRemovedStandaloneNumericFlag(state, content) {
  return (
    state.removedRulesBraceDepth !== null &&
    state.removedCurrentCeilingRuleKey !== null &&
    state.removedExpectingCeilingThreshold &&
    isStandaloneNumericThresholdLine(content)
  );
}

function getRemovedStandaloneMaxFlag(state, content) {
  return (
    state.removedRulesBraceDepth !== null &&
    state.removedCurrentCeilingRuleKey !== null &&
    (isStandaloneMaxLine(content) || isObjectFormMaxLine(content))
  );
}
