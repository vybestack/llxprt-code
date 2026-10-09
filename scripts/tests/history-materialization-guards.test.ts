/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { observeHistorySynchronouslyForTest } from '@vybestack/llxprt-code-test-utils/core/synchronous-history-test-observation.js';
import { DensityDiskHistory } from '../../packages/agents/src/compression/__tests__/density-disk-helpers.js';
import { HighdensityPreparationHistory } from '../../packages/agents/src/compression/__tests__/highdensity-disk-helpers.js';
import { BatchStreamHistory } from '../../packages/core/src/services/history/addbatch-stream-test-helpers.js';
import { MergeRowHistory } from '../../packages/core/src/services/history/history-merge-test-helpers.js';
import { DiagnosticsCursorHistory } from '../../packages/core/src/services/history/provider-diagnostics-test-helpers.js';

describe('journal materialization guard', () => {
  it('DensityDiskHistory rejects journal eager materialization', () => {
    const history = new DensityDiskHistory();
    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'density materialization forbidden',
      );
    } finally {
      history.dispose();
    }
  });
});

describe('journal materialization guard', () => {
  it('HighdensityPreparationHistory rejects journal eager materialization', () => {
    const history = new HighdensityPreparationHistory();
    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'eager high-density preparation materialization forbidden',
      );
    } finally {
      history.dispose();
    }
  });
});

describe('journal materialization guard', () => {
  it('BatchStreamHistory rejects journal eager materialization', () => {
    const history = new BatchStreamHistory();
    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'addBatch eager materialization reached',
      );
    } finally {
      history.dispose();
    }
  });
});

describe('journal materialization guard', () => {
  it('MergeRowHistory rejects journal eager materialization', () => {
    const history = new MergeRowHistory();
    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'merge materialization forbidden',
      );
    } finally {
      history.dispose();
    }
  });
});

describe('journal materialization guard', () => {
  it('DiagnosticsCursorHistory rejects journal eager materialization', () => {
    const history = new DiagnosticsCursorHistory();
    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'eager diagnostics preparation',
      );
    } finally {
      history.dispose();
    }
  });
});
