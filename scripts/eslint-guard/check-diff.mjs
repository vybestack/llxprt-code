/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SEVERITY_RANK,
  addedContent,
  isAllowedPolicyOff,
  isNewOffRule,
  removedContent,
  startsWithAddedContent,
  startsWithRemovedContent,
} from './constants.mjs';
import {
  hasInlineEslintDirective,
  hasTypeScriptSuppressionInState,
  scanTemplateLiteralState,
  shouldCheckInlineDirective,
  shouldCheckTypeScriptSuppression,
} from './directive-scanner.mjs';
import {
  compareRuleConfigChanges,
  extractMaxValueFromStandaloneLine,
  extractRuleKey,
  extractStandaloneNumericThresholdValue,
  isMultilineArraySeverityEntry,
  isMultilineNumericSeverityEntry,
  isObjectFormMaxLine,
  isRuleOffEntry,
  isRuleSeverityAssignmentShape,
  isStandaloneMaxLine,
  isStandaloneNumericThresholdLine,
  isStandaloneOffRuleValue,
  normalizeMultilineSeverity,
} from './rule-config.mjs';
import { countDiffBraceDeltaWithBlockState } from './diff-context.mjs';
import {
  bufferRemovedConfig,
  updateRemovedStructuralContext,
  updateStructuralContext,
} from './diff-state-tracking.mjs';
import {
  checkCrossFormKeyedRemoved,
  checkCrossFormStandaloneAdded,
  checkInlineRulesEntries,
} from './added-config-checks.mjs';
import { isCommentOnlyLine } from './constants.mjs';

function addViolation(violations, file, lineNumber, message, content) {
  violations.push({ file, lineNumber, message, content });
}

export function checkDiff(diff) {
  const state = createDiffState();
  for (const line of diff.split('\n')) {
    processDiffLine(state, line);
  }
  checkPolicyState(state);
  return state.violations;
}

function createDiffState() {
  return {
    violations: [],
    policyState: {
      removedInlineDisableBan: null,
      addedInlineDisableBan: false,
      removedMaxWarnings: null,
      addedMaxWarnings: false,
    },
    file: '',
    newLine: 0,
    oldLine: 0,
    pendingRemovedConfigs: [],
    pendingRemovedRuleState: [],
    pendingRemovedMultilineSeverity: [],
    pendingRemovedMultilineMax: [],
    pendingRemovedMultilineNumericThreshold: [],
    pendingRemovedInlineRules: [],
    rulesBraceDepth: null,
    currentCeilingRuleKey: null,
    currentRuleKey: null,
    insideRuleEntry: false,
    ruleEntryDepth: null,
    expectingFirstSeverityElement: false,
    expectingCeilingThreshold: false,
    removedRulesBraceDepth: null,
    removedCurrentRuleKey: null,
    removedCurrentCeilingRuleKey: null,
    removedInsideRuleEntry: false,
    removedRuleEntryDepth: null,
    removedExpectingFirstSeverityElement: false,
    removedExpectingCeilingThreshold: false,
    arbitraryObjectDepth: null,
    removedArbitraryObjectDepth: null,
    nonRuleContainerDepth: null,
    removedNonRuleContainerDepth: null,
    hasHunkContext: false,
    removedCompletedDirectiveCleanupBlockDepth: null,
    removedCompletedDirectiveCleanupBlockInComment: false,
    templateLiteralState: { inTemplate: false, exprDepth: 0 },
  };
}

function flushPendingConfigs(state) {
  state.pendingRemovedConfigs = [];
  state.pendingRemovedRuleState = [];
  state.pendingRemovedMultilineSeverity = [];
  state.pendingRemovedMultilineMax = [];
  state.pendingRemovedMultilineNumericThreshold = [];
  state.pendingRemovedInlineRules = [];
  state.rulesBraceDepth = null;
  state.currentCeilingRuleKey = null;
  state.currentRuleKey = null;
  state.insideRuleEntry = false;
  state.ruleEntryDepth = null;
  state.expectingFirstSeverityElement = false;
  state.expectingCeilingThreshold = false;
  state.removedRulesBraceDepth = null;
  state.removedCurrentCeilingRuleKey = null;
  state.removedCurrentRuleKey = null;
  state.removedInsideRuleEntry = false;
  state.removedRuleEntryDepth = null;
  state.removedExpectingFirstSeverityElement = false;
  state.removedExpectingCeilingThreshold = false;
  state.arbitraryObjectDepth = null;
  state.removedArbitraryObjectDepth = null;
  state.nonRuleContainerDepth = null;
  state.removedNonRuleContainerDepth = null;
  state.hasHunkContext = false;
  state.removedCompletedDirectiveCleanupBlockDepth = null;
  state.removedCompletedDirectiveCleanupBlockInComment = false;
  state.templateLiteralState = { inTemplate: false, exprDepth: 0 };
}

