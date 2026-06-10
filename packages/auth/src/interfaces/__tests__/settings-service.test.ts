/**
 * @plan:PLAN-20260608-ISSUE1586.P07
 * @requirement:REQ-INTF-001.2
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { ISettingsService } from '../settings-service.js';

// ---------------------------------------------------------------------------
// In-memory test double implementing ISettingsService
// ---------------------------------------------------------------------------

class InMemorySettingsService implements ISettingsService {
  private readonly settings = new Map<string, unknown>();
  private readonly providerSettings = new Map<
    string,
    Record<string, unknown>
  >();
  private readonly handlers = new Map<
    string,
    Set<(...args: unknown[]) => void>
  >();

  get(key: string): unknown {
    return this.settings.get(key);
  }

  getProviderSettings(providerName: string): Record<string, unknown> {
    return this.providerSettings.get(providerName) ?? {};
  }

  // Test helper to set a value (not part of interface)
  setSetting(key: string, value: unknown): void {
    this.settings.set(key, value);
  }

  // Test helper to set provider settings (not part of interface)
  setProviderConfig(
    providerName: string,
    config: Record<string, unknown>,
  ): void {
    this.providerSettings.set(providerName, config);
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    let handlers = this.handlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(event, handlers);
    }
    handlers.add(handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  // Test helper to emit an event (not part of interface)
  emit(event: string, ...args: unknown[]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describe('ISettingsService contract', () => {
  describe('get', () => {
    it('returns the value stored under a key', () => {
      const settings: ISettingsService = new InMemorySettingsService();
      (settings as InMemorySettingsService).setSetting('theme', 'dark');
      expect(settings.get('theme')).toBe('dark');
    });

    it('returns undefined for an unset key', () => {
      const settings: ISettingsService = new InMemorySettingsService();
      expect(settings.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getProviderSettings', () => {
    it('returns the provider configuration object', () => {
      const settings: ISettingsService = new InMemorySettingsService();
      (settings as InMemorySettingsService).setProviderConfig('openai', {
        apiKey: 'sk-test',
        model: 'gpt-4',
      });
      const result = settings.getProviderSettings('openai');
      expect(result).toStrictEqual({ apiKey: 'sk-test', model: 'gpt-4' });
    });

    it('returns an empty object for an unknown provider', () => {
      const settings: ISettingsService = new InMemorySettingsService();
      const result = settings.getProviderSettings('unknown');
      expect(result).toStrictEqual({});
    });
  });

  describe('on / off event subscription', () => {
    it('invokes handler when event is emitted after on()', () => {
      const settings = new InMemorySettingsService();
      const received: unknown[][] = [];
      settings.on('change', (...args: unknown[]) => {
        received.push(args);
      });
      settings.emit('change', 'theme', 'dark');
      expect(received).toStrictEqual([['theme', 'dark']]);
    });

    it('stops invoking handler after off()', () => {
      const settings = new InMemorySettingsService();
      const received: unknown[][] = [];
      const handler = (...args: unknown[]) => {
        received.push(args);
      };
      settings.on('change', handler);
      settings.emit('change', 'first');
      settings.off('change', handler);
      settings.emit('change', 'second');
      expect(received).toStrictEqual([['first']]);
    });

    it('supports multiple handlers for the same event', () => {
      const settings = new InMemorySettingsService();
      const logA: string[] = [];
      const logB: string[] = [];
      const handlerA = (val: unknown) => logA.push(val as string);
      const handlerB = (val: unknown) => logB.push(val as string);
      settings.on('update', handlerA);
      settings.on('update', handlerB);
      settings.emit('update', 'payload');
      expect(logA).toStrictEqual(['payload']);
      expect(logB).toStrictEqual(['payload']);
    });
  });
});
