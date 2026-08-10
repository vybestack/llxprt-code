/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  type Dirent,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';

import commentJson from 'comment-json';

import { git } from './git.ts';
import type { Violation } from './types.ts';

export const ISSUE_NUMBER = '3161';
export const BASELINE_PATH =
  'scripts/eslint-guard/test-exclusion-baseline.json';

const TEST_FILE_EXT_PATTERN = /\.(?:test-d|test|spec)\./i;
const TESTS_DIR_SEGMENT_PATTERN = /(?:^|[\\/])(?:__tests__|tests?)(?:[\\/]|$)/i;
const BRACE_GROUP_PATTERN = /\{[^{}]*\}/g;
const BRACE_TEST_WORD_PATTERN = /\b(?:test-d|test|spec)\b/i;
const GLOB_WILDCARD_PATTERN = /[*?{}]/;
const TYPECHECK_CONFIG_PATTERN = /^packages\/[^/]+\/tsconfig\.json$/;

export interface ConfigExclusionScan {
  readonly blanket: readonly Violation[];
  readonly optOuts: readonly string[];
}

export interface BaselineData {
  readonly issue: number;
  readonly configs: Readonly<Record<string, readonly string[]>>;
}

interface ParsedConfig {
  readonly exclude: readonly string[] | null;
  readonly extendsPath: string | null;
}

interface EffectiveExclude {
  readonly entry: string;
  readonly ownerPath: string;
}

interface RepoConfig {
  readonly repoPath: string;
  readonly absolutePath: string;
  readonly source: string;
}

function braceGroupIsTestRelated(group: string): boolean {
  const contents = group.slice(1, -1);
  return contents.split(',').some((alternative) => {
    const normalized = alternative.trim().toLowerCase();
    return (
      normalized === 'test' ||
      normalized === 'tests' ||
      normalized === '__tests__' ||
      BRACE_TEST_WORD_PATTERN.test(normalized)
    );
  });
}

function hasBraceTestAlternative(pattern: string): boolean {
  for (const match of pattern.matchAll(BRACE_GROUP_PATTERN)) {
    if (braceGroupIsTestRelated(match[0])) {
      return true;
    }
  }
  return false;
}

export function isTestIndicator(pattern: string): boolean {
  return (
    TEST_FILE_EXT_PATTERN.test(pattern) ||
    TESTS_DIR_SEGMENT_PATTERN.test(pattern) ||
    hasBraceTestAlternative(pattern)
  );
}

export function hasGlobWildcards(pattern: string): boolean {
  return GLOB_WILDCARD_PATTERN.test(pattern);
}

function hasFileExtension(pattern: string): boolean {
  const finalSegment = normalizePosixPath(pattern)
    .split('/')
    .findLast((segment) => segment !== '');
  return finalSegment !== undefined && extname(finalSegment) !== '';
}

function resolvesToDirectory(
  pattern: string,
  owningConfigPath: string | undefined,
): boolean {
  if (owningConfigPath === undefined || hasGlobWildcards(pattern)) {
    return false;
  }
  const candidate = resolve(
    dirname(owningConfigPath),
    normalizePosixPath(pattern),
  );
  return existsSync(candidate) && statSync(candidate).isDirectory();
}

function isBlanketForConfig(
  pattern: string,
  owningConfigPath: string | undefined,
): boolean {
  if (!isTestIndicator(pattern)) {
    return false;
  }
  return (
    hasGlobWildcards(pattern) ||
    resolvesToDirectory(pattern, owningConfigPath) ||
    !hasFileExtension(pattern)
  );
}

export function isBlanketTestExclusion(pattern: string): boolean {
  return isBlanketForConfig(pattern, undefined);
}

export function isLiteralTestOptOut(pattern: string): boolean {
  return (
    isTestIndicator(pattern) &&
    !hasGlobWildcards(pattern) &&
    hasFileExtension(pattern)
  );
}

export function normalizePosixPath(pattern: string): string {
  return pattern.replace(/\\/g, '/');
}

function isTsConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStringArray(
  value: unknown,
  fieldName: string,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function parseConfig(configSource: string, configPath: string): ParsedConfig {
  const parsed: unknown = commentJson.parse(configSource);
  if (!isTsConfigObject(parsed)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }
  const exclude =
    parsed.exclude === undefined
      ? null
      : parseStringArray(parsed.exclude, `${configPath} exclude`);
  if (
    parsed.extends !== undefined &&
    (typeof parsed.extends !== 'string' || parsed.extends.trim() === '')
  ) {
    throw new Error(`${configPath} extends must be a non-empty string.`);
  }
  return {
    exclude,
    extendsPath: typeof parsed.extends === 'string' ? parsed.extends : null,
  };
}

export function extractExcludeArray(configSource: string): readonly string[] {
  return parseConfig(configSource, 'tsconfig').exclude ?? [];
}

function scanExclusions(
  configPath: string,
  entries: readonly EffectiveExclude[],
): ConfigExclusionScan {
  const blanket: Violation[] = [];
  const optOuts: string[] = [];
  for (const exclusion of entries) {
    if (isBlanketForConfig(exclusion.entry, exclusion.ownerPath)) {
      blanket.push({
        file: configPath,
        lineNumber: 1,
        message: `Blanket test exclusion "${exclusion.entry}" is forbidden in typecheck configs; use a literal file path or remove it (#${ISSUE_NUMBER}).`,
        content: exclusion.entry,
      });
    } else if (isLiteralTestOptOut(exclusion.entry)) {
      optOuts.push(normalizePosixPath(exclusion.entry));
    }
  }
  return { blanket, optOuts };
}

export function scanConfigExclusions(
  configPath: string,
  configSource: string,
  owningConfigPath?: string,
): ConfigExclusionScan {
  const ownerPath = owningConfigPath ?? configPath;
  const entries = extractExcludeArray(configSource).map((entry) => ({
    entry,
    ownerPath,
  }));
  return scanExclusions(configPath, entries);
}

function validateBaselineConfigKey(key: string): string {
  const normalized = normalizePosixPath(key);
  if (!TYPECHECK_CONFIG_PATTERN.test(normalized)) {
    throw new Error(
      `Baseline config ${key} must be an exact packages/*/tsconfig.json path.`,
    );
  }
  return normalized;
}

function validateBaselineEntries(
  configPath: string,
  value: unknown,
): readonly string[] {
  const entries = parseStringArray(value, `Baseline entries for ${configPath}`);
  const normalized = entries.map(normalizePosixPath).sort();
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(
      `Baseline entries for ${configPath} contain a duplicate path.`,
    );
  }
  for (const entry of normalized) {
    if (!isLiteralTestOptOut(entry)) {
      throw new Error(
        `Baseline entry "${entry}" for ${configPath} must be a literal test opt-out.`,
      );
    }
  }
  return normalized;
}

export function parseBaseline(content: string): BaselineData {
  if (content.trim() === '') {
    throw new Error(`The #${ISSUE_NUMBER} baseline is empty.`);
  }
  const parsed: unknown = commentJson.parse(content);
  if (!isTsConfigObject(parsed)) {
    throw new Error(`The #${ISSUE_NUMBER} baseline must be an object.`);
  }
  if (parsed.issue !== Number(ISSUE_NUMBER)) {
    throw new Error(`The baseline issue must be ${ISSUE_NUMBER}.`);
  }
  const configsValue = parsed.configs;
  if (!isTsConfigObject(configsValue)) {
    throw new Error('The baseline configs value must be an object.');
  }

  const configs: Record<string, readonly string[]> = {};
  for (const key of Object.keys(configsValue).sort()) {
    const normalizedKey = validateBaselineConfigKey(key);
    if (configs[normalizedKey] !== undefined) {
      throw new Error(`Baseline contains duplicate config ${normalizedKey}.`);
    }
    configs[normalizedKey] = validateBaselineEntries(key, configsValue[key]);
  }
  return { issue: Number(ISSUE_NUMBER), configs };
}

