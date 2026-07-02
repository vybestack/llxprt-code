/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SCOPE_DECLARATION_ARRAYS,
  isCommentOnlyLine,
  isNewOffRule,
} from './constants.mjs';
import { isStandaloneOffRuleValue } from './rule-config.mjs';

/**
 * Strips trailing line comments and block comments from a line, respecting
 * string literals so that comment markers inside quotes are not mistaken for
 * real comments. Without block-comment stripping, a module path that only
 * appears inside a block comment could seed ctx.moduleObjectDepth and produce
 * bogus bypass detections on later top-level rules or ignores lines.
 */
function stripInlineComment(line) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (quote === null && char === '/' && next === '/') {
      return line.slice(0, i);
    }
    if (quote === null && char === '/' && next === '*') {
      return line.slice(0, i);
    }
    const step = scanCommentStripChar(char, quote, escaped);
    if (step.done) {
      return line.slice(0, i);
    }
    quote = step.quote;
    escaped = step.escaped;
  }
  return line;
}

function scanCommentStripChar(char, quote, escaped) {
  if (escaped) {
    return { done: false, quote, escaped: false };
  }
  if (quote !== null) {
    if (char === '\\') {
      return { done: false, quote, escaped: true };
    }
    if (char === quote) {
      return { done: false, quote: null, escaped: false };
    }
    return { done: false, quote, escaped: false };
  }
  if (char === "'" || char === '"' || char === '`') {
    return { done: false, quote: char, escaped: false };
  }
  return { done: false, quote, escaped: false };
}

