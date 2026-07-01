/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CEILING_RULES,
  RULE_ID_CHARS,
  SEVERITY_RANK,
  STRUCTURAL_KEYS,
} from './constants.mjs';

export function extractRuleKey(line) {
  const match = new RegExp('^[\'"]?([' + RULE_ID_CHARS + ']+)[\'"]?\\s*:').exec(
    line.trim(),
  );
  if (match === null) {
    return null;
  }
  const key = match[1];
  if (STRUCTURAL_KEYS.has(key)) {
    return null;
  }
  return key;
}

export function extractSeverityValue(line) {
  const arrayMatch = /\[\s*['"]?(error|warn|off|2|1|0)['"]?\s*[,\]]/.exec(line);
  if (arrayMatch !== null) {
    return normalizeSeverity(arrayMatch[1]);
  }
  const colonMatch = /:\s*['"]?(error|warn|off|2|1|0)['"]?\s*[,\]}]/.exec(line);
  if (colonMatch !== null) {
    return normalizeSeverity(colonMatch[1]);
  }
  return null;
}

export function normalizeSeverity(raw) {
  switch (raw) {
    case 'error':
    case '2':
      return 'error';
    case 'warn':
    case '1':
      return 'warn';
    case 'off':
    case '0':
      return 'off';
    default:
      return null;
  }
}

export function extractThresholdValue(line, ruleKey) {
  if (!CEILING_RULES.has(ruleKey)) {
    return null;
  }
  const maxMatch = /['"]?max['"]?[ \t]*:[ \t]*(\d+)/.exec(line);
  if (maxMatch !== null) {
    return { value: Number(maxMatch[1]), form: 'max' };
  }
  const numericMatch =
    /\[[ \t]*['"]?(?:error|warn|off|2|1|0)['"]?[ \t]*,[ \t]*(\d+)[ \t]*[,\]]/.exec(
      line,
    );
  if (numericMatch !== null) {
    return { value: Number(numericMatch[1]), form: 'numeric' };
  }
  return null;
}

/**
 * Strips a trailing // line comment (outside quotes) so the remaining content
 * can be matched with anchored, non-backtracking patterns.
 */
function stripTrailingComment(line) {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

export function isMultilineArraySeverityEntry(line) {
  return /^[ \t]*['"](?:error|warn|off)['"][ \t]*(?:,[ \t]*)?$/.test(
    stripTrailingComment(line.trim()),
  );
}

export function isMultilineNumericSeverityEntry(line) {
  return /^[ \t]*(?:2|1|0)[ \t]*(?:,[ \t]*)?$/.test(
    stripTrailingComment(line.trim()),
  );
}

export function normalizeMultilineSeverity(line) {
  const stringMatch = /^[ \t]*['"](error|warn|off)['"]/.exec(line);
  if (stringMatch !== null) {
    return stringMatch[1];
  }
  const numericMatch = /^[ \t]*(2|1|0)\b/.exec(line);
  if (numericMatch !== null) {
    return normalizeSeverity(numericMatch[1]);
  }
  return null;
}

export function isStandaloneMaxLine(line) {
  return /^['"]?max['"]?[ \t]*:[ \t]*\d+[ \t]*(?:,[ \t]*)?$/.test(line.trim());
}

export function isObjectFormMaxLine(line) {
  return /^\{?[ \t]*['"]?max['"]?[ \t]*:[ \t]*\d+\b/.test(line.trim());
}

export function extractMaxValueFromStandaloneLine(line) {
  const match = /^\{?[ \t]*['"]?max['"]?[ \t]*:[ \t]*(\d+)/.exec(line.trim());
  return match !== null ? Number(match[1]) : null;
}

export function isStandaloneNumericThresholdLine(line) {
  return /^[ \t]*\d+[ \t]*(?:,[ \t]*)?$/.test(line.trim());
}

export function extractStandaloneNumericThresholdValue(line) {
  const match = /^[ \t]*(\d+)[ \t]*(?:,[ \t]*)?$/.exec(line.trim());
  return match !== null ? Number(match[1]) : null;
}

export function isStandaloneOffRuleValue(line) {
  return /^\s*(?:['"]off['"]|0),?\s*(?:\/\/.*)?$/.test(line);
}

export function isRuleOffEntry(
  line,
  insideRulesBlock,
  insideRuleEntry = false,
) {
  if (insideRuleEntry) {
    return false;
  }
  if (extractRuleKey(line) === null) {
    return false;
  }
  if (insideRulesBlock) {
    return true;
  }
  const key = extractRuleKey(line);
  if (key === null) {
    return false;
  }
  if (CEILING_RULES.has(key)) {
    return true;
  }
  return new RegExp('[\'"]\\s*[' + RULE_ID_CHARS + ']+\\s*[\'"]\\s*:').test(
    line,
  );
}

export function hasAssignmentOperator(line) {
  for (let i = 0; i < line.length; i++) {
    if (isAssignmentOperatorAt(line, i)) {
      return true;
    }
  }
  return false;
}

function isAssignmentOperatorAt(line, i) {
  if (line[i] !== '=') {
    return false;
  }
  const prev = line[i - 1];
  const next = line[i + 1];
  if (next === '=') {
    return false;
  }
  if (prev === '=' || prev === '!' || prev === '<' || prev === '>') {
    return false;
  }
  if (/[+\-*/%&|^~]/.test(prev)) {
    return false;
  }
  return true;
}

export function isRuleSeverityAssignmentShape(line) {
  if (extractRuleKey(line) === null) {
    return false;
  }
  if (extractSeverityValue(line) === null) {
    return false;
  }
  const trimmed = line.trim();
  const isStatementKeyword =
    /^(?:const|let|var|function|export|import|return|throw|if|for|while|switch|class|interface|type|enum)\b/.test(
      trimmed,
    );
  if (isStatementKeyword) {
    return false;
  }
  if (/=>/.test(line) || hasAssignmentOperator(line)) {
    return false;
  }
  return true;
}

export function buildRuleState(
  content,
  ruleKey,
  isStandaloneSeverity,
  isStandaloneNumericThreshold,
  isStandaloneMax,
) {
  const keyedRuleKey = extractRuleKey(content);
  const effectiveKey = keyedRuleKey !== null ? keyedRuleKey : ruleKey;

  let severity = null;
  let threshold = null;
  let thresholdForm = null;

  if (isStandaloneSeverity) {
    severity = normalizeMultilineSeverity(content);
  } else if (effectiveKey !== null) {
    severity = extractSeverityValue(content);
    if (effectiveKey !== null && CEILING_RULES.has(effectiveKey)) {
      const thresholdResult = extractThresholdValue(content, effectiveKey);
      if (thresholdResult !== null) {
        threshold = thresholdResult.value;
        thresholdForm = thresholdResult.form;
      }
    }
  }

  if (isStandaloneNumericThreshold) {
    threshold = extractStandaloneNumericThresholdValue(content);
    thresholdForm = 'numeric';
  }

  if (isStandaloneMax) {
    threshold = extractMaxValueFromStandaloneLine(content);
    thresholdForm = 'max';
  }

  if (effectiveKey === null && severity === null && threshold === null) {
    return null;
  }

  return { ruleKey: effectiveKey, severity, threshold, thresholdForm };
}

export function compareRuleConfigChanges(removedContentLine, addedContentLine) {
  const messages = [];

  if (
    !isRuleSeverityAssignmentShape(removedContentLine) ||
    !isRuleSeverityAssignmentShape(addedContentLine)
  ) {
    return messages;
  }

  const removedKey = extractRuleKey(removedContentLine);
  const addedKey = extractRuleKey(addedContentLine);

  if (removedKey === null || addedKey === null || removedKey !== addedKey) {
    return messages;
  }

  pushSeverityDowngrade(
    messages,
    removedContentLine,
    addedContentLine,
    addedKey,
  );
  pushThresholdChanges(
    messages,
    removedContentLine,
    addedContentLine,
    addedKey,
  );

  return messages;
}

function pushSeverityDowngrade(messages, removedLine, addedLine, ruleKey) {
  const removedSeverity = extractSeverityValue(removedLine);
  const addedSeverity = extractSeverityValue(addedLine);
  if (removedSeverity === null || addedSeverity === null) {
    return;
  }
  const removedRank = SEVERITY_RANK[removedSeverity];
  const addedRank = SEVERITY_RANK[addedSeverity];
  if (addedRank < removedRank) {
    messages.push(
      `ESLint severity downgrade for '${ruleKey}' (${removedSeverity} -> ${addedSeverity}) is forbidden by #2189.`,
    );
  }
}

function pushThresholdChanges(messages, removedLine, addedLine, ruleKey) {
  const removedThreshold = extractThresholdValue(removedLine, ruleKey);
  const addedThreshold = extractThresholdValue(addedLine, ruleKey);

  if (
    removedThreshold === null &&
    addedThreshold !== null &&
    CEILING_RULES.has(ruleKey)
  ) {
    messages.push(
      `Adding a ceiling threshold to '${ruleKey}' is forbidden by #2189; ceiling rules must not gain an explicit loose ceiling.`,
    );
  }

  if (
    removedThreshold !== null &&
    addedThreshold !== null &&
    addedThreshold.value > removedThreshold.value
  ) {
    messages.push(
      `Ceiling threshold increase for '${ruleKey}' (${removedThreshold.value} -> ${addedThreshold.value}) is forbidden by #2189.`,
    );
  }
}

export function isCompleteSingleLineRuleEntry(content) {
  if (extractRuleKey(content) === null) {
    return false;
  }
  return countDiffBracketAndBraceDelta(content) === 0;
}

export function openerExpectsFirstArrayElement(content) {
  if (countDiffBracketAndBraceDelta(content) <= 0) {
    return false;
  }
  return openerBracketExpectsElement(content);
}

/**
 * Advances the quote/escape state machine for one character. Returns
 * { quote, escaped, skip } where skip indicates the caller should not
 * process the char further (it was consumed as part of a quote/escape).
 */
function advanceQuoteEscapeState(ch, next, quote, escaped) {
  if (escaped) {
    return { quote, escaped: false, skip: true };
  }
  if (quote !== null) {
    if (ch === '\\') {
      return { quote, escaped: true, skip: true };
    }
    if (ch === quote) {
      return { quote: null, escaped: false, skip: true };
    }
    return { quote, escaped: false, skip: true };
  }
  if (ch === "'" || ch === '"' || ch === '`') {
    return { quote: ch, escaped: false, skip: true };
  }
  return { quote, escaped: false, skip: false };
}

function openerBracketExpectsElement(content) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (quote === null && ch === '/' && next === '/') {
      return false;
    }
    const step = advanceQuoteEscapeState(ch, next, quote, escaped);
    if (step.skip) {
      quote = step.quote;
      escaped = step.escaped;
      continue;
    }
    quote = step.quote;
    escaped = step.escaped;
    if (ch === '[') {
      return contentAfterBracketIsEmpty(content, i + 1);
    }
  }
  return false;
}

function contentAfterBracketIsEmpty(content, start) {
  for (let j = start; j < content.length; j++) {
    const after = content[j];
    if (after === '/' && content[j + 1] === '/') {
      return false;
    }
    if (!/\s/.test(after)) {
      return false;
    }
  }
  return true;
}

export function countDiffBracketAndBraceDelta(line) {
  let delta = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (quote === null && ch === '/' && next === '/') {
      return delta;
    }
    const step = advanceQuoteEscapeState(ch, next, quote, escaped);
    quote = step.quote;
    escaped = step.escaped;
    if (step.skip) {
      continue;
    }
    if (ch === '{' || ch === '[') {
      delta += 1;
    } else if (ch === '}' || ch === ']') {
      delta -= 1;
    }
  }

  return delta;
}