function processDiffLine(state, line) {
  const fileMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
  if (fileMatch) {
    state.file = fileMatch[2];
    state.newLine = 0;
    state.oldLine = 0;
    flushPendingConfigs(state);
    return;
  }
  const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (hunkMatch) {
    state.oldLine = Number(hunkMatch[1]);
    state.newLine = Number(hunkMatch[2]);
    flushPendingConfigs(state);
    return;
  }
  if (!state.file) {
    return;
  }
  if (startsWithAddedContent(line)) {
    processAddedLine(state, line);
    return;
  }
  if (startsWithRemovedContent(line)) {
    processRemovedLine(state, line);
    return;
  }
  processContextLine(state, line);
}

function processContextLine(state, line) {
  if (line.startsWith('\\')) {
    return;
  }
  state.hasHunkContext = true;
  updateStructuralContext(state, line);
  updateRemovedStructuralContext(state, line);
  if (shouldCheckTypeScriptSuppression(state.file)) {
    state.templateLiteralState = scanTemplateLiteralState(
      line,
      state.templateLiteralState,
    );
  }
  state.oldLine += 1;
  state.newLine += 1;
}

function processAddedLine(state, line) {
  const content = addedContent(line);
  const currentLine = state.newLine;
  checkAddedDirectives(state, content, currentLine);
  if (state.file === 'eslint.config.js') {
    checkCliDirectiveScope(state, content, currentLine);
    processConfigAddedLine(state, content, currentLine);
  }
  processPolicyStateAdded(state, content);
  state.newLine += 1;
}

function checkAddedDirectives(state, content, currentLine) {
  if (
    shouldCheckInlineDirective(state.file) &&
    hasInlineEslintDirective(content)
  ) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      'Inline ESLint disable/enable directives are forbidden by #2079/#2080.',
      content,
    );
  }
  if (shouldCheckTypeScriptSuppression(state.file)) {
    checkAddedTsSuppression(state, content, currentLine);
  }
}

function checkAddedTsSuppression(state, content, currentLine) {
  if (hasTypeScriptSuppressionInState(content, state.templateLiteralState)) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      'TypeScript suppression directives (@ts-ignore/@ts-expect-error/@ts-nocheck) are forbidden by #2189.',
      content,
    );
  }
  state.templateLiteralState = scanTemplateLiteralState(
    content,
    state.templateLiteralState,
  );
}

function checkCliDirectiveScope(state, content, currentLine) {
  if (content.includes('packages/cli/src') && !isCommentOnlyLine(content)) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      'packages/cli directive cleanup scopes are forbidden by #2114; fix CLI code instead.',
      content,
    );
  }
}

function processPolicyStateAdded(state, content) {
  if (
    state.file === 'eslint.config.js' &&
    content.includes('eslint-comments/no-use') &&
    !content.includes("'off'") &&
    !content.includes('"off"')
  ) {
    state.policyState.addedInlineDisableBan = true;
  }
  if (state.file === 'package.json' && content.includes('--max-warnings 0')) {
    state.policyState.addedMaxWarnings = true;
  }
}

function checkPolicyState(state) {
  const ps = state.policyState;
  if (ps.removedInlineDisableBan && !ps.addedInlineDisableBan) {
    addViolation(
      state.violations,
      ps.removedInlineDisableBan.file,
      ps.removedInlineDisableBan.lineNumber,
      'Do not remove or weaken the inline-disable ban from eslint.config.js.',
      ps.removedInlineDisableBan.content,
    );
  }
  if (ps.removedMaxWarnings && !ps.addedMaxWarnings) {
    addViolation(
      state.violations,
      ps.removedMaxWarnings.file,
      ps.removedMaxWarnings.lineNumber,
      'Do not remove --max-warnings 0 from lint:ci.',
      ps.removedMaxWarnings.content,
    );
  }
}

