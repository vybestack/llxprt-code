import { describe, it, expect } from 'vitest';
import { shouldRetryOnStatus } from './retryStrategy.js';

describe('shouldRetryOnStatus', () => {
  it('retries on 429 status', () => {
    expect(shouldRetryOnStatus({ status: 429 })).toBe(true);
  });

  it('retries on 500 status', () => {
    expect(shouldRetryOnStatus({ status: 500 })).toBe(true);
  });

  it('retries on 503 status', () => {
    expect(shouldRetryOnStatus({ status: 503 })).toBe(true);
  });

  it('does not retry on 200 status', () => {
    expect(shouldRetryOnStatus({ status: 200 })).toBe(false);
  });

  it('does not retry on 400 status', () => {
    expect(shouldRetryOnStatus({ status: 400 })).toBe(false);
  });

  it('does not retry on 401 status', () => {
    expect(shouldRetryOnStatus({ status: 401 })).toBe(false);
  });

  it('detects 429 from error message', () => {
    expect(shouldRetryOnStatus(new Error('Rate limit 429 exceeded'))).toBe(
      true,
    );
  });

  it('detects status from response.status', () => {
    expect(shouldRetryOnStatus({ response: { status: 502 } })).toBe(true);
  });

  it('uses checkNetworkTransient callback when provided', () => {
    const error = new Error('ECONNRESET');
    const result = shouldRetryOnStatus(error, {
      checkNetworkTransient: () => true,
    });
    expect(result).toBe(true);
  });

  it('does not call checkNetworkTransient when status retry applies', () => {
    let called = false;
    shouldRetryOnStatus(
      { status: 500 },
      {
        checkNetworkTransient: () => {
          called = true;
          return true;
        },
      },
    );
    expect(called).toBe(false);
  });
});
