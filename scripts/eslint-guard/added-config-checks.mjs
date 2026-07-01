/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CEILING_RULES, SEVERITY_RANK } from './constants.mjs';
import {
  buildRuleState,
  compareRuleConfigChanges,
  extractRuleKey,
  isMultilineArraySeverityEntry,
  isMultilineNumericSeverityEntry,
  isObjectFormMaxLine,
  isStandaloneMaxLine,
  isStandaloneNumericThresholdLine,
} from './rule-config.mjs';
import { extractInlineRulesEntries } from './diff-context.mjs';

function addViolation(violations, file, lineNumber, message, content) {
  violations.push({ file, lineNumber, message, content });
}

function severityDowngradeMessage(ruleKey, oldSev, newSev) {
  return (
    `ESLint severity downgrade for '${ruleKey}' ` +
    `(${oldSev} -> ${newSev}) is forbidden by #2189.`
  );
}

function thresholdAdditionMessage(ruleKey) {
  return (
    `Adding a ceiling threshold to '${ruleKey}' is forbidden by #2189; ` +
    'ceiling rules must not gain an explicit loose ceiling.'
  );
}

function thresholdIncreaseMessage(ruleKey, oldVal, newVal, context) {
  return (
    `Ceiling threshold increase for '${ruleKey}' ` +
    `(${oldVal} -> ${newVal}) in ${context} is forbidden by #2189.`
  );
}

