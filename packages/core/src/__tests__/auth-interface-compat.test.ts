/**
 * @plan:PLAN-20260608-ISSUE1586.P07
 * @requirement:REQ-INTF-001
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core structural compatibility tests.
 *
 * These tests verify that core's concrete implementations (SecureStore,
 * SettingsService, DebugLogger) structurally satisfy the DI interface
 * shapes defined in @vybestack/llxprt-code-auth.
 *
 * These are type-level structural compatibility checks — they verify that
 * TypeScript structural typing allows core classes to satisfy auth DI
 * interfaces. They do NOT construct auth instances or call factory functions.
 */

import { describe, it, expect } from 'vitest';
import type { ISecureStore } from '@vybestack/llxprt-code-auth';
import type { ISettingsService } from '@vybestack/llxprt-code-auth';
import type { IDebugLogger } from '@vybestack/llxprt-code-auth';
import { SecureStore } from '../storage/secure-store.js';
import { SettingsService } from '../settings/SettingsService.js';
import { DebugLogger } from '../debug/DebugLogger.js';

/**
 * Type-level structural compatibility check helper.
 * If the type assignment compiles, the core implementation structurally
 * satisfies the auth DI interface. The runtime assertion confirms the
 * helper actually ran.
 */
function assertSatisfies<T>(_value: T): void {
  // Intentionally empty — this function exists for compile-time type checking.
  // The _value parameter ensures TypeScript verifies structural compatibility.
}

describe('Core structural compatibility with auth DI interfaces', () => {
  it('SecureStore satisfies ISecureStore', () => {
    // SecureStore has: get, set, delete, list, has — matching ISecureStore
    assertSatisfies<ISecureStore>(null as unknown as SecureStore);
    // Runtime sanity: SecureStore has the required method names
    const proto = SecureStore.prototype as Record<string, unknown>;
    expect(typeof proto.get).toBe('function');
    expect(typeof proto.set).toBe('function');
    expect(typeof proto.delete).toBe('function');
    expect(typeof proto.list).toBe('function');
    expect(typeof proto.has).toBe('function');
  });

  it('SettingsService satisfies ISettingsService', () => {
    // SettingsService has: get, getProviderSettings, on, off — matching ISettingsService
    assertSatisfies<ISettingsService>(null as unknown as SettingsService);
    const proto = SettingsService.prototype as Record<string, unknown>;
    expect(typeof proto.get).toBe('function');
    expect(typeof proto.getProviderSettings).toBe('function');
    expect(typeof proto.on).toBe('function');
    expect(typeof proto.off).toBe('function');
  });

  it('DebugLogger satisfies IDebugLogger', () => {
    // DebugLogger has: debug, error, warn, log — matching IDebugLogger
    assertSatisfies<IDebugLogger>(null as unknown as DebugLogger);
    const proto = DebugLogger.prototype as Record<string, unknown>;
    expect(typeof proto.debug).toBe('function');
    expect(typeof proto.error).toBe('function');
    expect(typeof proto.warn).toBe('function');
    expect(typeof proto.log).toBe('function');
  });
});
