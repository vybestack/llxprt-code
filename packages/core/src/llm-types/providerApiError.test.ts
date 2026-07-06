/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-007.1, REQ-007.2
 * @pseudocode lines 80-84
 */
import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import {
  isProviderApiError,
  type ProviderApiError,
} from './providerApiError.js';

describe('isProviderApiError', () => {
  it('accepts a minimal valid error with only message', () => {
    expect(isProviderApiError({ message: 'Something went wrong' })).toBe(true);
  });

  it('accepts a full error with all fields', () => {
    const err: ProviderApiError = {
      provider: 'gemini',
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Rate limited',
      retryAfterMs: 5000,
      isQuotaError: true,
      isAuthError: false,
      isTransient: true,
      raw: { foo: 'bar' },
    };
    expect(isProviderApiError(err)).toBe(true);
  });

  it('accepts error with optional string code', () => {
    expect(isProviderApiError({ code: 'NOT_FOUND', message: 'err' })).toBe(
      true,
    );
  });

  it('accepts error with optional number status', () => {
    expect(isProviderApiError({ status: 500, message: 'err' })).toBe(true);
  });

  it('accepts error with optional string provider', () => {
    expect(isProviderApiError({ provider: 'openai', message: 'err' })).toBe(
      true,
    );
  });

  it('rejects null', () => {
    expect(isProviderApiError(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isProviderApiError(undefined)).toBe(false);
  });

  it('rejects string', () => {
    expect(isProviderApiError('error message')).toBe(false);
  });

  it('rejects number', () => {
    expect(isProviderApiError(42)).toBe(false);
  });

  it('rejects object without message', () => {
    expect(isProviderApiError({ status: 500 })).toBe(false);
  });

  it('rejects object with non-string message', () => {
    expect(isProviderApiError({ message: 42 })).toBe(false);
  });

  it('rejects object with non-number status', () => {
    expect(isProviderApiError({ message: 'err', status: '500' })).toBe(false);
  });

  it('rejects object with non-string code', () => {
    expect(isProviderApiError({ message: 'err', code: 42 })).toBe(false);
  });

  it('rejects object with non-string provider', () => {
    expect(isProviderApiError({ message: 'err', provider: 42 })).toBe(false);
  });

  it('accepts object with message and arbitrary extra keys', () => {
    expect(
      isProviderApiError({ message: 'err', extra: 'stuff', anything: true }),
    ).toBe(true);
  });

  it('rejects object with non-number retryAfterMs', () => {
    expect(isProviderApiError({ message: 'err', retryAfterMs: 'soon' })).toBe(
      false,
    );
  });

  it('rejects object with Infinity retryAfterMs', () => {
    expect(isProviderApiError({ message: 'err', retryAfterMs: Infinity })).toBe(
      false,
    );
  });

  it('rejects object with NaN retryAfterMs', () => {
    expect(isProviderApiError({ message: 'err', retryAfterMs: NaN })).toBe(
      false,
    );
  });

  it('rejects object with non-boolean isQuotaError', () => {
    expect(isProviderApiError({ message: 'err', isQuotaError: 'yes' })).toBe(
      false,
    );
  });

  it('rejects object with non-boolean isAuthError', () => {
    expect(isProviderApiError({ message: 'err', isAuthError: 1 })).toBe(false);
  });

  it('rejects object with non-boolean isTransient', () => {
    expect(isProviderApiError({ message: 'err', isTransient: 'maybe' })).toBe(
      false,
    );
  });
});

// ============================================================================
// Property-based tests
// ============================================================================

describe('providerApiError property-based', () => {
  it.prop([
    fc.tuple(
      fc.string({ minLength: 1 }),
      fc.option(fc.integer({ min: 100, max: 599 })),
      fc.option(fc.string()),
      fc.option(fc.string()),
    ),
  ])(
    'any object with string message and valid optional fields is a ProviderApiError',
    ([message, status, code, provider]) => {
      const obj: Record<string, unknown> = { message };
      if (status !== null) obj.status = status;
      if (code !== null) obj.code = code;
      if (provider !== null) obj.provider = provider;
      return isProviderApiError(obj) === true;
    },
  );

  it.prop([
    fc.oneof(
      fc.record({ message: fc.integer() }),
      fc.record({ message: fc.boolean() }),
      fc.record({ message: fc.constant(null) }),
      fc.record({ status: fc.integer() }),
    ),
  ])(
    'non-string or missing message is NOT a ProviderApiError',
    (obj: unknown) => isProviderApiError(obj) === false,
  );

  it.prop([
    fc.oneof(
      fc.integer(),
      fc.string(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
    ),
  ])(
    'primitives and null are never ProviderApiError',
    (v: unknown) => isProviderApiError(v) === false,
  );

  it.prop([
    fc.record({
      message: fc.string({ minLength: 1 }),
      provider: fc.string({ minLength: 1, maxLength: 20 }),
    }),
  ])(
    'object with message and string provider is always a ProviderApiError',
    (obj) => isProviderApiError(obj) === true,
  );

  it.prop([
    fc.record({
      message: fc.string({ minLength: 1 }),
      status: fc.integer({ min: 100, max: 599 }),
    }),
  ])(
    'object with message and number status is always a ProviderApiError',
    (obj) => isProviderApiError(obj) === true,
  );

  it.prop([
    fc.record({
      message: fc.string({ minLength: 1 }),
      raw: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
    }),
  ])(
    'object with message and any raw value is always a ProviderApiError',
    (obj) => isProviderApiError(obj) === true,
  );

  it.prop([
    fc.record({
      message: fc.string({ minLength: 1 }),
      code: fc.string({ minLength: 1, maxLength: 20 }),
    }),
  ])(
    'object with message and string code is always a ProviderApiError',
    (obj) => isProviderApiError(obj) === true,
  );

  it.prop([
    fc.record({
      message: fc.string({ minLength: 1 }),
      isQuotaError: fc.boolean(),
      isAuthError: fc.boolean(),
      isTransient: fc.boolean(),
    }),
  ])(
    'object with message and boolean flags is always a ProviderApiError',
    (obj) => isProviderApiError(obj) === true,
  );

  it.prop([
    fc.record({
      message: fc.string({ minLength: 1 }),
      retryAfterMs: fc.nat({ max: 100000 }),
    }),
  ])(
    'object with message and retryAfterMs is always a ProviderApiError',
    (obj) => isProviderApiError(obj) === true,
  );
});
