/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DIRECTIVE_PATTERN,
  TS_SUPPRESSION_START_PATTERN,
} from './constants.mjs';

export function shouldCheckInlineDirective(file) {
  if (
    file === 'scripts/check-eslint-guard.js' ||
    file === 'scripts/tests/eslint-guard.test.js'
  ) {
    return false;
  }
  return /\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(file);
}

export function shouldCheckTypeScriptSuppression(file) {
  return /\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(file);
}

export function previousCodeChar(line, index) {
  for (let i = index - 1; i >= 0; i--) {
    const ch = line[i];
    if (!/\s/.test(ch)) {
      return ch;
    }
  }
  return '';
}

export function canStartRegex(line, index) {
  const previous = previousCodeChar(line, index);
  return previous === '' || /[({[=,:;!&|?+\-*%^~<>]/.test(previous);
}

export function skipQuoted(line, start, quote) {
  for (let i = start + 1; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === quote) {
      return i;
    }
  }
  return line.length;
}

export function skipRegex(line, start) {
  let inCharacterClass = false;
  for (let i = start + 1; i < line.length; i++) {
    const ch = line[i];
    const result = scanRegexChar(ch, inCharacterClass);
    if (result.foundSlash) {
      return i;
    }
    if (result.skipNext) {
      i += 1;
    }
    inCharacterClass = result.inCharacterClass;
  }
  return line.length;
}

function scanRegexChar(ch, inCharacterClass) {
  if (ch === '\\') {
    return { foundSlash: false, inCharacterClass, skipNext: true };
  }
  if (ch === '[') {
    return { foundSlash: false, inCharacterClass: true, skipNext: false };
  }
  if (ch === ']') {
    return { foundSlash: false, inCharacterClass: false, skipNext: false };
  }
  if (ch === '/' && !inCharacterClass) {
    return { foundSlash: true, inCharacterClass, skipNext: false };
  }
  return { foundSlash: false, inCharacterClass, skipNext: false };
}

/**
 * Scans for the closing backtick of a nested template literal inside a
 * template ${ ... } expression, tracking nested ${}, quotes, and braces.
 * Returns the index past the closing backtick, or the content length if
 * unclosed. Used by all three state machines to skip nested templates.
 */
function findNestedTemplateEnd(content, start) {
  let i = start;
  let nExpr = 0;
  let nQuote = null;
  let nEscaped = false;
  while (i < content.length) {
    const nch = content[i];
    const nnext = content[i + 1];
    const step = scanNestedTemplateChar(nch, nnext, nQuote, nEscaped, nExpr);
    if (step.done) {
      return i + 1;
    }
    nExpr = step.nExpr;
    nQuote = step.nQuote;
    nEscaped = step.nEscaped;
    i += step.advance;
  }
  return i;
}

function scanNestedTemplateChar(nch, nnext, nQuote, nEscaped, nExpr) {
  if (nEscaped) {
    return { done: false, nExpr, nQuote, nEscaped: false, advance: 1 };
  }
  if (nch === '\\') {
    return { done: false, nExpr, nQuote, nEscaped: true, advance: 1 };
  }
  if (nQuote !== null) {
    return {
      done: false,
      nExpr,
      nQuote: nch === nQuote ? null : nQuote,
      nEscaped: false,
      advance: 1,
    };
  }
  if (nch === '"' || nch === "'") {
    return { done: false, nExpr, nQuote: nch, nEscaped: false, advance: 1 };
  }
  if (nch === '$' && nnext === '{') {
    return {
      done: false,
      nExpr: nExpr + 1,
      nQuote,
      nEscaped: false,
      advance: 2,
    };
  }
  if (nch === '{') {
    return {
      done: false,
      nExpr: nExpr + 1,
      nQuote,
      nEscaped: false,
      advance: 1,
    };
  }
  if (nch === '}' && nExpr > 0) {
    return {
      done: false,
      nExpr: nExpr - 1,
      nQuote,
      nEscaped: false,
      advance: 1,
    };
  }
  if (nch === '`' && nExpr === 0) {
    return { done: true, nExpr, nQuote, nEscaped: false, advance: 1 };
  }
  return { done: false, nExpr, nQuote, nEscaped: false, advance: 1 };
}

/**
 * Checks a line comment (//) for a directive pattern. Returns true when
 * the pattern matches the comment text after the marker.
 */
function lineCommentMatches(line, markerIndex, pattern) {
  return pattern.test(line.slice(markerIndex + 2));
}

/**
 * Checks a block comment opener (/*) for a directive pattern. Returns:
 * - 'FOUND' when the pattern matches inside the block comment
 * - 'END' when the block comment is unclosed (consumes the rest of line)
 * - 'CONTINUE' with the index past the block comment when it closes
 */
function blockCommentCheck(line, startIndex, pattern) {
  const end = line.indexOf('*/', startIndex + 2);
  const comment = line.slice(startIndex + 2, end === -1 ? undefined : end);
  if (pattern.test(comment)) {
    return { result: 'FOUND' };
  }
  if (end === -1) {
    return { result: 'END' };
  }
  return { result: 'CONTINUE', nextIndex: end + 2 };
}

/**
 * Normalizes the incoming state parameter to { inTemplate, exprDepth }.
 */
function normalizeIncomingState(incoming) {
  if (typeof incoming === 'boolean') {
    return { inTemplate: incoming, exprDepth: 0 };
  }
  return incoming;
}

export function hasInlineEslintDirective(line) {
  return scanLineForDirective(line, DIRECTIVE_PATTERN);
}

export function hasTypeScriptSuppression(line) {
  return scanLineForDirective(line, TS_SUPPRESSION_START_PATTERN);
}

/**
 * Non-state scanner: scans a line for a directive pattern in comments,
 * skipping over quoted strings and regex literals.
 */
function scanLineForDirective(line, pattern) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipQuoted(line, i, ch);
      continue;
    }
    const commentResult = checkCommentMarker(line, i, ch, pattern);
    if (commentResult.terminal !== null) {
      return commentResult.terminal;
    }
    if (commentResult.skipTo !== null) {
      i = commentResult.skipTo;
    }
  }
  return false;
}