function findConfigLine(configSource: string, pattern: string): number {
  const lines = configSource.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(pattern)) {
      return i + 1;
    }
  }
  return 1;
}

function readPackageConfig(
  packagesDir: string,
  entry: Dirent,
  rootDir: string,
): RepoConfig | null {
  if (!entry.isDirectory() || entry.name === 'node_modules') {
    return null;
  }
  const tsconfigPath = join(packagesDir, entry.name, 'tsconfig.json');
  if (!existsSync(tsconfigPath) || !statSync(tsconfigPath).isFile()) {
    return null;
  }
  return {
    repoPath: normalizePosixPath(relative(rootDir, tsconfigPath)),
    absolutePath: tsconfigPath,
    source: readFileSync(tsconfigPath, 'utf8'),
  };
}

function listTypecheckConfigs(rootDir: string): RepoConfig[] {
  const packagesDir = join(rootDir, 'packages');
  if (!existsSync(packagesDir)) {
    return [];
  }
  const configs: RepoConfig[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    const config = readPackageConfig(packagesDir, entry, rootDir);
    if (config !== null) {
      configs.push(config);
    }
  }
  return configs.sort((left, right) =>
    left.repoPath.localeCompare(right.repoPath),
  );
}

function findConfigCandidate(basePath: string): string | null {
  for (const candidate of [
    basePath,
    `${basePath}.json`,
    join(basePath, 'tsconfig.json'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function resolveExtendsPath(configPath: string, extendsPath: string): string {
  if (extendsPath.startsWith('.') || extendsPath.startsWith('/')) {
    const candidate = findConfigCandidate(
      resolve(dirname(configPath), extendsPath),
    );
    if (candidate !== null) {
      return candidate;
    }
  } else {
    const requireFromConfig = createRequire(configPath);
    try {
      return requireFromConfig.resolve(extendsPath);
    } catch {
      throw new Error(`${configPath} extends missing config ${extendsPath}.`);
    }
  }
  throw new Error(`${configPath} extends missing config ${extendsPath}.`);
}

function resolveEffectiveExcludes(
  configPath: string,
  ancestry: readonly string[],
): readonly EffectiveExclude[] {
  if (ancestry.includes(configPath)) {
    throw new Error(
      `Cycle in tsconfig extends chain: ${[...ancestry, configPath].join(' -> ')}`,
    );
  }
  const source = readFileSync(configPath, 'utf8');
  const parsed = parseConfig(source, configPath);
  const nextAncestry = [...ancestry, configPath];
  let inherited: readonly EffectiveExclude[] = [];
  if (parsed.extendsPath !== null) {
    const parentPath = resolveExtendsPath(configPath, parsed.extendsPath);
    inherited = resolveEffectiveExcludes(parentPath, nextAncestry);
  }
  if (parsed.exclude === null) {
    return inherited;
  }
  return parsed.exclude.map((entry) => ({
    entry,
    ownerPath: configPath,
  }));
}

function readBaselineFromBase(
  rootDir: string,
  baseRef: string,
): BaselineData | null {
  const baselineAbs = join(rootDir, BASELINE_PATH);
  const baselineRepo = normalizePosixPath(relative(rootDir, baselineAbs));
  git(['cat-file', '-e', `${baseRef}^{commit}`], rootDir);
  const baselineAtBase = git(
    ['ls-tree', '--name-only', baseRef, '--', baselineRepo],
    rootDir,
  );
  if (baselineAtBase === '') {
    return null;
  }
  return parseBaseline(git(['show', `${baseRef}:${baselineRepo}`], rootDir));
}

function readWorkingBaseline(rootDir: string): BaselineData {
  const baselineAbs = join(rootDir, BASELINE_PATH);
  if (!existsSync(baselineAbs)) {
    throw new Error(
      `Missing required #${ISSUE_NUMBER} baseline: ${BASELINE_PATH}`,
    );
  }
  return parseBaseline(readFileSync(baselineAbs, 'utf8'));
}

function validateWorkingBaselineKeys(
  configs: readonly RepoConfig[],
  baseline: BaselineData,
): void {
  const scanned = configs.map((config) => config.repoPath).sort();
  const recorded = Object.keys(baseline.configs).sort();
  if (
    scanned.length !== recorded.length ||
    scanned.some((configPath, index) => configPath !== recorded[index])
  ) {
    throw new Error(
      `Baseline config keys must exactly match scanned typecheck configs. Scanned: ${scanned.join(', ')}; baseline: ${recorded.join(', ')}.`,
    );
  }
}

function findBaselineAdditions(
  workingBaseline: BaselineData,
  baseBaseline: BaselineData,
): readonly Violation[] {
  const additions: Violation[] = [];
  for (const configPath of Object.keys(workingBaseline.configs)) {
    const baseEntries = new Set(baseBaseline.configs[configPath] ?? []);
    for (const entry of workingBaseline.configs[configPath]) {
      if (!baseEntries.has(entry)) {
        additions.push({
          file: BASELINE_PATH,
          lineNumber: 1,
          message: `Baseline entry "${entry}" for ${configPath} is absent from the Git base; #${ISSUE_NUMBER} forbids adding test opt-outs. Fix the type error instead.`,
          content: `${configPath}:${entry}`,
        });
      }
    }
  }
  return additions;
}

function addConfigViolations(
  config: RepoConfig,
  scan: ConfigExclusionScan,
  baselineEntries: readonly string[],
  violations: Violation[],
): void {
  for (const violation of scan.blanket) {
    violations.push({
      ...violation,
      lineNumber: findConfigLine(config.source, violation.content),
    });
  }
  for (const optOut of scan.optOuts) {
    if (!baselineEntries.includes(optOut)) {
      violations.push({
        file: config.repoPath,
        lineNumber: findConfigLine(config.source, optOut),
        message: `Literal test opt-out "${optOut}" is not tracked in the #${ISSUE_NUMBER} baseline; add it via a debt-reduction review or fix the type error.`,
        content: optOut,
      });
    }
  }
}

function reportStaleEntries(
  baseline: BaselineData,
  currentByConfig: ReadonlyMap<string, readonly string[]>,
): void {
  const stale: string[] = [];
  for (const configPath of Object.keys(baseline.configs)) {
    const current = currentByConfig.get(configPath) ?? [];
    for (const entry of baseline.configs[configPath]) {
      if (!current.includes(entry)) {
        stale.push(`${configPath}:${entry}`);
      }
    }
  }
  if (stale.length > 0) {
    console.log(
      `[#${ISSUE_NUMBER}] ${stale.length} stale baseline entr${stale.length === 1 ? 'y' : 'ies'} (informational, nonblocking):\n` +
        stale.map((entry) => `  - ${entry}`).join('\n'),
    );
  }
}

export function scanRepositoryTestExclusions(
  rootDir: string,
  baseRef: string,
): Violation[] {
  const configs = listTypecheckConfigs(rootDir);
  const workingBaseline = readWorkingBaseline(rootDir);
  validateWorkingBaselineKeys(configs, workingBaseline);

  const violations: Violation[] = [];
  const currentByConfig = new Map<string, readonly string[]>();
  for (const config of configs) {
    const effective = resolveEffectiveExcludes(config.absolutePath, []);
    const scan = scanExclusions(config.repoPath, effective);
    const normalized = scan.optOuts.map(normalizePosixPath).sort();
    currentByConfig.set(config.repoPath, normalized);
    addConfigViolations(
      config,
      { blanket: scan.blanket, optOuts: normalized },
      workingBaseline.configs[config.repoPath],
      violations,
    );
  }

  reportStaleEntries(workingBaseline, currentByConfig);
  const baseBaseline = readBaselineFromBase(rootDir, baseRef);
  if (baseBaseline !== null) {
    violations.push(...findBaselineAdditions(workingBaseline, baseBaseline));
  }
  return violations;
}
