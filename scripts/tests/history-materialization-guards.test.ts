/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { materializeHistoryForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import { DensityDiskHistory } from '../../packages/agents/src/compression/__tests__/density-disk-helpers.js';
import { HighdensityPreparationHistory } from '../../packages/agents/src/compression/__tests__/highdensity-disk-helpers.js';
import { BatchStreamHistory } from '../../packages/core/src/services/history/__tests__/support/addbatch-stream-test-helpers.js';
import { MergeRowHistory } from '../../packages/core/src/services/history/__tests__/support/history-merge-test-helpers.js';
import { DiagnosticsCursorHistory } from '../../packages/core/src/services/history/__tests__/support/provider-diagnostics-test-helpers.js';

describe('journal materialization guard', () => {
  it('DensityDiskHistory rejects journal eager materialization', async () => {
    const history = new DensityDiskHistory();
    try {
      await expect(materializeHistoryForTest(history)).rejects.toThrow(
        'density materialization forbidden',
      );
    } finally {
      await history.dispose();
    }
  });
});

describe('journal materialization guard', () => {
  it('HighdensityPreparationHistory rejects journal eager materialization', async () => {
    const history = new HighdensityPreparationHistory();
    try {
      await expect(materializeHistoryForTest(history)).rejects.toThrow(
        'eager high-density preparation materialization forbidden',
      );
    } finally {
      await history.dispose();
    }
  });
});

describe('journal materialization guard', () => {
  it('BatchStreamHistory rejects journal eager materialization', async () => {
    const history = new BatchStreamHistory();
    try {
      await expect(materializeHistoryForTest(history)).rejects.toThrow(
        'addBatch eager materialization reached',
      );
    } finally {
      await history.dispose();
    }
  });
});

describe('journal materialization guard', () => {
  it('MergeRowHistory rejects journal eager materialization', async () => {
    const history = new MergeRowHistory();
    try {
      await expect(materializeHistoryForTest(history)).rejects.toThrow(
        'merge materialization forbidden',
      );
    } finally {
      await history.dispose();
    }
  });
});

describe('journal materialization guard', () => {
  it('DiagnosticsCursorHistory rejects journal eager materialization', async () => {
    const history = new DiagnosticsCursorHistory();
    try {
      await expect(materializeHistoryForTest(history)).rejects.toThrow(
        'eager diagnostics preparation',
      );
    } finally {
      await history.dispose();
    }
  });
});