function processConfigAddedLine(state, content, currentLine) {
  let detected = false;
  detected = checkSameKeyComparison(state, content, currentLine, detected);
  detected = checkMultilineSeverity(state, content, currentLine, detected);
  checkMultilineMaxThreshold(state, content, currentLine);
  checkMultilineNumericThreshold(state, content, currentLine);
  detected = checkInlineRulesEntries(state, content, currentLine, detected);
  detected = checkCrossFormKeyedRemoved(state, content, currentLine, detected);
  detected = checkCrossFormStandaloneAdded(
    state,
    content,
    currentLine,
    detected,
  );

  const preUpdateInsideRuleEntry = state.insideRuleEntry;
  const preUpdateExpectingFirstSeverity = state.expectingFirstSeverityElement;
  updateStructuralContext(state, content);

  checkOffPolicy(
    state,
    content,
    currentLine,
    detected,
    preUpdateInsideRuleEntry,
    preUpdateExpectingFirstSeverity,
  );
}

function checkSameKeyComparison(state, content, currentLine, detected) {
  const addedKey = extractRuleKey(content);
  if (addedKey === null || state.insideRuleEntry) {
    return detected;
  }
  const useZeroContextFallback =
    state.rulesBraceDepth === null &&
    !state.hasHunkContext &&
    isRuleSeverityAssignmentShape(content);
  const matchIndex = findMatchingRemovedConfig(
    state,
    addedKey,
    useZeroContextFallback,
  );
  if (matchIndex !== -1) {
    const removed = state.pendingRemovedConfigs[matchIndex];
    detected = applyRemovedConfigComparison(
      state,
      removed,
      content,
      currentLine,
      detected,
    );
    state.pendingRemovedConfigs.splice(matchIndex, 1);
  }
  return detected;
}

function findMatchingRemovedConfig(state, addedKey, useZeroContextFallback) {
  for (let pi = 0; pi < state.pendingRemovedConfigs.length; pi++) {
    const removed = state.pendingRemovedConfigs[pi];
    const removedKey = extractRuleKey(removed.content);
    if (removedKey !== addedKey) {
      continue;
    }
    const isEligible = isConfigMatchEligible(
      state,
      removed,
      useZeroContextFallback,
    );
    if (isEligible) {
      return pi;
    }
  }
  return -1;
}

function isConfigMatchEligible(state, removed, useZeroContextFallback) {
  if (!useZeroContextFallback && state.rulesBraceDepth === null) {
    return false;
  }
  const isZeroContextWithShape =
    state.rulesBraceDepth === null &&
    !isRuleSeverityAssignmentShape(removed.content);
  return !isZeroContextWithShape;
}

function applyRemovedConfigComparison(
  state,
  removed,
  content,
  currentLine,
  detected,
) {
  const changeMessages = compareRuleConfigChanges(removed.content, content);
  for (const msg of changeMessages) {
    addViolation(state.violations, state.file, currentLine, msg, content);
    if (msg.includes('severity downgrade')) {
      detected = true;
    }
  }
  return detected;
}

function checkMultilineSeverity(state, content, currentLine, detected) {
  const inRulesBlock = state.rulesBraceDepth !== null;
  const hasRuleKey = state.currentRuleKey !== null;
  const isExpecting = state.expectingFirstSeverityElement;
  const isSeverityEntry =
    isMultilineArraySeverityEntry(content) ||
    isMultilineNumericSeverityEntry(content);
  const hasPending = state.pendingRemovedMultilineSeverity.length > 0;
  const isRuleContext = inRulesBlock && hasRuleKey && isExpecting;
  const shouldCheck = isRuleContext && isSeverityEntry && hasPending;
  if (!shouldCheck) {
    return detected;
  }
  const addedSeverity = normalizeMultilineSeverity(content);
  for (const removed of state.pendingRemovedMultilineSeverity) {
    if (removed.ruleKey !== state.currentRuleKey) {
      continue;
    }
    const removedSeverity = normalizeMultilineSeverity(removed.content);
    const isDowngrade =
      removedSeverity !== null &&
      addedSeverity !== null &&
      SEVERITY_RANK[addedSeverity] < SEVERITY_RANK[removedSeverity];
    if (isDowngrade) {
      addViolation(
        state.violations,
        state.file,
        currentLine,
        multilineSeverityMessage(
          state.currentRuleKey,
          removedSeverity,
          addedSeverity,
        ),
        content,
      );
      detected = true;
    }
  }
  filterMultilineSeverityByRule(state);
  return detected;
}

