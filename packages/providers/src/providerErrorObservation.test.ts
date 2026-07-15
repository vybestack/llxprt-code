import { describe, expect, it, vi } from 'vitest';
import {
  classifyProviderError,
  getEffectiveProviderStatus,
  getSafeProviderMessage,
  invokeProviderErrorObserver,
  normalizePublicProviderText,
  toObservedProviderError,
} from './providerErrorObservation.js';

describe('provider error observation', () => {
  it('contains synchronous observer failure', () => {
    const observerFailure = new Error('observer failed synchronously');
    const onFailure = vi.fn();

    invokeProviderErrorObserver(
      () => {
        throw observerFailure;
      },
      { message: 'provider failed' },
      onFailure,
    );

    expect(onFailure).toHaveBeenCalledWith(observerFailure);
  });

  it('contains asynchronous observer rejection', async () => {
    const observerFailure = new Error('observer failed asynchronously');
    const onFailure = vi.fn();

    invokeProviderErrorObserver(
      async () => {
        throw observerFailure;
      },
      { message: 'provider failed' },
      onFailure,
    );
    await Promise.resolve();

    expect(onFailure).toHaveBeenCalledWith(observerFailure);
  });

  it('uses the provider envelope message and removes unsafe control characters', () => {
    const observed = toObservedProviderError(
      {
        message: 'raw private diagnostics',
        error: {
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: 'Safe\u0000 provider message',
          },
        },
      },
      429,
      'rate_limit',
    );

    expect(observed).toStrictEqual({
      message: 'Safe provider message',
      status: 429,
      category: 'rate_limit',
    });
  });

  it('extracts a safe provider message directly from a string payload', () => {
    expect(
      getSafeProviderMessage(
        '429 {"error":{"message":"Rate limited by provider"}}',
      ),
    ).toBe('Rate limited by provider');
  });

  it('bounds oversized messages and safely handles malformed payloads', () => {
    const oversized = getSafeProviderMessage(new Error('x'.repeat(2000)));

    expect({
      oversized,
      malformed: getSafeProviderMessage({ error: { message: null } }),
    }).toMatchObject({
      malformed: 'Provider request failed',
    });
    expect(oversized.length).toBe(512);
    expect(oversized.endsWith('…')).toBe(true);
  });

  it('truncates by Unicode code point without splitting an astral character', () => {
    const astral = '\u{1F600}';
    expect(normalizePublicProviderText(`ab${astral}c`, 4)).toBe(`ab${astral}c`);
    expect(normalizePublicProviderText(`ab${astral}cd`, 4)).toBe(
      `ab${astral}…`,
    );
  });

  it('classifies a body-level statusless rate_limit_error and normalizes whitespace', () => {
    const error = {
      type: 'rate_limit_error',
      message: '  limited\n\tby\u0000 provider  ',
    };
    const category = classifyProviderError(error, undefined);

    expect({
      category,
      status: getEffectiveProviderStatus(error, undefined, category),
      message: getSafeProviderMessage(error),
    }).toStrictEqual({
      category: 'rate_limit',
      status: 429,
      message: 'limited by provider',
    });
  });

  it('preserves an existing structured category before status classification', () => {
    expect(classifyProviderError({ category: 'quota' }, 429)).toBe('quota');
  });

  it('classifies status 429 as rate_limit', () => {
    expect(classifyProviderError({}, 429)).toBe('rate_limit');
  });

  it('classifies status 402 as quota', () => {
    expect(classifyProviderError({}, 402)).toBe('quota');
  });

  it.each([401, 403])('classifies status %i as authentication', (status) => {
    expect(classifyProviderError({}, status)).toBe('authentication');
  });

  it.each(['overloaded_error', 'api_error'])(
    'classifies body-level %s as server_error',
    (type) => {
      expect(classifyProviderError({ error: { type } }, undefined)).toBe(
        'server_error',
      );
    },
  );

  it.each([500, 599])('classifies status %i as server_error', (status) => {
    expect(classifyProviderError({}, status)).toBe('server_error');
  });

  it('classifies a transient network error as network', () => {
    const error = Object.assign(new Error('DNS lookup failed'), {
      code: 'ENOTFOUND',
    });

    expect(classifyProviderError(error, undefined)).toBe('network');
  });

  it.each([400, 404, 499])(
    'classifies other status %i as client_error',
    (status) => {
      expect(classifyProviderError({}, status)).toBe('client_error');
    },
  );

  it('treats an explicit client status as authoritative over network heuristics', () => {
    const error = Object.assign(new Error('socket hang up'), {
      status: 400,
      code: 'ECONNRESET',
    });

    expect(classifyProviderError(error, 400)).toBe('client_error');
  });

  it('classifies a statusless stream timeout as server_error, not rate_limit', () => {
    expect(
      classifyProviderError(new Error('Stream timeout occurred'), undefined),
    ).toBe('server_error');
  });

  it('returns undefined for an unclassifiable statusless error', () => {
    expect(
      classifyProviderError(new Error('Unknown provider failure'), undefined),
    ).toBeUndefined();
  });

  it.each([
    'authentication',
    'server_error',
    'network',
    'client_error',
  ] as const)('omits status for a statusless %s observation', (category) => {
    const observed = toObservedProviderError(
      { message: 'Provider failed' },
      undefined,
      category,
    );

    expect(observed).toStrictEqual({
      message: 'Provider failed',
      category,
    });
    expect('status' in observed).toBe(false);
  });
});
