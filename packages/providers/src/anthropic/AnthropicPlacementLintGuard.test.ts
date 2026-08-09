/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structural proof (issue #3172 AC-4): the error-level, provider-scoped
 * `no-restricted-syntax` guard in the EFFECTIVE eslint.config.js must reject
 * auth-controlled placement in the original decision site and in the
 * placement-only helper, while allowing direct auth facts inside auth-specific
 * helpers.
 *
 * The rule is extracted from ESLint's calculated effective config for the
 * target file — not merely scanned from the raw config entry — so a later
 * flat-config block that silently drops the selector is detected.
 */

import { describe, it, expect } from 'bun:test';
import { ESLint, Linter } from 'eslint';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PROJECT_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TARGET_FILE = path.join(
  PROJECT_ROOT,
  'packages/providers/src/anthropic/AnthropicRequestPreparation.ts',
);
const PREPARATION_SOURCE_PATH = TARGET_FILE;

type RuleEntry = { selector: string; message: string };
type RuleConfig = [severity: Linter.RuleSeverity, ...entries: RuleEntry[]];

function isRuleEntry(value: unknown): value is RuleEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    'selector' in candidate &&
    typeof candidate['selector'] === 'string' &&
    'message' in candidate &&
    typeof candidate['message'] === 'string'
  );
}

async function getEffectiveRule(): Promise<RuleConfig | undefined> {
  const eslint = new ESLint({ cwd: PROJECT_ROOT });
  const config = await eslint.calculateConfigForFile(TARGET_FILE);
  const rule = config.rules?.['no-restricted-syntax'];
  if (!Array.isArray(rule) || rule.length < 2) {
    return undefined;
  }
  const severity = rule[0];
  const entries = rule.slice(1).filter(isRuleEntry);
  return [severity, ...entries] as RuleConfig;
}

const effectiveRule = await getEffectiveRule();

function lintWithEffectiveRule(code: string) {
  const linter = new Linter();
  return linter.verify(code, {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-restricted-syntax': effectiveRule ?? 'off',
    },
  });
}

function hasPlacementViolation(
  messages: ReturnType<typeof lintWithEffectiveRule>,
): boolean {
  return messages.some(
    (message) =>
      message.severity === 2 && message.message.includes('issue #3172'),
  );
}

describe('AnthropicRequestPreparation placement lint guard (issue #3172 AC-4)', () => {
  it('registers an error-level rule in the EFFECTIVE config for the target file', () => {
    expect(effectiveRule).toBeDefined();
    // calculateConfigForFile normalizes severity to numeric (2 = error).
    expect(effectiveRule![0]).toBe(2);
  });

  it('preserves the pre-existing no-restricted-syntax entries under flat-config replacement', () => {
    const [, ...entries] = effectiveRule!;
    const selectors = entries.map((entry) => entry.selector);
    expect(selectors).toContain('CallExpression[callee.name="require"]');
    expect(selectors).toContain(
      'ThrowStatement > Literal:not([value=/^\\w+Error:/])',
    );
  });

  it('rejects any isOAuth reference inside placeSystemInstruction', () => {
    const messages = lintWithEffectiveRule(
      [
        'function placeSystemInstruction(params) {',
        '  if (params.isOAuth) {',
        '    return [];',
        '  }',
        '  return [];',
        '}',
      ].join('\n'),
    );
    expect(hasPlacementViolation(messages)).toBe(true);
  });

  it('rejects isOAuth when the placement helper is an arrow function', () => {
    const messages = lintWithEffectiveRule(
      [
        'const placeSystemInstruction = (params) => {',
        '  return params.isOAuth ? [] : [];',
        '};',
      ].join('\n'),
    );
    expect(hasPlacementViolation(messages)).toBe(true);
  });

  it('rejects the exact removed isOAuth branch when reintroduced in buildSystemContext', () => {
    const messages = lintWithEffectiveRule(
      [
        'function buildSystemContext(params) {',
        '  if (params.isOAuth) {',
        '    return buildOAuthSystemContext(params);',
        '  }',
        '  return buildNonOAuthSystemContext(params);',
        '}',
      ].join('\n'),
    );
    expect(hasPlacementViolation(messages)).toBe(true);
  });

  it('rejects an inline auth ternary after the placement helper is renamed', () => {
    const messages = lintWithEffectiveRule(
      [
        'function renamedPlacement(params) {',
        '  return params.isOAuth ? buildOAuthSystemContext(params) : [];',
        '}',
      ].join('\n'),
    );
    expect(hasPlacementViolation(messages)).toBe(true);
  });

  it('rejects negation bypass: !params.isOAuth inside placeSystemInstruction', () => {
    const messages = lintWithEffectiveRule(
      [
        'function placeSystemInstruction(params) {',
        '  if (!params.isOAuth) {',
        '    return [];',
        '  }',
        '  return [];',
        '}',
      ].join('\n'),
    );
    expect(hasPlacementViolation(messages)).toBe(true);
  });

  it('rejects equality bypass: params.isOAuth === true inside placeSystemInstruction', () => {
    const messages = lintWithEffectiveRule(
      [
        'function placeSystemInstruction(params) {',
        '  if (params.isOAuth === true) {',
        '    return [];',
        '  }',
        '  return [];',
        '}',
      ].join('\n'),
    );
    expect(hasPlacementViolation(messages)).toBe(true);
  });

  it('rejects ternary bypass: params.isOAuth ? a : b inside placeSystemInstruction', () => {
    const messages = lintWithEffectiveRule(
      [
        'function placeSystemInstruction(params) {',
        '  const x = params.isOAuth ? [] : [];',
        '  return x;',
        '}',
      ].join('\n'),
    );
    expect(hasPlacementViolation(messages)).toBe(true);
  });

  it('rejects file-wide destructure bypass: const { isOAuth } = params', () => {
    const messages = lintWithEffectiveRule(
      [
        'function renamedPlacement(params) {',
        '  const { isOAuth } = params;',
        '  return isOAuth ? [] : [];',
        '}',
      ].join('\n'),
    );
    expect(hasPlacementViolation(messages)).toBe(true);
  });

  it('rejects switch bypass: switch on params.isOAuth inside placeSystemInstruction', () => {
    const messages = lintWithEffectiveRule(
      [
        'function placeSystemInstruction(params) {',
        '  switch (params.isOAuth) {',
        '    case true: return [];',
        '    default: return [];',
        '  }',
        '}',
      ].join('\n'),
    );
    expect(hasPlacementViolation(messages)).toBe(true);
  });

  it('allows legitimate auth-only use of a direct isOAuth parameter', () => {
    const messages = lintWithEffectiveRule(
      [
        'function buildContextPrefixSystemField(isOAuth) {',
        '  if (isOAuth) {',
        '    return "vendor";',
        '  }',
        '  return undefined;',
        '}',
      ].join('\n'),
    );
    expect(messages).toStrictEqual([]);
  });

  it('allows placement-only branching without any isOAuth reference', () => {
    const messages = lintWithEffectiveRule(
      [
        'function placeSystemInstruction(params) {',
        '  if (params.placement === "context-prefix") {',
        '    return [{ role: "user", content: "prompt" }];',
        '  }',
        '  return [];',
        '}',
      ].join('\n'),
    );
    expect(messages).toStrictEqual([]);
  });

  it('keeps the candidate AnthropicRequestPreparation.ts source lint-clean', async () => {
    const eslint = new ESLint({ cwd: PROJECT_ROOT });
    const [result] = await eslint.lintFiles(PREPARATION_SOURCE_PATH);
    expect(result.messages).toStrictEqual([]);
  });
});