function extractArrayStart(line) {
  const match = /^\s*(?:const\s+)?([A-Za-z0-9_$-]+)\s*(?::|=)\s*\[/.exec(line);
  if (match !== null) {
    return match[1];
  }
  const allowMatch = /\ballow\s*:\s*\[/.exec(line);
  return allowMatch === null ? null : 'allow';
}

function isModulePathLine(line, modulePath) {
  const code = stripInlineComment(line);
  return !isCommentOnlyLine(code) && code.includes(modulePath);
}

/**
 * Returns true if the line is a bare quoted string literal entry (e.g.
 * a glob like 'packages/policy/src/...'). These appear as individual entries
 * inside arrays.
 */
function isBareStringEntry(line) {
  return /^\s*['"`]/.test(line);
}

/**
 * Returns true if the line is a file-pattern reference inside an ESLint config
 * block (i.e. mentions the module path) that should set the object-depth
 * tracker for central-bypass analysis.
 *
 * Bare quoted string literals are excluded only when they appear inside a
 * top-level scope-declaration array (legacyDirectiveCleanupScopes /
 * completedDirectiveCleanupScopes), so those entries are not mistaken for
 * config-block file patterns. Inside config objects, bare quoted strings in a
 * files array are legitimate module references and must be tracked.
 */
function isModuleFilesLine(line, modulePath, currentArray) {
  if (!isModulePathLine(line, modulePath)) {
    return false;
  }
  if (
    isBareStringEntry(line) &&
    currentArray !== null &&
    SCOPE_DECLARATION_ARRAYS.has(currentArray)
  ) {
    return false;
  }
  return true;
}

function hasModuleCentralBypassOnSingleLine(line, modulePath) {
  if (!isModulePathLine(line, modulePath)) {
    return null;
  }
  if (/\bignores\s*:/.test(line)) {
    return 'scoped ignore';
  }
  if (
    /\brules\s*:/.test(line) &&
    (isNewOffRule(line) || isStandaloneOffRuleValue(line))
  ) {
    return 'rule-off';
  }
  return null;
}

function moduleCentralBypassMessage(modulePath, kind, issueNumber) {
  return `${modulePath} must not be covered by central ESLint ${kind} entries (#${issueNumber}).`;
}

function countBraceDelta(line) {
  let delta = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (quote === null && char === '/' && next === '/') {
      break;
    }
    const step = scanBraceDeltaChar(char, quote, escaped);
    quote = step.quote;
    escaped = step.escaped;
    delta += step.delta;
  }

  return delta;
}

function scanBraceDeltaChar(char, quote, escaped) {
  if (escaped) {
    return { quote, escaped: false, delta: 0 };
  }
  if (quote !== null) {
    if (char === '\\') {
      return { quote, escaped: true, delta: 0 };
    }
    if (char === quote) {
      return { quote: null, escaped: false, delta: 0 };
    }
    return { quote, escaped: false, delta: 0 };
  }
  if (char === "'" || char === '"' || char === '`') {
    return { quote: char, escaped: false, delta: 0 };
  }
  if (char === '{') {
    return { quote, escaped: false, delta: 1 };
  }
  if (char === '}') {
    return { quote, escaped: false, delta: -1 };
  }
  return { quote, escaped: false, delta: 0 };
}

function countOpeningBraces(line) {
  let count = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (quote === null && char === '/' && next === '/') {
      break;
    }
    const step = scanOpeningBracesChar(char, quote, escaped);
    quote = step.quote;
    escaped = step.escaped;
    count += step.count;
  }

  return count;
}

function scanOpeningBracesChar(char, quote, escaped) {
  if (escaped) {
    return { quote, escaped: false, count: 0 };
  }
  if (quote !== null) {
    if (char === '\\') {
      return { quote, escaped: true, count: 0 };
    }
    if (char === quote) {
      return { quote: null, escaped: false, count: 0 };
    }
    return { quote, escaped: false, count: 0 };
  }
  if (char === "'" || char === '"' || char === '`') {
    return { quote: char, escaped: false, count: 0 };
  }
  if (char === '{') {
    return { quote, escaped: false, count: 1 };
  }
  return { quote, escaped: false, count: 0 };
}

function enclosingObjectDepth(line, braceDepth, modulePath) {
  const moduleIndex = line.indexOf(modulePath);
  const openIndex = line.indexOf('{');
  if (openIndex !== -1 && openIndex < moduleIndex) {
    return braceDepth + 1;
  }
  return braceDepth;
}

/**
 * Inspects eslint.config.js source text for module-path central bypasses that
 * would reintroduce the old suppression pattern outside source files.
 */
export function checkModuleCentralBypassesInConfig(
  configSource,
  modulePath,
  issueNumber,
) {
  const violations = [];
  const lines = configSource.split('\n');
  const ctx = {
    currentArray: null,
    braceDepth: 0,
    moduleObjectDepth: null,
    rulesObjectDepth: null,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    processCentralBypassLine(
      line,
      lineNumber,
      modulePath,
      issueNumber,
      ctx,
      violations,
    );
  }

  return violations;
}

function processCentralBypassLine(
  line,
  lineNumber,
  modulePath,
  issueNumber,
  ctx,
  violations,
) {
  updateCurrentArray(ctx, line);

  pushSingleLineBypass(
    line,
    lineNumber,
    modulePath,
    issueNumber,
    ctx,
    violations,
  );
  pushModuleArrayBypass(
    line,
    lineNumber,
    modulePath,
    issueNumber,
    ctx,
    violations,
  );
  pushModuleObjectBypass(
    line,
    lineNumber,
    modulePath,
    issueNumber,
    ctx,
    violations,
  );
  updateBraceDepth(ctx, line);
}

function updateCurrentArray(ctx, line) {
  const arrayStart = extractArrayStart(line);
  if (arrayStart !== null) {
    ctx.currentArray = arrayStart;
  }
  if (ctx.currentArray !== null && /^\s*\]/.test(line)) {
    ctx.currentArray = null;
  }
}

function pushSingleLineBypass(
  line,
  lineNumber,
  modulePath,
  issueNumber,
  ctx,
  violations,
) {
  const singleLineBypass = hasModuleCentralBypassOnSingleLine(line, modulePath);
  if (singleLineBypass !== null) {
    violations.push({
      file: 'eslint.config.js',
      lineNumber,
      message: moduleCentralBypassMessage(
        modulePath,
        singleLineBypass,
        issueNumber,
      ),
      content: line,
    });
  }
}

function pushModuleArrayBypass(
  line,
  lineNumber,
  modulePath,
  issueNumber,
  ctx,
  violations,
) {
  if (!isModulePathLine(line, modulePath)) {
    return;
  }
  const arrayKind = getArrayBypassKind(ctx.currentArray);
  if (arrayKind !== null) {
    violations.push({
      file: 'eslint.config.js',
      lineNumber,
      message: moduleCentralBypassMessage(modulePath, arrayKind, issueNumber),
      content: line,
    });
  }
  if (isModuleFilesLine(line, modulePath, ctx.currentArray)) {
    ctx.moduleObjectDepth = enclosingObjectDepth(
      line,
      ctx.braceDepth,
      modulePath,
    );
  }
}