function checkCommentMarker(line, i, ch, pattern) {
  if (ch !== '/') {
    return { terminal: null, skipTo: null };
  }
  const next = line[i + 1];
  if (next === '/') {
    return { terminal: pattern.test(line.slice(i + 2)), skipTo: null };
  }
  if (next === '*') {
    return checkBlockCommentMarker(line, i, pattern);
  }
  if (canStartRegex(line, i)) {
    return { terminal: null, skipTo: skipRegex(line, i) };
  }
  return { terminal: null, skipTo: null };
}

function checkBlockCommentMarker(line, i, pattern) {
  const end = line.indexOf('*/', i + 2);
  const comment = line.slice(i + 2, end === -1 ? undefined : end);
  if (pattern.test(comment)) {
    return { terminal: true, skipTo: null };
  }
  if (end === -1) {
    return { terminal: false, skipTo: null };
  }
  return { terminal: null, skipTo: end + 1 };
}

/**
 * Template-aware counterpart to hasInlineEslintDirective. Directive text inside
 * template literal text is inert, while comments in normal code or template
 * expressions are still reported.
 */
export function hasInlineEslintDirectiveInState(line, incoming) {
  return scanLineForDirectiveInState(line, DIRECTIVE_PATTERN, incoming, false);
}

/**
 * Template-aware counterpart to hasTypeScriptSuppression. Scans for a real
 * TypeScript suppression directive in executable code, given the template
 * literal state at the start of the line.
 */
export function hasTypeScriptSuppressionInState(line, incoming) {
  return scanLineForDirectiveInState(
    line,
    TS_SUPPRESSION_START_PATTERN,
    incoming,
    true,
  );
}

/**
 * Unified template-aware directive scanner. Scans for a directive pattern in
 * executable code, tracking template-literal state. When trackBraces is true,
 * bare { and } inside template expressions adjust exprDepth.
 * Returns true if the pattern is found in a comment, false otherwise.
 */
function scanLineForDirectiveInState(line, pattern, incoming, trackBraces) {
  const initialState = normalizeIncomingState(incoming);
  let state = {
    inTemplate: initialState.inTemplate,
    exprDepth: initialState.exprDepth,
    quote: null,
    escaped: false,
  };

  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];
    const step = advanceDirectiveScanner(
      line,
      i,
      ch,
      next,
      pattern,
      state,
      trackBraces,
    );
    if (step.terminal !== null) {
      return step.terminal;
    }
    state = step.state;
    i = step.advance !== null ? step.advance : i + 1;
  }
  return false;
}

/**
 * Processes one character of the directive state scanner. Returns
 * { terminal, state, advance } where terminal is a boolean when a definitive
 * answer is found (null otherwise), state is the updated scanner state, and
 * advance is the explicit new index (null means i+1).
 */
