/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Behavioral tests for retention policy resolution, validation, and period
 * parsing (AC-2, AC-3, AC-11).
 */

import { describe, it, expect } from 'bun:test';
import {
  parseRetentionPeriod,
  validateRetentionConfig,
  resolveRetentionConfig,
  DEFAULT_MAX_TOTAL_SIZE_MB,
  DEFAULT_MIN_RETENTION,
} from './retentionPolicy.js';

describe('parseRetentionPeriod', () => {
  it('parses hours', () => {
    expect(parseRetentionPeriod('24h')).toBe(24 * 60 * 60 * 1000);
  });

  it('parses days', () => {
    expect(parseRetentionPeriod('7d')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('parses weeks', () => {
    expect(parseRetentionPeriod('2w')).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('parses months (30 days)', () => {
    expect(parseRetentionPeriod('1m')).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('throws on invalid format', () => {
    expect(() => parseRetentionPeriod('invalid')).toThrow(
      /Invalid retention period/,
    );
    expect(() => parseRetentionPeriod('30x')).toThrow(
      /Invalid retention period/,
    );
    expect(() => parseRetentionPeriod('abc')).toThrow(
      /Invalid retention period/,
    );
  });

  it('throws on zero value', () => {
    expect(() => parseRetentionPeriod('0d')).toThrow(/must be greater than 0/);
  });

  it('throws on missing unit', () => {
    expect(() => parseRetentionPeriod('30')).toThrow(
      /Invalid retention period/,
    );
  });
});

describe('validateRetentionConfig', () => {
  it('accepts undefined config', () => {
    expect(() => validateRetentionConfig(undefined)).not.toThrow();
  });

  it('accepts valid maxTotalSizeMB', () => {
    expect(() =>
      validateRetentionConfig({ maxTotalSizeMB: 1024 }),
    ).not.toThrow();
  });

  it('rejects negative maxTotalSizeMB', () => {
    expect(() => validateRetentionConfig({ maxTotalSizeMB: -100 })).toThrow(
      /Invalid sessionRetention/,
    );
  });

  it('rejects zero maxTotalSizeMB', () => {
    expect(() => validateRetentionConfig({ maxTotalSizeMB: 0 })).toThrow(
      /Invalid sessionRetention/,
    );
  });

  it('rejects non-finite maxTotalSizeMB', () => {
    expect(() => validateRetentionConfig({ maxTotalSizeMB: Infinity })).toThrow(
      /Invalid sessionRetention/,
    );
  });

  it('accepts valid maxCount', () => {
    expect(() => validateRetentionConfig({ maxCount: 10 })).not.toThrow();
  });

  it('rejects maxCount less than 1', () => {
    expect(() => validateRetentionConfig({ maxCount: 0 })).toThrow(
      /Invalid sessionRetention/,
    );
  });

  it('rejects non-finite maxCount', () => {
    expect(() => validateRetentionConfig({ maxCount: NaN })).toThrow(
      /Invalid sessionRetention/,
    );
  });

  it('accepts valid maxAge', () => {
    expect(() => validateRetentionConfig({ maxAge: '30d' })).not.toThrow();
  });

  it('rejects invalid maxAge format', () => {
    expect(() => validateRetentionConfig({ maxAge: 'invalid' })).toThrow(
      /Invalid retention period/,
    );
  });

  it('rejects maxAge shorter than minRetention', () => {
    expect(() =>
      validateRetentionConfig({ maxAge: '1h', minRetention: '1d' }),
    ).toThrow(/cannot be less than minRetention/);
  });

  it('accepts maxAge equal to minRetention (boundary)', () => {
    expect(() =>
      validateRetentionConfig({ maxAge: '1d', minRetention: '1d' }),
    ).not.toThrow();
  });

  it('rejects maxAge shorter than default minRetention when minRetention not provided', () => {
    expect(() => validateRetentionConfig({ maxAge: '1h' })).toThrow(
      /cannot be less than minRetention/,
    );
  });

  it('rejects invalid minRetention format', () => {
    expect(() => validateRetentionConfig({ minRetention: 'bad' })).toThrow(
      /Invalid retention period/,
    );
  });
});

describe('resolveRetentionConfig — defaults (AC-2)', () => {
  it('is default-on with 4 GiB budget when no config provided', () => {
    const resolved = resolveRetentionConfig(undefined);
    expect(resolved.enabled).toBe(true);
    expect(resolved.maxTotalSizeBytes).toBe(4096 * 1024 * 1024);
  });

  it('has no default maxAge', () => {
    const resolved = resolveRetentionConfig(undefined);
    expect(resolved.maxAgeMs).toBeNull();
  });

  it('has no default maxCount', () => {
    const resolved = resolveRetentionConfig(undefined);
    expect(resolved.maxCount).toBeNull();
  });

  it('has 1d minRetention floor by default', () => {
    const resolved = resolveRetentionConfig(undefined);
    expect(resolved.minRetentionMs).toBe(24 * 60 * 60 * 1000);
  });

  it('DEFAULT_MAX_TOTAL_SIZE_MB is 4096', () => {
    expect(DEFAULT_MAX_TOTAL_SIZE_MB).toBe(4096);
  });

  it('DEFAULT_MIN_RETENTION is 1d', () => {
    expect(DEFAULT_MIN_RETENTION).toBe('1d');
  });
});

describe('resolveRetentionConfig — explicit user settings (AC-3)', () => {
  it('respects enabled: false', () => {
    const resolved = resolveRetentionConfig({ enabled: false });
    expect(resolved.enabled).toBe(false);
  });

  it('respects explicit maxAge', () => {
    const resolved = resolveRetentionConfig({ maxAge: '7d' });
    expect(resolved.maxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('respects explicit maxCount', () => {
    const resolved = resolveRetentionConfig({ maxCount: 5 });
    expect(resolved.maxCount).toBe(5);
  });

  it('respects explicit maxTotalSizeMB', () => {
    const resolved = resolveRetentionConfig({ maxTotalSizeMB: 100 });
    expect(resolved.maxTotalSizeBytes).toBe(100 * 1024 * 1024);
  });

  it('respects explicit minRetention', () => {
    const resolved = resolveRetentionConfig({ minRetention: '2h' });
    expect(resolved.minRetentionMs).toBe(2 * 60 * 60 * 1000);
  });
});

describe('resolveRetentionConfig — partial settings retain defaults (AC-2)', () => {
  it('partial config with only maxAge keeps default size budget', () => {
    const resolved = resolveRetentionConfig({ maxAge: '30d' });
    expect(resolved.maxTotalSizeBytes).toBe(4096 * 1024 * 1024);
    expect(resolved.enabled).toBe(true);
    expect(resolved.maxCount).toBeNull();
    expect(resolved.minRetentionMs).toBe(24 * 60 * 60 * 1000);
  });

  it('partial config with only maxCount keeps default size budget', () => {
    const resolved = resolveRetentionConfig({ maxCount: 3 });
    expect(resolved.maxTotalSizeBytes).toBe(4096 * 1024 * 1024);
    expect(resolved.maxAgeMs).toBeNull();
  });

  it('partial config with enabled:true and no other fields keeps defaults', () => {
    const resolved = resolveRetentionConfig({ enabled: true });
    expect(resolved.enabled).toBe(true);
    expect(resolved.maxTotalSizeBytes).toBe(4096 * 1024 * 1024);
    expect(resolved.maxAgeMs).toBeNull();
    expect(resolved.maxCount).toBeNull();
  });

  it('partial config with custom size keeps default minRetention', () => {
    const resolved = resolveRetentionConfig({ maxTotalSizeMB: 512 });
    expect(resolved.minRetentionMs).toBe(24 * 60 * 60 * 1000);
  });
});

describe('resolveRetentionConfig — invalid config fails fast (AC-11)', () => {
  it('throws on invalid maxAge format', () => {
    expect(() => resolveRetentionConfig({ maxAge: 'bad' })).toThrow(
      /Invalid retention period/,
    );
  });

  it('throws on negative maxTotalSizeMB', () => {
    expect(() => resolveRetentionConfig({ maxTotalSizeMB: -1 })).toThrow(
      /Invalid sessionRetention/,
    );
  });

  it('throws on maxAge less than minRetention', () => {
    expect(() =>
      resolveRetentionConfig({ maxAge: '12h', minRetention: '1d' }),
    ).toThrow(/cannot be less than minRetention/);
  });

  it('throws on maxCount of 0', () => {
    expect(() => resolveRetentionConfig({ maxCount: 0 })).toThrow(
      /Invalid sessionRetention/,
    );
  });
});

describe('validateRetentionConfig — safe-integer and overflow validation (finding D)', () => {
  it('rejects fractional maxCount (must be a safe integer)', () => {
    expect(() => validateRetentionConfig({ maxCount: 2.5 })).toThrow(
      /Invalid sessionRetention/,
    );
  });

  it('rejects maxCount exceeding the safe-integer range', () => {
    expect(() =>
      validateRetentionConfig({ maxCount: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow(/Invalid sessionRetention/);
  });

  it('accepts maxCount at MAX_SAFE_INTEGER', () => {
    expect(() =>
      validateRetentionConfig({ maxCount: Number.MAX_SAFE_INTEGER }),
    ).not.toThrow();
  });

  it('rejects maxTotalSizeMB whose byte conversion overflows', () => {
    expect(() => validateRetentionConfig({ maxTotalSizeMB: 1e15 })).toThrow(
      /Invalid sessionRetention/,
    );
  });

  it('accepts fractional maxTotalSizeMB that yields valid bytes', () => {
    expect(() =>
      validateRetentionConfig({ maxTotalSizeMB: 0.5 }),
    ).not.toThrow();
  });
});

describe('parseRetentionPeriod — overflow-safe arithmetic (finding D)', () => {
  it('rejects period values whose converted arithmetic overflows safe integers', () => {
    expect(() => parseRetentionPeriod('99999999999999999d')).toThrow(
      /Invalid retention period/,
    );
  });

  it('accepts a large-but-safe period', () => {
    // 1000 weeks is ~6e11 ms, well within safe-integer range.
    expect(() => parseRetentionPeriod('1000w')).not.toThrow();
  });
});

describe('resolveRetentionConfig — byte overflow surfaces clearly (finding D)', () => {
  it('throws on maxTotalSizeMB whose byte conversion overflows', () => {
    expect(() => resolveRetentionConfig({ maxTotalSizeMB: 1e15 })).toThrow(
      /Invalid sessionRetention/,
    );
  });

  it('resolves fractional maxTotalSizeMB to correct finite bytes', () => {
    const resolved = resolveRetentionConfig({ maxTotalSizeMB: 0.5 });
    expect(resolved.maxTotalSizeBytes).toBe(Math.round(0.5 * 1024 * 1024));
    expect(Number.isSafeInteger(resolved.maxTotalSizeBytes)).toBe(true);
  });

  it('resolved maxTotalSizeBytes is always a safe positive integer', () => {
    const resolved = resolveRetentionConfig(undefined);
    expect(Number.isSafeInteger(resolved.maxTotalSizeBytes)).toBe(true);
    expect(resolved.maxTotalSizeBytes).toBeGreaterThan(0);
  });
});
