/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CEILING_RULES, SEVERITY_RANK } from './constants.ts';
import {
  buildRuleState,
  compareRuleConfigChanges,
  extractRuleKey,
  isMultilineArraySeverityEntry,
  isMultilineNumericSeverityEntry,
  isObjectFormMaxLine,
  isStandaloneMaxLine,
  isStandaloneNumericThresholdLine,
} from './rule-config.ts';
import { extractInlineRulesEntries } from './diff-context.ts';
import type {
  CrossFormFlags,
  DiffState,
  RemovedRuleState,
  RuleState,
  Violation,
} from './types.ts';

type KeyedRuleState = RuleState & { ruleKey: string };

function hasRuleKey(ruleState: RuleState | null): ruleState is KeyedRuleState {
  return ruleState !== null && ruleState.ruleKey !== null;
}

function addViolation(
  violations: Violation[],
  file: string,
  lineNumber: number,
  message: string,
  content: string,
) {
  violations.push({ file, lineNumber, message, content });
}

function severityDowngradeMessage(
  ruleKey: string,
  oldSev: string | number,
  newSev: string | number,
) {
  return (
    `ESLint severity downgrade for '${ruleKey}' ` +
    `(${oldSev} -> ${newSev}) is forbidden by #2189.`
  );
}

function thresholdAdditionMessage(ruleKey: string) {
  return (
    `Adding a ceiling threshold to '${ruleKey}' is forbidden by #2189; ` +
    'ceiling rules must not gain an explicit loose ceiling.'
  );
}

function thresholdIncreaseMessage(
  ruleKey: string,
  oldVal: number,
  newVal: number,
  context: string,
) {
  return (
    `Ceiling threshold increase for '${ruleKey}' ` +
    `(${oldVal} -> ${newVal}) in ${context} is forbidden by #2189.`
  );
}

export function checkInlineRulesEntries(
  state: DiffState,
  content: string,
  currentLine: number,
  detected: boolean,
) {
  const addedInlineEntries =
    state.arbitraryObjectDepth === null && state.nonRuleContainerDepth === null
      ? extractInlineRulesEntries(content)
      : [];
  if (addedInlineEntries.length === 0) {
    return detected;
  }
  for (const added of addedInlineEntries) {
    detected = checkSingleInlineEntry(
      state,
      added,
      content,
      currentLine,
      detected,
    );
  }
  return detected;
}

function checkSingleInlineEntry(
  state: DiffState,
  added: { key: string; content: string },
  content: string,
  currentLine: number,
  detected: boolean,
) {
  if (isInlineOffRule(added.content, content)) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      'New ESLint off/0 entries must be explicitly justified with eslint-policy-allow-off.',
      content,
    );
    detected = true;
  }
  return consumeMatchingInline(state, added, content, currentLine, detected);
}