function advanceDirectiveScanner(
  line,
  i,
  ch,
  next,
  pattern,
  state,
  trackBraces,
) {
  if (state.escaped) {
    return {
      terminal: null,
      state: { ...state, escaped: false },
      advance: null,
    };
  }
  if (ch === '\\') {
    return {
      terminal: null,
      state: { ...state, escaped: true },
      advance: null,
    };
  }
  if (state.quote !== null) {
    const newQuote = ch === state.quote ? null : state.quote;
    return {
      terminal: null,
      state: { ...state, quote: newQuote },
      advance: null,
    };
  }

  const inExecutable = !state.inTemplate || state.exprDepth > 0;
  const execResult = tryExecutableScan(
    line,
    i,
    ch,
    next,
    pattern,
    state,
    inExecutable,
  );
  if (execResult.handled) {
    return execResult.result;
  }

  return scanTemplateStructure(line, i, ch, next, state, trackBraces);
}

function tryExecutableScan(line, i, ch, next, pattern, state, inExecutable) {
  if (!inExecutable) {
    return { handled: false };
  }
  if (ch === '/' && next === '/') {
    return {
      handled: true,
      result: {
        terminal: lineCommentMatches(line, i, pattern),
        state,
        advance: null,
      },
    };
  }
  if (ch === '/' && next === '*') {
    return {
      handled: true,
      result: scanStateBlockComment(line, i, pattern, state),
    };
  }
  if (!state.inTemplate && ch === '/' && canStartRegex(line, i)) {
    return {
      handled: true,
      result: { terminal: null, state, advance: skipRegex(line, i) },
    };
  }
  if (ch === '"' || ch === "'") {
    return {
      handled: true,
      result: { terminal: null, state: { ...state, quote: ch }, advance: null },
    };
  }
  return { handled: false };
}

function scanStateBlockComment(line, i, pattern, state) {
  const block = blockCommentCheck(line, i, pattern);
  if (block.result === 'FOUND') {
    return { terminal: true, state, advance: null };
  }
  if (block.result === 'END') {
    return { terminal: false, state, advance: null };
  }
  return { terminal: null, state, advance: block.nextIndex };
}

/**
 * Handles non-executable structural characters: backtick toggles template
 * state, ${ opens an expression, } closes one. When trackBraces is true,
 * bare { also increments depth inside expressions.
 */
function scanTemplateStructure(line, i, ch, next, state, trackBraces) {
  if (!state.inTemplate) {
    return scanOutsideTemplateChar(ch, state);
  }
  if (state.exprDepth === 0) {
    return scanTemplateTextChar(ch, next, state);
  }
  return scanTemplateExprChar(line, i, ch, next, state, trackBraces);
}

function scanOutsideTemplateChar(ch, state) {
  if (ch === '`') {
    return {
      terminal: null,
      state: { ...state, inTemplate: true, exprDepth: 0 },
      advance: null,
    };
  }
  return { terminal: null, state, advance: null };
}

function scanTemplateTextChar(ch, next, state) {
  if (ch === '$' && next === '{') {
    return {
      terminal: null,
      state: { ...state, exprDepth: state.exprDepth + 1 },
      advance: null,
    };
  }
  if (ch === '`') {
    return {
      terminal: null,
      state: { ...state, inTemplate: false },
      advance: null,
    };
  }
  return { terminal: null, state, advance: null };
}

function scanTemplateExprChar(line, i, ch, next, state, trackBraces) {
  if (ch === '`') {
    return {
      terminal: null,
      state,
      advance: findNestedTemplateEnd(line, i + 1),
    };
  }
  if (ch === '$' && next === '{') {
    return {
      terminal: null,
      state: { ...state, exprDepth: state.exprDepth + 1 },
      advance: null,
    };
  }
  if (ch === '{' && trackBraces) {
    return {
      terminal: null,
      state: { ...state, exprDepth: state.exprDepth + 1 },
      advance: null,
    };
  }
  if (ch === '}') {
    return {
      terminal: null,
      state: {
        ...state,
        exprDepth: state.exprDepth > 0 ? state.exprDepth - 1 : 0,
      },
      advance: null,
    };
  }
  return { terminal: null, state, advance: null };
}

/**
 * Tracks template literal state across diff lines so the guard can tell whether
 * an added line starts inside template literal TEXT or inside a template
 * ${ ... } EXPRESSION.
 */
