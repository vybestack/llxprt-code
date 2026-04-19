/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  nextStreamEventWithIdleTimeout,
  StreamIdleTimeoutError,
  resolveStreamIdleTimeoutMs,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV,
  STREAM_IDLE_TIMEOUT_SETTING_KEY,
} from './streamIdleTimeout.js';

describe('nextStreamEventWithIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the next iterator event before the idle timeout and clears the timer', async () => {
    async function* stream(): AsyncGenerator<string> {
      yield 'fast';
    }

    const iterator = stream()[Symbol.asyncIterator]();

    const nextEventPromise = nextStreamEventWithIdleTimeout({
      iterator,
      timeoutMs: 30_000,
    });

    await Promise.resolve();
    expect(await nextEventPromise).toEqual({ done: false, value: 'fast' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('throws StreamIdleTimeoutError and runs onTimeout when the iterator stays idle', async () => {
    const onTimeout = vi.fn();
    async function* stalled(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'never';
    }

    const iterator = stalled()[Symbol.asyncIterator]();
    const nextEventPromise = nextStreamEventWithIdleTimeout({
      iterator,
      timeoutMs: 30_000,
      onTimeout,
    });
    const rejection = nextEventPromise.then(
      () => {
        throw new Error('Expected the idle timeout to reject');
      },
      (error) => {
        expect(error).toBeInstanceOf(StreamIdleTimeoutError);
      },
    );

    await vi.advanceTimersByTimeAsync(30_001);

    await rejection;
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the provided error factory when timing out', async () => {
    async function* stalled(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'never';
    }

    const customError = new Error('custom timeout');
    const iterator = stalled()[Symbol.asyncIterator]();
    const nextEventPromise = nextStreamEventWithIdleTimeout({
      iterator,
      timeoutMs: 30_000,
      createTimeoutError: () => customError,
    });
    const rejection = nextEventPromise.then(
      () => {
        throw new Error('Expected the custom timeout to reject');
      },
      (error) => {
        expect(error).toBe(customError);
      },
    );

    await vi.advanceTimersByTimeAsync(30_001);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leave stale timers behind across rapid successive iterator reads', async () => {
    async function* stream(): AsyncGenerator<string> {
      yield 'one';
      yield 'two';
      yield 'three';
    }

    const iterator = stream()[Symbol.asyncIterator]();

    await expect(
      nextStreamEventWithIdleTimeout({ iterator, timeoutMs: 30_000 }),
    ).resolves.toEqual({ done: false, value: 'one' });
    expect(vi.getTimerCount()).toBe(0);

    await expect(
      nextStreamEventWithIdleTimeout({ iterator, timeoutMs: 30_000 }),
    ).resolves.toEqual({ done: false, value: 'two' });
    expect(vi.getTimerCount()).toBe(0);

    await expect(
      nextStreamEventWithIdleTimeout({ iterator, timeoutMs: 30_000 }),
    ).resolves.toEqual({ done: false, value: 'three' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with AbortError when the parent signal aborts before the next event', async () => {
    async function* stalled(): AsyncGenerator<string> {
      await new Promise(() => {});
      yield 'never';
    }

    const controller = new AbortController();
    const iterator = stalled()[Symbol.asyncIterator]();
    const nextEventPromise = nextStreamEventWithIdleTimeout({
      iterator,
      timeoutMs: 30_000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(nextEventPromise).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Aborted',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should throw immediately when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const iterator = (async function* () {
      yield 1;
    })()[Symbol.asyncIterator]();
    await expect(
      nextStreamEventWithIdleTimeout({
        iterator,
        timeoutMs: 5000,
        signal: ac.signal,
      }),
    ).rejects.toThrow(StreamIdleTimeoutError);
  });
});

describe('resolveStreamIdleTimeoutMs', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    delete process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV];
  });

  afterEach(() => {
    // Restore environment after each test
    process.env = originalEnv;
  });

  it('returns DEFAULT_STREAM_IDLE_TIMEOUT_MS (0) when no env var or config — watchdog disabled by default', () => {
    const result = resolveStreamIdleTimeoutMs();
    expect(result).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS);
    expect(result).toBe(0);
  });

  it('env var LLXPRT_STREAM_IDLE_TIMEOUT_MS overrides default', () => {
    process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '300000';
    const result = resolveStreamIdleTimeoutMs();
    expect(result).toBe(300_000);
  });

  it('env var overrides config setting', () => {
    process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '240000';
    const mockConfig = {
      getEphemeralSetting: () => 120000,
    };
    const result = resolveStreamIdleTimeoutMs(mockConfig);
    expect(result).toBe(240_000); // env wins
  });

  it('returns 0 when env var is 0 (disabled sentinel)', () => {
    process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '0';
    const result = resolveStreamIdleTimeoutMs();
    expect(result).toBe(0);
  });

  it('returns 0 when env var is negative (disabled sentinel)', () => {
    process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '-1';
    const result = resolveStreamIdleTimeoutMs();
    expect(result).toBe(0);
  });

  it('config setting is used when no env var', () => {
    const mockConfig = {
      getEphemeralSetting: (key: string) => {
        if (key === STREAM_IDLE_TIMEOUT_SETTING_KEY) {
          return 180_000;
        }
        return undefined;
      },
    };
    const result = resolveStreamIdleTimeoutMs(mockConfig);
    expect(result).toBe(180_000);
  });

  it('config string value is parsed correctly', () => {
    const mockConfig = {
      getEphemeralSetting: () => '90000',
    };
    const result = resolveStreamIdleTimeoutMs(mockConfig);
    expect(result).toBe(90_000);
  });

  it('returns 0 when config setting is 0 (disabled)', () => {
    const mockConfig = {
      getEphemeralSetting: () => 0,
    };
    const result = resolveStreamIdleTimeoutMs(mockConfig);
    expect(result).toBe(0);
  });

  it('returns 0 when config setting is negative (disabled)', () => {
    const mockConfig = {
      getEphemeralSetting: () => -5,
    };
    const result = resolveStreamIdleTimeoutMs(mockConfig);
    expect(result).toBe(0);
  });

  it('falls back to default when env var is invalid', () => {
    process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = 'not-a-number';
    const result = resolveStreamIdleTimeoutMs();
    expect(result).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS);
  });

  it('falls back to config when env var is invalid', () => {
    process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = 'invalid';
    const mockConfig = {
      getEphemeralSetting: () => 150_000,
    };
    const result = resolveStreamIdleTimeoutMs(mockConfig);
    expect(result).toBe(150_000);
  });

  it('falls back to default when config value is invalid', () => {
    const mockConfig = {
      getEphemeralSetting: () => 'not-a-number',
    };
    const result = resolveStreamIdleTimeoutMs(mockConfig);
    expect(result).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS);
  });

  it('falls back to default when config has no getEphemeralSetting', () => {
    const mockConfig = {};
    const result = resolveStreamIdleTimeoutMs(mockConfig);
    expect(result).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS);
  });

  it('config setting takes precedence when env var is not set', () => {
    delete process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV];
    const mockConfig = {
      getEphemeralSetting: () => 300_000,
    };
    const result = resolveStreamIdleTimeoutMs(mockConfig);
    expect(result).toBe(300_000);
  });

  describe('empty string handling', () => {
    it('empty string env var falls through to config/default (not parsed as 0)', () => {
      process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '';
      const mockConfig = {
        getEphemeralSetting: () => 150_000,
      };
      const result = resolveStreamIdleTimeoutMs(mockConfig);
      expect(result).toBe(150_000); // Falls through to config, not 0
    });

    it('whitespace-only env var falls through to config/default', () => {
      process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '   ';
      const mockConfig = {
        getEphemeralSetting: () => 120_000,
      };
      const result = resolveStreamIdleTimeoutMs(mockConfig);
      expect(result).toBe(120_000); // Falls through to config, not 0
    });

    it('empty string env var falls through to default when no config', () => {
      process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '';
      const result = resolveStreamIdleTimeoutMs();
      expect(result).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS);
    });

    it('string "0" is parsed as 0 (explicitly disabled)', () => {
      process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '0';
      const result = resolveStreamIdleTimeoutMs();
      expect(result).toBe(0); // Explicitly disabled
    });

    it('config empty string value falls through to default', () => {
      const mockConfig = {
        getEphemeralSetting: () => '',
      };
      const result = resolveStreamIdleTimeoutMs(mockConfig);
      expect(result).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS);
    });

    it('config whitespace-only string falls through to default', () => {
      const mockConfig = {
        getEphemeralSetting: () => '   ',
      };
      const result = resolveStreamIdleTimeoutMs(mockConfig);
      expect(result).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS);
    });

    it('config string "0" is parsed as 0 (explicitly disabled)', () => {
      const mockConfig = {
        getEphemeralSetting: () => '0',
      };
      const result = resolveStreamIdleTimeoutMs(mockConfig);
      expect(result).toBe(0);
    });
  });

  describe('default-off behavior', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV];
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('default is 0 (watchdog disabled) when no env var or config is set', () => {
      expect(DEFAULT_STREAM_IDLE_TIMEOUT_MS).toBe(0);
      const result = resolveStreamIdleTimeoutMs();
      expect(result).toBe(0);
    });

    it('env var LLXPRT_STREAM_IDLE_TIMEOUT_MS re-enables the watchdog with a positive value', () => {
      process.env[LLXPRT_STREAM_IDLE_TIMEOUT_MS_ENV] = '120000';
      const result = resolveStreamIdleTimeoutMs();
      expect(result).toBe(120_000);
    });

    it('ephemeral setting stream-idle-timeout-ms re-enables the watchdog with a positive value', () => {
      const mockConfig = {
        getEphemeralSetting: (key: string) => {
          if (key === STREAM_IDLE_TIMEOUT_SETTING_KEY) {
            return 90_000;
          }
          return undefined;
        },
      };
      const result = resolveStreamIdleTimeoutMs(mockConfig);
      expect(result).toBe(90_000);
    });
  });
});
