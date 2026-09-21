/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CEILING_RULES, isCommentOnlyLine } from './constants.ts';
import {
  countDiffBraceDelta,
  extractInlineRulesEntries,
  isRulesBlockOpen,
} from './diff-context.ts';
import {
  countDiffBracketAndBraceDelta,
  extractMaxValueFromStandaloneLine,
  extractRuleKey,
  extractSeverityValue,
  extractStandaloneNumericThresholdValue,
  extractThresholdValue,
  isCompleteSingleLineRuleEntry,
  isMultilineArraySeverityEntry,
  isMultilineNumericSeverityEntry,
  isObjectFormMaxLine,
  isStandaloneMaxLine,
  isStandaloneNumericThresholdLine,
  isStandaloneOffRuleValue,
  normalizeMultilineSeverity,
  openerExpectsFirstArrayElement,
} from './rule-config.ts';
import type { Violation } from './types.ts';

// --- Per-file ceiling override guard (#3718) ---
//
// eslint-policy-allow-off must not be able to waive a CEILING_RULES override
// for specific files. Raising or switching off a ceiling rule per file is a
// violation unless the exact files-glob + rule-id pair is listed in the
// checked-in baseline.

export const CEILING_OVERRIDE_ISSUE_NUMBER = '3718';
export const CEILING_OVERRIDE_BASELINE_PATH =
  'scripts/eslint-guard/ceiling-override-baseline.json';

// Repository-wide ceiling thresholds. A per-file threshold above these values
// waives the repo ceiling and is treated exactly like an off entry. Ceiling
// rules without a repo base (max-statements, max-params, max-depth) are not
// configured globally, so an explicit per-file threshold for them enables a
// rule rather than waiving one and is never flagged as a threshold waiver.
export const REPO_BASE_CEILINGS: Readonly<Record<string, number>> = {
  'max-lines': 800,
  'max-lines-per-function': 80,
  complexity: 25,
  'sonarjs/cognitive-complexity': 30,
};

