/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider Package Public API Behavioral Tests (P10)
 *
 * These tests define the expected public API surface of the providers package
 * after P11 migration. They test against the current state (pre-migration,
 * where providers package exports are empty/scaffold) and document exactly
 * which symbols must be added to the providers package public API.
 *
 * Expected status: RED on specific export checks until P11 migration completes.
 * The dynamic import succeeds but exports are not yet populated.
 *
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect } from 'vitest';

/**
 * Expected public API surface of @vybestack/llxprt-code-providers.
 *
 * After P11, these symbols must be importable from the providers package.
 */
const EXPECTED_PROVIDER_PUBLIC_API: Array<{
  name: string;
  kind: 'type' | 'value';
  category: string;
}> = [
  // Contract interfaces (type-only exports)
  { name: 'IProvider', kind: 'type', category: 'contracts' },
  { name: 'IProviderManager', kind: 'type', category: 'contracts' },
  { name: 'IModel', kind: 'type', category: 'contracts' },
  { name: 'ITool', kind: 'type', category: 'contracts' },
  { name: 'ITokenizer', kind: 'type', category: 'contracts' },
  { name: 'ContentGeneratorRole', kind: 'value', category: 'contracts' },

  // Concrete provider implementations (value exports)
  { name: 'ProviderManager', kind: 'value', category: 'orchestration' },
  { name: 'FakeProvider', kind: 'value', category: 'providers' },
  { name: 'OpenAIProvider', kind: 'value', category: 'providers' },
  { name: 'AnthropicProvider', kind: 'value', category: 'providers' },
  { name: 'GeminiProvider', kind: 'value', category: 'providers' },
  { name: 'OpenAIResponsesProvider', kind: 'value', category: 'providers' },
  { name: 'OpenAIVercelProvider', kind: 'value', category: 'providers' },
  { name: 'LoadBalancingProvider', kind: 'value', category: 'providers' },

  // Content generation
  { name: 'ProviderContentGenerator', kind: 'value', category: 'content' },

  // Tokenizers
  { name: 'OpenAITokenizer', kind: 'value', category: 'tokenizers' },
  { name: 'AnthropicTokenizer', kind: 'value', category: 'tokenizers' },

  // Errors
  { name: 'AuthenticationRequiredError', kind: 'value', category: 'errors' },
  { name: 'RateLimitError', kind: 'value', category: 'errors' },
  { name: 'QuotaError', kind: 'value', category: 'errors' },
  { name: 'AuthenticationError', kind: 'value', category: 'errors' },
  { name: 'ServerError', kind: 'value', category: 'errors' },
  { name: 'NetworkError', kind: 'value', category: 'errors' },
  { name: 'ClientError', kind: 'value', category: 'errors' },
  { name: 'MissingProviderRuntimeError', kind: 'value', category: 'errors' },
  { name: 'LoadBalancerFailoverError', kind: 'value', category: 'errors' },
  { name: 'AllBucketsExhaustedError', kind: 'value', category: 'errors' },

  // Utility
  { name: 'fetchApiKeyQuota', kind: 'value', category: 'utility' },
];

const EXPECTED_PROVIDER_RUNTIME_API = EXPECTED_PROVIDER_PUBLIC_API.filter(
  (entry) => entry.kind === 'value',
);

const EXPECTED_PROVIDER_TYPE_API = EXPECTED_PROVIDER_PUBLIC_API.filter(
  (entry) => entry.kind === 'type',
);