function getArrayBypassKind(currentArray) {
  if (currentArray === 'ignores') {
    return 'ignore';
  }
  if (currentArray === 'allow') {
    return 'allow-list';
  }
  return null;
}

function pushModuleObjectBypass(
  line,
  lineNumber,
  modulePath,
  issueNumber,
  ctx,
  violations,
) {
  const inModuleObject =
    ctx.moduleObjectDepth !== null && ctx.braceDepth >= ctx.moduleObjectDepth;
  if (!inModuleObject) {
    return;
  }
  if (/^\s*ignores\s*:/.test(line)) {
    violations.push({
      file: 'eslint.config.js',
      lineNumber,
      message: moduleCentralBypassMessage(
        modulePath,
        'scoped ignore',
        issueNumber,
      ),
      content: line,
    });
  }
  if (/^\s*rules\s*:/.test(line)) {
    ctx.rulesObjectDepth = ctx.braceDepth + countOpeningBraces(line);
  }
  const isRuleOff =
    ctx.rulesObjectDepth !== null &&
    (isNewOffRule(line) || isStandaloneOffRuleValue(line));
  if (isRuleOff) {
    violations.push({
      file: 'eslint.config.js',
      lineNumber,
      message: moduleCentralBypassMessage(modulePath, 'rule-off', issueNumber),
      content: line,
    });
  }
}

function updateBraceDepth(ctx, line) {
  ctx.braceDepth += countBraceDelta(line);
  if (ctx.rulesObjectDepth !== null && ctx.braceDepth < ctx.rulesObjectDepth) {
    ctx.rulesObjectDepth = null;
  }
  if (
    ctx.moduleObjectDepth !== null &&
    ctx.braceDepth < ctx.moduleObjectDepth
  ) {
    ctx.moduleObjectDepth = null;
    ctx.rulesObjectDepth = null;
  }
}

/**
 * Inspects eslint.config.js source text for packages/core central bypasses that
 * would reintroduce the old suppression pattern outside source files.
 */
export function checkCoreCentralBypassesInConfig(configSource) {
  return checkModuleCentralBypassesInConfig(
    configSource,
    'packages/core',
    '2115',
  );
}

/**
 * Inspects eslint.config.js source text and returns any directive cleanup scope
 * entries that reference the given module path. By default both
 * legacyDirectiveCleanupScopes and completedDirectiveCleanupScopes are checked.
 * When checkCompletedScopes is false, only legacyDirectiveCleanupScopes is
 * checked — this is used when a module is intentionally locked in
 * completedDirectiveCleanupScopes as its durable enforcement.
 */
export function checkModuleDirectiveScopesInConfig(
  configSource,
  modulePath,
  issueNumber,
  checkCompletedScopes = true,
) {
  const violations = [];
  const lines = configSource.split('\n');
  let currentScope = null;
  let currentStatement = '';
  let currentCode = '';
  let currentStartLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const scopeMatch =
      /^const\s+(legacyDirectiveCleanupScopes|completedDirectiveCleanupScopes)\s*=/.exec(
        line,
      );
    if (scopeMatch) {
      currentScope = scopeMatch[1];
      currentStatement = line;
      currentCode = stripInlineComment(line);
      currentStartLine = i + 1;
    } else if (currentScope !== null) {
      currentStatement += '\n' + line;
      currentCode += '\n' + stripInlineComment(line);
    }

    if (currentScope !== null && /;\s*(?:\/\/.*)?$/.test(line)) {
      const shouldFlag =
        currentScope === 'legacyDirectiveCleanupScopes' ||
        (checkCompletedScopes &&
          currentScope === 'completedDirectiveCleanupScopes');
      if (shouldFlag && currentCode.includes(modulePath)) {
        violations.push({
          file: 'eslint.config.js',
          lineNumber: currentStartLine,
          message: `${modulePath} must not remain in ${currentScope} (#${issueNumber}).`,
          content: currentStatement,
        });
      }
      currentScope = null;
      currentStatement = '';
      currentCode = '';
    }
  }
  return violations;
}

/**
 * Inspects eslint.config.js source text and returns any directive cleanup scope
 * entries that reference packages/core. Issue #2115 requires packages/core to
 * be removed from both temporary and completed central directive lists.
 */
export function checkCoreDirectiveScopesInConfig(configSource) {
  return checkModuleDirectiveScopesInConfig(
    configSource,
    'packages/core',
    '2115',
  );
}

export { stripInlineComment };