function isInlineOffRule(addedContent: string, lineContent: string) {
  const isOffColon = /:\s*['"]off['"]/.test(addedContent);
  const isZeroColon = /:\s*0\b/.test(addedContent);
  const isOffBracket = /\[\s*['"]off['"]/.test(addedContent);
  const isZeroBracket = /\[\s*0\b/.test(addedContent);
  const hasAllowOff = lineContent.includes('eslint-policy-allow-off:');
  const isOffValue = isOffColon || isZeroColon;
  const isBracketOff = isOffBracket || isZeroBracket;
  return (isOffValue || isBracketOff) && !hasAllowOff;
}

function consumeMatchingInline(
  state: DiffState,
  added: { key: string; content: string },
  content: string,
  currentLine: number,
  detected: boolean,
) {
  const matchIndex = findMatchingRemovedInline(state, added);
  if (matchIndex !== -1) {
    const removed = state.pendingRemovedInlineRules[matchIndex];
    detected = applyRemovedInlineComparison(
      state,
      removed,
      added,
      content,
      currentLine,
      detected,
    );
    state.pendingRemovedInlineRules.splice(matchIndex, 1);
  }
  return detected;
}

function findMatchingRemovedInline(
  state: DiffState,
  added: { key: string; content: string },
) {
  for (let pi = 0; pi < state.pendingRemovedInlineRules.length; pi++) {
    if (state.pendingRemovedInlineRules[pi].key === added.key) {
      return pi;
    }
  }
  return -1;
}

function applyRemovedInlineComparison(
  state: DiffState,
  removed: { key: string; content: string },
  added: { key: string; content: string },
  content: string,
  currentLine: number,
  detected: boolean,
) {
  const msgs = compareRuleConfigChanges(removed.content, added.content);
  for (const msg of msgs) {
    addViolation(state.violations, state.file, currentLine, msg, content);
    if (msg.includes('severity downgrade')) {
      detected = true;
    }
  }
  return detected;
}

export function getCrossFormFlags(
  state: DiffState,
  content: string,
): CrossFormFlags {
  return {
    isSeverity: isCrossFormSeverity(state, content),
    isNumeric: isCrossFormNumeric(state, content),
    isMax: isCrossFormMax(state, content),
  };
}

function isCrossFormSeverity(state: DiffState, content: string) {
  const inRulesBlock = state.rulesBraceDepth !== null;
  const hasRuleKey = state.currentRuleKey !== null;
  const isExpecting = state.expectingFirstSeverityElement;
  const isSeverityEntry =
    isMultilineArraySeverityEntry(content) ||
    isMultilineNumericSeverityEntry(content);
  return inRulesBlock && hasRuleKey && isExpecting && isSeverityEntry;
}

function isCrossFormNumeric(state: DiffState, content: string) {
  return (
    state.rulesBraceDepth !== null &&
    state.currentCeilingRuleKey !== null &&
    state.expectingCeilingThreshold &&
    isStandaloneNumericThresholdLine(content)
  );
}

function isCrossFormMax(state: DiffState, content: string) {
  return (
    state.rulesBraceDepth !== null &&
    state.currentCeilingRuleKey !== null &&
    (isStandaloneMaxLine(content) || isObjectFormMaxLine(content))
  );
}

export function checkCrossFormKeyedRemoved(
  state: DiffState,
  content: string,
  currentLine: number,
  detected: boolean,
) {
  const flags = getCrossFormFlags(state, content);
  const addedRuleState = buildRuleState(
    content,
    state.currentRuleKey,
    flags.isSeverity,
    flags.isNumeric,
    flags.isMax,
  );
  const isStandaloneForm = flags.isSeverity || flags.isNumeric || flags.isMax;
  if (isStandaloneForm || !hasRuleKey(addedRuleState)) {
    return detected;
  }
  const removed = findMatchingRemovedKeyed(state, addedRuleState);
  if (removed !== null) {
    detected = pushCrossFormSeverity(
      state,
      removed,
      addedRuleState,
      content,
      currentLine,
      detected,
    );
    pushCrossFormThresholdAdd(
      state,
      removed,
      addedRuleState,
      content,
      currentLine,
    );
    pushCrossFormThresholdInc(
      state,
      removed,
      addedRuleState,
      content,
      currentLine,
    );
    markMatchingRemovedKeyedConsumed(state, addedRuleState.ruleKey);
  }
  return detected;
}

/**
 * Finds and aggregates removed rule state for the same rule key as the added
 * entry. For multiline ceiling rules, severity and threshold are buffered as
 * separate entries; without aggregation, comparing against only the first
 * (severity-only) entry would falsely report a threshold addition.
 */
function findMatchingRemovedKeyed(
  state: DiffState,
  addedRuleState: KeyedRuleState,
) {
  let matched: RemovedRuleState | null = null;
  for (const removed of state.pendingRemovedRuleState) {
    if (shouldSkipRemovedEntry(removed, addedRuleState)) {
      continue;
    }
    if (matched === null) {
      matched = { ...removed, consumed: removed.consumed };
    } else {
      // Merge severity/threshold from separate multiline entries.
      if (matched.severity === null && removed.severity !== null) {
        matched.severity = removed.severity;
      }
      if (matched.threshold === null && removed.threshold !== null) {
        matched.threshold = removed.threshold;
        matched.thresholdForm = removed.thresholdForm;
      }
    }
  }
  return matched;
}

/**
 * Marks all removed entries with the same rule key as consumed so a subsequent
 * added entry for a different rule does not re-match them.
 */
function markMatchingRemovedKeyedConsumed(state: DiffState, ruleKey: string) {
  for (const removed of state.pendingRemovedRuleState) {
    if (removed.ruleKey === ruleKey && !removed.consumed) {
      removed.consumed = true;
    }
  }
}

function shouldSkipRemovedEntry(
  removed: RemovedRuleState,
  addedRuleState: KeyedRuleState,
) {
  if (removed.consumed || removed.ruleKey !== addedRuleState.ruleKey) {
    return true;
  }
  return !(
    removed.content !== undefined && extractRuleKey(removed.content) === null
  );
}

function pushCrossFormSeverity(
  state: DiffState,
  removed: RemovedRuleState,
  added: KeyedRuleState,
  content: string,
  currentLine: number,
  detected: boolean,
) {
  const removedSeverity = removed.severity;
  const addedSeverity = added.severity;
  if (
    removedSeverity !== null &&
    addedSeverity !== null &&
    SEVERITY_RANK[addedSeverity] < SEVERITY_RANK[removedSeverity]
  ) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      severityDowngradeMessage(added.ruleKey, removedSeverity, addedSeverity),
      content,
    );
    detected = true;
  }
  return detected;
}

function pushCrossFormThresholdAdd(
  state: DiffState,
  removed: RemovedRuleState,
  added: KeyedRuleState,
  content: string,
  currentLine: number,
) {
  const isAddition =
    removed.threshold === null &&
    added.threshold !== null &&
    CEILING_RULES.has(added.ruleKey) &&
    removed.severity !== null;
  if (isAddition) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      thresholdAdditionMessage(added.ruleKey),
      content,
    );
  }
}

