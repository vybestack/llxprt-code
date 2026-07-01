/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { NON_RULE_CONTAINER_KEYS, RULE_ID_CHARS } from './constants.mjs';
import {
  extractRuleKey,
  extractSeverityValue,
  hasAssignmentOperator,
} from './rule-config.mjs';

export { hasAssignmentOperator };

/**
 * Advances quote/escape state for one char. Returns { quote, escaped, skip }
 * where skip means the char is inside a string or an escape and should not be
 * treated as structural by the caller.
 */
function advanceQuoteEscape(ch, quote, escaped) {
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

export function propertyKeyRegex(key, openBrace = false) {
  const suffix = openBrace ? '\\s*:\\s*\\{' : '\\s*:';
  return new RegExp('(?:^|[^\\w])[\'"]?' + key + '[\'"]?' + suffix);
}

export function isExportDefaultConfigContext(line, matchIndex) {
  const before = line.slice(0, matchIndex);
  const exportDefaultMatch = /^export\s+default\s+/.exec(before);
  if (exportDefaultMatch === null) {
    return false;
  }
  const afterExportDefault = before.slice(exportDefaultMatch[0].length);
  if (/^[[{]/.test(afterExportDefault)) {
    return true;
  }
  return /^[$A-Za-z_][\w$]*\.config\s*\(/.test(afterExportDefault);
}

export function isRulesInArbitraryContext(line, matchIndex) {
  const before = line.slice(0, matchIndex);
  const trimmed = before.trim();
  const hasStatementKeyword =
    /(?:const|let|var|function|export|import|return|throw|if|for|while|switch|class|interface|type|enum)\s/.test(
      before,
    );
  if (hasStatementKeyword) {
    return true;
  }
  if (hasAssignmentOperator(before)) {
    return true;
  }
  if (/=>/.test(trimmed)) {
    return true;
  }
  if (isRulesNestedInNonRuleContainer(line, matchIndex)) {
    return true;
  }
  return false;
}

export function isRulesNestedInNonRuleContainer(line, matchIndex) {
  for (const key of NON_RULE_CONTAINER_KEYS) {
    if (containerKeyNestsRules(line, key, matchIndex)) {
      return true;
    }
  }
  return false;
}

function containerKeyNestsRules(line, key, matchIndex) {
  const openerPattern = propertyKeyRegex(key, true);
  let searchFrom = 0;
  for (;;) {
    const match = openerPattern.exec(line.slice(searchFrom));
    if (match === null) {
      return false;
    }
    const openerStart = searchFrom + match.index;
    if (openerStart >= matchIndex) {
      return false;
    }
    const bracePos = openerStart + match[0].length - 1;
    if (line[bracePos] !== '{') {
      searchFrom = openerStart + match[0].length;
      continue;
    }
    if (containerOpenAtPosition(line, bracePos, matchIndex)) {
      return true;
    }
    searchFrom = openerStart + match[0].length;
  }
}

export function containerOpenAtPosition(line, bracePos, targetPos) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = bracePos; i < targetPos; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (quote === null && ch === '/' && next === '/') {
      return depth > 0;
    }
    const step = advanceQuoteEscape(ch, quote, escaped);
    quote = step.quote;
    escaped = step.escaped;
    if (step.skip) {
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth <= 0) {
        return false;
      }
    }
  }
  return depth > 0;
}

export function isNonRuleContainerOpen(line) {
  for (const key of NON_RULE_CONTAINER_KEYS) {
    const pattern = propertyKeyRegex(key, true);
    const match = pattern.exec(line);
    if (match !== null && !isRulesInArbitraryContext(line, match.index)) {
      return true;
    }
  }
  return false;
}

export function isRulesBlockOpen(line) {
  const match = propertyKeyRegex('rules', true).exec(line);
  if (match === null) {
    return false;
  }
  const isArbitrary =
    isRulesInArbitraryContext(line, match.index) &&
    !isExportDefaultConfigContext(line, match.index);
  return !isArbitrary;
}

/**
 * Returns true when trimmed ends with an open brace '{' followed by content
 * that contains no closing brace '}' (equivalent to /\{[^}]*$/).
 */
function endsWithOpenBraceNoClose(trimmed) {
  const braceIdx = trimmed.lastIndexOf('{');
  if (braceIdx === -1) {
    return false;
  }
  return trimmed.indexOf('}', braceIdx) === -1;
}

export function isArbitraryObjectOpener(line) {
  const trimmed = line.trim();
  const isDeclaration = /^(?:export\s+)?(?:const|let|var)\s+/.test(trimmed);
  const hasAssign = hasAssignmentOperator(line);
  if (!isDeclaration && !hasAssign) {
    return false;
  }
  if (!/\{[ \t]*$/.test(trimmed) && !endsWithOpenBraceNoClose(trimmed)) {
    return false;
  }
  if (/\brules\s*:/.test(line)) {
    return false;
  }
  return true;
}

export function extractDirectValueAfterKey(segment) {
  const trimmed = segment.trim();
  const keyMatch = new RegExp(
    '^[\'"]?([' + RULE_ID_CHARS + ']+)[\'"]?\\s*:',
  ).exec(trimmed);
  if (keyMatch === null) {
    return null;
  }
  return trimmed.slice(keyMatch[0].length).trim();
}

/**
 * Walks from start to the matching close brace on the same line, respecting
 * nested braces/brackets and string literals.
 */
function findInlineCloseBrace(line, start) {
  let depth = 1;
  let quote = null;
  let escaped = false;
  let end = line.length;
  for (let i = start; i < line.length; i++) {
    const ch = line[i];
    const step = advanceQuoteEscape(ch, quote, escaped);
    quote = step.quote;
    escaped = step.escaped;
    if (step.skip) {
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        return end;
      }
    }
  }
  return end;
}

/**
 * Splits inline content into comma-separated segments at the top level.
 */
function splitInlineSegments(inline) {
  const segments = [];
  let segStart = 0;
  let segDepth = 0;
  let segQuote = null;
  let segEscaped = false;
  for (let i = 0; i < inline.length; i++) {
    const ch = inline[i];
    const step = advanceQuoteEscape(ch, segQuote, segEscaped);
    segQuote = step.quote;
    segEscaped = step.escaped;
    if (step.skip) {
      continue;
    }
    if (ch === '{' || ch === '[') {
      segDepth += 1;
    } else if (ch === '}' || ch === ']') {
      segDepth -= 1;
    } else if (ch === ',' && segDepth === 0) {
      segments.push(inline.slice(segStart, i));
      segStart = i + 1;
    }
  }
  segments.push(inline.slice(segStart));
  return segments;
}

export function extractInlineRulesEntries(line) {
  const openMatch = propertyKeyRegex('rules', true).exec(line);
  if (openMatch === null) {
    return [];
  }
  const isArbitrary =
    isRulesInArbitraryContext(line, openMatch.index) &&
    !isExportDefaultConfigContext(line, openMatch.index);
  if (isArbitrary) {
    return [];
  }
  const start = openMatch.index + openMatch[0].length;
  const end = findInlineCloseBrace(line, start);
  const inline = line.slice(start, end);
  const segments = splitInlineSegments(inline);
  return collectRuleEntries(segments);
}

function collectRuleEntries(segments) {
  const entries = [];
  for (const segment of segments) {
    const entry = collectSingleRuleEntry(segment);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

function collectSingleRuleEntry(segment) {
  const key = extractRuleKey(segment);
  if (key === null) {
    return null;
  }
  const directValue = extractDirectValueAfterKey(segment);
  if (directValue === null || /^\{/.test(directValue.trim())) {
    return null;
  }
  const padded = segment.trim() + ',';
  if (extractSeverityValue(padded) === null) {
    return null;
  }
  return { key, content: padded };
}

export function countDiffBraceDelta(line) {
  return countDiffBraceDeltaWithBlockState(line, false).delta;
}

export function countDiffBraceDeltaWithBlockState(line, inBlockComment) {
  let delta = 0;
  let quote = null;
  let escaped = false;
  let stillInBlockComment = inBlockComment;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    const blockResult = scanBlockCommentChar(
      ch,
      next,
      quote,
      stillInBlockComment,
    );
    if (blockResult.handled) {
      stillInBlockComment = blockResult.inBlockComment;
      if (blockResult.advanceExtra) {
        i += 1;
      }
      if (blockResult.terminated) {
        return { delta, inBlockComment: stillInBlockComment };
      }
    } else {
      const step = advanceQuoteEscape(ch, quote, escaped);
      quote = step.quote;
      escaped = step.escaped;
      delta = applyBraceDelta(ch, step.skip, delta);
    }
  }

  return { delta, inBlockComment: stillInBlockComment };
}

function applyBraceDelta(ch, skip, delta) {
  if (skip) {
    return delta;
  }
  if (ch === '{') {
    return delta + 1;
  }
  if (ch === '}') {
    return delta - 1;
  }
  return delta;
}

/**
 * Handles block-comment state transitions for countDiffBraceDeltaWithBlockState.
 * Returns { handled, inBlockComment, advanceExtra, terminated }.
 */
function scanBlockCommentChar(ch, next, quote, inBlockComment) {
  if (quote !== null) {
    return {
      handled: false,
      inBlockComment,
      advanceExtra: false,
      terminated: false,
    };
  }
  if (inBlockComment) {
    if (ch === '*' && next === '/') {
      return {
        handled: true,
        inBlockComment: false,
        advanceExtra: true,
        terminated: false,
      };
    }
    return {
      handled: true,
      inBlockComment: true,
      advanceExtra: false,
      terminated: false,
    };
  }
  if (ch === '/' && next === '*') {
    return {
      handled: true,
      inBlockComment: true,
      advanceExtra: true,
      terminated: false,
    };
  }
  if (ch === '/' && next === '/') {
    return {
      handled: true,
      inBlockComment: false,
      advanceExtra: false,
      terminated: true,
    };
  }
  return {
    handled: false,
    inBlockComment,
    advanceExtra: false,
    terminated: false,
  };
}
