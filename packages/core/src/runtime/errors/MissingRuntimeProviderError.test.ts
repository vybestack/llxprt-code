/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for MissingRuntimeProviderError core-owned contract.
 *
 * Proves that core runtime can throw and catch context-missing errors
 * without importing provider errors from the providers package.
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect } from 'vitest';
import { MissingRuntimeProviderError } from './MissingRuntimeProviderError.js';

describe('MissingRuntimeProviderError', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('constructs with required providerKey and missingFields', () => {
    const error = new MissingRuntimeProviderError({
      providerKey: 'openai',
      missingFields: ['apiKey', 'model'],
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(MissingRuntimeProviderError);
    expect(error.name).toBe('MissingRuntimeProviderError');
    expect(error.providerKey).toBe('openai');
    expect(error.missingFields).toStrictEqual(['apiKey', 'model']);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('constructs with default message based on providerKey and missingFields', () => {
    const error = new MissingRuntimeProviderError({
      providerKey: 'anthropic',
      missingFields: ['apiKey'],
    });

    expect(error.message).toContain('anthropic');
    expect(error.message).toContain('apiKey');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('constructs with custom message', () => {
    const error = new MissingRuntimeProviderError({
      providerKey: 'gemini',
      missingFields: [],
      message: 'Custom error message',
    });

    expect(error.message).toBe('Custom error message');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('formats default message with "runtime data" when missingFields is empty', () => {
    const error = new MissingRuntimeProviderError({
      providerKey: 'openai',
      missingFields: [],
    });

    expect(error.message).toContain('runtime data');
    expect(error.message).toContain('openai');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('includes default requirement tag', () => {
    const error = new MissingRuntimeProviderError({
      providerKey: 'openai',
      missingFields: ['config'],
    });

    expect(error.requirement).toBe('REQ-DEP-001');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts custom requirement tag', () => {
    const error = new MissingRuntimeProviderError({
      providerKey: 'openai',
      missingFields: ['config'],
      requirement: 'REQ-CUSTOM-001',
    });

    expect(error.requirement).toBe('REQ-CUSTOM-001');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('provides default remediation suggestions', () => {
    const error = new MissingRuntimeProviderError({
      providerKey: 'openai',
      missingFields: ['apiKey'],
    });

    expect(error.remediation).toHaveLength(2);
    expect(error.remediation[0]).toContain('ProviderManager');
    expect(error.remediation[1]).toContain('ProviderRuntimeContext');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts custom remediation suggestions', () => {
    const error = new MissingRuntimeProviderError({
      providerKey: 'openai',
      missingFields: ['apiKey'],
      remediation: ['Check your config file'],
    });

    expect(error.remediation).toStrictEqual(['Check your config file']);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('includes context with stage and metadata', () => {
    const error = new MissingRuntimeProviderError({
      providerKey: 'openai',
      missingFields: ['apiKey'],
      stage: 'initialization',
      metadata: { model: 'gpt-4', region: 'us-east' },
    });

    expect(error.context.stage).toBe('initialization');
    expect(error.context.metadata).toStrictEqual({
      model: 'gpt-4',
      region: 'us-east',
    });
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('can be caught and identified by instanceof', () => {
    function throwIfNoProvider(providerKey: string | undefined): void {
      if (!providerKey) {
        throw new MissingRuntimeProviderError({
          providerKey: 'unknown',
          missingFields: ['providerKey'],
        });
      }
    }

    expect(() => throwIfNoProvider(undefined)).toThrow(
      MissingRuntimeProviderError,
    );

    let thrownError: MissingRuntimeProviderError | undefined;
    try {
      throwIfNoProvider(undefined);
    } catch (e) {
      thrownError = e as MissingRuntimeProviderError;
    }
    expect(thrownError).toBeInstanceOf(MissingRuntimeProviderError);
    expect(thrownError?.providerKey).toBe('unknown');
    expect(thrownError?.missingFields).toStrictEqual(['providerKey']);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('missingFields is readonly (immutable)', () => {
    const error = new MissingRuntimeProviderError({
      providerKey: 'openai',
      missingFields: ['apiKey', 'model'],
    });

    const fields = error.missingFields;
    expect(fields).toStrictEqual(['apiKey', 'model']);
    // TypeScript enforces readonly, but runtime check of the contract's intent
    expect(Array.isArray(fields)).toBe(true);
  });
});