describe('Provider package public API behavioral tests', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * Verify that all expected categories are represented in the public API.
   */
  it('public API covers all expected categories', () => {
    const categories = new Set(
      EXPECTED_PROVIDER_PUBLIC_API.map((e) => e.category),
    );
    expect(categories.has('contracts')).toBe(true);
    expect(categories.has('providers')).toBe(true);
    expect(categories.has('orchestration')).toBe(true);
    expect(categories.has('content')).toBe(true);
    expect(categories.has('tokenizers')).toBe(true);
    expect(categories.has('errors')).toBe(true);
    expect(categories.has('utility')).toBe(true);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * Count the expected exports per category.
   * This test documents the required minimum export count per category.
   */
  it('each expected category has at least one expected export', () => {
    const categoryCounts: Record<string, number> = {};
    for (const entry of EXPECTED_PROVIDER_PUBLIC_API) {
      categoryCounts[entry.category] =
        (categoryCounts[entry.category] ?? 0) + 1;
    }
    // Verify non-zero counts
    for (const [category, count] of Object.entries(categoryCounts)) {
      expect(
        count,
        `Category ${category} must have at least 1 export`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * Type-only exports must be validated by TypeScript import tests once P11
   * exposes provider declarations. They must not be asserted with runtime
   * property checks because type-only exports are erased by TypeScript.
   */
  it('documents type-only provider package exports separately from runtime exports', () => {
    expect(EXPECTED_PROVIDER_TYPE_API.map((entry) => entry.name)).toStrictEqual(
      ['IProvider', 'IProviderManager', 'IModel', 'ITool', 'ITokenizer'],
    );
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * RED TEST: The providers package dynamic import does not yet export
   * runtime provider symbols. After P11, all value exports must be present.
   *
   * Current state: The providers package index.ts is a scaffold that exports
   * nothing. This test documents exactly which runtime symbols are missing
   * and must be added during P11 migration.
   */
  it('providers package exports all expected runtime public API symbols (P11 green)', async () => {
    let providersModule: Record<string, unknown>;
    try {
      providersModule = await import('@vybestack/llxprt-code-providers');
    } catch (error) {
      // If import fails entirely, all symbols are missing.
      const allNames = EXPECTED_PROVIDER_RUNTIME_API.map((e) => e.name);
      throw new Error(
        '@vybestack/llxprt-code-providers dynamic import ' +
          'failed or exports nothing. Missing symbols: ' +
          allNames.join(', ') +
          '. Import error: ' +
          String(error),
      );
    }

    // The import succeeds but the module is a scaffold — check which symbols are missing
    const missingSymbols: string[] = [];
    for (const entry of EXPECTED_PROVIDER_RUNTIME_API) {
      if (!(entry.name in providersModule)) {
        missingSymbols.push(entry.name);
      }
    }

    // All expected runtime symbols must be present after P11 migration
    const missingDetail =
      missingSymbols.length > 0
        ? `@vybestack/llxprt-code-providers is missing ${missingSymbols.length} expected runtime exports: ${missingSymbols.join(', ')}. These must be added during P11 migration when provider files are moved.`
        : '';
    expect(missingDetail).toBe('');
    expect(missingSymbols).toStrictEqual([]);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * RED TEST: ProviderManager must be constructable from providers package.
   * Currently undefined because the package doesn't export it yet.
   */
  it('ProviderManager is constructable from providers package (P11 green)', async () => {
    let providersModule: Record<string, unknown>;
    try {
      providersModule = await import('@vybestack/llxprt-code-providers');
    } catch (error) {
      throw new Error('Cannot import from providers package: ' + String(error));
    }

    const ProviderManager = providersModule.ProviderManager;
    expect(typeof ProviderManager).toBe('function');
    expect(
      (ProviderManager as new (...args: unknown[]) => unknown).prototype,
    ).toBeDefined();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P10
   * @requirement:REQ-TEST-001
   *
   * RED TEST: FakeProvider must be constructable from providers package.
   */
  it('FakeProvider is constructable from providers package (P11 green)', async () => {
    let providersModule: Record<string, unknown>;
    try {
      providersModule = await import('@vybestack/llxprt-code-providers');
    } catch (error) {
      throw new Error('Cannot import from providers package: ' + String(error));
    }

    const FakeProvider = providersModule.FakeProvider;
    expect(typeof FakeProvider).toBe('function');
  });
});
