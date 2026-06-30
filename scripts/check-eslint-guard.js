#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';

const DEFAULT_BASE = process.env.GITHUB_BASE_REF
  ? 'origin/' + process.env.GITHUB_BASE_REF
  : 'origin/main';

const POLICY_PATHS = ['.'];

function parseArgs(argv) {
  const args = {
    base: process.env.ESLINT_GUARD_BASE || DEFAULT_BASE,
    head: process.env.ESLINT_GUARD_HEAD || 'HEAD',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base') {
      args.base = argv[++i];
    } else if (arg === '--head') {
      args.head = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/check-eslint-guard.js [--base REF] [--head REF]',
      );
      process.exit(0);
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }

  return args;
}

const GIT_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_BUFFER_BYTES,
  }).trim();
}

function resolveBase(base, head) {
  try {
    return git(['merge-base', base, head]);
  } catch {
    return base;
  }
}

// A generous unified context (20 lines) ensures that common multiline rule
// config changes in eslint.config.js include the enclosing rules: { block
// and rule key context lines, so multiline severity/threshold detection
// (which relies on rulesBraceDepth and currentCeilingRuleKey/currentRuleKey
// context tracking) works in production CI, not just in context-rich test
// fixtures. Multiline rule config objects in this project can have the rule
// key more than 5 lines above the changed severity/max field (e.g. a
// ceiling rule with many options), so a 5-line context would drop the rule
// key outside the hunk and lose rule attribution. 20 lines comfortably
// covers the widest realistic single-rule config object while keeping diffs
// reviewable. Guard behavior is more important than minimizing the diff
// size. This limit is documented and exercised by tests with >5 lines
// between the rule key and the changed field.
const DIFF_CONTEXT_LINES = '20';

function diffFromGit(base, head) {
  const resolvedBase = resolveBase(base, head);

  if (head === 'HEAD') {
    return git([
      'diff',
      '--unified=' + DIFF_CONTEXT_LINES,
      '--no-ext-diff',
      resolvedBase,
      '--',
      ...POLICY_PATHS,
    ]);
  }

  return git([
    'diff',
    '--unified=' + DIFF_CONTEXT_LINES,
    '--no-ext-diff',
    resolvedBase + '...' + head,
    '--',
    ...POLICY_PATHS,
  ]);
}

function isGeneratedGuardFixture(file) {
  return (
    file === 'scripts/check-eslint-guard.js' ||
    file === 'scripts/tests/eslint-guard.test.js'
  );
}

function startsWithAddedContent(line) {
  return line.startsWith('+') && !line.startsWith('+++');
}

function startsWithRemovedContent(line) {
  return line.startsWith('-') && !line.startsWith('---');
}

function addedContent(line) {
  return line.slice(1);
}

function removedContent(line) {
  return line.slice(1);
}

function isAllowedPolicyOff(line) {
  return line.includes('eslint-policy-allow-off:');
}