function multilineSeverityMessage(ruleKey, removedSeverity, addedSeverity) {
  return (
    `ESLint severity downgrade for '${ruleKey}' ` +
    `(${removedSeverity} -> ${addedSeverity}) ` +
    `in multiline rule config is forbidden by #2189.`
  );
}

function filterMultilineSeverityByRule(state) {
  state.pendingRemovedMultilineSeverity =
    state.pendingRemovedMultilineSeverity.filter(
      (entry) => entry.ruleKey !== state.currentRuleKey,
    );
}

function checkMultilineMaxThreshold(state, content, currentLine) {
  const inRulesBlock = state.rulesBraceDepth !== null;
  const hasCeilingRule = state.currentCeilingRuleKey !== null;
  const isMaxLine =
    isStandaloneMaxLine(content) || isObjectFormMaxLine(content);
  const hasPending = state.pendingRemovedMultilineMax.length > 0;
  const shouldCheck = inRulesBlock && hasCeilingRule && isMaxLine && hasPending;
  if (!shouldCheck) {
    return;
  }
  const addedMaxValue = extractMaxValueFromStandaloneLine(content);
  for (const removed of state.pendingRemovedMultilineMax) {
    if (removed.ruleKey !== state.currentCeilingRuleKey) {
      continue;
    }
    const removedMaxValue = extractMaxValueFromStandaloneLine(removed.content);
    const isIncrease =
      removedMaxValue !== null &&
      addedMaxValue !== null &&
      addedMaxValue > removedMaxValue;
    if (isIncrease) {
      addViolation(
        state.violations,
        state.file,
        currentLine,
        thresholdIncreaseMessage(
          removed.ruleKey,
          removedMaxValue,
          addedMaxValue,
          'multiline rule config',
        ),
        content,
      );
    }
  }
  state.pendingRemovedMultilineMax = state.pendingRemovedMultilineMax.filter(
    (entry) => entry.ruleKey !== state.currentCeilingRuleKey,
  );
}

function checkMultilineNumericThreshold(state, content, currentLine) {
  const inRulesBlock = state.rulesBraceDepth !== null;
  const hasCeilingRule = state.currentCeilingRuleKey !== null;
  const isExpecting = state.expectingCeilingThreshold;
  const isNumericLine = isStandaloneNumericThresholdLine(content);
  const hasPending = state.pendingRemovedMultilineNumericThreshold.length > 0;
  const isRuleContext = inRulesBlock && hasCeilingRule && isExpecting;
  const shouldCheck = isRuleContext && isNumericLine && hasPending;
  if (!shouldCheck) {
    return;
  }
  const addedValue = extractStandaloneNumericThresholdValue(content);
  for (const removed of state.pendingRemovedMultilineNumericThreshold) {
    if (removed.ruleKey !== state.currentCeilingRuleKey) {
      continue;
    }
    const removedValue = extractStandaloneNumericThresholdValue(
      removed.content,
    );
    const isIncrease =
      removedValue !== null && addedValue !== null && addedValue > removedValue;
    if (isIncrease) {
      addViolation(
        state.violations,
        state.file,
        currentLine,
        thresholdIncreaseMessage(
          removed.ruleKey,
          removedValue,
          addedValue,
          'multiline numeric-array rule config',
        ),
        content,
      );
    }
  }
  filterMultilineNumericByRule(state);
}

function filterMultilineNumericByRule(state) {
  state.pendingRemovedMultilineNumericThreshold =
    state.pendingRemovedMultilineNumericThreshold.filter(
      (entry) => entry.ruleKey !== state.currentCeilingRuleKey,
    );
}

function thresholdIncreaseMessage(ruleKey, oldVal, newVal, config) {
  return (
    `Ceiling threshold increase for '${ruleKey}' ` +
    `(${oldVal} -> ${newVal}) in ${config} ` +
    `is forbidden by #2189.`
  );
}