export function scanTemplateLiteralState(content, incoming) {
  const initialState = normalizeIncomingState(incoming);
  let state = {
    inTemplate: initialState.inTemplate,
    exprDepth: initialState.exprDepth,
    quote: null,
    escaped: false,
  };

  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];
    const step = advanceTemplateLoopBody(content, i, ch, next, state);
    if (step.terminal !== null) {
      return step.terminal;
    }
    state = step.state;
    i = step.advance;
  }

  return { inTemplate: state.inTemplate, exprDepth: state.exprDepth };
}

function advanceTemplateLoopBody(content, i, ch, next, state) {
  if (state.escaped) {
    return {
      state: { ...state, escaped: false },
      advance: i + 1,
      terminal: null,
    };
  }

  const commentResult = trySkipComment(content, i, ch, next, state);
  if (commentResult.handled) {
    if (commentResult.terminal) {
      return {
        state,
        advance: commentResult.advance,
        terminal: { inTemplate: state.inTemplate, exprDepth: state.exprDepth },
      };
    }
    return { state, advance: commentResult.advance, terminal: null };
  }

  if (ch === '\\') {
    return {
      state: { ...state, escaped: true },
      advance: i + 1,
      terminal: null,
    };
  }

  const charStep = advanceTemplateStateChar(content, i, ch, next, state);
  const newState = charStep.state;
  if (charStep.done) {
    return {
      state: newState,
      advance: charStep.advance,
      terminal: {
        inTemplate: newState.inTemplate,
        exprDepth: newState.exprDepth,
      },
    };
  }
  return { state: newState, advance: charStep.advance, terminal: null };
}

function trySkipComment(content, i, ch, next, state) {
  const canScanComments = state.inTemplate
    ? state.exprDepth > 0
    : !state.inTemplate;
  if (state.quote !== null || !canScanComments) {
    return { handled: false };
  }
  if (ch === '/' && next === '/') {
    return { handled: true, terminal: true, advance: content.length };
  }
  if (ch === '/' && next === '*') {
    const end = content.indexOf('*/', i + 2);
    return {
      handled: true,
      terminal: false,
      advance: end === -1 ? content.length : end + 2,
    };
  }
  return { handled: false };
}

function advanceTemplateStateChar(content, i, ch, next, state) {
  if (state.inTemplate) {
    return advanceInsideTemplate(content, i, ch, next, state);
  }
  return advanceOutsideTemplate(ch, state, i);
}

function advanceInsideTemplate(content, i, ch, next, state) {
  if (state.exprDepth === 0) {
    return advanceTemplateText(ch, next, state, i);
  }
  return advanceTemplateExpr(content, i, ch, next, state);
}

function advanceTemplateText(ch, next, state, i) {
  if (ch === '$' && next === '{') {
    return { state: { ...state, exprDepth: 1 }, advance: i + 2, done: false };
  }
  if (ch === '`') {
    return {
      state: { ...state, inTemplate: false, exprDepth: 0 },
      advance: i + 1,
      done: false,
    };
  }
  return { state, advance: i + 1, done: false };
}

function advanceTemplateExpr(content, i, ch, next, state) {
  if (state.quote !== null) {
    const newQuote = ch === state.quote ? null : state.quote;
    return {
      state: { ...state, quote: newQuote },
      advance: i + 1,
      done: false,
    };
  }
  if (ch === '"' || ch === "'") {
    return { state: { ...state, quote: ch }, advance: i + 1, done: false };
  }
  if (ch === '`') {
    const end = findNestedTemplateEnd(content, i + 1);
    if (end >= content.length) {
      return { state, advance: end, done: true };
    }
    return { state, advance: end, done: false };
  }
  if (ch === '{') {
    return {
      state: { ...state, exprDepth: state.exprDepth + 1 },
      advance: i + 1,
      done: false,
    };
  }
  if (ch === '}') {
    return {
      state: { ...state, exprDepth: state.exprDepth - 1 },
      advance: i + 1,
      done: false,
    };
  }
  return { state, advance: i + 1, done: false };
}

function advanceOutsideTemplate(ch, state, i) {
  if (state.quote !== null) {
    const newQuote = ch === state.quote ? null : state.quote;
    return {
      state: { ...state, quote: newQuote },
      advance: i + 1,
      done: false,
    };
  }
  if (ch === '"' || ch === "'") {
    return { state: { ...state, quote: ch }, advance: i + 1, done: false };
  }
  if (ch === '`') {
    return {
      state: { ...state, inTemplate: true },
      advance: i + 1,
      done: false,
    };
  }
  return { state, advance: i + 1, done: false };
}