function isNewOffRule(line) {
  return (
    /:\s*['"]off['"]/.test(line) ||
    /:\s*0\b/.test(line) ||
    /\[\s*['"]off['"]/.test(line) ||
    /\[\s*0\b/.test(line)
  );
}

/**
 * Returns true when the line is a rule-assignment-shaped entry: it has an
 * extractable rule key (e.g. "'no-console': ...") so the off/0 value is the
 * rule's severity, not an unrelated config field. This gates off/0 detection
 * so that fields like "mode: 'off'" or "level: 0" outside rule contexts do not
 * produce false positives.
 */
function isRuleAssignmentLine(line) {
  return extractRuleKey(line) !== null;
}

/**
 * Returns true when the line is a rule off/0 entry suitable for the off/0
 * policy gate. When insideRulesBlock is true, any extractable rule key
 * qualifies (structural context disambiguates option fields). When false
 * (zero-context or after a closed rules block), only quoted rule keys or known
 * ceiling rules qualify, so unquoted unknown identifiers like
 * `experimental: "off"` in unrelated objects are not mistaken for rule
 * severities.
 *
 * When insideRuleEntry is true (we are inside an existing multiline rule config
 * object), this returns false entirely: STRUCTURAL_KEYS cannot cover every
 * custom/plugin-specific option field, so an extractable key such as
 * customOption would be mistaken for a rule assignment. Only the standalone
 * multiline severity form (isStandaloneOffRuleValue) applies inside a rule
 * config object, for actual first-element 'off' or 0 values.
 */
function isRuleOffEntry(line, insideRulesBlock, insideRuleEntry = false) {
  if (insideRuleEntry) {
    return false;
  }
  if (!isRuleAssignmentLine(line)) {
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
  // A quoted rule key (e.g. 'no-console') is a strong rule-assignment signal.
  // Unquoted identifiers (e.g. experimental) are ambiguous outside a rules
  // block and are excluded to avoid false positives. Uses the same centralized
  // RULE_ID_CHARS character class (including the @ scope marker) as
  // extractRuleKey so scoped rule keys like '@typescript-eslint/no-explicit-any'
  // are recognized consistently (#2189 review finding).
  return new RegExp('[\'"]\\s*[' + RULE_ID_CHARS + ']+\\s*[\'"]\\s*:').test(
    line,
  );
}

function isStandaloneOffRuleValue(line) {
  return /^\s*(?:['"]off['"]|0),?\s*(?:\/\/.*)?$/.test(line);
}

function shouldCheckInlineDirective(file) {
  if (isGeneratedGuardFixture(file)) {
    return false;
  }
  return /\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(file);
}

/**
 * Determines whether TypeScript suppression directives in a file should be
 * scanned. Unlike shouldCheckInlineDirective, this does NOT exempt the guard
 * implementation/test fixture files: TS suppression detection
 * (hasTypeScriptSuppression) skips string, template, and regex literals, so
 * directive text used as data in fixture strings cannot trigger a false
 * positive. This ensures a real TS suppression directive (at-ts-ignore,
 * at-ts-expect-error, at-ts-nocheck) added to scripts/check-eslint-guard.js or
 * its test is still rejected, splitting the ESLint-directive fixture exemption
 * (which is needed because eslint-disable text appears in fixture
 * strings/regexes) from TS suppression scanning.
 */
function shouldCheckTypeScriptSuppression(file) {
  return /\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(file);
}

function previousCodeChar(line, index) {
  for (let i = index - 1; i >= 0; i--) {
    const ch = line[i];
    if (!/\s/.test(ch)) {
      return ch;
    }
  }
  return '';
}

function canStartRegex(line, index) {
  const previous = previousCodeChar(line, index);
  return previous === '' || /[({[=,:;!&|?+\-*%^~<>]/.test(previous);
}

function skipQuoted(line, start, quote) {
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

function skipRegex(line, start) {
  // Limitation: this is a single-line, character-class-aware regex skipper,
  // not a full lexer. It does not handle division-vs-regex disambiguation via
  // ASI (the canStartRegex heuristic suffices for this project's source), nor
  // template literals with embedded ${}. These trade-offs are acceptable
  // because the guard scans one diff line at a time and the target patterns
  // (eslint directives, TS suppressions) are never valid regex/division
  // operands in practice. Lines with exotic constructs are rare and any
  // residual false positive is caught by review.
  let inCharacterClass = false;
  for (let i = start + 1; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '[') {
      inCharacterClass = true;
      continue;
    }
    if (ch === ']') {
      inCharacterClass = false;
      continue;
    }
    if (ch === '/' && !inCharacterClass) {
      return i;
    }
  }
  return line.length;
}

const DIRECTIVE_PATTERN = /eslint-(?:disable|enable)(?:-next-line|-line)?\b/;

// TypeScript suppression directives (@ts-ignore, @ts-expect-error, @ts-nocheck)
// are only effective when they appear at the START of the comment text (after
// optional whitespace). This was verified against TypeScript 5.8.3 (the repo's
// version) via focused compiler tests: a directive preceded by leading prose
// (e.g. "// see notes @ts-ignore" or "/* prose @ts-ignore */") is NOT an
// effective suppression and the compiler reports the error as usual. This
// start-of-comment anchoring is therefore compiler-accurate: it matches exactly
// the directives the TypeScript compiler would treat as effective suppressions.
const TS_SUPPRESSION_START_PATTERN =
  /^\s*@(?:ts-ignore|ts-expect-error|ts-nocheck)\b/;
const TYPE_ESCAPE_PATTERNS = [
  { pattern: /@ts-expect-error\b/, label: '@ts-expect-error' },
  { pattern: /@ts-ignore\b/, label: '@ts-ignore' },
  { pattern: /@ts-nocheck\b/, label: '@ts-nocheck' },
  { pattern: /\bas\s+any\b/, label: 'as any' },
  { pattern: /\bas\s+unknown\s+as\b/, label: 'as unknown as' },
];

const CLI_TYPE_ESCAPE_ALLOWLIST = [];

export function hasInlineEslintDirective(line) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipQuoted(line, i, ch);
      continue;
    }
    if (ch !== '/') {
      continue;
    }
    const next = line[i + 1];
    if (next === '/') {
      return DIRECTIVE_PATTERN.test(line.slice(i + 2));
    }
    if (next === '*') {
      const end = line.indexOf('*/', i + 2);
      const comment = line.slice(i + 2, end === -1 ? undefined : end);
      if (DIRECTIVE_PATTERN.test(comment)) {
        return true;
      }
      if (end === -1) {
        return false;
      }
      i = end + 1;
      continue;
    }
    if (canStartRegex(line, i)) {
      i = skipRegex(line, i);
    }
  }
  return false;
}

/**
 * Returns true when the line contains a TypeScript suppression directive
 * (@ts-ignore, @ts-expect-error, @ts-nocheck) inside a real comment. String
 * and regex literals are skipped so text mentioning these directives does not
 * produce false positives. This reuses the same string/regex-aware scanning
 * approach as hasInlineEslintDirective.
 *
 * Multiline block-comment behavior (verified against TypeScript 5.8.3):
 * TypeScript only recognizes these directives as effective suppressions when
 * they appear in a line comment or a single-line block comment where the
 * directive is at the start of the comment text (after optional whitespace).
 * A directive on a continuation line of a multiline block comment (e.g.
 * "* @ts-ignore" on line 2 of a multi-line comment) is NOT an effective
 * suppression and is not flagged here, avoiding false positives on prose that
 * merely mentions the directive. The guard processes one line at a time, so a
 * multiline block comment opener like "/* @ts-ignore" (without a same-line
 * closer) IS flagged as a conservative measure — while TS 5.8.3 does not treat
 * it as an effective suppression, flagging it errs on the side of
 * caution and avoids any risk of a real suppression slipping through.
 */
export function hasTypeScriptSuppression(line) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipQuoted(line, i, ch);
      continue;
    }
    if (ch !== '/') {
      continue;
    }
    const next = line[i + 1];
    if (next === '/') {
      return TS_SUPPRESSION_START_PATTERN.test(line.slice(i + 2));
    }
    if (next === '*') {
      const end = line.indexOf('*/', i + 2);
      const comment = line.slice(i + 2, end === -1 ? undefined : end);
      if (TS_SUPPRESSION_START_PATTERN.test(comment)) {
        return true;
      }
      if (end === -1) {
        return false;
      }
      i = end + 1;
      continue;
    }
    if (canStartRegex(line, i)) {
      i = skipRegex(line, i);
    }
  }
  return false;
}

/**
 * Template-aware counterpart to hasInlineEslintDirective. Directive text inside
 * template literal text is inert, while comments in normal code or template
 * expressions are still reported.
 */
export function hasInlineEslintDirectiveInState(line, incoming) {
  const initialState =
    typeof incoming === 'boolean'
      ? { inTemplate: incoming, exprDepth: 0 }
      : incoming;
  let inTemplate = initialState.inTemplate;
  let exprDepth = initialState.exprDepth;
  let quote = null;
  let escaped = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    if (escaped) {
      escaped = false;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      i += 1;
      continue;
    }

    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    const inExecutable = !inTemplate || exprDepth > 0;
    if (inExecutable) {
      if (ch === '/' && next === '/') {
        return DIRECTIVE_PATTERN.test(line.slice(i + 2));
      }
      if (ch === '/' && next === '*') {
        const end = line.indexOf('*/', i + 2);
        const comment = line.slice(i + 2, end === -1 ? undefined : end);
        if (DIRECTIVE_PATTERN.test(comment)) {
          return true;
        }
        if (end === -1) {
          return false;
        }
        i = end + 2;
        continue;
      }
      if (!inTemplate && ch === '/' && canStartRegex(line, i)) {
        i = skipRegex(line, i);
        continue;
      }
    }

    if (inExecutable && (ch === '"' || ch === "'")) {
      quote = ch;
      i += 1;
      continue;
    }

    if (!inTemplate) {
      if (ch === '`') {
        inTemplate = true;
        exprDepth = 0;
      }
      i += 1;
      continue;
    }

    if (exprDepth === 0) {
      if (ch === '$' && next === '{') {
        exprDepth += 1;
        i += 2;
        continue;
      }
      if (ch === '`') {
        inTemplate = false;
      }
      i += 1;
      continue;
    }

    if (ch === '`') {
      i += 1;
      let nExpr = 0;
      let nQuote = null;
      let nEscaped = false;
      while (i < line.length) {
        const nch = line[i];
        const nnext = line[i + 1];
        if (nEscaped) {
          nEscaped = false;
          i += 1;
          continue;
        }
        if (nch === '\\') {
          nEscaped = true;
          i += 1;
          continue;
        }
        if (nQuote !== null) {
          if (nch === nQuote) {
            nQuote = null;
          }
          i += 1;
          continue;
        }
        if (nch === '"' || nch === "'") {
          nQuote = nch;
          i += 1;
          continue;
        }
        if (nch === '$' && nnext === '{') {
          nExpr += 1;
          i += 2;
          continue;
        }
        if (nch === '}' && nExpr > 0) {
          nExpr -= 1;
          i += 1;
          continue;
        }
        if (nch === '`' && nExpr === 0) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === '$' && next === '{') {
      exprDepth += 1;
      i += 2;
      continue;
    }
    if (ch === '}') {
      exprDepth -= 1;
      if (exprDepth < 0) {
        exprDepth = 0;
      }
    }
    i += 1;
  }

  return false;
}

/**
 * Scans a line for a real TypeScript suppression directive
 * (@ts-ignore/@ts-expect-error/@ts-nocheck) in executable code, given the
 * template-literal state at the start of the line. This is the template-aware
 * counterpart to hasTypeScriptSuppression: it distinguishes template literal
 * TEXT (where directive text is inert) from template ${ ... } EXPRESSION code
 * (where an at-ts-ignore line comment is a real, effective comment) and from
 * code outside any template.
 *
 * A suppression is reported only when a line or block comment containing the
 * directive is found in EXECUTABLE context (outside a template, or inside a
 * template ${ ... } expression). Directive text in template literal text is
 * inert and not reported.
 *
 * The incoming state { inTemplate, exprDepth } mirrors scanTemplateLiteralState
 * so a line can start inside an already-open expression (exprDepth > 0) and a
 * real suppression comment there is still caught (#2189 review finding).
 */
export function hasTypeScriptSuppressionInState(line, incoming) {
  const initialState =
    typeof incoming === 'boolean'
      ? { inTemplate: incoming, exprDepth: 0 }
      : incoming;
  let inTemplate = initialState.inTemplate;
  let exprDepth = initialState.exprDepth;
  let quote = null;
  let escaped = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    if (escaped) {
      escaped = false;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      i += 1;
      continue;
    }

    // Inside a quote (within expression code): skip until the matching quote.
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    // Comments in EXECUTABLE context only: outside a template, or inside a
    // template ${ ... } expression (exprDepth > 0). Inside template literal
    // TEXT (inTemplate && exprDepth === 0), // and /* are inert characters.
    const inExecutable = !inTemplate || exprDepth > 0;
    if (inExecutable) {
      if (ch === '/' && next === '/') {
        // Line comment in executable code: check for a TS suppression.
        return TS_SUPPRESSION_START_PATTERN.test(line.slice(i + 2));
      }
      if (ch === '/' && next === '*') {
        const end = line.indexOf('*/', i + 2);
        const comment = line.slice(i + 2, end === -1 ? undefined : end);
        if (TS_SUPPRESSION_START_PATTERN.test(comment)) {
          return true;
        }
        if (end === -1) {
          return false;
        }
        i = end + 2;
        continue;
      }
      // Regex disambiguation in executable code (outside template text).
      if (!inTemplate && ch === '/' && canStartRegex(line, i)) {
        i = skipRegex(line, i);
        continue;
      }
    }

    // Track quotes inside expression code so a // or ${ inside a string is
    // not mistaken for a comment or expression opener.
    if (inExecutable && (ch === '"' || ch === "'")) {
      quote = ch;
      i += 1;
      continue;
    }

    if (!inTemplate) {
      // Outside any template: a backtick opens a template literal.
      if (ch === '`') {
        inTemplate = true;
        exprDepth = 0;
      }
      i += 1;
      continue;
    }

    // Inside a template literal.
    if (exprDepth === 0) {
      // Literal text context.
      if (ch === '$' && next === '{') {
        exprDepth += 1;
        i += 2;
        continue;
      }
      if (ch === '`') {
        inTemplate = false;
      }
      i += 1;
      continue;
    }

    // Inside a template ${ ... } expression (exprDepth > 0).
    if (ch === '`') {
      // A nested template literal inside the expression. Skip its body to
      // its closing backtick so its contents do not affect outer state.
      // Nested templates may themselves contain ${...}; track depth.
      i += 1;
      let nExpr = 0;
      let nQuote = null;
      let nEscaped = false;
      while (i < line.length) {
        const nch = line[i];
        const nnext = line[i + 1];
        if (nEscaped) {
          nEscaped = false;
          i += 1;
          continue;
        }
        if (nch === '\\') {
          nEscaped = true;
          i += 1;
          continue;
        }
        if (nQuote !== null) {
          if (nch === nQuote) {
            nQuote = null;
          }
          i += 1;
          continue;
        }
        if (nch === '"' || nch === "'") {
          nQuote = nch;
          i += 1;
          continue;
        }
        if (nch === '$' && nnext === '{') {
          nExpr += 1;
          i += 2;
          continue;
        }
        if (nch === '{') {
          nExpr += 1;
          i += 1;
          continue;
        }
        if (nch === '}' && nExpr > 0) {
          nExpr -= 1;
          i += 1;
          continue;
        }
        if (nch === '`' && nExpr === 0) {
          // Position at the closing backtick; the outer loop will advance
          // past it on the next iteration.
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '{') {
      exprDepth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (exprDepth > 0) {
        exprDepth -= 1;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return false;
}

/**
 * Tracks template literal state across diff lines so the guard can tell whether
 * an added line starts inside template literal TEXT (where directive text like
 * an at-ts-ignore line comment is inert) or inside a template ${ ... }
 * EXPRESSION (where such a comment is real, effective executable code).
 *
 * The incoming state is { inTemplate, exprDepth } carried from the previous
 * diff line (or the initial { inTemplate: false, exprDepth: 0 }). This returns
 * the state after processing the content line:
 *   - inTemplate: true when the line ends inside an unclosed backtick template
 *     literal.
 *   - exprDepth: when inTemplate is true, tracks the depth of ${ ... }
 *     substitution expressions at the end of the line. At exprDepth > 0 the
 *     line ends inside an expression inside a template (not in the literal
 *     text), so a following line that opens a suppression comment is real
 *     executable code that must be flagged.
 *
 * Carrying exprDepth across lines is essential: a line can start inside an
 * already-open ${ ... } expression (exprDepth > 0), and only by preserving
 * that depth can a subsequent line's } correctly return to literal-text
 * context. A boolean-only inTemplate flag loses this, causing directive text
 * inside a multiline ${ ... } expression to be mistaken for inert template
 * body text (#2189 review finding).
 *
 * The optional incoming state defaults to { inTemplate: false, exprDepth: 0 }.
 * For backward compatibility a bare boolean may be passed (treated as the
 * inTemplate flag with exprDepth 0), which is used by the internal recursive
 * nested-template scan.
 *
 * Limitations (documented, acceptable for directive scanning):
 *   - Does not perform full JS lexing (ASI, regex disambiguation, etc.). The
 *     heuristic tracks quotes, comments, backticks, and ${} nesting, which is
 *     sufficient for this project's source where template literals with
 *     directive text are the concern.
 *   - A // comment inside a template line is treated as literal text (correct:
 *     // has no special meaning inside a template literal).
 */
export function scanTemplateLiteralState(content, incoming) {
  const initialState =
    typeof incoming === 'boolean'
      ? { inTemplate: incoming, exprDepth: 0 }
      : incoming;
  let inTemplate = initialState.inTemplate;
  let i = 0;
  let exprDepth = initialState.exprDepth;
  let quote = null;
  let escaped = false;

  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (escaped) {
      escaped = false;
      i += 1;
      continue;
    }

    // Skip comments so their contents do not affect state. Outside a
    // template and inside a template ${ ... } expression (exprDepth > 0),
    // // and /* are real comments. Inside template literal text
    // (inTemplate && exprDepth === 0) they are literal characters with no
    // special meaning. A // comment always ends the line, and a /* ...
    // */ comment may span the rest of the line (a multiline /* that does
    // not close is treated as consuming the remainder).
    if (quote === null && (inTemplate ? exprDepth > 0 : !inTemplate)) {
      if (ch === '/' && next === '/') {
        break;
      }
      if (ch === '/' && next === '*') {
        const end = content.indexOf('*/', i + 2);
        i = end === -1 ? content.length : end + 2;
        continue;
      }
    }

    // Handle escape sequences inside quotes/templates.
    if (ch === '\\') {
      escaped = true;
      i += 1;
      continue;
    }

    // Inside a template literal, ${ opens a substitution expression and }
    // closes it. At exprDepth > 0 we are in expression context where quotes
    // and nested backticks are code, not literal text.
    if (inTemplate) {
      if (exprDepth === 0) {
        // In literal text context: only } does not close anything, ${ opens
        // an expression, and a backtick closes the template.
        if (ch === '$' && next === '{') {
          exprDepth += 1;
          i += 2;
          continue;
        }
        if (ch === '`') {
          inTemplate = false;
          i += 1;
          continue;
        }
        i += 1;
        continue;
      }
      // exprDepth > 0: inside a ${...} expression. Track braces, quotes, and
      // nested backticks (which open a nested template tracked via recursion
      // of the same state machine).
      if (quote !== null) {
        if (ch === quote) {
          quote = null;
        }
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        i += 1;
        continue;
      }
      if (ch === '`') {
        // Nested template: recursively find its close.
        const nested = scanTemplateLiteralState(content.slice(i + 1), true);
        // scanTemplateLiteralState returns the state after the remaining
        // substring; we need to advance past the nested template's close
        // backtick. Since the recursive call operates on a suffix, we count
        // how many chars it consumed. If the nested template is unclosed on
        // this line, the entire remaining line is consumed inside it.
        // Determine consumed length: if the nested call returned
        // inTemplate=false, a closing backtick was found; find its position.
        if (!nested.inTemplate) {
          // Find the matching close backtick at exprDepth 0 of the nested
          // template. scanTemplateLiteralState already consumed it, but we
          // need the index. Re-scan to find the close position.
          let ni = i + 1;
          let nExpr = 0;
          let nQuote = null;
          let nEscaped = false;
          while (ni < content.length) {
            const nch = content[ni];
            const nnext = content[ni + 1];
            if (nEscaped) {
              nEscaped = false;
              ni += 1;
              continue;
            }
            if (nch === '\\') {
              nEscaped = true;
              ni += 1;
              continue;
            }
            if (nQuote !== null) {
              if (nch === nQuote) {
                nQuote = null;
              }
              ni += 1;
              continue;
            }
            if (nch === '"' || nch === "'") {
              nQuote = nch;
              ni += 1;
              continue;
            }
            if (nch === '$' && nnext === '{') {
              nExpr += 1;
              ni += 2;
              continue;
            }
            if (nch === '{') {
              nExpr += 1;
              ni += 1;
              continue;
            }
            if (nch === '}' && nExpr > 0) {
              nExpr -= 1;
              ni += 1;
              continue;
            }
            if (nch === '`' && nExpr === 0) {
              ni += 1;
              break;
            }
            ni += 1;
          }
          i = ni;
          continue;
        }
        // Nested template is unclosed on this line; the entire remaining
        // content is inside it, so we stay in the outer template's expression
        // at the current exprDepth. There is nothing more to process.
        return { inTemplate: true, exprDepth };
      }
      if (ch === '{') {
        exprDepth += 1;
        i += 1;
        continue;
      }
      if (ch === '}') {
        exprDepth -= 1;
        if (exprDepth === 0) {
          // Exited the ${...} expression back to literal text context.
        }
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    // Not inside a template literal. Track single-line quotes and backticks.
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i += 1;
      continue;
    }
    i += 1;
  }

  return { inTemplate, exprDepth };
}

function addViolation(violations, file, lineNumber, message, content) {
  violations.push({ file, lineNumber, message, content });
}

// --- ESLint config severity and ceiling-threshold detection (#2189) ---

const CEILING_RULES = new Set([
  'complexity',
  'max-lines',
  'max-lines-per-function',
  'max-statements',
  'max-params',
  'max-depth',
  'sonarjs/cognitive-complexity',
]);

const SEVERITY_RANK = { off: 0, 0: 0, warn: 1, 1: 1, error: 2, 2: 2 };

// Centralized rule-id character class matching the full syntax of ESLint rule
// IDs. Accepts:
//   - Core rules: no-console, max-depth
//   - Plugin rules (slash-separated): sonarjs/cognitive-complexity
//   - Scoped plugin rules (npm-scope prefix): @typescript-eslint/no-explicit-any
//   - Scoped rules with multiple path segments: @scope/plugin/rule-name
// Used by extractRuleKey(), extractDirectValueAfterKey(), and isRuleOffEntry
// () quoted-key detection so all three share identical rule-ID parsing
// semantics, including the @ scope marker that was previously excluded
// (#2189 review finding).
const RULE_ID_CHARS = '@a-zA-Z0-9/_-';

// Property keys that are clearly not rule names (e.g. files, rules, ignores,
// settings, plugins, languageOptions, linterOptions) and common ESLint
// rule-option properties (e.g. max, allow, skipBlankLines) that appear inside
// rule config objects but are not rule keys themselves. Hoisted to module
// scope so it is not recreated on every extractRuleKey call.
const STRUCTURAL_KEYS = new Set([
  'files',
  'rules',
  'ignores',
  'settings',
  'plugins',
  'languageOptions',
  'linterOptions',
  'globals',
  'parserOptions',
  'reportUnusedDisableDirectives',
  'processor',
  'allow',
  'name',
  'message',
  'selector',
  'paths',
  'patterns',
  'group',
  'importNames',
  'max',
  'min',
  'maxDepth',
  'maxLen',
  'skipBlankLines',
  'skipComments',
  'IIFEs',
  'ignoreTopLevelFunctions',
  'ignorePattern',
  'ignorePatterns',
  'options',
  'properties',
  'property',
  'var',
  'before',
  'after',
  'level',
  'type',
  'value',
  'description',
  'mode',
  'limit',
  'count',
  'threshold',
  'severity',
  'depth',
  'env',
  'rulesdir',
  'extends',
  'overrides',
  'excludedFiles',
]);

/**
 * Extracts the ESLint rule key from a config line or inline segment. Handles
 * quoted and unquoted keys, including namespaced rules like
 * 'sonarjs/cognitive-complexity'. Returns null if no rule key is found.
 *
 * The extraction is ANCHORED: the rule key must appear at the START of the
 * trimmed input (after leading whitespace). This prevents misparsing nested
 * properties as rule keys — a segment like
 * `'custom-rules': { complexity: ['error', 50] }` yields `custom-rules` (the
 * top-level key), never `complexity` (a nested property). Without anchoring,
 * extractRuleKey would take the first rule-like property anywhere in the
 * segment, producing false positives for unrelated nested config fields
 * (#2189 review finding).
 *
 * Examples:
 *   "      'no-console': 'error'," -> "no-console"
 *   "      complexity: ['error', 25]," -> "complexity"
 *   "'custom-rules': { complexity: [...] }" -> "custom-rules" (not complexity)
 */
export function extractRuleKey(line) {
  const match = new RegExp('^[\'"]?([' + RULE_ID_CHARS + ']+)[\'"]?\\s*:').exec(
    line.trim(),
  );
  if (match === null) {
    return null;
  }
  // Reject property keys that are clearly not rule names (e.g. files, rules,
  // ignores, settings, plugins, languageOptions, linterOptions) and common
  // ESLint rule-option properties (e.g. max, allow, skipBlankLines) that
  // appear inside rule config objects but are not rule keys themselves.
  const key = match[1];
  if (STRUCTURAL_KEYS.has(key)) {
    return null;
  }
  return key;
}

/**
 * Extracts the first severity value from an ESLint rule config line.
 * Recognises string severities ('error', 'warn', 'off') and numeric severities
 * (2, 1, 0), in both colon form and array form.
 *
 * Returns the severity string ('error', 'warn', 'off') or null if not found.
 */
function extractSeverityValue(line) {
  // Array form: ['error', ...] or [2, ...] or [ 'error', ...
  const arrayMatch = /\[\s*['"]?(error|warn|off|2|1|0)['"]?\s*[,\]]/.exec(line);
  if (arrayMatch !== null) {
    return normalizeSeverity(arrayMatch[1]);
  }
  // Colon form: 'rule': 'error'  or  'rule': 2
  const colonMatch = /:\s*['"]?(error|warn|off|2|1|0)['"]?\s*[,\]}]/.exec(line);
  if (colonMatch !== null) {
    return normalizeSeverity(colonMatch[1]);
  }
  return null;
}

function normalizeSeverity(raw) {
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

/**
 * Extracts a numeric threshold from an ESLint rule config line.
 *
 * Supports two forms for ceiling rules:
 *   1. Simple numeric array: complexity: ['error', 25] -> 25
 *   2. Object max form: 'max-lines': ['error', { max: 800 }] -> 800
 *
 * Returns { value, form } where form is 'numeric' or 'max', or null.
 */
function extractThresholdValue(line, ruleKey) {
  if (!CEILING_RULES.has(ruleKey)) {
    return null;
  }

  // Object max form: { max: 800 } or {max: 800}
  const maxMatch = /\bmax\s*:\s*(\d+)/.exec(line);
  if (maxMatch !== null) {
    return { value: Number(maxMatch[1]), form: 'max' };
  }

  // Simple numeric array form: ['error', 25]
  // The numeric value is the second element after the severity.
  const numericMatch =
    /\[\s*['"]?(?:error|warn|off|2|1|0)['"]?\s*,\s*(\d+)\s*[,\]]/.exec(line);
  if (numericMatch !== null) {
    return { value: Number(numericMatch[1]), form: 'numeric' };
  }

  return null;
}

/**
 * Builds a normalized rule-state snapshot from a diff content line and its
 * surrounding rule context. This unifies severity and threshold extraction
 * across ALL ESLint rule config representations (keyed same-line, keyed opener,
 * standalone multiline severity, standalone numeric threshold, standalone/object
 * max) so that cross-form comparisons work: a removed multiline severity can be
 * matched against an added same-line downgrade, and a removed standalone
 * numeric threshold can be matched against an added same-line threshold
 * increase (#2189 review finding).
 *
 * Parameters:
 *   - content: the diff content line (without +/- prefix).
 *   - ruleKey: the rule key attributed to this line by context tracking (may
 *     be null for standalone lines with no key on the same line). For keyed
 *     lines, extractRuleKey(content) takes precedence.
 *   - isStandaloneSeverity: true when this line is a standalone multiline
 *     severity value (isMultilineArraySeverityEntry or
 *     isMultilineNumericSeverityEntry).
 *   - isStandaloneNumericThreshold: true when this line is a standalone numeric
 *     threshold line (isStandaloneNumericThresholdLine) inside a ceiling rule.
 *   - isStandaloneMax: true when this line is a standalone max or object-form
 *     max line (isStandaloneMaxLine or isObjectFormMaxLine).
 *
 * Returns { ruleKey, severity, threshold, thresholdForm } where severity is
 * 'error'/'warn'/'off' or null, threshold is a number or null, thresholdForm
 * is 'numeric' or 'max' or null, and ruleKey is the extracted/attributed key
 * or null. Returns null when no rule key can be determined and no standalone
 * severity/threshold form is recognized.
 */
function buildRuleState(
  content,
  ruleKey,
  isStandaloneSeverity,
  isStandaloneNumericThreshold,
  isStandaloneMax,
) {
  // Keyed lines: the key on the line takes precedence over the context key.
  const keyedRuleKey = extractRuleKey(content);
  const effectiveKey = keyedRuleKey !== null ? keyedRuleKey : ruleKey;

  let severity = null;
  let threshold = null;
  let thresholdForm = null;

  if (isStandaloneSeverity) {
    severity = normalizeMultilineSeverity(content);
  } else if (effectiveKey !== null) {
    // Keyed same-line or opener: extract severity and threshold from the
    // full line. extractSeverityValue handles colon form, array form, etc.
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

/**
 * Returns true when a line has the shape of an ESLint rule severity assignment
 * (a rule-like key whose value is a severity) and is NOT a general JS
 * declaration/assignment statement. This is the stricter no-context fallback
 * heuristic used by compareRuleConfigChanges to avoid false positives on
 * unrelated object data that happens to use rule-like keys (e.g.
 * `const docs = { 'no-console': 'error' }` or `docs = { ... }`).
 *
 * A line qualifies when it:
 *   1. Extracts a rule key (extractRuleKey filters structural/option keys).
 *   2. Carries a severity value (string or numeric, in colon or array form).
 *   3. Does not begin with a JS statement keyword (const/let/var/function/
 *      export/import/return/throw/if/for/while/switch) or contain an assignment
 *      operator (= or =>) that would indicate arbitrary code rather than a
 *      bare rule entry inside a rules object.
 *
 * The assignment-operator check rejects ordinary assignments such as
 * `docs = { 'no-console': 'error' }` and `settings.rules = { ... }` while
 * still allowing comparisons (==, ===, !=, <=, >=) and compound operators
 * (+=, -=, etc.). This is essential because a bare rule entry inside a rules
 * object never contains a `=` token.
 */
function isRuleSeverityAssignmentShape(line) {
  if (extractRuleKey(line) === null) {
    return false;
  }
  if (extractSeverityValue(line) === null) {
    return false;
  }
  const trimmed = line.trim();
  if (
    /^(?:const|let|var|function|export|import|return|throw|if|for|while|switch|class|interface|type|enum)\b/.test(
      trimmed,
    )
  ) {
    return false;
  }
  if (/=>/.test(line) || hasAssignmentOperator(line)) {
    return false;
  }
  return true;
}

/**
 * Returns true when the line contains an ordinary assignment operator (=)
 * that is NOT part of a comparison (==, ===, !=, <=, >=) or a compound
 * operator (+=, -=, *=, etc.) or an arrow (=>). Used to reject statements
 * like `docs = { ... }` or `settings.rules = { ... }` that are not bare rule
 * entries inside a rules object.
 */
function hasAssignmentOperator(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '=') {
      continue;
    }
    const prev = line[i - 1];
    const next = line[i + 1];
    // Skip == and === (loose/strict equality): current '=' is followed by '='.
    if (next === '=') {
      continue;
    }
    // Skip !=, <=, >= and arrow =>: a comparison/arrow '=' is preceded by one
    // of these operators.
    if (prev === '=' || prev === '!' || prev === '<' || prev === '>') {
      continue;
    }
    // Skip compound assignment operators (+=, -=, *=, /=, %=, &=, |=, ^=, etc.).
    if (/[+\-*/%&|^~]/.test(prev)) {
      continue;
    }
    // A bare '=' (not part of ==, =>, <=, >=, !=, or a compound op) is an
    // ordinary assignment, which a bare rule entry never contains.
    return true;
  }
  return false;
}

/**
 * Compares a removed line and an added line from eslint.config.js to detect
 * severity downgrades and ceiling threshold loosening. Returns an array of
 * violation message strings (empty if no violation).
 *
 * Both lines must be rule-severity-assignment-shaped: a rule-like key followed
 * by a severity value, without the trappings of a general JS statement (const,
 * let, var, function, or an = assignment operator). This stricter shape check
 * prevents false positives on unrelated object data that happens to use
 * rule-like keys, e.g. `const docs = { 'no-console': 'error' }` changed to
 * `'warn'`, while still matching real rule assignment lines such as
 * `      'no-console': 'warn',`.
 *
 * Ceiling threshold detection (for CEILING_RULES only):
 *   1. Cross-form threshold increases: both the numeric array form
 *      (complexity: ['error', 25]) and the object max form ('max-lines':
 *      ['error', { max: 800 }]) are supported ceiling forms. A threshold
 *      increase is reported whenever addedThreshold.value >
 *      removedThreshold.value, regardless of form, so a rule cannot be
 *      loosened by switching forms while raising the effective ceiling
 *      (e.g. { max: 800 } -> 900, or 25 -> { max: 30 }).
 *   2. Scalar-to-threshold addition: for CEILING_RULES, transitioning from a
 *      scalar severity with no threshold (e.g. 'complexity': 'error') to any
 *      explicit threshold (e.g. 'complexity': ['error', 999]) is forbidden
 *      because it introduces a loose ceiling that did not exist before.
 */
function compareRuleConfigChanges(removedContent, addedContent) {
  const messages = [];

  if (
    !isRuleSeverityAssignmentShape(removedContent) ||
    !isRuleSeverityAssignmentShape(addedContent)
  ) {
    return messages;
  }

  const removedKey = extractRuleKey(removedContent);
  const addedKey = extractRuleKey(addedContent);

  // Only compare lines that target the same rule key.
  if (removedKey === null || addedKey === null || removedKey !== addedKey) {
    return messages;
  }

  const removedSeverity = extractSeverityValue(removedContent);
  const addedSeverity = extractSeverityValue(addedContent);

  if (removedSeverity !== null && addedSeverity !== null) {
    const removedRank = SEVERITY_RANK[removedSeverity];
    const addedRank = SEVERITY_RANK[addedSeverity];
    if (addedRank < removedRank) {
      messages.push(
        `ESLint severity downgrade for '${addedKey}' (${removedSeverity} -> ${addedSeverity}) is forbidden by #2189.`,
      );
    }
  }

  const removedThreshold = extractThresholdValue(removedContent, removedKey);
  const addedThreshold = extractThresholdValue(addedContent, addedKey);

  // Reject transitions where a known ceiling rule that previously had only a
  // scalar severity gains an explicit ceiling threshold. A scalar form like
  // 'complexity': 'error' has no threshold (extractThresholdValue returns
  // null), so the rule previously enforced the plugin default ceiling (or no
  // ceiling). Adding any explicit threshold — even a small one — introduces a
  // loose ceiling that did not exist before, which is forbidden for ceiling
  // rules. This is strictly more restrictive than comparing numeric values:
  // every threshold addition for a known ceiling rule is rejected regardless
  // of the value.
  if (
    removedThreshold === null &&
    addedThreshold !== null &&
    CEILING_RULES.has(addedKey)
  ) {
    messages.push(
      `Adding a ceiling threshold to '${addedKey}' is forbidden by #2189; ceiling rules must not gain an explicit loose ceiling.`,
    );
  }

  // Compare addedThreshold.value > removedThreshold.value whenever both
  // thresholds are non-null and the rule key matches, REGARDLESS of form. Both
  // the numeric array form (complexity: ['error', 25]) and the object max form
  // ('max-lines': ['error', { max: 800 }]) are supported ceiling forms, so a
  // rule can be loosened by switching forms while increasing the effective
  // ceiling (e.g. { max: 800 } -> 900, or 25 -> { max: 30 }). Comparing values
  // across forms catches these cross-form increases; equal or decreased values
  // are not flagged.
  if (
    removedThreshold !== null &&
    addedThreshold !== null &&
    addedThreshold.value > removedThreshold.value
  ) {
    messages.push(
      `Ceiling threshold increase for '${addedKey}' (${removedThreshold.value} -> ${addedThreshold.value}) is forbidden by #2189.`,
    );
  }

  return messages;
}

/**
 * Checks whether an added eslint.config.js line is the first array element of
 * a multiline rule config (e.g. a standalone severity string on its own line
 * inside a [ ... ] array). Used to detect severity changes in multiline arrays
 * where the removal and addition appear as separate diff lines but cannot be
 * paired by key (they have no rule key on the same line).
 */
function isMultilineArraySeverityEntry(line) {
  return /^\s*['"](error|warn|off)['"]\s*,?\s*(?:\/\/.*)?$/.test(line.trim());
}

function isMultilineNumericSeverityEntry(line) {
  return /^\s*(2|1|0)\s*,?\s*(?:\/\/.*)?$/.test(line.trim());
}

function normalizeMultilineSeverity(line) {
  const stringMatch = /^\s*['"](error|warn|off)['"]/.exec(line);
  if (stringMatch !== null) {
    return stringMatch[1];
  }
  const numericMatch = /^\s*(2|1|0)\b/.exec(line);
  if (numericMatch !== null) {
    return normalizeSeverity(numericMatch[1]);
  }
  return null;
}

/**
 * Detects a standalone max threshold line inside a multiline ceiling rule
 * config (e.g. "max: 800,"). Such lines have no rule key on the same line
 * and must be correlated with context tracking to detect threshold increases.
 * Accepts an optional quote around the key (e.g. "'max': 800,") since ESLint
 * config object keys may be quoted.
 */
function isStandaloneMaxLine(line) {
  return /^\s*['"]?max['"]?\s*:\s*\d+\s*,?\s*$/.test(line.trim());
}

/**
 * Detects the project-common max object line shape inside a multiline ceiling
 * rule config array, e.g. "{ max: 800, skipBlankLines: true, skipComments:
 * true }". Such lines have no rule key on the same line (the key is the
 * structural `max` option property) and must be correlated with context
 * tracking (currentCeilingRuleKey) to detect threshold increases without
 * matching unrelated max fields outside ceiling rules. Accepts an optional
 * quote around the key (e.g. "{ 'max': 800, ... }") since ESLint config
 * object keys may be quoted.
 */
function isObjectFormMaxLine(line) {
  return /^\s*\{?\s*['"]?max['"]?\s*:\s*\d+\b/.test(line.trim());
}

/**
 * Extracts the numeric value from a standalone max threshold line like
 * "max: 800," or an object-form max line like "{ max: 800, skipBlankLines:
 * true }". Accepts an optional quote around the key (e.g. "'max': 800").
 * Returns null if no value is found.
 */
function extractMaxValueFromStandaloneLine(line) {
  const match = /^\s*\{?\s*['"]?max['"]?\s*:\s*(\d+)/.exec(line);
  return match !== null ? Number(match[1]) : null;
}

/**
 * Detects a standalone numeric threshold line inside a multiline ceiling rule
 * config in numeric-array form, e.g. "25," or "25". Such lines have no rule
 * key on the same line and must be correlated with context tracking
 * (expectingCeilingThreshold + currentCeilingRuleKey) to detect threshold
 * increases without matching unrelated standalone numeric values. This matches
 * any bare positive integer (including 0) on its own line, but the gating
 * (expectingCeilingThreshold) ensures it is only treated as a threshold when
 * it is the second array element after a severity (#2189 review finding).
 */
function isStandaloneNumericThresholdLine(line) {
  return /^\s*\d+\s*,?\s*$/.test(line.trim());
}

/**
 * Extracts the numeric value from a standalone numeric threshold line like
 * "25," or "25". Returns null if no value is found.
 */
function extractStandaloneNumericThresholdValue(line) {
  const match = /^\s*(\d+)\s*,?\s*$/.exec(line.trim());
  return match !== null ? Number(match[1]) : null;
}

/**
 * Returns true when a line closes a rule entry, clearing the ceiling rule key
 * context so a subsequent standalone max line is not attributed to a prior
 * ceiling rule. Covers common rule-entry closure shapes found in multiline
 * ESLint rule configs:
 *   - Array form:        "],"  or  "]"
 *   - Object form:       "}],"  "} ],",  "}",  "} ,"
 * The match is whitespace-tolerant and allows an optional trailing comma.
 */

/**
 * Returns true when a line is a complete single-line rule entry that does not
 * open a multiline config (i.e. all brackets/braces opened on the line are also
 * closed on the line). This covers scalar entries like
 *   "'no-console': 'error',"
 * and inline-array/object entries like
 *   "complexity: ['error', 25]," or "'max-lines': ['error', { max: 800 }],"
 * which are fully closed on one line. Such entries do not need a subsequent
 * closure line, so insideRuleEntry must NOT be set for them — otherwise a
 * following multiline rule opener (e.g. "'max-lines': ['error', {") would be
 * ignored (insideRuleEntry still pinned), causing the multiline rule's max
 * changes to be missed (false negative) or mis-attributed.
 *
 * Returns false when the line carries a rule key but has unclosed brackets or
 * braces (a multiline opener), or when it has no rule key at all.
 *
 * Note: unlike countDiffBraceDelta (which only tracks braces for rules-block
 * depth), this function tracks BOTH brackets and braces because a rule entry
 * opener may use either form ("'rule': [" or "'rule': {") and both indicate an
 * unclosed multiline config.
 */
function isCompleteSingleLineRuleEntry(content) {
  if (extractRuleKey(content) === null) {
    return false;
  }
  return countDiffBracketAndBraceDelta(content) === 0;
}

/**
 * Returns true when a multiline rule-entry opener line (e.g. "'rule': [") opens
 * a bracket-delimited config array but does NOT contain the first array element
 * (the severity) on the same line. In ESLint rule configs the first element of
 * the array is always the severity, so when the opener has content after the
 * opening bracket (e.g. "'rule': ['error',"), the severity is already present
 * and subsequent standalone 'off'/0 lines are option values, not severities.
 *
 * This is used by updateStructuralContext to set the expectingFirstSeverity
 * Element flag: when true, the next non-comment/non-blank line inside the rule
 * entry is the first (severity) element, so standalone off/0 detection is
 * valid; when false, the severity was already seen and standalone off/0 lines
 * are option values (#2189 review finding).
 *
 * Returns false when the line does not open an unclosed bracket at all (e.g.
 * a scalar entry or an object-form opener).
 */
function openerExpectsFirstArrayElement(content) {
  // Only consider lines that open a rule-entry array (unclosed bracket).
  if (countDiffBracketAndBraceDelta(content) <= 0) {
    return false;
  }
  // Find the first opening bracket [ on the line and check if there is
  // meaningful content (a severity value or any element) after it, respecting
  // string literals and comments.
  let quote = null;
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (quote === null && ch === '/' && next === '/') {
      break;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '[') {
      // Check for non-whitespace, non-comment content after the bracket.
      for (let j = i + 1; j < content.length; j++) {
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
  }
  return false;
}

/**
 * Counts the net bracket+brace delta ({ } and [ ] minus their closings) of a
 * diff content line, respecting string literals and // comments. Used by
 * isCompleteSingleLineRuleEntry to determine whether a rule entry opens a
 * multiline config (non-zero delta) or is complete on one line (zero delta).
 */
function countDiffBracketAndBraceDelta(line) {
  let delta = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (quote === null && ch === '/' && next === '/') {
      break;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '{' || ch === '[') {
      delta += 1;
    } else if (ch === '}' || ch === ']') {
      delta -= 1;
    }
  }

  return delta;
}

/**
 * Returns true when the text preceding the `rules:` keyword at matchIndex in
 * line indicates a valid ESLint flat-config export context. Recognizes three
 * valid export-default config forms:
 *   1. `export default [...]` — array of config objects
 *   2. `export default { ... }` — a single config object
 *   3. `export default tseslint.config(...)` / `export default eslint.config(
 *      ...)` — the flat-config function-call wrapper used by this project
 *      (see eslint.config.js). This form wraps config objects in a function
 *      call that may itself take a plain config object argument, so the
 *      `rules:` property inside it IS the policy rules block.
 *
 * The check is narrowly scoped: it only matches `export default` (not bare
 * `export` or `export const`), and the text between `export default` and the
 * `rules:` keyword must be only structural config syntax (the function-call
 * wrapper identifier + `(`, or array/object openers, brackets, braces,
 * commas, whitespace). This prevents a false positive on arbitrary exports
 * like `export const config = { rules: { ... } }` (which has an identifier
 * `config` and an assignment `=` between export and rules) and
 * `export default someConfig` (which has an arbitrary identifier, not a
 * recognized config wrapper or structural opener).
 *
 * Returns true when the line starts with `export default` followed by either
 * a structural object/array opener (`[` / `{`) or a recognized flat-config
 * function-call wrapper (e.g. `tseslint.config(` / `eslint.config(`) up to the
 * rules: keyword match position.
 */
function isExportDefaultConfigContext(line, matchIndex) {
  const before = line.slice(0, matchIndex);
  const exportDefaultMatch = /^export\s+default\s+/.exec(before);
  if (exportDefaultMatch === null) {
    return false;
  }
  const afterExportDefault = before.slice(exportDefaultMatch[0].length);
  // Form 1 & 2: the text immediately after `export default` starts with an
  // array or object opener ([ or {). This matches the valid flat-config
  // export forms `export default [...]` and `export default { ... }`. It
  // rejects `export const config = {` (has `const config =` after export) and
  // `export default someConfig` (has an identifier, not a structural opener).
  if (/^[[{]/.test(afterExportDefault)) {
    return true;
  }
  // Form 3: the flat-config function-call wrapper used by this project:
  // `export default tseslint.config(` or `export default eslint.config(`. The
  // config objects are passed as arguments to the config() helper, so a
  // `rules:` property inside the call IS the policy rules block. The wrapper
  // is narrowly matched: a dotted identifier (e.g. `tseslint.config`,
  // `eslint.config`) immediately followed by `(`. Everything after the opening
  // paren is treated as structural config syntax. This rejects arbitrary
  // identifiers like `export default someConfig` (no `.config(` wrapper) and
  // `export default foo({ rules: ... })` (unrecognized wrapper name).
  return /^[$A-Za-z_][\w$]*\.config\s*\(/.test(afterExportDefault);
}

/**
 * Returns true if the text preceding the `rules:` keyword at matchIndex in
 * line indicates an arbitrary JS declaration/assignment rather than a bare
 * property inside an ESLint config object. This gates `rules: {` detection so
 * unrelated objects with a property named `rules` (e.g.
 * `const meta = { rules: { 'no-console': 'error' } }` or
 * `settings.rules = { ... }`) are not mistaken for an ESLint rule policy
 * block.
 *
 * The check mirrors isRuleSeverityAssignmentShape: a real ESLint config rules
 * property appears as a bare `rules: {` inside a config object, never preceded
 * by a declaration keyword (const/let/var/function/etc.) or an ordinary
 * assignment operator (=). This rejects obvious arbitrary declarations and
 * assignments while allowing the bare property form used in eslint.config.js.
 */
function isRulesInArbitraryContext(line, matchIndex) {
  const before = line.slice(0, matchIndex);
  const trimmed = before.trim();
  if (
    /(?:const|let|var|function|export|import|return|throw|if|for|while|switch|class|interface|type|enum)\s/.test(
      before,
    )
  ) {
    return true;
  }
  // A bare `=` (not part of ==, ===, =>, <=, >=, !=, or compound ops) before
  // the rules: keyword indicates an assignment, not a config property. This
  // catches `settings.rules = { ... }` and `config = { rules: { ... } }`.
  if (hasAssignmentOperator(before)) {
    return true;
  }
  // An arrow function => before rules: indicates arbitrary code, not a
  // config property.
  if (/=>/.test(trimmed)) {
    return true;
  }
  // A known non-rule container key (settings, languageOptions, plugins, etc.)
  // opened earlier on the same line indicates the `rules:` property is nested
  // inside application data, not an ESLint policy rules block. This catches
  // single-line forms like `settings: { rules: { 'no-console': 'off' } }` and
  // quoted-key forms like `'settings': { rules: { ... } }`
  // (#2189 review finding 2).
  //
  // However, the container must STILL BE OPEN at the `rules:` match position.
  // A closed container with a sibling `rules:` (e.g.
  // `{ languageOptions: {}, rules: { complexity: ['error', 25] } }` or
  // `export default [{ settings: {}, rules: { 'no-console': 'off' } }]`) is a
  // valid ESLint flat-config object where `rules:` IS the policy rules block.
  // Treating a merely-preceding (but closed) container as proof of nesting
  // caused a false negative that suppressed real policy violations
  // (#2189 review finding). The structural scan walks from each container
  // opener to the `rules:` match, respecting strings, // comments, braces and
  // brackets, and reports non-rule ONLY when the container object remains open
  // (brace depth > 0) at `rules:`.
  if (isRulesNestedInNonRuleContainer(line, matchIndex)) {
    return true;
  }
  return false;
}

/**
 * Returns true when the `rules:` keyword at matchIndex in line is structurally
 * nested inside a known non-rule container object (settings, languageOptions,
 * plugins, etc.) that is still open at matchIndex. This is the structural
 * counterpart to the previous "any container key appears before rules:" check
 * in isRulesInArbitraryContext.
 *
 * For each non-rule container key found as `key: {` (an opener) before
 * matchIndex, the function scans forward from that opener's opening brace to
 * matchIndex, tracking net brace/bracket depth while skipping string literals
 * and // comments. If the container remains open (depth > 0) at matchIndex,
 * then `rules:` is nested inside application data (e.g.
 * `settings: { rules: { ... } }`) and is NOT the ESLint policy rules block.
 *
 * If the container closes before matchIndex (depth <= 0), then `rules:` is a
 * SIBLING (e.g. `{ languageOptions: {}, rules: { ... } }`) and IS the policy
 * rules block — the function returns false so detection proceeds
 * (#2189 review finding).
 *
 * Only the OUTERMOST still-open container at matchIndex matters: if a container
 * opens, closes, and then `rules:` follows as a sibling, it returns false even
 * if other container keys also appear earlier on the line. This is correct
 * because a sibling `rules:` after ANY closed container is a real flat-config
 * rules block.
 */
function isRulesNestedInNonRuleContainer(line, matchIndex) {
  for (const key of NON_RULE_CONTAINER_KEYS) {
    const openerPattern = propertyKeyRegex(key, true);
    let searchFrom = 0;
    // A line may contain the same container key more than once; check each
    // occurrence as a potential opener.
    for (;;) {
      const match = openerPattern.exec(line.slice(searchFrom));
      if (match === null) {
        break;
      }
      const openerStart = searchFrom + match.index;
      // The opener must precede the rules: match.
      if (openerStart >= matchIndex) {
        break;
      }
      // Find the opening brace '{' of the container value (the regex already
      // requires it, so it is at openerStart + match[0].length - 1).
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
  return false;
}

/**
 * Scans from an opening brace at bracePos toward targetPos, tracking net
 * brace/bracket depth while skipping string literals and // comments. Returns
 * true when the object opened at bracePos is still open (depth > 0) at
 * targetPos — i.e. targetPos falls structurally inside the container.
 *
 * Brackets ([ ]) are tracked alongside braces ({ }) so a closed bracketed
 * value inside the container (e.g. an array in `settings: { a: [1], rules: {
 * ... } }`) does not affect the brace-only nesting decision. The depth is
 * brace-and-bracket combined; since the opener is a '{' (depth starts at 1),
 * reaching depth 0 means the container closed.
 */
function containerOpenAtPosition(line, bracePos, targetPos) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = bracePos; i < targetPos; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (quote === null && ch === '/' && next === '/') {
      // A // comment ends the line; the container is still open (its closing
      // brace cannot appear after a // comment on the same line).
      break;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
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

/**
 * ESLint config property keys whose object value is a known non-rule container.
 * A `rules:` property nested inside one of these (e.g.
 * `settings: { rules: { 'no-console': 'off' } }`) is NOT the ESLint policy
 * rules object — it is application data consumed by plugins/shared configs.
 * Hoisted to module scope so it is not recreated on every call (#2189 review
 * finding 2).
 */
const NON_RULE_CONTAINER_KEYS = new Set([
  'settings',
  'languageOptions',
  'plugins',
  'linterOptions',
  'processor',
  'globals',
  'parserOptions',
  'parser',
  'env',
  'extends',
  'overrides',
  'ecmaFeatures',
  'sourceType',
]);

/**
 * Builds a RegExp that matches a JavaScript property key followed by a colon
 * and (optionally) an opening brace, accepting the key with optional
 * single/double quotes around it. This shared helper centralizes the
 * property-key regex construction that was previously duplicated as
 * `\bKEY\s*:\s*\{` literal patterns in isRulesInArbitraryContext and
 * isNonRuleContainerOpen, which missed quoted config keys such as
 * `'settings': {` or `"languageOptions": {` (#2189 review finding).
 *
 * Parameters:
 *   - key: the unquoted property key name (e.g. 'settings', 'rules').
 *   - openBrace: when true, the pattern requires `\s*:\s*\{` (the key is
 *     opening an object); when false (default), it requires just `\s*:` (the
 *     key is present with a colon, no brace requirement).
 *
 * Returns a RegExp.
 */
function propertyKeyRegex(key, openBrace = false) {
  const suffix = openBrace ? '\\s*:\\s*\\{' : '\\s*:';
  // (?:^|[^\w]) ensures the key is not a substring of a larger identifier
  // (e.g. so 'parser' does not match inside 'parserOptions'), while still
  // allowing the key to be preceded by a quote, whitespace, or start of line.
  // The optional quotes around the key support quoted config keys such as
  // 'settings' or "languageOptions" (#2189 review finding).
  return new RegExp('(?:^|[^\\w])[\'"]?' + key + '[\'"]?' + suffix);
}

/**
 * Returns true when the line opens a known non-rule container property
 * (e.g. `settings: {`, `languageOptions: {`) whose object value may legally
 * contain a nested `rules:` property that is NOT the ESLint policy rules
 * block. This is the context-tracking counterpart to isRulesBlockOpen: when
 * inside such a container, a nested `rules: {` must not be treated as a
 * policy rules block (#2189 review finding 2).
 *
 * Detects a bare property key from NON_RULE_CONTAINER_KEYS followed by an
 * opening brace. Rejects declaration/assignment contexts (mirrors
 * isRulesInArbitraryContext) so a const declaration with a settings property
 * is handled by the arbitrary-object tracker instead.
 */
function isNonRuleContainerOpen(line) {
  for (const key of NON_RULE_CONTAINER_KEYS) {
    const pattern = propertyKeyRegex(key, true);
    const match = pattern.exec(line);
    if (match !== null && !isRulesInArbitraryContext(line, match.index)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the line opens a rules: { ... } object in an eslint.config.js
 * config block. Detects the "rules:" key followed by an opening brace. Rejects
 * arbitrary declarations/assignments (e.g. const meta = { rules: { ... } })
 * so unrelated config fields named "rules" do not produce false positives
 * (#2189 review finding). The export-default flat-config form (e.g.
 * `export default { rules: { ... } }`) is a valid ESLint config export and is
 * allowed via isExportDefaultConfigContext (#2189 review finding).
 */
function isRulesBlockOpen(line) {
  const match = propertyKeyRegex('rules', true).exec(line);
  if (match === null) {
    return false;
  }
  if (
    isRulesInArbitraryContext(line, match.index) &&
    !isExportDefaultConfigContext(line, match.index)
  ) {
    return false;
  }
  return true;
}

/**
 * Returns true when a line opens an arbitrary JS object literal via a
 * declaration keyword (const/let/var) or an assignment operator (=) followed
 * by an opening brace, e.g. `const meta = {` or `meta = {`. This is used to
 * track arbitrary object nesting so a nested `rules: {` property inside the
 * object is NOT mistaken for an ESLint config rules block (#2189 review
 * finding 1).
 *
 * Only matches single-line openers where the brace is opened but the `rules:`
 * keyword is NOT on the same line (the `rules:` case is already handled by
 * isRulesInArbitraryContext). If the line opens a brace but also contains
 * `rules:`, isRulesBlockOpen / isRulesInArbitraryContext handles it.
 */
function isArbitraryObjectOpener(line) {
  const trimmed = line.trim();
  // Must start with a declaration keyword or contain an assignment operator.
  const isDeclaration = /^(?:export\s+)?(?:const|let|var)\s+/.test(trimmed);
  const hasAssign = hasAssignmentOperator(line);
  if (!isDeclaration && !hasAssign) {
    return false;
  }
  // Must open an object brace on this line.
  if (!/\{\s*$/.test(trimmed) && !/\{[^}]*$/.test(trimmed)) {
    return false;
  }
  // Must NOT contain `rules:` on this line (that's handled by
  // isRulesBlockOpen / isRulesInArbitraryContext).
  if (/\brules\s*:/.test(line)) {
    return false;
  }
  return true;
}

/**
 * Extracts the DIRECT value of the top-level key in a segment — the text that
 * immediately follows the key's colon. This is used by extractInlineRules
 * Entries to anchor severity detection to the rule's own value, not to nested
 * properties inside a container value.
 *
 * For a segment like `'custom-rules': { complexity: ['error', 50] }`, the
 * direct value is `{ complexity: ['error', 50] }` (a plain object container),
 * so the caller can detect that this is NOT a rule entry. For
 * `complexity: ['error', 50]`, the direct value is `['error', 50]` (a rule
 * config array). For `'no-console': 'error'`, the direct value is `'error'`
 * (a scalar severity).
 *
 * Returns the trimmed value text after the colon, or null if no top-level
 * key: colon is found at the start of the trimmed segment (#2189 review
 * finding).
 */
function extractDirectValueAfterKey(segment) {
  const trimmed = segment.trim();
  // Match the top-level key (quoted or unquoted) followed by a colon. This
  // mirrors the anchored extractRuleKey regex and uses the same centralized
  // RULE_ID_CHARS character class so scoped rule IDs are recognized
  // consistently (#2189 review finding).
  const keyMatch = new RegExp(
    '^[\'"]?([' + RULE_ID_CHARS + ']+)[\'"]?\\s*:',
  ).exec(trimmed);
  if (keyMatch === null) {
    return null;
  }
  return trimmed.slice(keyMatch[0].length).trim();
}

/**
 * Extracts inline rule entries from a single-line nested rules object such as
 * `rules: { 'no-console': 'off', complexity: ['error', 50] }`. Returns an
 * array of { key, content } where content is the inline segment text for each
 * rule-like key/severity pair found after the `rules: {` opener and before the
 * matching close brace on the same line. Returns an empty array when the line
 * does not open a rules object or has no inline rule entries.
 *
 * This covers the single-line nested rules form that extractRuleKey and the
 * off/severity checks otherwise bypass (extractRuleKey returns the first key
 * on the line, which is `rules`, a structural key that yields null).
 */
function extractInlineRulesEntries(line) {
  const openMatch = propertyKeyRegex('rules', true).exec(line);
  if (openMatch === null) {
    return [];
  }
  // Reject arbitrary declarations/assignments (e.g. const meta = { rules: {
  // 'no-console': 'error' } }) so unrelated config fields named "rules" do not
  // produce false positives. Mirrors isRulesBlockOpen gating (#2189 review
  // finding). The export-default flat-config form (e.g.
  // `export default [{ rules: { ... } }]`) is a valid ESLint config export and
  // is allowed via isExportDefaultConfigContext (#2189 review finding).
  if (
    isRulesInArbitraryContext(line, openMatch.index) &&
    !isExportDefaultConfigContext(line, openMatch.index)
  ) {
    return [];
  }
  const start = openMatch.index + openMatch[0].length;
  // Walk to the matching close brace on the same line, respecting nested
  // braces/brackets and string literals so an inline `}` inside a value does
  // not terminate the scan early.
  let depth = 1;
  let quote = null;
  let escaped = false;
  let end = line.length;
  for (let i = start; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const inline = line.slice(start, end);
  // Split into comma-separated segments at the top level (depth 0 relative to
  // the inline content) so array/object values are kept whole.
  const segments = [];
  let segStart = 0;
  let segDepth = 0;
  let segQuote = null;
  let segEscaped = false;
  for (let i = 0; i < inline.length; i++) {
    const ch = inline[i];
    if (segEscaped) {
      segEscaped = false;
      continue;
    }
    if (segQuote !== null) {
      if (ch === '\\') {
        segEscaped = true;
      } else if (ch === segQuote) {
        segQuote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      segQuote = ch;
    } else if (ch === '{' || ch === '[') {
      segDepth += 1;
    } else if (ch === '}' || ch === ']') {
      segDepth -= 1;
    } else if (ch === ',' && segDepth === 0) {
      segments.push(inline.slice(segStart, i));
      segStart = i + 1;
    }
  }
  segments.push(inline.slice(segStart));
  const entries = [];
  for (const segment of segments) {
    const key = extractRuleKey(segment);
    if (key === null) {
      continue;
    }
    // Extract only the DIRECT value of the top-level key (the text after the
    // key's colon) so severity detection does not misparse nested properties
    // inside a container value. A segment like
    // `'custom-rules': { complexity: ['error', 50] }` has a direct value
    // starting with `{` (a plain object container), so it is NOT a rule
    // entry and must be skipped. A real rule entry's direct value is either a
    // scalar severity (e.g. `'error'`) or a rule config array (starts with
    // `[`). This anchoring prevents false positives where a nested
    // severity-like value inside an unrelated container is mistaken for the
    // rule's severity (#2189 review finding).
    const directValue = extractDirectValueAfterKey(segment);
    if (directValue === null || /^\{/.test(directValue.trim())) {
      // No direct value, or the direct value is a plain object container
      // (not a rule config array or scalar severity): skip this segment.
      continue;
    }
    // Append a sentinel terminator so extractSeverityValue (which expects a
    // trailing ,/}/] after the severity) matches the last inline entry before
    // the closing brace, where the raw segment has no trailing delimiter.
    const padded = segment.trim() + ',';
    if (extractSeverityValue(padded) !== null) {
      entries.push({ key, content: padded });
    }
  }
  return entries;
}

/**
 * Counts the net brace delta ({ minus }) of a diff content line, respecting
 * string and regex literals and // comments so braces inside quotes or
 * comments are not counted. Used for contextual rules-block tracking in diffs.
 */
function countDiffBraceDelta(line) {
  return countDiffBraceDeltaWithBlockState(line, false).delta;
}

function countDiffBraceDeltaWithBlockState(line, inBlockComment) {
  let delta = 0;
  let quote = null;
  let escaped = false;
  let stillInBlockComment = inBlockComment;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (quote === null && stillInBlockComment) {
      if (ch === '*' && next === '/') {
        stillInBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote === null && ch === '/' && next === '*') {
      stillInBlockComment = true;
      i += 1;
      continue;
    }
    if (quote === null && ch === '/' && next === '/') {
      break;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      delta += 1;
    } else if (ch === '}') {
      delta -= 1;
    }
  }

  return { delta, inBlockComment: stillInBlockComment };
}

export function checkDiff(diff) {
  const violations = [];
  const policyState = {
    removedInlineDisableBan: null,
    addedInlineDisableBan: false,
    removedMaxWarnings: null,
    addedMaxWarnings: false,
  };
  let file = '';
  let newLine = 0;
  let oldLine = 0;

  // Buffer for removed eslint.config.js rule lines pending correlation with
  // added lines in the same hunk. Each entry: { content, lineNumber }.
  let pendingRemovedConfigs = [];

  // Unified normalized rule-state buffer for cross-form correlation. When a
  // rule's representation changes between removed and added (e.g. multiline
  // removed severity -> same-line added, or same-line removed -> multiline
  // added), the form-specific buffers (pendingRemovedConfigs,
  // pendingRemovedMultilineSeverity, etc.) do not match up because removed and
  // added lines go into different buffers. This buffer collects the normalized
  // severity and threshold values for each rule key across ALL forms on the
  // removed side, and the added side compares against it by rule key. Each
  // entry: { ruleKey, severity, threshold, thresholdForm, lineNumber }. The
  // severity is 'error'/'warn'/'off' or null; threshold is a number or null;
  // thresholdForm is 'numeric' or 'max' or null (#2189 review finding).
  let pendingRemovedRuleState = [];

  // Buffer for removed multiline array severity entries (standalone severity
  // values on their own line inside a [ ... ] array, e.g. 'error',). These
  // have no rule key on the same line so they cannot be paired by key.
  let pendingRemovedMultilineSeverity = [];

  // Buffer for removed standalone max threshold lines (e.g. "max: 800,") from
  // multiline ceiling rule configs. Correlated against added max lines using
  // currentCeilingRuleKey context to detect threshold increases.
  let pendingRemovedMultilineMax = [];

  // Buffer for removed standalone numeric threshold lines (e.g. "25,") from
  // multiline ceiling rule configs in numeric-array form (severity and
  // threshold on separate lines). Correlated against added numeric threshold
  // lines using currentCeilingRuleKey context to detect threshold increases
  // (#2189 review finding).
  let pendingRemovedMultilineNumericThreshold = [];

  // Buffer for removed inline rule entries from single-line nested rules
  // objects (e.g. "rules: { 'no-console': 'error' }"). Each entry is
  // { key, content } so added inline entries can be correlated by key for
  // severity/threshold detection in single-line nested rules forms.
  let pendingRemovedInlineRules = [];

  // Context tracking for multiline eslint.config.js diffs. rulesBraceDepth is
  // non-null while we are inside a rules: { ... } block (gates multiline
  // severity detection to avoid false positives on unrelated arrays). The
  // brace delta is approximated from diff content lines.
  let rulesBraceDepth = null;

  // Current ceiling rule key for the most recent rule-entry context (from
  // lines carrying a rule key). Allows standalone max: N lines without a key
  // to be attributed to the enclosing ceiling rule for threshold-increase
  // detection. Reset to null on non-ceiling rule keys and rule-entry closure.
  let currentCeilingRuleKey = null;

  // Current rule key for the most recent rule-entry context (any rule, not
  // just ceiling rules). Allows standalone multiline severity values (which
  // carry no rule key on their own line) to be attributed to their enclosing
  // rule so removed/added multiline severities from different rules are not
  // cross-paired. Reset to null on rule-entry closure and rules-block close.
  let currentRuleKey = null;

  // True while inside a rule entry's config (between the rule-entry opener key
  // and the rule-entry closure). Used so a custom option key not in
  // STRUCTURAL_KEYS (e.g. "customOption") inside a ceiling rule config does not
  // replace currentRuleKey/currentCeilingRuleKey, which would cause false
  // negatives for later multiline severity/max changes. Cleared on rule-entry
  // closure and rules-block close.
  let insideRuleEntry = false;

  // Per-rule-entry bracket+brace depth. When a rule-entry opener with unclosed
  // brackets/braces is detected (e.g. "'rule': [" or "'rule': ['error', {"),
  // this is set to the net bracket+brace delta opened on that opener line. Each
  // subsequent line adjusts the depth by its bracket+brace delta. When the
  // depth returns to <= 0, the rule entry is closed. This correctly handles
  // NESTED option objects inside a multiline rule config: a bare "}" that
  // closes a nested object (e.g. the option object in
  //   'max-lines': ['error', {
  //     nested: { ... },   // <- this } does NOT close the rule entry
  //     max: 900,
  //   }]
  // reduces the depth but does NOT close the rule entry, so later max/severity
  // lines in the same rule are still correctly attributed. The previous
  // isRuleEntryClosure heuristic treated any bare } / }, as closing the whole
  // rule entry, clearing currentRuleKey/currentCeilingRuleKey too early
  // (#2189 review finding). Null when not inside a rule entry.
  let ruleEntryDepth = null;

  // True when the current multiline rule entry is still expecting its first
  // array element (the severity). ESLint rule config arrays have the form
  // [severity, options...], so only the FIRST element can be a severity value.
  // Standalone off/0 detection (isStandaloneOffRuleValue) is only valid in this
  // state: once the first element is seen, subsequent standalone 'off' or 0
  // lines are option values (e.g. modes: ['off'] inside ['error', { ... }]),
  // not rule severities. Set when a multiline rule-entry array opener (e.g.
  // "'rule': [") is detected without a severity on the opener line; cleared
  // after the first non-comment/non-blank element, on rule-entry closure, and
  // on rules-block close. This fixes a false positive where a rule option
  // array containing 'off' or 0 inside an error-level rule config was
  // incorrectly rejected (#2189 review finding).
  let expectingFirstSeverityElement = false;

  // True when the current multiline ceiling rule entry has seen its severity
  // element and is expecting a standalone numeric threshold line (the second
  // array element, e.g. 25 in complexity: ['error', 25] split across lines).
  // Set when the severity element is seen for a ceiling rule in a multiline
  // array (either as a standalone line or on the opener), cleared after the
  // numeric threshold is seen, on rule-entry closure, and on rules-block
  // close. This tracks the common multiline numeric-array shape where the
  // severity and threshold are separate array elements on separate lines
  // (#2189 review finding).
  let expectingCeilingThreshold = false;

  // --- Removed-side rule context (mirrors post-change context for removed
  // lines). In realistic Git unified-diff ordering, adjacent changed opener
  // and value lines are emitted as removed-then-added:
  //   - 'no-console': [
  //   -   'error',
  //   + 'no-console': [
  //   +   'warn',
  // The removed severity is processed BEFORE the added opener sets the
  // post-change currentRuleKey, so bufferRemovedConfig would see a null key
  // and skip buffering — causing a false negative. To fix this, removed
  // eslint.config.js lines maintain their own parallel rule context that
  // reflects the pre-change file view. These are NEVER used for brace-depth
  // tracking (removed lines must not mutate rulesBraceDepth to avoid
  // double-counting), only for attributing removed multiline severity/max
  // values to their enclosing rule on the removed side.
  let removedRulesBraceDepth = null;
  let removedCurrentRuleKey = null;
  let removedCurrentCeilingRuleKey = null;
  let removedInsideRuleEntry = false;

  // Removed-side counterpart to ruleEntryDepth. Tracks the per-rule-entry
  // bracket+brace depth for the removed (pre-change) side so the removed-side
  // rule context correctly handles nested option objects inside multiline rule
  // configs (#2189 review finding).
  let removedRuleEntryDepth = null;

  // Removed-side counterpart to expectingFirstSeverityElement. Tracks whether
  // the current removed-side multiline rule entry is still expecting its first
  // severity element, so removed standalone severity entries are only buffered
  // when they are actual severities (the first array element), not option
  // values (#2189 review finding).
  let removedExpectingFirstSeverityElement = false;

  // Removed-side counterpart to expectingCeilingThreshold. Tracks whether the
  // current removed-side multiline ceiling rule entry has seen its severity and
  // is expecting a standalone numeric threshold line, so removed standalone
  // numeric threshold lines are buffered with the removed-side ceiling rule key
  // for correlation against added threshold lines (#2189 review finding).
  let removedExpectingCeilingThreshold = false;

  // Tracks brace depth inside arbitrary JS object declarations/assignments
  // outside an ESLint rules block (e.g. `const meta = { ... }` or
  // `meta = { ... }`). When non-null and > 0, a `rules: {` property inside the
  // arbitrary object is NOT treated as an ESLint config rules block, preventing
  // false positives for unrelated config fields named `rules`. This is set when
  // a line opens an object via a declaration keyword (const/let/var) or an
  // assignment operator (=) while rulesBraceDepth is null. It is cleared
  // (returned to null) when the braces close back to the base level. Only
  // applied when rulesBraceDepth is null (not already inside a tracked ESLint
  // rules block). (#2189 review finding 1.)
  let arbitraryObjectDepth = null;

  // Removed-side counterpart to arbitraryObjectDepth. Tracks brace depth
  // inside arbitrary JS object declarations on the removed (pre-change) side
  // so a removed `rules: {` property inside an arbitrary object is NOT
  // treated as an ESLint config rules block on the removed side either
  // (#2189 review finding 1).
  let removedArbitraryObjectDepth = null;

  // Tracks brace depth inside a known non-rule container property
  // (e.g. settings: { ... }, languageOptions: { ... }) outside an ESLint rules
  // block. When non-null and > 0, a nested `rules: {` property is NOT treated
  // as an ESLint config rules block, because it is application data consumed by
  // plugins/shared configs (e.g. settings: { rules: { 'no-console': 'off' } }).
  // This closes the gap where isRulesInArbitraryContext only caught
  // declaration/assignment contexts, not bare property nesting inside config
  // option objects. Set when a line opens a non-rule container
  // (isNonRuleContainerOpen) while rulesBraceDepth is null; cleared when the
  // braces close back to the base level. Only applied when rulesBraceDepth is
  // null (#2189 review finding 2).
  let nonRuleContainerDepth = null;

  // Removed-side counterpart to nonRuleContainerDepth. Tracks brace depth
  // inside a known non-rule container property on the removed (pre-change)
  // side so a removed nested `rules: {` is NOT treated as an ESLint config
  // rules block on the removed side either (#2189 review finding 2).
  let removedNonRuleContainerDepth = null;

  // True when the current hunk has at least one unchanged context line. The
  // zero-context fallback for compareRuleConfigChanges only fires when the
  // hunk has NO context lines (a truly minimal hunk where we cannot determine
  // rules-block membership). When context lines are present but rulesBraceDepth
  // is still null, we are definitively outside a rules block, so the fallback
  // must NOT fire (prevents false positives on multiline unrelated objects like
  // const thresholds = { complexity: ['error', 25] -> ['error', 26] }).
  let hasHunkContext = false;

  // Removed completedDirectiveCleanupScopes blocks were historical locks that
  // duplicated the global eslint-comments/no-use rule. Issue #2227 removes
  // those redundant blocks, so their local no-use entries are not the global
  // inline-disable ban that the diff guard protects.
  let removedCompletedDirectiveCleanupBlockDepth = null;
  let removedCompletedDirectiveCleanupBlockInComment = false;
  // Template literal tracking for TS suppression detection (#2189 review
  // finding 2). Template literals can span multiple diff lines; the
  // single-line hasTypeScriptSuppression scanner only skips backticks within
  // one line. This tracks the full template literal state across added and
  // context lines so:
  //   - directive text inside a multiline template body (literal text,
  //     exprDepth === 0) does not produce a false positive, AND
  //   - a real suppression comment inside a multiline ${ ... } expression
  //     (exprDepth > 0) IS still flagged because it is executable code.
  // A boolean-only inTemplate flag loses the expression/text distinction,
  // causing real suppressions inside template expressions to be missed.
  // Reset on file and hunk boundaries.
  let templateLiteralState = { inTemplate: false, exprDepth: 0 };

  function flushPendingConfigs() {
    pendingRemovedConfigs = [];
    pendingRemovedRuleState = [];
    pendingRemovedMultilineSeverity = [];
    pendingRemovedMultilineMax = [];
    pendingRemovedMultilineNumericThreshold = [];
    pendingRemovedInlineRules = [];
    rulesBraceDepth = null;
    currentCeilingRuleKey = null;
    currentRuleKey = null;
    insideRuleEntry = false;
    ruleEntryDepth = null;
    expectingFirstSeverityElement = false;
    expectingCeilingThreshold = false;
    removedRulesBraceDepth = null;
    removedCurrentCeilingRuleKey = null;
    removedCurrentRuleKey = null;
    removedInsideRuleEntry = false;
    removedRuleEntryDepth = null;
    removedExpectingFirstSeverityElement = false;
    removedExpectingCeilingThreshold = false;
    arbitraryObjectDepth = null;
    removedArbitraryObjectDepth = null;
    nonRuleContainerDepth = null;
    removedNonRuleContainerDepth = null;
    hasHunkContext = false;
    removedCompletedDirectiveCleanupBlockDepth = null;
    removedCompletedDirectiveCleanupBlockInComment = false;
    templateLiteralState = { inTemplate: false, exprDepth: 0 };
  }

  /**
   * Updates the removed-side rule context from a removed eslint.config.js
   * line. This is a parallel context tracker to updateStructuralContext but
   * for the removed (pre-change) side. It mirrors the post-change logic:
   *   - Opens the removed rules block on "rules: {".
   *   - Tracks removedRulesBraceDepth via brace deltas (NOT shared with the
   *     post-change rulesBraceDepth, so a changed opener containing { does
   *     not double-count brace depth on the post-change side).
   *   - Tracks removedCurrentRuleKey / removedCurrentCeilingRuleKey with
   *     removedInsideRuleEntry gating so nested option keys inside a removed
   *     rule config object do not replace the enclosing rule key.
   *   - Resets the removed rule keys on rule-entry closure and rules-block
   *     close.
   *
   * This mirrors updateStructuralContext exactly except it writes the
   * removed-prefixed state. Keeping the two contexts separate is essential:
   * the post-change context reflects the new-file brace nesting (used for
   * added-line gating and brace-depth double-count avoidance), while the
   * removed context reflects the pre-change rule attribution so removed
   * multiline severity/max values are correctly attributed even when the
   * removed opener precedes the added opener in Git diff ordering.
   */
  function updateRemovedStructuralContext(content) {
    if (file !== 'eslint.config.js') {
      return;
    }
    // Track arbitrary object declarations on the removed side too, mirroring
    // updateStructuralContext, so a removed `rules: {` property inside an
    // arbitrary object is NOT treated as an ESLint config rules block
    // (#2189 review finding 1).
    if (removedRulesBraceDepth === null) {
      if (
        removedArbitraryObjectDepth === null &&
        isArbitraryObjectOpener(content) &&
        !isRulesBlockOpen(content)
      ) {
        removedArbitraryObjectDepth = 0;
      }
      if (removedArbitraryObjectDepth !== null) {
        removedArbitraryObjectDepth += countDiffBraceDelta(content);
        if (removedArbitraryObjectDepth <= 0) {
          removedArbitraryObjectDepth = null;
        }
      }
      // Track known non-rule containers (settings, languageOptions, etc.) on
      // the removed side so a nested `rules: {` inside one is NOT treated as
      // an ESLint config rules block (#2189 review finding 2).
      if (
        removedNonRuleContainerDepth === null &&
        isNonRuleContainerOpen(content)
      ) {
        removedNonRuleContainerDepth = 0;
      }
      if (removedNonRuleContainerDepth !== null) {
        removedNonRuleContainerDepth += countDiffBraceDelta(content);
        if (removedNonRuleContainerDepth <= 0) {
          removedNonRuleContainerDepth = null;
        }
      }
    }
    const rulesOpensHere =
      isRulesBlockOpen(content) &&
      removedRulesBraceDepth === null &&
      removedArbitraryObjectDepth === null &&
      removedNonRuleContainerDepth === null;
    if (rulesOpensHere) {
      removedRulesBraceDepth = 0;
      removedInsideRuleEntry = false;
      removedExpectingFirstSeverityElement = false;
      removedExpectingCeilingThreshold = false;
    }
    if (removedRulesBraceDepth !== null) {
      const delta = countDiffBraceDelta(content);
      removedRulesBraceDepth += delta;
      if (removedRulesBraceDepth <= 0) {
        removedRulesBraceDepth = null;
        removedCurrentCeilingRuleKey = null;
        removedCurrentRuleKey = null;
        removedInsideRuleEntry = false;
        removedExpectingFirstSeverityElement = false;
        removedExpectingCeilingThreshold = false;
        return;
      }
      // Per-rule-entry depth-based closure tracking. When inside a rule entry,
      // adjust the bracket+brace depth. A NESTED option object's closing brace
      // (e.g. a bare "}," inside a multiline rule config) reduces the depth but
      // does NOT close the rule entry unless the depth reaches zero. The
      // previous isRuleEntryClosure heuristic treated any bare } / }, as
      // closing the whole rule entry, clearing currentCeilingRuleKey too early
      // so later max/severity-like lines in the same rule were missed or
      // misclassified (#2189 review finding).
      //
      // A duplicate opener (a changed opener line, e.g. when a rule's
      // representation changes between multiline and same-line) carries the
      // SAME rule key as the current entry and would double-count its brackets
      // if added to the depth. Such lines are skipped.
      if (
        removedInsideRuleEntry &&
        removedRuleEntryDepth !== null &&
        !(
          removedCurrentRuleKey !== null &&
          extractRuleKey(content) === removedCurrentRuleKey
        )
      ) {
        removedRuleEntryDepth += countDiffBracketAndBraceDelta(content);
        if (removedRuleEntryDepth <= 0) {
          removedCurrentCeilingRuleKey = null;
          removedCurrentRuleKey = null;
          removedInsideRuleEntry = false;
          removedRuleEntryDepth = null;
          removedExpectingFirstSeverityElement = false;
          removedExpectingCeilingThreshold = false;
        } else if (removedExpectingFirstSeverityElement) {
          if (
            isMultilineArraySeverityEntry(content) ||
            isMultilineNumericSeverityEntry(content)
          ) {
            removedExpectingFirstSeverityElement = false;
            // The severity element was just seen. For a ceiling rule, the next
            // standalone numeric line is the threshold.
            removedExpectingCeilingThreshold =
              removedCurrentCeilingRuleKey !== null;
          }
        } else if (
          removedExpectingCeilingThreshold &&
          isStandaloneNumericThresholdLine(content)
        ) {
          // A standalone numeric threshold line was seen (buffered by
          // bufferRemovedConfig). Clear the expectation so a subsequent numeric
          // line (an option value) is not mistaken for a second threshold.
          removedExpectingCeilingThreshold = false;
        }
      }
      if (!removedInsideRuleEntry) {
        const key = extractRuleKey(content);
        if (key !== null) {
          removedCurrentRuleKey = key;
          removedCurrentCeilingRuleKey = CEILING_RULES.has(key) ? key : null;
          if (!isCompleteSingleLineRuleEntry(content)) {
            removedInsideRuleEntry = true;
            removedRuleEntryDepth = countDiffBracketAndBraceDelta(content);
            removedExpectingFirstSeverityElement =
              openerExpectsFirstArrayElement(content);
            // When the severity is already on the opener line (e.g.
            // "'complexity': ['error',"), the next standalone numeric line is
            // the threshold for a ceiling rule. When the opener has no
            // severity, expectingFirstSeverityElement is true and the
            // threshold expectation is set only after the severity is seen
            // below.
            removedExpectingCeilingThreshold =
              !removedExpectingFirstSeverityElement &&
              removedCurrentCeilingRuleKey !== null;
          }
        }
      }
    }
  }

  /**
   * Buffers removed eslint.config.js rule config entries (same-key rule lines,
   * standalone multiline severities, standalone max threshold lines, and inline
   * rules entries) for later correlation with added lines in the same hunk.
   *
   * Critically, removed lines do NOT mutate the post-change structural brace
   * context (rulesBraceDepth) or the post-change current rule/ceiling-rule
   * key. This avoids double-counting brace depth when a multiline rule opener
   * containing { is both removed and added (a change), which would otherwise
   * leave the guard falsely inside a rules block after it closes. Only context
   * and added lines update post-change structural context
   * (see updateStructuralContext), producing the correct post-change/new-file
   * view of brace nesting.
   *
   * Removed multiline severity/max values are attributed using the
   * REMOVED-SIDE rule context (removedCurrentRuleKey /
   * removedCurrentCeilingRuleKey), which mirrors the post-change context but
   * reflects the pre-change file view. This is essential for realistic Git
   * diff ordering where adjacent changed opener and value lines are emitted
   * removed-then-added (e.g. "- 'no-console': [", "-   'error',",
   * "+ 'no-console': [", "+   'warn',"): the removed severity is processed
   * before the added opener sets the post-change currentRuleKey, so without
   * a separate removed-side context the removed severity would be unbuffered
   * and the downgrade missed (false negative).
   *
   * The removed-side rule key is stored with each buffered entry so
   * removed/added multiline entries from different rules in the same hunk are
   * not cross-paired.
   */
  function bufferRemovedConfig(content, currentLine) {
    if (file !== 'eslint.config.js') {
      return;
    }
    // Do not buffer keyed entries while inside an existing rule-entry config
    // object (removedInsideRuleEntry). STRUCTURAL_KEYS cannot cover every
    // custom/plugin-specific option field, so a keyed entry such as
    // customOption: 'error' would be mistaken for a rule assignment and
    // buffered for same-rule severity comparison. Only the actual rule-entry
    // opener at the rules-object level (when removedInsideRuleEntry is false)
    // qualifies.
    if (!removedInsideRuleEntry && extractRuleKey(content) !== null) {
      pendingRemovedConfigs.push({ content, lineNumber: currentLine });
    }
    // Only buffer standalone severity values when inside a rules: { ... }
    // context (removed-side) to avoid false positives on unrelated arrays.
    // The removed-side rule key is stored with the entry so removed/added
    // severities from different multiline rules in the same hunk are not
    // cross-paired. Gated to removedExpectingFirstSeverityElement: only the
    // first array element is the severity; subsequent standalone severity-like
    // lines are option values (#2189 review finding).
    if (
      removedRulesBraceDepth !== null &&
      removedCurrentRuleKey !== null &&
      removedExpectingFirstSeverityElement &&
      (isMultilineArraySeverityEntry(content) ||
        isMultilineNumericSeverityEntry(content))
    ) {
      pendingRemovedMultilineSeverity.push({
        content,
        lineNumber: currentLine,
        ruleKey: removedCurrentRuleKey,
      });
    }
    // Buffer standalone max threshold lines and project-common object-form
    // max lines for multiline ceiling rule threshold-increase correlation.
    // The removed-side ceiling rule key is stored with the entry so
    // removed/added max lines from different ceiling rules in the same
    // hunk are not cross-attributed.
    if (
      removedRulesBraceDepth !== null &&
      removedCurrentCeilingRuleKey !== null &&
      (isStandaloneMaxLine(content) || isObjectFormMaxLine(content))
    ) {
      pendingRemovedMultilineMax.push({
        content,
        lineNumber: currentLine,
        ruleKey: removedCurrentCeilingRuleKey,
      });
    }
    // Buffer standalone numeric threshold lines (e.g. "25,") from multiline
    // ceiling rule configs in numeric-array form where the severity and
    // threshold are on separate lines. Gated to removedExpectingCeilingThreshold
    // so only the second array element (the threshold after the severity) is
    // buffered, not subsequent unrelated standalone numeric values (#2189
    // review finding). The removed-side ceiling rule key is stored so
    // removed/added numeric thresholds from different ceiling rules in the
    // same hunk are not cross-attributed.
    if (
      removedRulesBraceDepth !== null &&
      removedCurrentCeilingRuleKey !== null &&
      removedExpectingCeilingThreshold &&
      isStandaloneNumericThresholdLine(content)
    ) {
      pendingRemovedMultilineNumericThreshold.push({
        content,
        lineNumber: currentLine,
        ruleKey: removedCurrentCeilingRuleKey,
      });
    }
    // Buffer inline rule entries from single-line nested rules objects for
    // severity/threshold correlation with added inline entries. Gated to
    // removedArbitraryObjectDepth === null so a `rules:` property inside an
    // arbitrary object on the removed side is not treated as an ESLint config
    // rules block (#2189 review finding 1).
    if (removedArbitraryObjectDepth === null) {
      for (const entry of extractInlineRulesEntries(content)) {
        pendingRemovedInlineRules.push({
          key: entry.key,
          content: entry.content,
          lineNumber: currentLine,
        });
      }
    }
    // Collect the normalized rule state for cross-form correlation. This
    // unifies severity and threshold extraction across ALL forms (keyed
    // same-line, keyed opener, standalone multiline severity, standalone
    // numeric threshold, standalone/object max) so that when a rule's
    // representation changes between removed and added, the removed state is
    // still matched against the added state by rule key (#2189 review finding).
    // The standalone forms are gated to the removed-side rules-block context
    // to avoid false positives on unrelated arrays.
    if (
      removedRulesBraceDepth !== null ||
      (!removedInsideRuleEntry && extractRuleKey(content) !== null)
    ) {
      const removedIsStandaloneSeverity =
        removedRulesBraceDepth !== null &&
        removedCurrentRuleKey !== null &&
        removedExpectingFirstSeverityElement &&
        (isMultilineArraySeverityEntry(content) ||
          isMultilineNumericSeverityEntry(content));
      const removedIsStandaloneNumericThreshold =
        removedRulesBraceDepth !== null &&
        removedCurrentCeilingRuleKey !== null &&
        removedExpectingCeilingThreshold &&
        isStandaloneNumericThresholdLine(content);
      const removedIsStandaloneMax =
        removedRulesBraceDepth !== null &&
        removedCurrentCeilingRuleKey !== null &&
        (isStandaloneMaxLine(content) || isObjectFormMaxLine(content));
      const ruleState = buildRuleState(
        content,
        removedCurrentRuleKey,
        removedIsStandaloneSeverity,
        removedIsStandaloneNumericThreshold,
        removedIsStandaloneMax,
      );
      if (ruleState !== null && ruleState.ruleKey !== null) {
        // consumed (deprecated) is kept for backward compatibility with the
        // standalone-removed -> keyed-added block below, which still uses a
        // single consumed flag (a standalone removed entry carries only ONE
        // field — either a severity OR a threshold, never both — so a single
        // consumption flag is sufficient there). severityConsumed and
        // thresholdConsumed are used by the keyed-removed -> standalone-added
        // block so that a standalone added SEVERITY line consuming the
        // severity does not prevent a later standalone added THRESHOLD line
        // from comparing against the removed threshold on the SAME keyed
        // entry (#2189 review finding).
        pendingRemovedRuleState.push({
          ...ruleState,
          content,
          lineNumber: currentLine,
          consumed: false,
          severityConsumed: false,
          thresholdConsumed: false,
        });
      }
    }
    // Update the removed-side structural context AFTER buffering so this
    // line's rule key is available for subsequent removed lines (e.g. a
    // removed opener sets the removed rule key, then a removed standalone
    // severity is attributed to it). Mirrors the post-change pattern where
    // updateStructuralContext runs after added-line detection.
    updateRemovedStructuralContext(content);
  }

  /**
   * Updates structural context-tracking state (rulesBraceDepth, current rule
   * key, current ceiling rule key) from a diff content line (without the
   * leading +/-). Called ONLY for context and added lines so that structural
   * brace nesting reflects the post-change/new-file view of the file. Removed
   * lines are never passed here — they only buffer configs
   * (bufferRemovedConfig) — so a changed multiline rule opener containing {
   * does not double-count brace depth.
   *
   * Ceiling context (currentCeilingRuleKey) is reset whenever a different rule
   * key appears or a rule-entry closes, preventing stale attribution of
   * multiline max changes to a prior ceiling rule.
   *
   * Rule-key tracking (currentRuleKey/currentCeilingRuleKey) is gated by the
   * insideRuleEntry flag so nested option properties inside a rule config
   * object cannot replace the enclosing rule key.
   */
  function updateStructuralContext(content) {
    if (file !== 'eslint.config.js') {
      return;
    }
    // Track arbitrary object declarations/assignments outside rules blocks. A
    // `rules: {` property inside an arbitrary object (e.g. const meta = { ...
    // rules: { ... } ... }) must NOT be treated as an ESLint config rules
    // block (#2189 review finding 1). When arbitraryObjectDepth is non-null
    // and > 0, we are inside such an arbitrary object, so isRulesBlockOpen is
    // suppressed.
    if (rulesBraceDepth === null) {
      if (
        arbitraryObjectDepth === null &&
        isArbitraryObjectOpener(content) &&
        !isRulesBlockOpen(content)
      ) {
        arbitraryObjectDepth = 0;
      }
      if (arbitraryObjectDepth !== null) {
        arbitraryObjectDepth += countDiffBraceDelta(content);
        if (arbitraryObjectDepth <= 0) {
          arbitraryObjectDepth = null;
        }
      }
      // Track known non-rule containers (settings, languageOptions, etc.) so a
      // nested `rules: {` inside one is NOT treated as an ESLint config rules
      // block (#2189 review finding 2).
      if (nonRuleContainerDepth === null && isNonRuleContainerOpen(content)) {
        nonRuleContainerDepth = 0;
      }
      if (nonRuleContainerDepth !== null) {
        nonRuleContainerDepth += countDiffBraceDelta(content);
        if (nonRuleContainerDepth <= 0) {
          nonRuleContainerDepth = null;
        }
      }
    }
    const rulesOpensHere =
      isRulesBlockOpen(content) &&
      rulesBraceDepth === null &&
      arbitraryObjectDepth === null &&
      nonRuleContainerDepth === null;
    if (rulesOpensHere) {
      rulesBraceDepth = 0;
      insideRuleEntry = false;
      expectingFirstSeverityElement = false;
      expectingCeilingThreshold = false;
    }
    if (rulesBraceDepth !== null) {
      const delta = countDiffBraceDelta(content);
      rulesBraceDepth += delta;
      // When the rules block closes the brace depth returns to 0 (or below on
      // an over-close). Reset both the depth tracker and the ceiling rule key
      // so subsequent unrelated arrays/objects outside the rules block are not
      // mistaken for rules context (stale false positives).
      if (rulesBraceDepth <= 0) {
        rulesBraceDepth = null;
        currentCeilingRuleKey = null;
        currentRuleKey = null;
        insideRuleEntry = false;
        expectingFirstSeverityElement = false;
        expectingCeilingThreshold = false;
        return;
      }
      // Per-rule-entry depth-based closure tracking. When inside a rule entry,
      // adjust the bracket+brace depth. A NESTED option object's closing brace
      // (e.g. a bare "}," inside a multiline rule config) reduces the depth but
      // does NOT close the rule entry unless the depth reaches zero. The
      // previous isRuleEntryClosure heuristic treated any bare } / }, as
      // closing the whole rule entry, clearing currentCeilingRuleKey too early
      // so later max/severity-like lines in the same rule were missed or
      // misclassified (#2189 review finding).
      //
      // A duplicate opener (a changed opener line emitted as removed-then-added,
      // e.g. when a rule's representation changes between multiline and same-line)
      // carries the SAME rule key as the current entry and would double-count
      // its brackets if added to the depth. Such lines are skipped: the entry
      // was already opened by the context/removed line, and the added opener is
      // a change-replacement of that line, not a new entry.
      if (
        insideRuleEntry &&
        ruleEntryDepth !== null &&
        !(currentRuleKey !== null && extractRuleKey(content) === currentRuleKey)
      ) {
        ruleEntryDepth += countDiffBracketAndBraceDelta(content);
        if (ruleEntryDepth <= 0) {
          currentCeilingRuleKey = null;
          currentRuleKey = null;
          insideRuleEntry = false;
          ruleEntryDepth = null;
          expectingFirstSeverityElement = false;
          expectingCeilingThreshold = false;
        } else if (expectingFirstSeverityElement) {
          // Still inside a rule entry and still expecting the first severity
          // element. The first standalone severity value (string or numeric)
          // IS the severity element; clear the expectation so subsequent
          // standalone 'off'/0 lines (option values inside nested arrays, not
          // severities) are not flagged. A keyed property line (e.g.
          // customLabel: true) is NOT a severity value and does not clear the
          // expectation, so an unusual config with option-like content before
          // the severity still detects the severity (#2189 review finding).
          if (
            isMultilineArraySeverityEntry(content) ||
            isMultilineNumericSeverityEntry(content)
          ) {
            expectingFirstSeverityElement = false;
            // The severity element was just seen. For a ceiling rule, the next
            // standalone numeric line is the threshold.
            expectingCeilingThreshold = currentCeilingRuleKey !== null;
          }
        } else if (
          expectingCeilingThreshold &&
          isStandaloneNumericThresholdLine(content)
        ) {
          // A standalone numeric threshold line was seen. Clear the expectation
          // so a subsequent numeric line (an option value) is not mistaken for
          // a second threshold.
          expectingCeilingThreshold = false;
        }
      }
      if (!insideRuleEntry) {
        // Only update the rule key when NOT already inside a rule entry. Once
        // a rule-entry opener sets the key, nested option properties inside
        // that rule's config object (e.g. a custom key not in STRUCTURAL_KEYS)
        // must NOT replace the enclosing rule key. The flag is cleared on
        // rule-entry closure (above) or rules-block close, so the next rule
        // key at the rules-object level is correctly tracked.
        //
        // A complete single-line rule entry (e.g. "'no-console': 'error',"
        // or "complexity: ['error', 25],") opens and closes all its
        // brackets/braces on one line. It must NOT set insideRuleEntry,
        // because there is no subsequent closure line to clear the flag.
        // Without this check, the flag would stay pinned and a following
        // multiline rule opener (e.g. "'max-lines': ['error', {") would be
        // ignored, causing its max changes to be missed (false negative).
        const key = extractRuleKey(content);
        if (key !== null) {
          currentRuleKey = key;
          currentCeilingRuleKey = CEILING_RULES.has(key) ? key : null;
          if (!isCompleteSingleLineRuleEntry(content)) {
            insideRuleEntry = true;
            ruleEntryDepth = countDiffBracketAndBraceDelta(content);
            // Set the first-severity-element expectation only when the opener
            // opens a bracket array WITHOUT the severity already on this line.
            // When the severity is on the opener (e.g. "'rule': ['error',"),
            // subsequent standalone 'off'/0 lines are option values, so the
            // expectation is cleared (#2189 review finding).
            expectingFirstSeverityElement =
              openerExpectsFirstArrayElement(content);
            // When the severity is already on the opener line, the next
            // standalone numeric line is the threshold for a ceiling rule.
            expectingCeilingThreshold =
              !expectingFirstSeverityElement && currentCeilingRuleKey !== null;
          }
        }
      }
    }
  }

  for (const line of diff.split('\n')) {
    const fileMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (fileMatch) {
      file = fileMatch[2];
      newLine = 0;
      oldLine = 0;
      flushPendingConfigs();
      continue;
    }

    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      flushPendingConfigs();
      continue;
    }

    if (!file) {
      continue;
    }

    if (startsWithAddedContent(line)) {
      const content = addedContent(line);
      const currentLine = newLine;

      if (
        shouldCheckInlineDirective(file) &&
        hasInlineEslintDirective(content)
      ) {
        addViolation(
          violations,
          file,
          currentLine,
          'Inline ESLint disable/enable directives are forbidden by #2079/#2080.',
          content,
        );
      }

      // TypeScript suppression directives (#2189). The template-state-aware
      // scanner hasTypeScriptSuppressionInState distinguishes template literal
      // TEXT (where directive text is inert) from template ${ ... } EXPRESSION
      // code (where an at-ts-ignore line comment is a real, effective
      // comment). It also handles lines that START in template text but
      // transition into an expression mid-line where a directive appears, and
      // lines that start inside an already-open expression carried from a
      // prior diff line. The full template state is carried across added and
      // context lines so the text/expression distinction is preserved (#2189
      // review finding).
      if (
        shouldCheckTypeScriptSuppression(file) &&
        hasTypeScriptSuppressionInState(content, templateLiteralState)
      ) {
        addViolation(
          violations,
          file,
          currentLine,
          'TypeScript suppression directives (@ts-ignore/@ts-expect-error/@ts-nocheck) are forbidden by #2189.',
          content,
        );
      }
      if (shouldCheckTypeScriptSuppression(file)) {
        templateLiteralState = scanTemplateLiteralState(
          content,
          templateLiteralState,
        );
      }

      if (
        file === 'eslint.config.js' &&
        content.includes('packages/cli/src') &&
        !isCommentOnlyLine(content)
      ) {
        addViolation(
          violations,
          file,
          currentLine,
          'packages/cli directive cleanup scopes are forbidden by #2114; fix CLI code instead.',
          content,
        );
      }

      // Severity downgrade and ceiling threshold increase detection (#2189)
      // Runs before the isNewOffRule check so that severity downgrades to off
      // are reported as downgrades rather than double-reported.
      //
      // Same-rule-key comparison (compareRuleConfigChanges) normally requires
      // actual rules-block context (rulesBraceDepth !== null) to avoid false
      // positives on multiline unrelated config/data objects whose entries
      // look like rule entries (e.g. const docs = { 'no-console': 'error' } or
      // const thresholds = { complexity: ['error', 25] }). A narrowly scoped
      // zero-context fallback covers ONLY truly minimal hunks that have no
      // context lines at all (hasHunkContext === false) and where both lines
      // are rule-severity-assignment-shaped (bare rule entries, not
      // const/let/var declarations or assignments containing =). When context
      // lines are present but rulesBraceDepth is null, the hunk is definitively
      // outside a rules block and the fallback must NOT fire. Production uses
      // git diff --unified=20 so the rules: { line is almost always present
      // and the fallback rarely fires, preferring correctness/no false
      // positives over over-broad detection.
      //
      // Ambiguous multiline standalone entries (severity values and max: lines
      // that have no rule key on the same line) are always gated to
      // rulesBraceDepth to avoid false positives on unrelated arrays.
      let severityDowngradeDetected = false;
      if (file === 'eslint.config.js') {
        // Same-rule-key comparison: normally requires rules-block context
        // (rulesBraceDepth !== null). When there is no rules-block context, the
        // zero-context fallback only fires for truly minimal hunks that have
        // NO context lines at all (hasHunkContext === false). If context lines
        // are present but rulesBraceDepth is still null, we are definitively
        // outside a rules block and the fallback must NOT fire — this prevents
        // false positives on multiline unrelated objects like
        // const thresholds = { complexity: ['error', 25] -> ['error', 26] }.
        // For the fallback, both the removed and added lines must also be
        // rule-severity-assignment-shaped (bare rule entries, not
        // const/let/var declarations or assignments containing =).
        //
        // Removed entries are paired with the added line by extracted rule key
        // and the matching removed entry is consumed whether or not violations
        // are emitted. Consuming no-op (same-severity/threshold) pairs prevents
        // stale pending removed entries from causing order-dependent false
        // positives (e.g. a leftover removed entry matching a later added line
        // of a different change).
        const addedKey = extractRuleKey(content);
        // Do not compare keyed entries while inside an existing rule-entry
        // config object (insideRuleEntry). STRUCTURAL_KEYS cannot cover every
        // custom/plugin-specific option field, so a keyed entry such as
        // customOption: 'warn' would be mistaken for a rule assignment and
        // compared as if customOption were an ESLint rule key (producing a
        // false severity-downgrade violation). Only the actual rule-entry
        // opener at the rules-object level (when insideRuleEntry is false)
        // qualifies for same-rule-key comparison. Removed-side buffering is
        // gated symmetrically in bufferRemovedConfig.
        if (addedKey !== null && !insideRuleEntry) {
          const useZeroContextFallback =
            rulesBraceDepth === null &&
            !hasHunkContext &&
            isRuleSeverityAssignmentShape(content);
          for (let pi = 0; pi < pendingRemovedConfigs.length; pi++) {
            const removed = pendingRemovedConfigs[pi];
            const removedKey = extractRuleKey(removed.content);
            if (removedKey !== addedKey) {
              continue;
            }
            // Skip the pair entirely if neither rules-block context nor the
            // zero-context fallback applies. This prevents false positives on
            // multiline unrelated objects outside a rules block whose entries
            // carry rule-like keys (e.g. const docs = { 'no-console': ... }).
            if (!useZeroContextFallback && rulesBraceDepth === null) {
              continue;
            }
            // When the zero-context fallback is active, require the removed
            // line to also be rule-severity-assignment-shaped so a removed
            // const/assignment declaration is not compared.
            if (
              rulesBraceDepth === null &&
              !isRuleSeverityAssignmentShape(removed.content)
            ) {
              continue;
            }
            const changeMessages = compareRuleConfigChanges(
              removed.content,
              content,
            );
            for (const msg of changeMessages) {
              addViolation(violations, file, currentLine, msg, content);
              if (msg.includes('severity downgrade')) {
                severityDowngradeDetected = true;
              }
            }
            // Consume the matching removed entry whether or not violations
            // were emitted, so no-op comparisons do not leave stale entries.
            pendingRemovedConfigs.splice(pi, 1);
            break;
          }
        }

        // Multiline array severity detection: standalone severity values on
        // their own line. Gated to rules: { ... } context because these lines
        // carry no rule key and could match unrelated arrays. Removed entries
        // are buffered with the enclosing rule key (currentRuleKey) at the
        // time of removal, and an added severity is only compared against a
        // removed entry whose rule key matches the current rule key. This
        // prevents pairing removed and added severities from two different
        // multiline rules in the same hunk.
        //
        // Also gated to expectingFirstSeverityElement: only the FIRST element
        // of a rule's [severity, options...] array is the severity. A
        // standalone 'error'/'warn'/'off'/0 line that is NOT the first element
        // is an option value (e.g. modes: ['error'] inside ['error', { ... }]),
        // not a severity, and must not be compared as a severity downgrade
        // (#2189 review finding).
        if (
          rulesBraceDepth !== null &&
          currentRuleKey !== null &&
          expectingFirstSeverityElement &&
          (isMultilineArraySeverityEntry(content) ||
            isMultilineNumericSeverityEntry(content)) &&
          pendingRemovedMultilineSeverity.length > 0
        ) {
          const addedSeverity = normalizeMultilineSeverity(content);
          for (const removed of pendingRemovedMultilineSeverity) {
            if (removed.ruleKey !== currentRuleKey) {
              continue;
            }
            const removedSeverity = normalizeMultilineSeverity(removed.content);
            if (
              removedSeverity !== null &&
              addedSeverity !== null &&
              SEVERITY_RANK[addedSeverity] < SEVERITY_RANK[removedSeverity]
            ) {
              addViolation(
                violations,
                file,
                currentLine,
                `ESLint severity downgrade for '${currentRuleKey}' (${removedSeverity} -> ${addedSeverity}) in multiline rule config is forbidden by #2189.`,
                content,
              );
              severityDowngradeDetected = true;
            }
          }
          pendingRemovedMultilineSeverity =
            pendingRemovedMultilineSeverity.filter(
              (entry) => entry.ruleKey !== currentRuleKey,
            );
        }

        // Multiline max threshold detection: standalone "max: N" lines and
        // project-common object-form max lines (e.g. "{ max: 800,
        // skipBlankLines: true }") inside a ceiling rule config. Removed
        // entries are buffered with the enclosing ceiling rule key, and an
        // added max line is only compared against a removed entry whose rule
        // key matches the current ceiling rule key. This prevents
        // misattributing a max increase across two different ceiling rules in
        // the same hunk.
        if (
          rulesBraceDepth !== null &&
          currentCeilingRuleKey !== null &&
          (isStandaloneMaxLine(content) || isObjectFormMaxLine(content)) &&
          pendingRemovedMultilineMax.length > 0
        ) {
          const addedMaxValue = extractMaxValueFromStandaloneLine(content);
          for (const removed of pendingRemovedMultilineMax) {
            if (removed.ruleKey !== currentCeilingRuleKey) {
              continue;
            }
            const removedMaxValue = extractMaxValueFromStandaloneLine(
              removed.content,
            );
            if (
              removedMaxValue !== null &&
              addedMaxValue !== null &&
              addedMaxValue > removedMaxValue
            ) {
              addViolation(
                violations,
                file,
                currentLine,
                `Ceiling threshold increase for '${removed.ruleKey}' (${removedMaxValue} -> ${addedMaxValue}) in multiline rule config is forbidden by #2189.`,
                content,
              );
            }
          }
          pendingRemovedMultilineMax = pendingRemovedMultilineMax.filter(
            (entry) => entry.ruleKey !== currentCeilingRuleKey,
          );
        }

        // Multiline numeric-array threshold detection: standalone numeric
        // threshold lines (e.g. "25,") inside a ceiling rule config where the
        // severity and threshold are separate array elements on separate lines.
        // Gated to expectingCeilingThreshold so only the second array element
        // (the threshold after the severity) is treated as a threshold, not
        // subsequent unrelated standalone numeric values (#2189 review
        // finding). Removed entries are buffered with the enclosing ceiling
        // rule key, and an added numeric threshold line is only compared
        // against a removed entry whose rule key matches the current ceiling
        // rule key.
        const preUpdateExpectingCeilingThreshold = expectingCeilingThreshold;
        if (
          rulesBraceDepth !== null &&
          currentCeilingRuleKey !== null &&
          preUpdateExpectingCeilingThreshold &&
          isStandaloneNumericThresholdLine(content) &&
          pendingRemovedMultilineNumericThreshold.length > 0
        ) {
          const addedThresholdValue =
            extractStandaloneNumericThresholdValue(content);
          for (const removed of pendingRemovedMultilineNumericThreshold) {
            if (removed.ruleKey !== currentCeilingRuleKey) {
              continue;
            }
            const removedThresholdValue =
              extractStandaloneNumericThresholdValue(removed.content);
            if (
              removedThresholdValue !== null &&
              addedThresholdValue !== null &&
              addedThresholdValue > removedThresholdValue
            ) {
              addViolation(
                violations,
                file,
                currentLine,
                `Ceiling threshold increase for '${removed.ruleKey}' (${removedThresholdValue} -> ${addedThresholdValue}) in multiline numeric-array rule config is forbidden by #2189.`,
                content,
              );
            }
          }
          pendingRemovedMultilineNumericThreshold =
            pendingRemovedMultilineNumericThreshold.filter(
              (entry) => entry.ruleKey !== currentCeilingRuleKey,
            );
        }

        // Single-line nested rules detection: inline rule entries within a
        // rules: { ... } opener on one line (e.g. "rules: { 'no-console':
        // 'warn' }"). These bypass the same-rule-key and standalone checks
        // because extractRuleKey returns null for the `rules` structural key,
        // so they are handled explicitly here. Correlates added inline entries
        // with buffered removed inline entries by key to detect severity
        // downgrades and ceiling threshold increases, and flags new off/0
        // entries. Gated to arbitraryObjectDepth === null so a `rules:`
        // property inside an arbitrary object (e.g. const meta = { rules: ...
        // }) is not treated as an ESLint config rules block (#2189 review
        // finding 1).
        const addedInlineEntries =
          arbitraryObjectDepth === null
            ? extractInlineRulesEntries(content)
            : [];
        if (addedInlineEntries.length > 0) {
          for (const added of addedInlineEntries) {
            if (isNewOffRule(added.content) && !isAllowedPolicyOff(content)) {
              addViolation(
                violations,
                file,
                currentLine,
                'New ESLint off/0 entries must be explicitly justified with eslint-policy-allow-off.',
                content,
              );
              severityDowngradeDetected = true;
            }
            for (let pi = 0; pi < pendingRemovedInlineRules.length; pi++) {
              const removed = pendingRemovedInlineRules[pi];
              if (removed.key !== added.key) {
                continue;
              }
              const changeMessages = compareRuleConfigChanges(
                removed.content,
                added.content,
              );
              for (const msg of changeMessages) {
                addViolation(violations, file, currentLine, msg, content);
                if (msg.includes('severity downgrade')) {
                  severityDowngradeDetected = true;
                }
              }
              // Consume the matching removed entry whether or not violations
              // were emitted, so a no-op (same-severity) match does not leave
              // a stale entry that could later produce a false positive.
              pendingRemovedInlineRules.splice(pi, 1);
              break;
            }
          }
        }

        // Cross-form normalized rule-state comparison. When a rule's
        // representation changes between removed and added (e.g. multiline
        // removed severity -> same-line added, or same-line removed -> multiline
        // added), the form-specific buffers above do not match up because
        // removed and added lines go into different buffers. This block
        // compares the normalized severity/threshold of the added line against
        // ALL removed rule-state entries by rule key, consuming matched entries.
        // It only fires when the added line carries a rule key (same-line or
        // opener) OR is a standalone form attributed to a current rule, and it
        // avoids double-reporting when a form-specific check already detected
        // the violation (#2189 review finding). updateStructuralContext has not
        // run yet at this point, so expectingFirstSeverityElement and
        // expectingCeilingThreshold are the pre-update values for this line.
        const crossFormIsStandaloneSeverity =
          rulesBraceDepth !== null &&
          currentRuleKey !== null &&
          expectingFirstSeverityElement &&
          (isMultilineArraySeverityEntry(content) ||
            isMultilineNumericSeverityEntry(content));
        const crossFormIsStandaloneNumericThreshold =
          rulesBraceDepth !== null &&
          currentCeilingRuleKey !== null &&
          expectingCeilingThreshold &&
          isStandaloneNumericThresholdLine(content);
        const crossFormIsStandaloneMax =
          rulesBraceDepth !== null &&
          currentCeilingRuleKey !== null &&
          (isStandaloneMaxLine(content) || isObjectFormMaxLine(content));
        const addedRuleState = buildRuleState(
          content,
          currentRuleKey,
          crossFormIsStandaloneSeverity,
          crossFormIsStandaloneNumericThreshold,
          crossFormIsStandaloneMax,
        );
        if (
          addedRuleState !== null &&
          addedRuleState.ruleKey !== null &&
          !crossFormIsStandaloneSeverity &&
          !crossFormIsStandaloneNumericThreshold &&
          !crossFormIsStandaloneMax
        ) {
          for (const removed of pendingRemovedRuleState) {
            if (
              removed.consumed ||
              removed.ruleKey !== addedRuleState.ruleKey
            ) {
              continue;
            }
            // Only compare against removed entries that were STANDALONE forms
            // (no rule key on the same line). The keyed-removed -> keyed-added
            // case is already handled by compareRuleConfigChanges above, so
            // comparing against keyed removed entries here would double-report.
            // The normalized comparison is specifically for the cross-form gap:
            // standalone-removed -> keyed-added.
            const removedWasStandalone =
              removed.content !== undefined &&
              extractRuleKey(removed.content) === null;
            if (!removedWasStandalone) {
              continue;
            }
            // Severity downgrade cross-form comparison.
            if (
              removed.severity !== null &&
              addedRuleState.severity !== null &&
              SEVERITY_RANK[addedRuleState.severity] <
                SEVERITY_RANK[removed.severity]
            ) {
              addViolation(
                violations,
                file,
                currentLine,
                `ESLint severity downgrade for '${addedRuleState.ruleKey}' (${removed.severity} -> ${addedRuleState.severity}) is forbidden by #2189.`,
                content,
              );
              severityDowngradeDetected = true;
            }
            // Ceiling threshold addition cross-form comparison: a ceiling rule
            // that had only a scalar severity (removed threshold null) gains an
            // explicit threshold.
            if (
              removed.threshold === null &&
              addedRuleState.threshold !== null &&
              CEILING_RULES.has(addedRuleState.ruleKey) &&
              removed.severity !== null
            ) {
              addViolation(
                violations,
                file,
                currentLine,
                `Adding a ceiling threshold to '${addedRuleState.ruleKey}' is forbidden by #2189; ceiling rules must not gain an explicit loose ceiling.`,
                content,
              );
            }
            // Ceiling threshold increase cross-form comparison.
            if (
              removed.threshold !== null &&
              addedRuleState.threshold !== null &&
              addedRuleState.threshold > removed.threshold
            ) {
              addViolation(
                violations,
                file,
                currentLine,
                `Ceiling threshold increase for '${addedRuleState.ruleKey}' (${removed.threshold} -> ${addedRuleState.threshold}) is forbidden by #2189.`,
                content,
              );
            }
            removed.consumed = true;
            break;
          }
        }

        // Cross-form comparison for STANDALONE added forms (multiline severity,
        // standalone numeric threshold, standalone/object max). When the added
        // line is a standalone form attributed to a current rule, compare it
        // against removed normalized entries that were KEYED (same-line/opener)
        // forms. This handles same-line-removed -> multiline-added
        // representation changes that the form-specific buffers miss
        // (#2189 review finding). The form-specific checks above already
        // handle standalone-removed -> standalone-added, so this only compares
        // against removed entries that had a key on the same line.
        //
        // Consumption is split by field (severityConsumed / thresholdConsumed)
        // rather than a single consumed flag. A keyed-removed entry carries
        // BOTH a severity AND a threshold (e.g. complexity: ['error', 25] has
        // severity 'error' and threshold 25). When a rule's representation
        // changes from a single-line keyed form to a multiline form, the
        // severity and threshold become separate standalone added lines. The
        // standalone severity line must only consume the severity so the later
        // standalone threshold line can still compare against the removed
        // threshold on the same keyed entry. A single consumed flag would
        // suppress the threshold comparison, producing a false negative
        // (complexity: ['error', 25] -> multiline [ 'error', 30 ] was missed)
        // (#2189 review finding).
        if (addedRuleState !== null && addedRuleState.ruleKey !== null) {
          const isStandaloneAdded =
            crossFormIsStandaloneSeverity ||
            crossFormIsStandaloneNumericThreshold ||
            crossFormIsStandaloneMax;
          if (isStandaloneAdded) {
            for (const removed of pendingRemovedRuleState) {
              if (removed.ruleKey !== addedRuleState.ruleKey) {
                continue;
              }
              // Only compare against removed entries that were keyed
              // (same-line/opener) forms — standalone-removed -> standalone-
              // added is already handled by the form-specific checks.
              const removedWasKeyed =
                removed.content !== undefined &&
                extractRuleKey(removed.content) !== null;
              if (!removedWasKeyed) {
                continue;
              }
              // Severity downgrade cross-form (keyed-removed -> standalone-
              // added). Only applies when the added line is a standalone
              // severity form, so a standalone threshold/max line does not
              // spuriously consume the severity field.
              if (
                crossFormIsStandaloneSeverity &&
                !removed.severityConsumed &&
                removed.severity !== null &&
                addedRuleState.severity !== null &&
                SEVERITY_RANK[addedRuleState.severity] <
                  SEVERITY_RANK[removed.severity]
              ) {
                addViolation(
                  violations,
                  file,
                  currentLine,
                  `ESLint severity downgrade for '${addedRuleState.ruleKey}' (${removed.severity} -> ${addedRuleState.severity}) is forbidden by #2189.`,
                  content,
                );
                severityDowngradeDetected = true;
              }
              // Ceiling threshold addition cross-form (keyed-removed ->
              // standalone-added): a ceiling rule that had only a scalar
              // severity (removed threshold null) gains an explicit standalone
              // threshold line (numeric or object max). Only applies when the
              // added line is a standalone threshold/max form. This mirrors
              // the standalone-removed -> keyed-added block's threshold-
              // addition check, closing the false negative where
              // complexity: 'error' -> multiline ['error', 999] was missed
              // (#2189 review finding).
              if (
                (crossFormIsStandaloneNumericThreshold ||
                  crossFormIsStandaloneMax) &&
                !removed.thresholdConsumed &&
                removed.threshold === null &&
                addedRuleState.threshold !== null &&
                CEILING_RULES.has(addedRuleState.ruleKey) &&
                removed.severity !== null
              ) {
                addViolation(
                  violations,
                  file,
                  currentLine,
                  `Adding a ceiling threshold to '${addedRuleState.ruleKey}' is forbidden by #2189; ceiling rules must not gain an explicit loose ceiling.`,
                  content,
                );
              }
              // Ceiling threshold increase cross-form (keyed-removed ->
              // standalone-added). Only applies when the added line is a
              // standalone threshold/max form, so a standalone severity line
              // does not spuriously consume the threshold field.
              if (
                (crossFormIsStandaloneNumericThreshold ||
                  crossFormIsStandaloneMax) &&
                !removed.thresholdConsumed &&
                removed.threshold !== null &&
                addedRuleState.threshold !== null &&
                addedRuleState.threshold > removed.threshold
              ) {
                addViolation(
                  violations,
                  file,
                  currentLine,
                  `Ceiling threshold increase for '${addedRuleState.ruleKey}' (${removed.threshold} -> ${addedRuleState.threshold}) is forbidden by #2189.`,
                  content,
                );
              }
              // Mark only the field(s) actually compared this pass as
              // consumed. A standalone severity line marks severityConsumed;
              // a standalone threshold/max line marks thresholdConsumed. This
              // leaves the other field available for a subsequent standalone
              // line of the opposite kind on the same keyed-removed entry.
              if (crossFormIsStandaloneSeverity) {
                removed.severityConsumed = true;
              }
              if (
                crossFormIsStandaloneNumericThreshold ||
                crossFormIsStandaloneMax
              ) {
                removed.thresholdConsumed = true;
              }
              break;
            }
          }
        }
      }

      // Update context tracking after detection so structural state reflects
      // this line for subsequent lines in the hunk.
      //
      // Capture the pre-update insideRuleEntry state BEFORE
      // updateStructuralContext runs. A newly added keyed multiline opener
      // such as "'no-console': ['off'," is a rule-entry opener that sets
      // insideRuleEntry = true inside updateStructuralContext. The off/0
      // policy gate below must evaluate this opener line as a rule entry
      // (the pre-update state, where insideRuleEntry was false for the
      // preceding closed entry), NOT the post-update state where the opener
      // has already pinned insideRuleEntry. Using the pre-update state lets
      // isRuleOffEntry recognize the keyed opener's off/0 severity and reject
      // it, fixing the multiline keyed opener false negative (#2189 review
      // finding). The standalone multiline off/0 detection remains gated to
      // rulesBraceDepth !== null so unrelated standalone values outside rules
      // blocks are not flagged.
      //
      // preUpdateExpectingFirstSeverity captures whether the current rule entry
      // was still expecting its first severity element BEFORE this line was
      // processed. A standalone 'off'/0 line is only a severity (and thus
      // rejectable) when it IS the first element of the rule array. Once the
      // first element is seen, expectingFirstSeverityElement is cleared and
      // subsequent standalone 'off'/0 lines are option values, not severities
      // (#2189 review finding).
      const preUpdateInsideRuleEntry = insideRuleEntry;
      const preUpdateExpectingFirstSeverity = expectingFirstSeverityElement;
      if (file === 'eslint.config.js') {
        updateStructuralContext(content);
      }

      // Off/0 policy gate (#2189). isNewOffRule(content) matches same-line
      // rule-assignment off/0 values (e.g. "'rule': 'off'") but does NOT match
      // standalone multiline off/0 severity entries (e.g. "'off'," or "0,")
      // that have no rule key on the same line. The standalone form is added
      // to the off-policy predicate so newly added multiline standalone
      // off/0 entries are also rejected. Both forms are still gated to actual
      // rule severity shapes (isRuleOffEntry or isStandaloneOffRuleValue under
      // rulesBraceDepth) so arbitrary option fields (e.g. mode: 'off') do not
      // produce false positives.
      //
      // Keyed off/0 rule-entry detection only applies at the rules-object
      // entry level, not while inside an existing multiline rule config object
      // (insideRuleEntry). STRUCTURAL_KEYS cannot cover every custom/plugin
      // option field, so isRuleOffEntry would treat an extractable custom
      // option key (e.g. customOption: "off") as a rule assignment. The
      // insideRuleEntry flag (tracked by updateStructuralContext) disambiguates
      // this: when true, isRuleOffEntry returns false entirely, leaving only
      // the standalone severity detection for actual first-element 'off'/0
      // values.
      //
      // For a newly added keyed multiline opener (e.g. "'no-console':
      // ['off',"), updateStructuralContext has just set insideRuleEntry = true
      // for THIS opener line. Using the post-update state would cause
      // isRuleOffEntry to return false (the opener is treated as a nested
      // option field), missing the off/0 severity. The PRE-update state
      // (preUpdateInsideRuleEntry) reflects whether we were already inside a
      // rule entry before this line, so the keyed opener is correctly
      // evaluated as a rule entry and its off/0 severity is rejected.
      //
      // Zero-context gating mirrors the same approach used for
      // compareRuleConfigChanges: when rulesBraceDepth is null (not inside a
      // tracked rules block), the off/0 gate is split into:
      //   - rulesBraceDepth !== null: structural detection applies
      //     (preUpdateInsideRuleEntry gates nested option fields;
      //     isRuleOffEntry disambiguates quoted keys).
      //   - rulesBraceDepth === null && !hasHunkContext (zero-context
      //     fallback): only bare rule-entry-shaped lines qualify — the line
      //     must be rule-severity-assignment-shaped
      //     (isRuleSeverityAssignmentShape) and not a comment-only line. This
      //     rejects unrelated JS declarations
      //     (const docs = { 'no-console': 'off' }) and comment-only lines
      //     (// docs: 'no-console': 'off') that carry rule-like keys.
      //   - rulesBraceDepth === null && hasHunkContext: context exists but no
      //     rules block is tracked, so we are definitively outside a rules
      //     block; the off/0 gate does NOT fire (prevents false positives on
      //     multiline unrelated objects).
      // A comment-only line (e.g. "// docs: 'no-console': 'off' remains
      // disabled elsewhere") is never a real rule assignment, but its text
      // can satisfy isNewOffRule and isRuleOffEntry because the directive
      // detection uses regex/extractRuleKey which does not distinguish
      // comments from code. The !isCommentOnlyLine(content) guard in the
      // final policy gate applies to ALL contexts (rules block and
      // zero-context) so a comment-only line inside a tracked rules block
      // is not falsely rejected (#2189 review finding).
      // Standalone off/0 detection is only valid when the current rule entry
      // is still expecting its first severity element (the first element of the
      // [severity, options...] array). A standalone 'off'/0 line that is NOT
      // the first element is an option value (e.g. modes: ['off'] inside
      // ['error', { ... }]), not a rule severity, and must not be flagged
      // (#2189 review finding). preUpdateExpectingFirstSeverity is the state
      // BEFORE updateStructuralContext processed this line, so for a standalone
      // severity line that IS the first element, it is still true.
      const isNewOffPolicyEntry =
        isNewOffRule(content) ||
        (rulesBraceDepth !== null &&
          preUpdateExpectingFirstSeverity &&
          isStandaloneOffRuleValue(content));
      const offZeroContextEligible =
        !hasHunkContext &&
        isRuleSeverityAssignmentShape(content) &&
        !isCommentOnlyLine(content);
      const isRuleSeverityOffShape =
        rulesBraceDepth !== null
          ? isRuleOffEntry(content, true, preUpdateInsideRuleEntry) ||
            (preUpdateExpectingFirstSeverity &&
              isStandaloneOffRuleValue(content))
          : offZeroContextEligible &&
            isRuleOffEntry(content, false, preUpdateInsideRuleEntry);
      if (
        file === 'eslint.config.js' &&
        isNewOffPolicyEntry &&
        !isCommentOnlyLine(content) &&
        !isAllowedPolicyOff(content) &&
        !severityDowngradeDetected &&
        isRuleSeverityOffShape
      ) {
        addViolation(
          violations,
          file,
          currentLine,
          'New ESLint off/0 entries must be explicitly justified with eslint-policy-allow-off.',
          content,
        );
      }

      if (
        file === 'eslint.config.js' &&
        content.includes('eslint-comments/no-use') &&
        !content.includes("'off'") &&
        !content.includes('"off"')
      ) {
        policyState.addedInlineDisableBan = true;
      }
      if (file === 'package.json' && content.includes('--max-warnings 0')) {
        policyState.addedMaxWarnings = true;
      }
      newLine += 1;
      continue;
    }

    if (startsWithRemovedContent(line)) {
      const content = removedContent(line);
      const currentLine = oldLine;

      // Buffer removed eslint.config.js rule config entries for severity/
      // threshold correlation with added lines in the same hunk. Removed lines
      // do NOT update structural context (rulesBraceDepth, currentRuleKey,
      // currentCeilingRuleKey) — only context and added lines do — so a
      // changed multiline rule opener containing { does not double-count brace
      // depth. This produces the correct post-change/new-file view of brace
      // nesting.
      bufferRemovedConfig(content, currentLine);

      if (
        file === 'eslint.config.js' &&
        content.includes('files: completedDirectiveCleanupScopes')
      ) {
        const triggerBraceScan = countDiffBraceDeltaWithBlockState(
          content,
          false,
        );
        removedCompletedDirectiveCleanupBlockDepth = 1 + triggerBraceScan.delta;
        removedCompletedDirectiveCleanupBlockInComment =
          triggerBraceScan.inBlockComment;
      }
      const removedFromCompletedDirectiveCleanupBlock =
        removedCompletedDirectiveCleanupBlockDepth !== null;

      if (
        file === 'eslint.config.js' &&
        content.includes('eslint-comments/no-use') &&
        !content.includes("'off'") &&
        !content.includes('"off"') &&
        !isCommentOnlyLine(content) &&
        !removedFromCompletedDirectiveCleanupBlock
      ) {
        policyState.removedInlineDisableBan = {
          file,
          lineNumber: currentLine,
          content,
        };
      }
      if (file === 'package.json' && content.includes('--max-warnings 0')) {
        policyState.removedMaxWarnings = {
          file,
          lineNumber: currentLine,
          content,
        };
      }

      if (removedCompletedDirectiveCleanupBlockDepth !== null) {
        const braceScan = countDiffBraceDeltaWithBlockState(
          content,
          removedCompletedDirectiveCleanupBlockInComment,
        );
        removedCompletedDirectiveCleanupBlockInComment =
          braceScan.inBlockComment;
        removedCompletedDirectiveCleanupBlockDepth += braceScan.delta;
        if (removedCompletedDirectiveCleanupBlockDepth <= 0) {
          removedCompletedDirectiveCleanupBlockDepth = null;
          removedCompletedDirectiveCleanupBlockInComment = false;
        }
      }
      oldLine += 1;
      continue;
    }

    if (!line.startsWith('\\')) {
      // Update context tracking for unchanged context lines so that
      // structural state (rules block, ceiling rule key) is maintained
      // across the full hunk, not just added lines. Context lines exist in
      // BOTH the pre-change and post-change file, so they update both the
      // post-change context (updateStructuralContext) and the removed-side
      // context (updateRemovedStructuralContext). The removed-side context
      // is essential for attributing removed multiline severity/max values
      // when the opener is an unchanged context line (not a removed line).
      hasHunkContext = true;
      updateStructuralContext(line);
      updateRemovedStructuralContext(line);
      // Advance template literal state from context lines so an added line
      // inside a template (opened on a context line) is correctly recognized.
      // The full state (inTemplate + exprDepth) is carried forward so the
      // text/expression distinction is preserved across context lines.
      if (shouldCheckTypeScriptSuppression(file)) {
        templateLiteralState = scanTemplateLiteralState(
          line,
          templateLiteralState,
        );
      }
      oldLine += 1;
      newLine += 1;
    }
  }

  if (
    policyState.removedInlineDisableBan &&
    !policyState.addedInlineDisableBan
  ) {
    addViolation(
      violations,
      policyState.removedInlineDisableBan.file,
      policyState.removedInlineDisableBan.lineNumber,
      'Do not remove or weaken the inline-disable ban from eslint.config.js.',
      policyState.removedInlineDisableBan.content,
    );
  }
  if (policyState.removedMaxWarnings && !policyState.addedMaxWarnings) {
    addViolation(
      violations,
      policyState.removedMaxWarnings.file,
      policyState.removedMaxWarnings.lineNumber,
      'Do not remove --max-warnings 0 from lint:ci.',
      policyState.removedMaxWarnings.content,
    );
  }
  return violations;
}

// Directories excluded from all recursive source scans. These are either
// dependency/build output (node_modules, dist, coverage, .git) or local-only
// vendored content (tmp). tmp/ is gitignored and holds vendored copies of
// upstream repos; it is excluded so durable full-tree scans (e.g.
// scanRootTypeScriptSuppressions) mirror the diff-based checkDiff coverage
// universe, which only sees tracked files (#2189 review finding).
const GENERATED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  'tmp',
]);

const BINARY_EXTENSIONS = new Set([
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.webp',
  '.zip',
]);

function isScannableTextFile(fileName) {
  return !BINARY_EXTENSIONS.has(extname(fileName).toLowerCase());
}

function isCliProductionTypeScriptFile(filePath) {
  if (!/\.(?:ts|tsx)$/.test(filePath)) {
    return false;
  }
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const fileName = parts[parts.length - 1];
  return (
    !parts.includes('__tests__') &&
    !parts.includes('test-utils') &&
    !fileName.endsWith('.test.ts') &&
    !fileName.endsWith('.test.tsx') &&
    !fileName.endsWith('.spec.ts') &&
    !fileName.endsWith('.spec.tsx') &&
    !fileName.endsWith('-test-helpers.ts') &&
    !fileName.endsWith('-test-helpers.tsx')
  );
}

function detectTypeEscape(line) {
  for (const { pattern, label } of TYPE_ESCAPE_PATTERNS) {
    if (pattern.test(line)) {
      return label;
    }
  }
  return null;
}

function matchingCliTypeEscapeAllowlistEntry(relativePath, label, content) {
  return CLI_TYPE_ESCAPE_ALLOWLIST.find(
    (entry) =>
      entry.file === relativePath &&
      entry.label === label &&
      content.trim() === entry.content,
  );
}

export function scanCliProductionTypeEscapes(baseDir = process.cwd()) {
  const cliSource = join(baseDir, 'packages', 'cli', 'src');
  if (!existsSync(cliSource)) {
    return [];
  }
  const allowCounts = new Map();
  const violations = [];
  for (const file of listTsFiles(cliSource)) {
    const relativePath = relative(baseDir, file).replace(/\\/g, '/');
    if (!isCliProductionTypeScriptFile(relativePath)) {
      continue;
    }
    const lines = readFileSync(file, 'utf8').split(String.fromCharCode(10));
    for (let i = 0; i < lines.length; i++) {
      const content = lines[i];
      const label = detectTypeEscape(content);
      if (label === null) {
        continue;
      }
      const allowEntry = matchingCliTypeEscapeAllowlistEntry(
        relativePath,
        label,
        content,
      );
      if (allowEntry !== undefined) {
        const key = `${allowEntry.issue}:${allowEntry.file}:${allowEntry.content}`;
        const nextCount = (allowCounts.get(key) ?? 0) + 1;
        allowCounts.set(key, nextCount);
        if (nextCount <= allowEntry.max) {
          continue;
        }
      }
      violations.push({
        file: relativePath,
        lineNumber: i + 1,
        message:
          `Production CLI TypeScript escape hatch '${label}' is forbidden by #2174; ` +
          'use a real type, type guard, validator, or shared adapter.',
        content,
      });
    }
  }
  return violations;
}

function scanDirectoryForDirectives(rootDir, modulePath, issueNumber) {
  const violations = [];
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && GENERATED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      violations.push(
        ...scanDirectoryForDirectives(fullPath, modulePath, issueNumber),
      );
    } else if (entry.isFile() && isScannableTextFile(entry.name)) {
      violations.push(
        ...scanFileForDirectives(fullPath, modulePath, issueNumber),
      );
    }
  }
  return violations;
}

function scanFileForDirectives(filePath, modulePath, issueNumber) {
  const violations = [];
  const contents = readFileSync(filePath, 'utf8');
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (hasInlineEslintDirective(line)) {
      violations.push({
        file: relative(process.cwd(), filePath),
        lineNumber: i + 1,
        message: `Inline ESLint disable/enable directives are forbidden in ${modulePath} by #${issueNumber}.`,
        content: line,
      });
    }
  }
  return violations;
}
export function checkCliSourcePolicy() {
  const violations = scanModuleDirectives('packages/cli/src', '2114');
  const configPath = join(process.cwd(), 'eslint.config.js');
  if (!existsSync(configPath)) {
    return violations;
  }

  const configSource = readFileSync(configPath, 'utf8');
  violations.push(
    ...checkModuleDirectiveScopesInConfig(
      configSource,
      'packages/cli/src',
      '2114',
    ),
  );
  return violations;
}

/**
 * Scans a named package directory for any inline ESLint disable/enable
 * directives. Returns a list of violations; an empty array means the policy is
 * satisfied. The modulePath (e.g. "packages/core") and issueNumber are used to
 * build descriptive violation messages.
 */
export function scanModuleDirectives(modulePath, issueNumber, baseDir) {
  const target = baseDir || join(process.cwd(), ...modulePath.split('/'));
  if (!existsSync(target)) {
    return [];
  }
  return scanDirectoryForDirectives(target, modulePath, issueNumber);
}

/**
 * Scans the packages/core directory for any inline ESLint disable/enable
 * directives. Returns a list of violations; an empty array means the policy is
 * satisfied. Issue #2115 requires zero such directives in packages/core.
 */
export function scanCoreDirectives(coreDir) {
  if (coreDir) {
    return scanDirectoryForDirectives(coreDir, 'packages/core', '2115');
  }
  return scanModuleDirectives('packages/core', '2115');
}

/**
 * Recursively lists all TypeScript source files under rootDir, excluding
 * generated directories (node_modules, dist, coverage, .git).
 */
export function listTsFiles(rootDir) {
  const results = [];
  if (!existsSync(rootDir)) {
    return results;
  }
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && GENERATED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listTsFiles(fullPath));
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Recursively lists all checked source files (same extensions as
 * shouldCheckTypeScriptSuppression) under rootDir, excluding generated
 * directories (node_modules, dist, coverage, .git). Used by
 * scanPackageTypeScriptSuppressions so the full-tree durable scan covers the
 * same file extensions as the diff-based checkDiff detection, not just
 * .ts/.tsx.
 */
export function listCheckedSourceFiles(rootDir) {
  const results = [];
  if (!existsSync(rootDir)) {
    return results;
  }
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && GENERATED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listCheckedSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      /\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(entry.name)
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Returns true when a checked source file is a production file (not a test
 * or test-helper file). Covers the same extensions as
 * shouldCheckTypeScriptSuppression (.js/.jsx/.ts/.tsx/.mjs/.cjs) and preserves
 * the test-file exclusions of isCliProductionTypeScriptFile (which only
 * handles .ts/.tsx). Used by scanPackageTypeScriptSuppressions so the
 * full-tree durable scan covers the same checked source extensions as the
 * diff-based checkDiff detection.
 */
function isProductionCheckedSourceFile(filePath) {
  if (!/\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(filePath)) {
    return false;
  }
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const fileName = parts[parts.length - 1];
  return (
    !parts.includes('__tests__') &&
    !parts.includes('test-utils') &&
    !fileName.endsWith('.test.ts') &&
    !fileName.endsWith('.test.tsx') &&
    !fileName.endsWith('.test.js') &&
    !fileName.endsWith('.test.jsx') &&
    !fileName.endsWith('.test.mjs') &&
    !fileName.endsWith('.test.cjs') &&
    !fileName.endsWith('.spec.ts') &&
    !fileName.endsWith('.spec.tsx') &&
    !fileName.endsWith('.spec.js') &&
    !fileName.endsWith('.spec.jsx') &&
    !fileName.endsWith('.spec.mjs') &&
    !fileName.endsWith('.spec.cjs') &&
    !fileName.endsWith('-test-helpers.ts') &&
    !fileName.endsWith('-test-helpers.tsx') &&
    !fileName.endsWith('-test-helpers.js') &&
    !fileName.endsWith('-test-helpers.jsx') &&
    !fileName.endsWith('test-setup.ts') &&
    !fileName.endsWith('test-setup.tsx') &&
    !fileName.endsWith('test-setup.js') &&
    !fileName.endsWith('test-setup.jsx') &&
    !fileName.endsWith('test-setup.mjs') &&
    !fileName.endsWith('test-setup.cjs')
  );
}

/**
 * Scans an arbitrary package source directory for inline ESLint disable/enable
 * directives. Each violation references the supplied issueNumber so guard test
 * failures point at the originating cleanup issue.
 */
export function scanPackageDirectives(packageDir, issueNumber) {
  const target = packageDir;
  if (!existsSync(target)) {
    return [];
  }
  const files = listTsFiles(target);
  const violations = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(String.fromCharCode(10));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (DIRECTIVE_PATTERN.test(line)) {
        violations.push({
          file: relative(process.cwd(), file),
          lineNumber: i + 1,
          message: `Inline ESLint disable/enable directives are forbidden in this module (#${issueNumber}).`,
          content: line,
        });
      }
    }
  }
  return violations;
}

/**
 * Durable full-tree scan for TypeScript suppression directives
 * (@ts-ignore, @ts-expect-error, @ts-nocheck) in protected package source.
 * Unlike the diff-based checkDiff detection, this scans the entire checked-in
 * tree so that pre-existing suppressions are also caught. Returns violations
 * referencing the supplied issueNumber.
 *
 * Covers the same checked source extensions (.js/.jsx/.ts/.tsx/.mjs/.cjs) as
 * the diff-based shouldCheckTypeScriptSuppression so a JS file with a TS
 * suppression directive is caught by the full-tree scan, not just by
 * diff-based detection.
 *
 * Test files are excluded because @ts-expect-error is a legitimate testing
 * pattern (asserting that invalid types are rejected by the compiler). This
 * matches the production-only approach of scanCliProductionTypeEscapes.
 *
 * Template literal state is carried across lines within each file (using
 * hasTypeScriptSuppressionInState plus scanTemplateLiteralState), mirroring the
 * diff-based checkDiff detection. This avoids false positives on inert
 * documentation text inside a multiline template literal body (where // or
 * directive text is just template text, not a real comment) while still
 * flagging a real suppression comment after a closed template or inside a
 * template ${ ... } expression (#2189 review finding).
 */
export function scanPackageTypeScriptSuppressions(packageDir, issueNumber) {
  const target = packageDir;
  if (!existsSync(target)) {
    return [];
  }
  const files = listCheckedSourceFiles(target);
  const violations = [];
  for (const file of files) {
    const relativePath = relative(process.cwd(), file).replace(/\\/g, '/');
    if (!isProductionCheckedSourceFile(relativePath)) {
      continue;
    }
    const lines = readFileSync(file, 'utf8').split(String.fromCharCode(10));
    let templateLiteralState = { inTemplate: false, exprDepth: 0 };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (hasTypeScriptSuppressionInState(line, templateLiteralState)) {
        violations.push({
          file: relativePath,
          lineNumber: i + 1,
          message: `TypeScript suppression directives (@ts-ignore/@ts-expect-error/@ts-nocheck) are forbidden in this module (#${issueNumber}).`,
          content: line,
        });
      }
      templateLiteralState = scanTemplateLiteralState(
        line,
        templateLiteralState,
      );
    }
  }
  return violations;
}

/**
 * Durable full-tree scan for TypeScript suppression directives
 * (@ts-ignore, @ts-expect-error, @ts-nocheck) across the entire repository
 * root, mirroring the diff-based checkDiff coverage universe (POLICY_PATHS is
 * '.'). This closes the gap where scanPackageTypeScriptSuppressions only
 * scanned selected packages src directories: checkDiff rejects newly-added
 * real TS suppressions anywhere in the repo, so the durable scan must also
 * cover root-level scripts, config files, and other top-level source to keep
 * the durable guard as strong as the diff-based acceptance criteria (#2189
 * review finding).
 *
 * Coverage:
 *   - Same checked source extensions as shouldCheckTypeScriptSuppression
 *     (.js/.jsx/.ts/.tsx/.mjs/.cjs).
 *   - Excludes generated directories (node_modules, dist, coverage, .git) via
 *     listCheckedSourceFiles.
 *   - Does NOT exempt the guard implementation/test fixture files:
 *     hasTypeScriptSuppressionInState skips string, template, and regex
 *     literals, so directive text used as fixture data cannot trigger a false
 *     positive. This matches shouldCheckTypeScriptSuppression, which also
 *     does not call isGeneratedGuardFixture.
 *   - Excludes test/spec/helper files via isProductionCheckedSourceFile,
 *     matching scanPackageTypeScriptSuppressions, because @ts-expect-error is
 *     a legitimate testing pattern.
 *
 * Template literal state is carried across lines within each file (using
 * hasTypeScriptSuppressionInState plus scanTemplateLiteralState), mirroring
 * scanPackageTypeScriptSuppressions and the diff-based checkDiff detection.
 */
export function scanRootTypeScriptSuppressions(rootDir, issueNumber) {
  const target = rootDir;
  if (!existsSync(target)) {
    return [];
  }
  const files = listCheckedSourceFiles(target);
  const violations = [];
  for (const file of files) {
    const relativePath = relative(target, file).replace(/\\/g, '/');
    if (!isProductionCheckedSourceFile(relativePath)) {
      continue;
    }
    const lines = readFileSync(file, 'utf8').split(String.fromCharCode(10));
    let templateLiteralState = { inTemplate: false, exprDepth: 0 };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (hasTypeScriptSuppressionInState(line, templateLiteralState)) {
        violations.push({
          file: relativePath,
          lineNumber: i + 1,
          message: `TypeScript suppression directives (@ts-ignore/@ts-expect-error/@ts-nocheck) are forbidden in checked source (#${issueNumber}).`,
          content: line,
        });
      }
      templateLiteralState = scanTemplateLiteralState(
        line,
        templateLiteralState,
      );
    }
  }
  return violations;
}

function repositoryTypeScriptFiles(rootDir) {
  const roots = [join(rootDir, 'packages'), join(rootDir, 'integration-tests')];
  return roots.flatMap((root) => listTsFiles(root));
}

function sourceFileFor(file, content) {
  return ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function collectZodAliases(sourceFile) {
  const aliases = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'zod'
    ) {
      continue;
    }
    const importClause = statement.importClause;
    if (importClause?.name) {
      aliases.add(importClause.name.text);
    }
    const namedBindings = importClause?.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      aliases.add(namedBindings.name.text);
    }
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (importedName === 'z') {
          aliases.add(element.name.text);
        }
      }
    }
  }
  return aliases;
}

function scanTypeScriptAstForEscapeHatches(
  file,
  sourceFile,
  issueNumber,
  rootDir,
) {
  const violations = [];
  const relativePath = relative(rootDir, file).replace(/\\/g, '/');

  const zodAliases = collectZodAliases(sourceFile);
  function addNodeViolation(node, message, content) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    violations.push({
      file: relativePath,
      lineNumber: position.line + 1,
      message,
      content,
    });
  }

  // Issue #2227 intentionally scans every repository TypeScript file in
  // packages and integration-tests, including tests, setup files, and helpers.
  // The policy forbids explicit any and z.any everywhere in that universe.
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      addNodeViolation(
        node,
        `explicit any type keywords are forbidden in repository TypeScript (#${issueNumber}).`,
        node.getText(sourceFile),
      );
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      zodAliases.has(node.expression.expression.text) &&
      node.expression.name.text === 'any'
    ) {
      addNodeViolation(
        node,
        `z.any() calls are forbidden in repository TypeScript (#${issueNumber}).`,
        node.getText(sourceFile),
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function scanTypeScriptTextForEscapeHatches(
  file,
  content,
  issueNumber,
  rootDir,
) {
  const relativePath = relative(rootDir, file).replace(/\\/g, '/');
  const lines = content.split(String.fromCharCode(10));
  const violations = [];
  let templateLiteralState = { inTemplate: false, exprDepth: 0 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (hasInlineEslintDirectiveInState(line, templateLiteralState)) {
      violations.push({
        file: relativePath,
        lineNumber: i + 1,
        message: `Inline ESLint disable/enable directives are forbidden in repository TypeScript (#${issueNumber}).`,
        content: line,
      });
    }
    if (hasTypeScriptSuppressionInState(line, templateLiteralState)) {
      // Production source is already covered by scanRootTypeScriptSuppressions
      // (#2189). Issue #2227 extends the durable ban to the remaining checked
      // repository TypeScript files, including tests, setup files, and helpers.
      const isAlreadyCoveredByRootScan =
        isProductionCheckedSourceFile(relativePath);
      if (!isAlreadyCoveredByRootScan) {
        violations.push({
          file: relativePath,
          lineNumber: i + 1,
          message: `TypeScript suppression directives (@ts-ignore/@ts-expect-error/@ts-nocheck) are forbidden in repository TypeScript (#${issueNumber}).`,
          content: line,
        });
      }
    }
    templateLiteralState = scanTemplateLiteralState(line, templateLiteralState);
  }

  return violations;
}

function stripBlockCommentsForSnippet(lines, startsInBlockComment) {
  const parts = [];
  let inBlock = startsInBlockComment;

  for (const rawLine of lines) {
    let remaining = rawLine;
    let output = '';

    while (remaining.length > 0) {
      if (inBlock) {
        const closeIndex = remaining.indexOf('*/');
        if (closeIndex === -1) {
          remaining = '';
          continue;
        }
        remaining = remaining.slice(closeIndex + 2);
        inBlock = false;
        continue;
      }

      const openIndex = remaining.indexOf('/*');
      if (openIndex === -1) {
        output += remaining;
        remaining = '';
        continue;
      }

      output += remaining.slice(0, openIndex);
      remaining = remaining.slice(openIndex + 2);
      inBlock = true;
    }

    parts.push(output);
  }

  return parts.join(' ');
}

function scanEslintConfigForEscapeHatches(rootDir, issueNumber) {
  const configPath = join(rootDir, 'eslint.config.js');
  if (!existsSync(configPath)) {
    return [];
  }

  const lines = readFileSync(configPath, 'utf8').split(String.fromCharCode(10));
  const violations = [];
  const configChecks = [
    {
      anchor: /\blegacyDirectiveCleanupScopes\b/,
      pattern: /\blegacyDirectiveCleanupScopes\b/,
      message: 'legacyDirectiveCleanupScopes must be removed',
    },
    {
      anchor: /\bcompletedDirectiveCleanupScopes\b/,
      pattern: /\bcompletedDirectiveCleanupScopes\b/,
      message: 'completedDirectiveCleanupScopes must be removed',
    },
    {
      anchor: /['"]@typescript-eslint\/no-explicit-any['"]/,
      pattern:
        /['"]@typescript-eslint\/no-explicit-any['"]\s*:\s*(?:['"](?:off|warn)['"]|[01]\b)|['"]@typescript-eslint\/no-explicit-any['"]\s*:\s*\[\s*(?:['"](?:off|warn)['"]|[01]\b)/,
      message:
        '@typescript-eslint/no-explicit-any off/warn entries are forbidden',
    },
    {
      anchor: /['"]eslint-comments\/no-use['"]/,
      pattern:
        /['"]eslint-comments\/no-use['"]\s*:\s*(?:['"]off['"]|0\b)|['"]eslint-comments\/no-use['"]\s*:\s*\[\s*(?:['"]off['"]|0\b)/,
      message: 'eslint-comments/no-use off entries are forbidden',
    },
    {
      anchor: /\breportUnusedDisableDirectives\b/,
      pattern:
        /\breportUnusedDisableDirectives\s*:\s*(?:['"]off['"]|0\b|false\b)/,
      message: 'reportUnusedDisableDirectives off entries are forbidden',
    },
  ];

  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let candidateLine = line;
    let trimmedLine = candidateLine.trim();

    if (inBlockComment) {
      const closeIndex = candidateLine.indexOf('*/');
      if (closeIndex === -1) {
        continue;
      }
      inBlockComment = false;
      candidateLine = candidateLine.slice(closeIndex + 2);
      trimmedLine = candidateLine.trim();
    }

    while (trimmedLine.startsWith('/*')) {
      const closeIndex = candidateLine.indexOf('*/');
      if (closeIndex === -1) {
        inBlockComment = true;
        break;
      }
      candidateLine = candidateLine.slice(closeIndex + 2);
      trimmedLine = candidateLine.trim();
    }

    if (
      inBlockComment ||
      trimmedLine === '' ||
      isCommentOnlyLine(candidateLine)
    ) {
      continue;
    }

    const snippetLines = [
      candidateLine,
      ...lines.slice(i + 1, Math.min(lines.length, i + 5)),
    ];
    const configSnippet = stripBlockCommentsForSnippet(
      snippetLines.map(stripInlineComment),
      false,
    );
    for (const check of configChecks) {
      if (!check.anchor.test(candidateLine)) {
        continue;
      }
      if (check.pattern.test(configSnippet)) {
        violations.push({
          file: 'eslint.config.js',
          lineNumber: i + 1,
          message: `${check.message} (#${issueNumber}).`,
          content: candidateLine,
        });
      }
    }
  }

  return violations;
}

function eslintCommandSegments(command) {
  return command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .map((segment) => segment.trim())
    .filter((segment) =>
      /(?:^|\s)(?:cross-env\s+[^&;]*\s+)?eslint(?:\s|$)/.test(segment),
    );
}

function eslintSegmentHasMaxWarningsZero(segment) {
  return /(?:^|\s)--max-warnings(?:\s+|=)0(?:\s|$)/.test(segment);
}

function lintCiKeepsMaxWarningsZero(lintCi) {
  const eslintSegments = eslintCommandSegments(lintCi);
  return (
    eslintSegments.length > 0 &&
    eslintSegments.every((segment) => eslintSegmentHasMaxWarningsZero(segment))
  );
}

function scanPackageJsonLintCi(rootDir, issueNumber) {
  const packagePath = join(rootDir, 'package.json');
  if (!existsSync(packagePath)) {
    return [];
  }

  const source = readFileSync(packagePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [
      {
        file: 'package.json',
        lineNumber: 1,
        message: `package.json must be valid JSON so lint:ci policy can be checked (#${issueNumber}).`,
        content: '',
      },
    ];
  }
  const lintCi = parsed?.scripts?.['lint:ci'];
  if (typeof lintCi === 'string' && lintCiKeepsMaxWarningsZero(lintCi)) {
    return [];
  }

  return [
    {
      file: 'package.json',
      lineNumber: 1,
      message: `lint:ci must keep --max-warnings 0 for every ESLint invocation (#${issueNumber}).`,
      content: typeof lintCi === 'string' ? lintCi : '',
    },
  ];
}

export function scanRepositoryLintEscapeHatches(rootDir, issueNumber) {
  const violations = [];
  for (const file of repositoryTypeScriptFiles(rootDir)) {
    const content = readFileSync(file, 'utf8');
    violations.push(
      ...scanTypeScriptTextForEscapeHatches(
        file,
        content,
        issueNumber,
        rootDir,
      ),
    );
    violations.push(
      ...scanTypeScriptAstForEscapeHatches(
        file,
        sourceFileFor(file, content),
        issueNumber,
        rootDir,
      ),
    );
  }
  violations.push(...scanEslintConfigForEscapeHatches(rootDir, issueNumber));
  violations.push(...scanPackageJsonLintCi(rootDir, issueNumber));
  return violations;
}

const SCOPE_STRING_PATTERN = /'([^']+)'|"([^"]+)"|`([^`]+)`/;

/**
 * Extracts the string-literal entries of a named const scope array
 * (legacyDirectiveCleanupScopes or completedDirectiveCleanupScopes) from
 * eslint.config.js source text. Returns the raw string values.
 */
export function extractScopeArray(scopeName, configSource) {
  const source =
    configSource ??
    readFileSync(join(process.cwd(), 'eslint.config.js'), 'utf8');
  const startMatch = new RegExp('const\\s+' + scopeName + '\\s*=\\s*\\[').exec(
    source,
  );
  if (startMatch === null) {
    return [];
  }
  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = source.indexOf(']', startIdx);
  if (endIdx === -1) {
    return [];
  }
  const body = source.slice(startIdx, endIdx);
  const entries = [];
  for (const rawLine of body.split(String.fromCharCode(10))) {
    const match = SCOPE_STRING_PATTERN.exec(rawLine);
    if (match !== null) {
      entries.push(match[1] ?? match[2] ?? match[3]);
    }
  }
  return entries;
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

function isCommentOnlyLine(line) {
  return line.trim().startsWith('//');
}

/**
 * Strips trailing // comments from a line, respecting string literals so that
 * // inside quotes is not mistaken for a comment start.
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
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    }
  }
  return line;
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

const SCOPE_DECLARATION_ARRAYS = new Set([
  'legacyDirectiveCleanupScopes',
  'completedDirectiveCleanupScopes',
]);

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
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '{') {
      delta += 1;
    } else if (char === '}') {
      delta -= 1;
    }
  }

  return delta;
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
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === '{') {
      count += 1;
    }
  }

  return count;
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
  let currentArray = null;
  let braceDepth = 0;
  let moduleObjectDepth = null;
  let rulesObjectDepth = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const arrayStart = extractArrayStart(line);
    if (arrayStart !== null) {
      currentArray = arrayStart;
    }

    if (currentArray !== null && /^\s*\]/.test(line)) {
      currentArray = null;
    }

    const singleLineBypass = hasModuleCentralBypassOnSingleLine(
      line,
      modulePath,
    );
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

    if (isModulePathLine(line, modulePath)) {
      if (currentArray === 'ignores') {
        violations.push({
          file: 'eslint.config.js',
          lineNumber,
          message: moduleCentralBypassMessage(
            modulePath,
            'ignore',
            issueNumber,
          ),
          content: line,
        });
      } else if (currentArray === 'allow') {
        violations.push({
          file: 'eslint.config.js',
          lineNumber,
          message: moduleCentralBypassMessage(
            modulePath,
            'allow-list',
            issueNumber,
          ),
          content: line,
        });
      }
      // Only set the object-depth tracker for file-pattern lines inside config
      // blocks, not bare scope-declaration-array string literals.
      if (isModuleFilesLine(line, modulePath, currentArray)) {
        moduleObjectDepth = enclosingObjectDepth(line, braceDepth, modulePath);
      }
    }

    const inModuleObject =
      moduleObjectDepth !== null && braceDepth >= moduleObjectDepth;
    if (inModuleObject) {
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
        rulesObjectDepth = braceDepth + countOpeningBraces(line);
      }
      if (
        rulesObjectDepth !== null &&
        (isNewOffRule(line) || isStandaloneOffRuleValue(line))
      ) {
        violations.push({
          file: 'eslint.config.js',
          lineNumber,
          message: moduleCentralBypassMessage(
            modulePath,
            'rule-off',
            issueNumber,
          ),
          content: line,
        });
      }
    }

    braceDepth += countBraceDelta(line);
    if (rulesObjectDepth !== null && braceDepth < rulesObjectDepth) {
      rulesObjectDepth = null;
    }
    if (moduleObjectDepth !== null && braceDepth < moduleObjectDepth) {
      moduleObjectDepth = null;
      rulesObjectDepth = null;
    }
  }

  return violations;
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

export function formatViolations(violations) {
  return violations
    .map((violation) => {
      const location = violation.file + ':' + violation.lineNumber;
      return (
        location + ' ' + violation.message + '\n  ' + violation.content.trim()
      );
    })
    .join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const diff = diffFromGit(args.base, args.head);
  const violations = checkDiff(diff);

  // Issue #2114 durable guard: packages/cli/src must contain zero inline ESLint
  // disable/enable directives and must not be present in central directive
  // cleanup scope lists.
  violations.push(...checkCliSourcePolicy());
  violations.push(...scanCliProductionTypeEscapes());

  // Issue #2115 durable guard: packages/core must contain zero inline ESLint
  // disable/enable directives and must not be present in central directive
  // cleanup scope lists.
  violations.push(...scanCoreDirectives());

  // Issue #2122 durable guard: packages/policy must contain zero inline ESLint
  // disable/enable directives and must not be present in central directive
  // cleanup scope lists.
  violations.push(...scanModuleDirectives('packages/policy', '2122'));

  // Issue #2189 durable guard: all checked source in the repository must
  // contain zero TypeScript suppression directives
  // (@ts-ignore/@ts-expect-error/@ts-nocheck). The root scan mirrors the
  // diff-based checkDiff coverage universe (the whole repo, excluding
  // generated directories), so the durable guard is as strong as the
  // diff-based acceptance criteria. This supersedes the earlier per-package
  // scanPackageTypeScriptSuppressions loop, which only covered selected
  // packages src directories and left root-level scripts and config files
  // unguarded (#2189 review finding).
  violations.push(...scanRootTypeScriptSuppressions(process.cwd(), '2189'));

  // Issue #2227 durable guard: all repository TypeScript under packages and
  // integration-tests must be free of lint/type escape hatches, and central
  // lint policy must not preserve carve-outs for directives or explicit any.
  violations.push(...scanRepositoryLintEscapeHatches(process.cwd(), '2227'));
  const configPath = join(process.cwd(), 'eslint.config.js');
  if (existsSync(configPath)) {
    const configSource = readFileSync(configPath, 'utf8');
    violations.push(...checkCoreDirectiveScopesInConfig(configSource));
    violations.push(...checkCoreCentralBypassesInConfig(configSource));
    violations.push(
      ...checkModuleDirectiveScopesInConfig(
        configSource,
        'packages/policy',
        '2122',
        false,
      ),
    );
    violations.push(
      ...checkModuleCentralBypassesInConfig(
        configSource,
        'packages/policy',
        '2122',
      ),
    );
  }

  if (violations.length === 0) {
    console.log('ESLint policy guard passed.');
    return;
  }

  console.error('ESLint policy guard failed:');
  console.error(formatViolations(violations));
  process.exit(1);
}

if (import.meta.url === 'file://' + process.argv[1]) {
  main();
}