function checkOffPolicy(
  state,
  content,
  currentLine,
  severityDowngradeDetected,
  preUpdateInsideRuleEntry,
  preUpdateExpectingFirstSeverity,
) {
  const isNewOffPolicyEntry =
    isNewOffRule(content) ||
    (state.rulesBraceDepth !== null &&
      preUpdateExpectingFirstSeverity &&
      isStandaloneOffRuleValue(content));
  const offZeroContextEligible =
    !state.hasHunkContext &&
    isRuleSeverityAssignmentShape(content) &&
    !isCommentOnlyLine(content);
  const isRuleSeverityOffShape = computeRuleSeverityOffShape(
    state,
    content,
    offZeroContextEligible,
    preUpdateInsideRuleEntry,
    preUpdateExpectingFirstSeverity,
  );
  const isComment = isCommentOnlyLine(content);
  const isAllowed = isAllowedPolicyOff(content);
  const isNotExcluded = !isComment && !isAllowed && !severityDowngradeDetected;
  const isOffPolicyViolation =
    isNewOffPolicyEntry && isNotExcluded && isRuleSeverityOffShape;
  if (isOffPolicyViolation) {
    addViolation(
      state.violations,
      state.file,
      currentLine,
      'New ESLint off/0 entries must be explicitly justified with eslint-policy-allow-off.',
      content,
    );
  }
}

function computeRuleSeverityOffShape(
  state,
  content,
  offZeroContextEligible,
  preUpdateInsideRuleEntry,
  preUpdateExpectingFirstSeverity,
) {
  if (state.rulesBraceDepth !== null) {
    const isOffEntry = isRuleOffEntry(content, true, preUpdateInsideRuleEntry);
    const isStandaloneOff =
      preUpdateExpectingFirstSeverity && isStandaloneOffRuleValue(content);
    return isOffEntry || isStandaloneOff;
  }
  return (
    offZeroContextEligible &&
    isRuleOffEntry(content, false, preUpdateInsideRuleEntry)
  );
}

function processRemovedLine(state, line) {
  const content = removedContent(line);
  const currentLine = state.oldLine;

  bufferRemovedConfig(state, content, currentLine);
  processRemovedDirectiveCleanupBlock(state, content);

  const removedFromCompletedBlock =
    state.removedCompletedDirectiveCleanupBlockDepth !== null;
  checkRemovedInlineDisableBan(
    state,
    content,
    currentLine,
    removedFromCompletedBlock,
  );
  checkRemovedMaxWarnings(state, content, currentLine);
  updateRemovedDirectiveCleanupBlockDepth(state, content);

  state.oldLine += 1;
}

function checkRemovedInlineDisableBan(
  state,
  content,
  currentLine,
  fromCompletedBlock,
) {
  const isEslintConfig = state.file === 'eslint.config.js';
  const hasNoUse = content.includes('eslint-comments/no-use');
  const isNotOff = !content.includes("'off'") && !content.includes('"off"');
  const isNotComment = !isCommentOnlyLine(content);
  const isNotFromCompleted = !fromCompletedBlock;
  const isNotExcluded = isNotOff && isNotComment && isNotFromCompleted;
  const shouldRecord = isEslintConfig && hasNoUse && isNotExcluded;
  if (shouldRecord) {
    state.policyState.removedInlineDisableBan = {
      file: state.file,
      lineNumber: currentLine,
      content,
    };
  }
}

function checkRemovedMaxWarnings(state, content, currentLine) {
  if (state.file === 'package.json' && content.includes('--max-warnings 0')) {
    state.policyState.removedMaxWarnings = {
      file: state.file,
      lineNumber: currentLine,
      content,
    };
  }
}

function processRemovedDirectiveCleanupBlock(state, content) {
  if (
    state.file === 'eslint.config.js' &&
    content.includes('files: completedDirectiveCleanupScopes')
  ) {
    const braceScan = countDiffBraceDeltaWithBlockState(content, false);
    state.removedCompletedDirectiveCleanupBlockDepth = 1 + braceScan.delta;
    state.removedCompletedDirectiveCleanupBlockInComment =
      braceScan.inBlockComment;
  }
}

function updateRemovedDirectiveCleanupBlockDepth(state, content) {
  if (state.removedCompletedDirectiveCleanupBlockDepth === null) {
    return;
  }
  const braceScan = countDiffBraceDeltaWithBlockState(
    content,
    state.removedCompletedDirectiveCleanupBlockInComment,
  );
  state.removedCompletedDirectiveCleanupBlockInComment =
    braceScan.inBlockComment;
  state.removedCompletedDirectiveCleanupBlockDepth += braceScan.delta;
  if (state.removedCompletedDirectiveCleanupBlockDepth <= 0) {
    state.removedCompletedDirectiveCleanupBlockDepth = null;
    state.removedCompletedDirectiveCleanupBlockInComment = false;
  }
}
