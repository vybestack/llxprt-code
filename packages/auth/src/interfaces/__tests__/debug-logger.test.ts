/**
 * @plan:PLAN-20260608-ISSUE1586.P07
 * @requirement:REQ-INTF-001.4
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { IDebugLogger } from '../debug-logger.js';

// ---------------------------------------------------------------------------
// In-memory test double implementing IDebugLogger
// ---------------------------------------------------------------------------

interface LogEntry {
  level: 'debug' | 'error' | 'warn' | 'log';
  args: unknown[];
}

class InMemoryDebugLogger implements IDebugLogger {
  readonly entries: LogEntry[] = [];

  debug(...args: unknown[]): void {
    this.entries.push({ level: 'debug', args });
  }

  error(...args: unknown[]): void {
    this.entries.push({ level: 'error', args });
  }

  warn(...args: unknown[]): void {
    this.entries.push({ level: 'warn', args });
  }

  log(...args: unknown[]): void {
    this.entries.push({ level: 'log', args });
  }
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describe('IDebugLogger contract', () => {
  it('records debug entries with message content', () => {
    const logger: IDebugLogger = new InMemoryDebugLogger();
    logger.debug('token refreshed', { provider: 'openai' });
    expect((logger as InMemoryDebugLogger).entries[0]).toStrictEqual({
      level: 'debug',
      args: ['token refreshed', { provider: 'openai' }],
    });
  });

  it('records error entries with message content', () => {
    const logger: IDebugLogger = new InMemoryDebugLogger();
    logger.error('auth failed', new Error('network'));
    expect((logger as InMemoryDebugLogger).entries[0]).toStrictEqual({
      level: 'error',
      args: ['auth failed', expect.any(Error)],
    });
    expect((logger as InMemoryDebugLogger).entries[0].args[1]).toBeInstanceOf(
      Error,
    );
  });

  it('records warn entries with message content', () => {
    const logger: IDebugLogger = new InMemoryDebugLogger();
    logger.warn('token expiring soon');
    expect((logger as InMemoryDebugLogger).entries[0]).toStrictEqual({
      level: 'warn',
      args: ['token expiring soon'],
    });
  });

  it('records log entries with message content', () => {
    const logger: IDebugLogger = new InMemoryDebugLogger();
    logger.log('precedence resolved', 'openai', 1);
    expect((logger as InMemoryDebugLogger).entries[0]).toStrictEqual({
      level: 'log',
      args: ['precedence resolved', 'openai', 1],
    });
  });

  it('accumulates multiple log entries in order', () => {
    const logger: IDebugLogger = new InMemoryDebugLogger();
    logger.debug('step 1');
    logger.warn('step 2');
    logger.error('step 3');
    const entries = (logger as InMemoryDebugLogger).entries;
    expect(entries).toHaveLength(3);
    expect(entries[0].level).toBe('debug');
    expect(entries[1].level).toBe('warn');
    expect(entries[2].level).toBe('error');
  });

  it('handles zero-argument calls', () => {
    const logger: IDebugLogger = new InMemoryDebugLogger();
    logger.debug();
    expect((logger as InMemoryDebugLogger).entries[0]).toStrictEqual({
      level: 'debug',
      args: [],
    });
  });
});
