/**
 * @plan PLAN-20260608-ISSUE1588.P04
 * @requirement REQ-SVC-001
 *
 * Behavioral TDD tests for the settings service singleton functions.
 *
 * These tests verify ONLY settings-owned singleton state:
 * getSettingsService, registerSettingsService, resetSettingsService.
 *
 * They MUST NOT import or reference core runtime context.
 * Context creation/clearing assertions belong in core adapter tests (P06).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSettingsService,
  registerSettingsService,
  resetSettingsService,
} from '../settings/settingsServiceInstance.js';
import { SettingsService } from '../settings/SettingsService.js';

describe('getSettingsService — singleton retrieval', () => {
  beforeEach(() => {
    resetSettingsService();
  });

  it('throws when no service is registered', () => {
    expect(() => getSettingsService()).toThrow('No SettingsService registered');
  });

  it('returns the registered service after registerSettingsService', () => {
    const svc = new SettingsService();
    registerSettingsService(svc);
    const result = getSettingsService();
    expect(result).toBe(svc);
  });

  it('returns the same instance on multiple getSettingsService calls', () => {
    const svc = new SettingsService();
    registerSettingsService(svc);
    const first = getSettingsService();
    const second = getSettingsService();
    expect(first).toBe(second);
  });
});

describe('registerSettingsService — singleton registration', () => {
  beforeEach(() => {
    resetSettingsService();
  });

  it('replaces the previous singleton with a new one', () => {
    const svc1 = new SettingsService();
    const svc2 = new SettingsService();
    registerSettingsService(svc1);
    registerSettingsService(svc2);
    expect(getSettingsService()).toBe(svc2);
  });
});

describe('resetSettingsService — singleton reset', () => {
  beforeEach(() => {
    resetSettingsService();
  });

  it('causes getSettingsService to throw after reset', () => {
    const svc = new SettingsService();
    registerSettingsService(svc);
    resetSettingsService();
    expect(() => getSettingsService()).toThrow('No SettingsService registered');
  });
});
