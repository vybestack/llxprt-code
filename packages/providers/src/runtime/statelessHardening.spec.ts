/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  configureCliStatelessHardening,
  getCliStatelessHardeningOverride,
  getCliStatelessHardeningPreference,
  isCliStatelessProviderModeEnabled,
} from './statelessHardening.js';
import { resetCliRuntimeRegistryForTesting } from './runtimeRegistry.js';

/**
 * Test suite for stateless hardening preference resolution
 *
 * Tests behavioral contracts for:
 * - Preference normalization
 * - Override behavior
 * - Default behavior
 * - Metadata precedence
 */
describe('statelessHardening', () => {
  beforeEach(() => {
    // Reset state before each test
    configureCliStatelessHardening(null);
    resetCliRuntimeRegistryForTesting();
  });

  afterEach(() => {
    // Clean up after each test
    configureCliStatelessHardening(null);
    resetCliRuntimeRegistryForTesting();
  });

  describe('configureCliStatelessHardening', () => {
    it('should set override to strict', () => {
      configureCliStatelessHardening('strict');
      expect(getCliStatelessHardeningOverride()).toBe('strict');
    });

    it('should set override to legacy', () => {
      configureCliStatelessHardening('legacy');
      expect(getCliStatelessHardeningOverride()).toBe('legacy');
    });

    it('should clear override when set to null', () => {
      configureCliStatelessHardening('strict');
      expect(getCliStatelessHardeningOverride()).toBe('strict');

      configureCliStatelessHardening(null);
      expect(getCliStatelessHardeningOverride()).toBeNull();
    });
  });

  describe('getCliStatelessHardeningPreference', () => {
    it('should return default strict preference when no override or metadata', () => {
      // Default should be 'strict' when no override, no metadata, no scope, no runtime entry
      const preference = getCliStatelessHardeningPreference();
      expect(preference).toBe('strict');
    });

    it('should return strict when override is set to strict', () => {
      configureCliStatelessHardening('strict');
      expect(getCliStatelessHardeningPreference()).toBe('strict');
    });

    it('should return legacy when override is set to legacy', () => {
      configureCliStatelessHardening('legacy');
      expect(getCliStatelessHardeningPreference()).toBe('legacy');
    });
  });

  describe('isCliStatelessProviderModeEnabled', () => {
    it('should return true when preference is strict', () => {
      configureCliStatelessHardening('strict');
      expect(isCliStatelessProviderModeEnabled()).toBe(true);
    });

    it('should return false when preference is legacy', () => {
      configureCliStatelessHardening('legacy');
      expect(isCliStatelessProviderModeEnabled()).toBe(false);
    });

    it('should return true by default (strict default)', () => {
      // Default preference is 'strict'
      expect(isCliStatelessProviderModeEnabled()).toBe(true);
    });
  });

  describe('override behavior', () => {
    it('should allow switching from strict to legacy', () => {
      configureCliStatelessHardening('strict');
      expect(isCliStatelessProviderModeEnabled()).toBe(true);

      configureCliStatelessHardening('legacy');
      expect(isCliStatelessProviderModeEnabled()).toBe(false);
    });

    it('should allow switching from legacy to strict', () => {
      configureCliStatelessHardening('legacy');
      expect(isCliStatelessProviderModeEnabled()).toBe(false);

      configureCliStatelessHardening('strict');
      expect(isCliStatelessProviderModeEnabled()).toBe(true);
    });
  });
});
