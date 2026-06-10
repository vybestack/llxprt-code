/**
 * @plan:PLAN-20260608-ISSUE1586.P07
 * @requirement:REQ-INTF-001.5
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type {
  IProviderRuntimeContext,
  GetActiveRuntimeContext,
} from '../runtime-context.js';
import type { ISettingsService } from '../settings-service.js';

// ---------------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------------

class InMemorySettingsService implements ISettingsService {
  private readonly data = new Map<string, unknown>();
  private readonly providerSettings = new Map<
    string,
    Record<string, unknown>
  >();

  get(key: string): unknown {
    return this.data.get(key);
  }

  getProviderSettings(providerName: string): Record<string, unknown> {
    return this.providerSettings.get(providerName) ?? {};
  }

  on(_event: string, _handler: (...args: unknown[]) => void): void {}
  off(_event: string, _handler: (...args: unknown[]) => void): void {}

  setSetting(key: string, value: unknown): void {
    this.data.set(key, value);
  }
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describe('IProviderRuntimeContext contract', () => {
  it('holds a settingsService reference', () => {
    const settings = new InMemorySettingsService();
    const ctx: IProviderRuntimeContext = {
      settingsService: settings,
    };
    expect(ctx.settingsService).toBe(settings);
  });

  it('holds optional config field', () => {
    const ctx: IProviderRuntimeContext = {
      settingsService: new InMemorySettingsService(),
      config: { timeout: 5000 },
    };
    expect(ctx.config).toStrictEqual({ timeout: 5000 });
  });

  it('holds optional runtimeId field', () => {
    const ctx: IProviderRuntimeContext = {
      settingsService: new InMemorySettingsService(),
      runtimeId: 'run-abc-123',
    };
    expect(ctx.runtimeId).toBe('run-abc-123');
  });

  it('holds optional metadata field', () => {
    const ctx: IProviderRuntimeContext = {
      settingsService: new InMemorySettingsService(),
      metadata: { source: 'test', version: 2 },
    };
    expect(ctx.metadata).toStrictEqual({ source: 'test', version: 2 });
  });

  it('works with all optional fields omitted', () => {
    const ctx: IProviderRuntimeContext = {
      settingsService: new InMemorySettingsService(),
    };
    expect(ctx.config).toBeUndefined();
    expect(ctx.runtimeId).toBeUndefined();
    expect(ctx.metadata).toBeUndefined();
  });
});

describe('GetActiveRuntimeContext contract', () => {
  it('returns a context when available', () => {
    const settings = new InMemorySettingsService();
    const context: IProviderRuntimeContext = {
      settingsService: settings,
      runtimeId: 'active',
    };
    const getCtx: GetActiveRuntimeContext = () => context;
    const result = getCtx();
    expect(result).toStrictEqual(context);
  });

  it('returns null when no context is active', () => {
    const getCtx: GetActiveRuntimeContext = () => null;
    const result = getCtx();
    expect(result).toBeNull();
  });

  it('can be undefined (not provided)', () => {
    const getCtx: GetActiveRuntimeContext = undefined;
    expect(getCtx).toBeUndefined();
  });
});
