/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  resolveAcquisitionBudgetFromSetting,
  resolveShellRetentionBudget,
} from './shellAcquisitionConfig.js';
import {
  ACQUISITION_HARD_MAX_BYTES,
  ACQUISITION_MIN_BYTES,
  DEFAULT_ACQUISITION_BUDGET_BYTES,
} from '@vybestack/llxprt-code-tools/acquisition.js';

describe('resolveAcquisitionBudgetFromSetting', () => {
  it('falls back to default for undefined', () => {
    const budget = resolveAcquisitionBudgetFromSetting(undefined);
    expect(budget.bytes).toBe(DEFAULT_ACQUISITION_BUDGET_BYTES);
  });

  it('falls back to default for null', () => {
    const budget = resolveAcquisitionBudgetFromSetting(null);
    expect(budget.bytes).toBe(DEFAULT_ACQUISITION_BUDGET_BYTES);
  });

  it('falls back to default for invalid string', () => {
    const budget = resolveAcquisitionBudgetFromSetting('not-a-number');
    expect(budget.bytes).toBe(DEFAULT_ACQUISITION_BUDGET_BYTES);
  });

  it('falls back to default for nonnumeric disabled values', () => {
    expect(resolveAcquisitionBudgetFromSetting(false).bytes).toBe(
      DEFAULT_ACQUISITION_BUDGET_BYTES,
    );
    expect(resolveAcquisitionBudgetFromSetting('').bytes).toBe(
      DEFAULT_ACQUISITION_BUDGET_BYTES,
    );
  });

  it('falls back to default for zero and negative values other than -1', () => {
    expect(resolveAcquisitionBudgetFromSetting(0).bytes).toBe(
      DEFAULT_ACQUISITION_BUDGET_BYTES,
    );
    expect(resolveAcquisitionBudgetFromSetting(-5).bytes).toBe(
      DEFAULT_ACQUISITION_BUDGET_BYTES,
    );
  });

  it('parses valid string', () => {
    const budget = resolveAcquisitionBudgetFromSetting('8388608');
    expect(budget.bytes).toBe(8388608);
  });

  it('uses hard max for -1 (disabled)', () => {
    const budget = resolveAcquisitionBudgetFromSetting(-1);
    expect(budget.bytes).toBe(ACQUISITION_HARD_MAX_BYTES);
  });

  it('accepts a serialized -1', () => {
    const budget = resolveAcquisitionBudgetFromSetting('-1');
    expect(budget.bytes).toBe(ACQUISITION_HARD_MAX_BYTES);
  });

  it('clamps above hard max', () => {
    const budget = resolveAcquisitionBudgetFromSetting(999_999_999);
    expect(budget.bytes).toBe(ACQUISITION_HARD_MAX_BYTES);
  });

  it('clamps a positive value above a valid intermediate custom hardMax', () => {
    const customHardMax = 10 * 1024 * 1024; // 10 MiB — valid intermediate
    const overCustom = 50 * 1024 * 1024; // 50 MiB — above the custom ceiling
    const budget = resolveAcquisitionBudgetFromSetting(
      overCustom,
      customHardMax,
    );
    expect(budget.bytes).toBe(customHardMax);
  });

  it('respects the absolute ceiling even with a custom hardMax', () => {
    const budget = resolveAcquisitionBudgetFromSetting(-1, 999 * 1024 * 1024);
    expect(budget.bytes).toBe(ACQUISITION_HARD_MAX_BYTES);
  });

  it('normalizes an invalid custom hard max before resolving -1', () => {
    const budget = resolveAcquisitionBudgetFromSetting(-1, Infinity);
    expect(budget.bytes).toBe(ACQUISITION_HARD_MAX_BYTES);
  });

  it('clamps to the minimum floor', () => {
    const budget = resolveAcquisitionBudgetFromSetting(1);
    expect(budget.bytes).toBe(ACQUISITION_MIN_BYTES);
  });

  it('produces a runtime-immutable (frozen) budget', () => {
    const budget = resolveAcquisitionBudgetFromSetting(8192);
    expect(Object.isFrozen(budget)).toBe(true);
    expect(budget.bytes).toBe(8192);
  });
});

describe('resolveShellRetentionBudget', () => {
  it('falls back to default for undefined', () => {
    const budget = resolveShellRetentionBudget(undefined);
    expect(budget.bytes).toBe(DEFAULT_ACQUISITION_BUDGET_BYTES);
  });

  it('uses hard max for -1', () => {
    const budget = resolveShellRetentionBudget(-1);
    expect(budget.bytes).toBe(ACQUISITION_HARD_MAX_BYTES);
  });

  it('resolves a valid number', () => {
    const budget = resolveShellRetentionBudget(8192);
    expect(budget.bytes).toBe(8192);
  });
});