function pushCrossFormThresholdInc(
  state: DiffState,
  removed: RemovedRuleState,
  added: KeyedRuleState,
  content: string,
  currentLine: number,
) {
  const removedThreshold = removed.threshold;
  const addedThreshold = added.threshold;
  if (
    removedThreshold !== null &&
    addedThreshold !== null &&
    addedThreshold > removedThreshold
  ) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      thresholdIncreaseMessage(
        added.ruleKey,
        removedThreshold,
        addedThreshold,
        'rule config',
      ),
      content,
    );
  }
}

export function checkCrossFormStandaloneAdded(
  state: DiffState,
  content: string,
  currentLine: number,
  detected: boolean,
) {
  const flags = getCrossFormFlags(state, content);
  const isStandaloneAdded = flags.isSeverity || flags.isNumeric || flags.isMax;
  if (!isStandaloneAdded) {
    return detected;
  }
  const addedRuleState = buildRuleState(
    content,
    state.currentRuleKey,
    flags.isSeverity,
    flags.isNumeric,
    flags.isMax,
  );
  if (!hasRuleKey(addedRuleState)) {
    return detected;
  }
  const removed = findMatchingRemovedStandalone(state, addedRuleState);
  if (removed !== null) {
    detected = checkStandaloneSeverity(
      state,
      removed,
      addedRuleState,
      flags,
      content,
      currentLine,
      detected,
    );
    checkStandaloneThreshold(
      state,
      removed,
      addedRuleState,
      flags,
      content,
      currentLine,
    );
    markConsumedFields(removed, flags);
  }
  return detected;
}

function findMatchingRemovedStandalone(
  state: DiffState,
  addedRuleState: KeyedRuleState,
) {
  for (const removed of state.pendingRemovedRuleState) {
    const isSameKey = removed.ruleKey === addedRuleState.ruleKey;
    const hasUnconsumedKey =
      removed.content !== undefined && extractRuleKey(removed.content) !== null;
    if (isSameKey && hasUnconsumedKey) {
      return removed;
    }
  }
  return null;
}

function checkStandaloneSeverity(
  state: DiffState,
  removed: RemovedRuleState,
  added: KeyedRuleState,
  flags: CrossFormFlags,
  content: string,
  currentLine: number,
  detected: boolean,
) {
  const removedSeverity = removed.severity;
  const addedSeverity = added.severity;
  if (!flags.isSeverity || removed.severityConsumed) {
    return detected;
  }
  if (
    removedSeverity !== null &&
    addedSeverity !== null &&
    SEVERITY_RANK[addedSeverity] < SEVERITY_RANK[removedSeverity]
  ) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      severityDowngradeMessage(added.ruleKey, removedSeverity, addedSeverity),
      content,
    );
    detected = true;
  }
  return detected;
}

function checkStandaloneThreshold(
  state: DiffState,
  removed: RemovedRuleState,
  added: KeyedRuleState,
  flags: CrossFormFlags,
  content: string,
  currentLine: number,
) {
  const isThresholdForm = flags.isNumeric || flags.isMax;
  checkThresholdAddition(
    state,
    removed,
    added,
    isThresholdForm,
    content,
    currentLine,
  );
  checkThresholdIncrease(
    state,
    removed,
    added,
    isThresholdForm,
    content,
    currentLine,
  );
}

function checkThresholdAddition(
  state: DiffState,
  removed: RemovedRuleState,
  added: KeyedRuleState,
  isThresholdForm: boolean,
  content: string,
  currentLine: number,
) {
  const isFormEligible = isThresholdForm && !removed.thresholdConsumed;
  const isCeilingRuleWithSeverity =
    CEILING_RULES.has(added.ruleKey) && removed.severity !== null;
  const isAddingThreshold =
    isFormEligible &&
    removed.threshold === null &&
    added.threshold !== null &&
    isCeilingRuleWithSeverity;
  if (isAddingThreshold) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      thresholdAdditionMessage(added.ruleKey),
      content,
    );
  }
}

function checkThresholdIncrease(
  state: DiffState,
  removed: RemovedRuleState,
  added: KeyedRuleState,
  isThresholdForm: boolean,
  content: string,
  currentLine: number,
) {
  const isFormEligible = isThresholdForm && !removed.thresholdConsumed;
  const removedThreshold = removed.threshold;
  const addedThreshold = added.threshold;
  if (
    isFormEligible &&
    removedThreshold !== null &&
    addedThreshold !== null &&
    addedThreshold > removedThreshold
  ) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      thresholdIncreaseMessage(
        added.ruleKey,
        removedThreshold,
        addedThreshold,
        'rule config',
      ),
      content,
    );
  }
}

function markConsumedFields(removed: RemovedRuleState, flags: CrossFormFlags) {
  if (flags.isSeverity) {
    removed.severityConsumed = true;
  }
  if (flags.isNumeric || flags.isMax) {
    removed.thresholdConsumed = true;
  }
}