const GLOB_STRING_PATTERN = /'([^']+)'|"([^"]+)"|`([^`]+)`/g;
const FILES_ARRAY_OPEN_PATTERN = /^\s*['"]?files['"]?\s*:\s*\[/;

export function extractGlobStrings(line: string): string[] {
  const globs: string[] = [];
  for (const match of line.matchAll(GLOB_STRING_PATTERN)) {
    globs.push(match[1] ?? match[2] ?? match[3]);
  }
  return globs;
}

export function isFilesArrayOpenLine(line: string): boolean {
  return FILES_ARRAY_OPEN_PATTERN.test(line);
}

export interface CeilingWaiver {
  readonly ruleKey: string;
  readonly kind: 'off' | 'threshold';
  readonly threshold: number | null;
}

function exceedsRepoBase(ruleKey: string, value: number) {
  const base = REPO_BASE_CEILINGS[ruleKey];
  return base !== undefined && value > base;
}

/**
 * Evaluates one config line for a ceiling waiver. `keyedRule` is the rule key
 * written on this line (null for continuation lines of multiline rule
 * configs); `continuationRuleKey` is the ceiling rule whose multiline entry
 * is currently open, and `expectingThreshold` whether the next standalone
 * numeric line would be its threshold.
 */
export function describeCeilingWaiver(
  content: string,
  keyedRule: string | null,
  continuationRuleKey: string | null,
  expectingThreshold: boolean,
): CeilingWaiver | null {
  const ruleKey = keyedRule ?? continuationRuleKey;
  if (ruleKey === null || !CEILING_RULES.has(ruleKey)) {
    return null;
  }
  if (keyedRule !== null) {
    if (extractSeverityValue(content) === 'off') {
      return { ruleKey, kind: 'off', threshold: null };
    }
    const threshold = extractThresholdValue(content, ruleKey);
    if (threshold !== null && exceedsRepoBase(ruleKey, threshold.value)) {
      return { ruleKey, kind: 'threshold', threshold: threshold.value };
    }
    return null;
  }
  if (
    isStandaloneOffRuleValue(content) ||
    normalizeMultilineSeverity(content) === 'off'
  ) {
    return { ruleKey, kind: 'off', threshold: null };
  }
  // The anchored standalone max/numeric patterns do not tolerate trailing
  // comments, but waivers in the config are routinely tagged, so compare
  // against the comment-stripped line.
  const stripped = stripTrailingLineComment(content);
  const isMaxForm =
    isStandaloneMaxLine(stripped) || isObjectFormMaxLine(stripped);
  const maxValue = isMaxForm
    ? extractMaxValueFromStandaloneLine(stripped)
    : null;
  const numericValue =
    expectingThreshold && isStandaloneNumericThresholdLine(stripped)
      ? extractStandaloneNumericThresholdValue(stripped)
      : null;
  const value = maxValue ?? numericValue;
  if (value !== null && exceedsRepoBase(ruleKey, value)) {
    return { ruleKey, kind: 'threshold', threshold: value };
  }
  return null;
}

function stripTrailingLineComment(content: string) {
  const idx = content.indexOf('//');
  return idx === -1 ? content : content.slice(0, idx);
}

export function ceilingOverrideMessage(
  ruleKey: string,
  filesGlobs: readonly string[],
): string {
  return (
    `Per-file ceiling override for '${ruleKey}' in files [${filesGlobs.join(', ')}] ` +
    `cannot be waived by eslint-policy-allow-off or any comment: ` +
    `split the file; raising the ceiling is not an accepted fix ` +
    `(#${CEILING_OVERRIDE_ISSUE_NUMBER}).`
  );
}

// --- Baseline ---

export interface CeilingOverrideBaselineEntry {
  readonly files: string;
  readonly rule: string;
}

export interface CeilingOverrideBaseline {
  readonly issue: number;
  readonly entries: readonly CeilingOverrideBaselineEntry[];
}

function baselineKey(files: string, rule: string) {
  return files + '\u0000' + rule;
}

function isBaselineEntryObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCeilingOverrideBaseline(
  content: string,
): CeilingOverrideBaseline {
  const parsed: unknown = JSON.parse(content);
  if (!isBaselineEntryObject(parsed)) {
    throw new Error(
      `The #${CEILING_OVERRIDE_ISSUE_NUMBER} ceiling override baseline must be an object.`,
    );
  }
  if (parsed.issue !== Number(CEILING_OVERRIDE_ISSUE_NUMBER)) {
    throw new Error(
      `The ceiling override baseline issue must be ${CEILING_OVERRIDE_ISSUE_NUMBER}.`,
    );
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error(
      `The #${CEILING_OVERRIDE_ISSUE_NUMBER} baseline entries must be an array.`,
    );
  }
  const seen = new Set<string>();
  const entries: CeilingOverrideBaselineEntry[] = [];
  for (const value of parsed.entries) {
    if (!isBaselineEntryObject(value)) {
      throw new Error('Baseline entries must be objects.');
    }
    const files = value.files;
    const rule = value.rule;
    if (typeof files !== 'string' || files.trim() === '') {
      throw new Error('Baseline entry files must be a non-empty string.');
    }
    if (typeof rule !== 'string' || !CEILING_RULES.has(rule)) {
      throw new Error(
        `Baseline entry rule "${String(rule)}" must be a CEILING_RULES rule id.`,
      );
    }
    const key = baselineKey(files, rule);
    if (seen.has(key)) {
      throw new Error(`Baseline contains duplicate entry ${files} / ${rule}.`);
    }
    seen.add(key);
    entries.push({ files, rule });
  }
  return { issue: Number(CEILING_OVERRIDE_ISSUE_NUMBER), entries };
}

// Derived from this module's location (scripts/eslint-guard/), not
// process.cwd(): the baseline must resolve from tests and the guard runner
// regardless of working directory.
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

function loadCeilingOverrideBaseline(): CeilingOverrideBaseline {
  const baselineAbs = join(repositoryRoot, CEILING_OVERRIDE_BASELINE_PATH);
  if (!existsSync(baselineAbs)) {
    throw new Error(
      `Missing required #${CEILING_OVERRIDE_ISSUE_NUMBER} baseline: ${CEILING_OVERRIDE_BASELINE_PATH}`,
    );
  }
  return parseCeilingOverrideBaseline(readFileSync(baselineAbs, 'utf8'));
}

let baselineKeysCache: ReadonlySet<string> | null = null;

export function ceilingOverrideBaselineKeys(): ReadonlySet<string> {
  if (baselineKeysCache === null) {
    baselineKeysCache = new Set(
      loadCeilingOverrideBaseline().entries.map((entry) =>
        baselineKey(entry.files, entry.rule),
      ),
    );
  }
  return baselineKeysCache;
}

/**
 * Suppression requires EVERY tracked files glob to have a matching
 * (files-glob, rule) baseline pair: a files array mixing one baselined glob
 * with one unbaselined glob must not waive the entry for all of them (#3718).
 */
export function isBaselinedCeilingOverride(
  filesGlobs: readonly string[],
  rule: string,
): boolean {
  const keys = ceilingOverrideBaselineKeys();
  return filesGlobs.every((glob) => keys.has(baselineKey(glob, rule)));
}

// --- Current-state scan of eslint.config.js ---

export interface ConfigCeilingOverride {
  readonly files: string;
  readonly rule: string;
  readonly lineNumber: number;
  readonly kind: 'off' | 'threshold';
  readonly threshold: number | null;
  readonly content: string;
}

interface ConfigScanState {
  filesGlobs: string[];
  activeFilesGlobs: string[];
  filesArrayBracketDepth: number | null;
  rulesBraceDepth: number | null;
  currentCeilingRuleKey: string | null;
  insideRuleEntry: boolean;
  ruleEntryDepth: number | null;
  expectingFirstSeverityElement: boolean;
  expectingCeilingThreshold: boolean;
}

function createConfigScanState(): ConfigScanState {
  return {
    filesGlobs: [],
    activeFilesGlobs: [],
    filesArrayBracketDepth: null,
    rulesBraceDepth: null,
    currentCeilingRuleKey: null,
    insideRuleEntry: false,
    ruleEntryDepth: null,
    expectingFirstSeverityElement: false,
    expectingCeilingThreshold: false,
  };
}

function resetRuleEntryState(state: ConfigScanState) {
  state.currentCeilingRuleKey = null;
  state.insideRuleEntry = false;
  state.ruleEntryDepth = null;
  state.expectingFirstSeverityElement = false;
  state.expectingCeilingThreshold = false;
}

function updateFilesArrayCollection(state: ConfigScanState, line: string) {
  const globs = extractGlobStrings(line);
  if (state.filesArrayBracketDepth === null && isFilesArrayOpenLine(line)) {
    state.filesGlobs = globs;
    const depth = countDiffBracketAndBraceDelta(line);
    state.filesArrayBracketDepth = depth > 0 ? depth : null;
    return;
  }
  state.filesGlobs.push(...globs);
  if (state.filesArrayBracketDepth !== null) {
    state.filesArrayBracketDepth += countDiffBracketAndBraceDelta(line);
    if (state.filesArrayBracketDepth <= 0) {
      state.filesArrayBracketDepth = null;
    }
  }
}

function updateRuleEntryState(state: ConfigScanState, line: string) {
  if (state.insideRuleEntry && state.ruleEntryDepth !== null) {
    state.ruleEntryDepth += countDiffBracketAndBraceDelta(line);
    if (state.ruleEntryDepth <= 0) {
      resetRuleEntryState(state);
      return;
    }
    updateSeverityExpectation(state, line);
    return;
  }
  const key = extractRuleKey(line);
  if (key === null) {
    return;
  }
  state.currentCeilingRuleKey = CEILING_RULES.has(key) ? key : null;
  if (isCompleteSingleLineRuleEntry(line)) {
    state.insideRuleEntry = false;
    state.ruleEntryDepth = null;
    return;
  }
  state.insideRuleEntry = true;
  state.ruleEntryDepth = countDiffBracketAndBraceDelta(line);
  state.expectingFirstSeverityElement = openerExpectsFirstArrayElement(line);
  state.expectingCeilingThreshold =
    !state.expectingFirstSeverityElement &&
    state.currentCeilingRuleKey !== null;
}

function updateSeverityExpectation(state: ConfigScanState, line: string) {
  if (state.expectingFirstSeverityElement) {
    const isSeverity =
      isMultilineArraySeverityEntry(line) ||
      isMultilineNumericSeverityEntry(line);
    if (isSeverity) {
      state.expectingFirstSeverityElement = false;
      state.expectingCeilingThreshold = state.currentCeilingRuleKey !== null;
    }
    return;
  }
  if (
    state.expectingCeilingThreshold &&
    isStandaloneNumericThresholdLine(line)
  ) {
    state.expectingCeilingThreshold = false;
  }
}

/**
 * Extracts every per-file CEILING_RULES waiver (off/0 or a threshold above
 * the repo base) from eslint.config.js source text.
 */
export function extractConfigCeilingOverrides(
  configSource: string,
): ConfigCeilingOverride[] {
  const overrides: ConfigCeilingOverride[] = [];
  const state = createConfigScanState();
  const lines = configSource.split('\n');

  for (let i = 0; i < lines.length; i++) {
    processConfigScanLine(state, lines[i], i + 1, overrides);
  }
  return overrides;
}

function processConfigScanLine(
  state: ConfigScanState,
  line: string,
  lineNumber: number,
  overrides: ConfigCeilingOverride[],
) {
  if (isCommentOnlyLine(line)) {
    return;
  }
  if (state.rulesBraceDepth === null) {
    if (state.filesArrayBracketDepth !== null || isFilesArrayOpenLine(line)) {
      updateFilesArrayCollection(state, line);
      return;
    }
    if (!isRulesBlockOpen(line)) {
      return;
    }
    state.rulesBraceDepth = 0;
    state.activeFilesGlobs = state.filesGlobs;
    resetRuleEntryState(state);
  }
  recordCeilingWaiverLine(state, line, lineNumber, overrides);
  updateRuleEntryState(state, line);
  state.rulesBraceDepth += countDiffBraceDelta(line);
  if (state.rulesBraceDepth <= 0) {
    state.rulesBraceDepth = null;
    state.filesGlobs = [];
    state.activeFilesGlobs = [];
    resetRuleEntryState(state);
  }
}

function recordCeilingWaiverLine(
  state: ConfigScanState,
  line: string,
  lineNumber: number,
  overrides: ConfigCeilingOverride[],
) {
  if (state.activeFilesGlobs.length === 0) {
    return;
  }
  recordInlineCeilingWaivers(state, line, lineNumber, overrides);
  const waiver = describeCeilingWaiver(
    line,
    extractRuleKey(line),
    state.currentCeilingRuleKey,
    state.expectingCeilingThreshold,
  );
  if (waiver === null) {
    return;
  }
  pushCeilingWaiverPerGlob(state, waiver, lineNumber, line, overrides);
}

/**
 * Single-line `rules: { 'max-lines': 'off' }` openers carry their rule
 * entries inline; extractRuleKey treats the structural `rules` key as null,
 * so evaluate each inline entry with describeCeilingWaiver the same way the
 * diff path does (#3718).
 */
function recordInlineCeilingWaivers(
  state: ConfigScanState,
  line: string,
  lineNumber: number,
  overrides: ConfigCeilingOverride[],
) {
  for (const added of extractInlineRulesEntries(line)) {
    const waiver = describeCeilingWaiver(added.content, added.key, null, false);
    if (waiver !== null) {
      pushCeilingWaiverPerGlob(state, waiver, lineNumber, line, overrides);
    }
  }
}

function pushCeilingWaiverPerGlob(
  state: ConfigScanState,
  waiver: CeilingWaiver,
  lineNumber: number,
  line: string,
  overrides: ConfigCeilingOverride[],
) {
  for (const glob of state.activeFilesGlobs) {
    overrides.push({
      files: glob,
      rule: waiver.ruleKey,
      lineNumber,
      kind: waiver.kind,
      threshold: waiver.threshold,
      content: line.trim(),
    });
  }
}

/**
 * Current-state guard: every per-file ceiling waiver in eslint.config.js must
 * be listed in the checked-in baseline, regardless of any comment tag.
 */
export function scanConfigCeilingOverrides(configSource: string): Violation[] {
  const baselined = ceilingOverrideBaselineKeys();
  const violations: Violation[] = [];
  for (const override of extractConfigCeilingOverrides(configSource)) {
    if (baselined.has(baselineKey(override.files, override.rule))) {
      continue;
    }
    violations.push({
      file: 'eslint.config.js',
      lineNumber: override.lineNumber,
      message: ceilingOverrideMessage(override.rule, [override.files]),
      content: override.content,
    });
  }
  return violations;
}