export function checkInlineRulesEntries(state, content, currentLine, detected) {
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

function checkSingleInlineEntry(state, added, content, currentLine, detected) {
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

function isInlineOffRule(addedContent, lineContent) {
  const isOffColon = /:\s*['"]off['"]/.test(addedContent);
  const isZeroColon = /:\s*0\b/.test(addedContent);
  const isOffBracket = /\[\s*['"]off['"]/.test(addedContent);
  const isZeroBracket = /\[\s*0\b/.test(addedContent);
  const hasAllowOff = lineContent.includes('eslint-policy-allow-off:');
  const isOffValue = isOffColon || isZeroColon;
  const isBracketOff = isOffBracket || isZeroBracket;
  return (isOffValue || isBracketOff) && !hasAllowOff;
}

function consumeMatchingInline(state, added, content, currentLine, detected) {
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

function findMatchingRemovedInline(state, added) {
  for (let pi = 0; pi < state.pendingRemovedInlineRules.length; pi++) {
    if (state.pendingRemovedInlineRules[pi].key === added.key) {
      return pi;
    }
  }
  return -1;
}

function applyRemovedInlineComparison(
  state,
  removed,
  added,
  content,
  currentLine,
  detected,
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

export function getCrossFormFlags(state, content) {
  return {
    isSeverity: isCrossFormSeverity(state, content),
    isNumeric: isCrossFormNumeric(state, content),
    isMax: isCrossFormMax(state, content),
  };
}

function isCrossFormSeverity(state, content) {
  const inRulesBlock = state.rulesBraceDepth !== null;
  const hasRuleKey = state.currentRuleKey !== null;
  const isExpecting = state.expectingFirstSeverityElement;
  const isSeverityEntry =
    isMultilineArraySeverityEntry(content) ||
    isMultilineNumericSeverityEntry(content);
  return inRulesBlock && hasRuleKey && isExpecting && isSeverityEntry;
}

function isCrossFormNumeric(state, content) {
  return (
    state.rulesBraceDepth !== null &&
    state.currentCeilingRuleKey !== null &&
    state.expectingCeilingThreshold &&
    isStandaloneNumericThresholdLine(content)
  );
}

function isCrossFormMax(state, content) {
  return (
    state.rulesBraceDepth !== null &&
    state.currentCeilingRuleKey !== null &&
    (isStandaloneMaxLine(content) || isObjectFormMaxLine(content))
  );
}

export function checkCrossFormKeyedRemoved(
  state,
  content,
  currentLine,
  detected,
) {
  const flags = getCrossFormFlags(state, content);
  const addedRuleState = buildRuleState(
    content,
    state.currentRuleKey,
    flags.isSeverity,
    flags.isNumeric,
    flags.isMax,
  );
  if (shouldSkipKeyedRemoved(addedRuleState, flags)) {
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
function findMatchingRemovedKeyed(state, addedRuleState) {
  let matched = null;
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
function markMatchingRemovedKeyedConsumed(state, ruleKey) {
  for (const removed of state.pendingRemovedRuleState) {
    if (removed.ruleKey === ruleKey && !removed.consumed) {
      removed.consumed = true;
    }
  }
}

function shouldSkipKeyedRemoved(addedRuleState, flags) {
  const isNullState =
    addedRuleState === null || addedRuleState.ruleKey === null;
  const isStandaloneForm = flags.isSeverity || flags.isNumeric || flags.isMax;
  return isNullState || isStandaloneForm;
}

function shouldSkipRemovedEntry(removed, addedRuleState) {
  if (removed.consumed || removed.ruleKey !== addedRuleState.ruleKey) {
    return true;
  }
  return !(
    removed.content !== undefined && extractRuleKey(removed.content) === null
  );
}

function pushCrossFormSeverity(
  state,
  removed,
  added,
  content,
  currentLine,
  detected,
) {
  const isDowngrade =
    removed.severity !== null &&
    added.severity !== null &&
    SEVERITY_RANK[added.severity] < SEVERITY_RANK[removed.severity];
  if (isDowngrade) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      severityDowngradeMessage(added.ruleKey, removed.severity, added.severity),
      content,
    );
    detected = true;
  }
  return detected;
}

function pushCrossFormThresholdAdd(
  state,
  removed,
  added,
  content,
  currentLine,
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
  state,
  removed,
  added,
  content,
  currentLine,
) {
  const isIncrease =
    removed.threshold !== null &&
    added.threshold !== null &&
    added.threshold > removed.threshold;
  if (isIncrease) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      thresholdIncreaseMessage(
        added.ruleKey,
        removed.threshold,
        added.threshold,
        'rule config',
      ),
      content,
    );
  }
}

export function checkCrossFormStandaloneAdded(
  state,
  content,
  currentLine,
  detected,
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
  if (addedRuleState === null || addedRuleState.ruleKey === null) {
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

function findMatchingRemovedStandalone(state, addedRuleState) {
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
  state,
  removed,
  added,
  flags,
  content,
  currentLine,
  detected,
) {
  const isSeverityForm = flags.isSeverity && !removed.severityConsumed;
  const hasBothSeverities =
    removed.severity !== null && added.severity !== null;
  const isDowngrade =
    isSeverityForm &&
    hasBothSeverities &&
    SEVERITY_RANK[added.severity] < SEVERITY_RANK[removed.severity];
  if (isDowngrade) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      severityDowngradeMessage(added.ruleKey, removed.severity, added.severity),
      content,
    );
    detected = true;
  }
  return detected;
}

function checkStandaloneThreshold(
  state,
  removed,
  added,
  flags,
  content,
  currentLine,
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
  state,
  removed,
  added,
  isThresholdForm,
  content,
  currentLine,
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
  state,
  removed,
  added,
  isThresholdForm,
  content,
  currentLine,
) {
  const isFormEligible = isThresholdForm && !removed.thresholdConsumed;
  const bothThresholdsPresent =
    removed.threshold !== null && added.threshold !== null;
  const isIncreasing =
    isFormEligible &&
    bothThresholdsPresent &&
    added.threshold > removed.threshold;
  if (isIncreasing) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      thresholdIncreaseMessage(
        added.ruleKey,
        removed.threshold,
        added.threshold,
        'rule config',
      ),
      content,
    );
  }
}

function markConsumedFields(removed, flags) {
  if (flags.isSeverity) {
    removed.severityConsumed = true;
  }
  if (flags.isNumeric || flags.isMax) {
    removed.thresholdConsumed = true;
  }
}
