/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P16
 * @requirement REQ-HD-004.1, REQ-HD-004.2, REQ-HD-004.3, REQ-HD-004.4
 * @requirement REQ-HD-009.1, REQ-HD-009.2, REQ-HD-009.3, REQ-HD-009.4
 * @requirement REQ-HD-009.5, REQ-HD-009.6
 *
 * Behavioral tests for settings, factory, and runtime accessors for the
 * high-density compression strategy. All tests operate on REAL objects —
 * actual SETTINGS_REGISTRY array, real COMPRESSION_STRATEGIES tuple,
 * real factory function, and real runtime context builder.
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  COMPRESSION_STRATEGIES,
  type CompressionStrategyName,
} from '../types.js';
import {
  getCompressionStrategy,
  parseCompressionStrategyName,
} from '../compressionStrategyFactory.js';
import {
  SETTINGS_REGISTRY,
  type SettingSpec,
} from '../../../settings/settingsRegistry.js';
import { createAgentRuntimeContext } from '../../../runtime/createAgentRuntimeContext.js';
import { createAgentRuntimeState } from '../../../runtime/AgentRuntimeState.js';
import type { AgentRuntimeContext } from '../../../runtime/AgentRuntimeContext.js';
import { SettingsService } from '../../../settings/SettingsService.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function findSettingSpec(key: string): SettingSpec | undefined {
  return SETTINGS_REGISTRY.find((s) => s.key === key);
}

function buildRuntimeContext(
  overrides: {
    compressionStrategy?: string;
    'compression.density.readWritePruning'?: boolean;
    'compression.density.fileDedupe'?: boolean;
    'compression.density.recencyPruning'?: boolean;
    'compression.density.recencyRetention'?: number;
  } = {},
  settingsServiceOverrides?: Record<string, unknown>,
): AgentRuntimeContext {
  const runtimeState = createAgentRuntimeState({
    runtimeId: 'test-runtime',
    provider: 'test-provider',
    model: 'test-model',
    sessionId: 'test-session',
  });

  const settingsService = new SettingsService();
  if (settingsServiceOverrides) {
    for (const [key, value] of Object.entries(settingsServiceOverrides)) {
      settingsService.set(key, value);
    }
  }

  return createAgentRuntimeContext({
    state: runtimeState,
    settings: {
      compressionThreshold: 0.85,
      contextLimit: 131134,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
      compressionStrategy: overrides.compressionStrategy,
      'compression.density.readWritePruning':
        overrides['compression.density.readWritePruning'],
      'compression.density.fileDedupe':
        overrides['compression.density.fileDedupe'],
      'compression.density.recencyPruning':
        overrides['compression.density.recencyPruning'],
      'compression.density.recencyRetention':
        overrides['compression.density.recencyRetention'],
    },
    provider: {
      getActiveProvider: vi.fn(() => ({
        name: 'test-provider',
        generateChatCompletion: vi.fn(),
      })),
    } as never,
    telemetry: {
      logApiRequest: vi.fn(),
      logApiResponse: vi.fn(),
      logApiError: vi.fn(),
    },
    tools: {
      listToolNames: vi.fn(() => []),
      getToolMetadata: vi.fn(() => undefined),
    },
    providerRuntime: {
      runtimeId: 'test-runtime',
      settingsService,
      config: {} as never,
    },
  });
}

// ---------------------------------------------------------------------------
// COMPRESSION_STRATEGIES Tuple Tests
// ---------------------------------------------------------------------------

describe('COMPRESSION_STRATEGIES @plan PLAN-20260211-HIGHDENSITY.P16', () => {
  /** @requirement REQ-HD-004.1 */
  it("COMPRESSION_STRATEGIES includes 'high-density'", () => {
    expect(
      (COMPRESSION_STRATEGIES as readonly string[]).includes('high-density'),
    ).toBe(true);
  });

  /** @requirement REQ-HD-004.1 */
  it('COMPRESSION_STRATEGIES preserves existing strategies', () => {
    expect(COMPRESSION_STRATEGIES).toContain('middle-out');
    expect(COMPRESSION_STRATEGIES).toContain('top-down-truncation');
    expect(COMPRESSION_STRATEGIES).toContain('one-shot');
  });
});

// ---------------------------------------------------------------------------
// Factory Tests
// ---------------------------------------------------------------------------

describe('Factory @plan PLAN-20260211-HIGHDENSITY.P16', () => {
  /** @requirement REQ-HD-004.2 */
  it("getCompressionStrategy('high-density') returns HighDensityStrategy", () => {
    const strategy = getCompressionStrategy('high-density');
    expect(strategy.name).toBe('high-density');
  });

  /** @requirement REQ-HD-004.3 */
  it('HighDensityStrategy from factory has correct properties', () => {
    const strategy = getCompressionStrategy('high-density');
    expect(strategy.name).toBe('high-density');
    expect(strategy.requiresLLM).toBe(false);
    expect(strategy.trigger.mode).toBe('continuous');
    expect(strategy.trigger.defaultThreshold).toBe(0.85);
  });

  /** @requirement REQ-HD-004.2 */
  it('HighDensityStrategy from factory has optimize method', () => {
    const strategy = getCompressionStrategy('high-density');
    expect(typeof strategy.optimize).toBe('function');
  });

  /** @requirement REQ-HD-004.2 */
  it('HighDensityStrategy from factory has compress method', () => {
    const strategy = getCompressionStrategy('high-density');
    expect(typeof strategy.compress).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Settings Enum Auto-Registration Tests
// ---------------------------------------------------------------------------

describe('Settings Enum @plan PLAN-20260211-HIGHDENSITY.P16', () => {
  /** @requirement REQ-HD-004.4 */
  it("compression.strategy setting includes 'high-density' in enumValues", () => {
    const spec = findSettingSpec('compression.strategy');
    expect(spec).toBeDefined();
    expect(spec!.enumValues).toContain('high-density');
  });

  /** @requirement REQ-HD-004.4 */
  it("compression.strategy setting's enumValues derives from COMPRESSION_STRATEGIES", () => {
    const spec = findSettingSpec('compression.strategy');
    expect(spec).toBeDefined();
    for (const strategyName of COMPRESSION_STRATEGIES) {
      expect(spec!.enumValues).toContain(strategyName);
    }
  });
});

// ---------------------------------------------------------------------------
// Settings Registry Spec Tests
// ---------------------------------------------------------------------------

describe('Settings Registry Specs @plan PLAN-20260211-HIGHDENSITY.P16', () => {
  /** @requirement REQ-HD-009.1 */
  it('compression.density.readWritePruning setting exists with correct spec', () => {
    const spec = findSettingSpec('compression.density.readWritePruning');
    expect(spec).toBeDefined();
    expect(spec!.type).toBe('boolean');
    expect(spec!.default).toBe(true);
    expect(spec!.category).toBe('cli-behavior');
    expect(spec!.persistToProfile).toBe(true);
  });

  /** @requirement REQ-HD-009.2 */
  it('compression.density.fileDedupe setting exists with correct spec', () => {
    const spec = findSettingSpec('compression.density.fileDedupe');
    expect(spec).toBeDefined();
    expect(spec!.type).toBe('boolean');
    expect(spec!.default).toBe(true);
    expect(spec!.category).toBe('cli-behavior');
    expect(spec!.persistToProfile).toBe(true);
  });

  /** @requirement REQ-HD-009.3 */
  it('compression.density.recencyPruning setting exists with correct spec', () => {
    const spec = findSettingSpec('compression.density.recencyPruning');
    expect(spec).toBeDefined();
    expect(spec!.type).toBe('boolean');
    expect(spec!.default).toBe(false);
    expect(spec!.category).toBe('cli-behavior');
    expect(spec!.persistToProfile).toBe(true);
  });

  /** @requirement REQ-HD-009.4 */
  it('compression.density.recencyRetention setting exists with correct spec', () => {
    const spec = findSettingSpec('compression.density.recencyRetention');
    expect(spec).toBeDefined();
    expect(spec!.type).toBe('number');
    expect(spec!.default).toBe(3);
    expect(spec!.category).toBe('cli-behavior');
    expect(spec!.persistToProfile).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Runtime Accessor Tests
// ---------------------------------------------------------------------------

describe('Runtime Accessors @plan PLAN-20260211-HIGHDENSITY.P16', () => {
  /** @requirement REQ-HD-009.5 */
  it('densityReadWritePruning returns configured value', () => {
    const ctx = buildRuntimeContext({
      'compression.density.readWritePruning': false,
    });
    expect(ctx.ephemerals.densityReadWritePruning()).toBe(false);
  });

  /** @requirement REQ-HD-009.5 */
  it('densityReadWritePruning returns default when unset', () => {
    const ctx = buildRuntimeContext();
    expect(ctx.ephemerals.densityReadWritePruning()).toBe(true);
  });

  /** @requirement REQ-HD-009.5 */
  it('densityFileDedupe returns configured value', () => {
    const ctx = buildRuntimeContext({
      'compression.density.fileDedupe': false,
    });
    expect(ctx.ephemerals.densityFileDedupe()).toBe(false);
  });

  /** @requirement REQ-HD-009.5 */
  it('densityRecencyPruning returns configured value', () => {
    const ctx = buildRuntimeContext({
      'compression.density.recencyPruning': true,
    });
    expect(ctx.ephemerals.densityRecencyPruning()).toBe(true);
  });

  /** @requirement REQ-HD-009.5 */
  it('densityRecencyPruning returns default false when unset', () => {
    const ctx = buildRuntimeContext();
    expect(ctx.ephemerals.densityRecencyPruning()).toBe(false);
  });

  /** @requirement REQ-HD-009.5 */
  it('densityRecencyRetention returns configured value', () => {
    const ctx = buildRuntimeContext({
      'compression.density.recencyRetention': 5,
    });
    expect(ctx.ephemerals.densityRecencyRetention()).toBe(5);
  });

  /** @requirement REQ-HD-009.5 */
  it('densityRecencyRetention returns default 3 when unset', () => {
    const ctx = buildRuntimeContext();
    expect(ctx.ephemerals.densityRecencyRetention()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Threshold Precedence Tests
// ---------------------------------------------------------------------------

describe('Threshold Precedence @plan PLAN-20260211-HIGHDENSITY.P16', () => {
  /** @requirement REQ-HD-009.5 */
  it('live settings service value overrides snapshot setting', () => {
    const ctx = buildRuntimeContext(
      { 'compression.density.readWritePruning': true },
      { 'compression.density.readWritePruning': false },
    );
    expect(ctx.ephemerals.densityReadWritePruning()).toBe(false);
  });

  /** @requirement REQ-HD-009.5 */
  it('snapshot setting overrides default when no live value', () => {
    const ctx = buildRuntimeContext({
      'compression.density.recencyPruning': true,
    });
    expect(ctx.ephemerals.densityRecencyPruning()).toBe(true);
  });

  /** @requirement REQ-HD-001.10 */
  it('compression threshold returns default 0.85 when not overridden', () => {
    const ctx = buildRuntimeContext();
    // The default compressionThreshold is set to 0.85 in our test helper
    expect(ctx.ephemerals.compressionThreshold()).toBeCloseTo(0.85, 2);
  });

  /** @requirement REQ-HD-001.10 */
  it('live compression-threshold overrides snapshot', () => {
    const ctx = buildRuntimeContext({}, { 'compression-threshold': 0.6 });
    expect(ctx.ephemerals.compressionThreshold()).toBeCloseTo(0.6, 2);
  });
});

// ---------------------------------------------------------------------------
// Property-Based Tests (≥ 30% of total)
// ---------------------------------------------------------------------------

describe('Property-based tests @plan PLAN-20260211-HIGHDENSITY.P16', () => {
  it("all density settings have 'cli-behavior' category", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'compression.density.readWritePruning',
          'compression.density.fileDedupe',
          'compression.density.recencyPruning',
          'compression.density.recencyRetention',
        ),
        (key) => {
          const spec = findSettingSpec(key);
          expect(spec).toBeDefined();
          expect(spec!.category).toBe('cli-behavior');
        },
      ),
    );
  });

  it('all density settings have persistToProfile true', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'compression.density.readWritePruning',
          'compression.density.fileDedupe',
          'compression.density.recencyPruning',
          'compression.density.recencyRetention',
        ),
        (key) => {
          const spec = findSettingSpec(key);
          expect(spec).toBeDefined();
          expect(spec!.persistToProfile).toBe(true);
        },
      ),
    );
  });

  it('boolean density settings return boolean from accessor', () => {
    fc.assert(
      fc.property(fc.boolean(), (val) => {
        const ctx = buildRuntimeContext({
          'compression.density.readWritePruning': val,
        });
        expect(typeof ctx.ephemerals.densityReadWritePruning()).toBe('boolean');
      }),
    );
  });

  it('recencyRetention accessor returns a number', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (val) => {
        const ctx = buildRuntimeContext({
          'compression.density.recencyRetention': val,
        });
        expect(typeof ctx.ephemerals.densityRecencyRetention()).toBe('number');
      }),
    );
  });

  it('COMPRESSION_STRATEGIES is a superset of original strategies', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('middle-out', 'top-down-truncation', 'one-shot'),
        (name) => {
          expect(
            (COMPRESSION_STRATEGIES as readonly string[]).includes(name),
          ).toBe(true);
        },
      ),
    );
  });

  it('factory returns strategy with correct name for all strategy names', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...COMPRESSION_STRATEGIES),
        (name: CompressionStrategyName) => {
          const strategy = getCompressionStrategy(name);
          expect(strategy.name).toBe(name);
        },
      ),
    );
  });

  it('every COMPRESSION_STRATEGIES member appears in compression.strategy enumValues', () => {
    const spec = findSettingSpec('compression.strategy');
    expect(spec).toBeDefined();
    fc.assert(
      fc.property(fc.constantFrom(...COMPRESSION_STRATEGIES), (name) => {
        expect(spec!.enumValues).toContain(name);
      }),
    );
  });

  it('parseCompressionStrategyName accepts every member of COMPRESSION_STRATEGIES', () => {
    fc.assert(
      fc.property(fc.constantFrom(...COMPRESSION_STRATEGIES), (name) => {
        expect(parseCompressionStrategyName(name)).toBe(name);
      }),
    );
  });

  it('densityFileDedupe returns boolean for any boolean input', () => {
    fc.assert(
      fc.property(fc.boolean(), (val) => {
        const ctx = buildRuntimeContext({
          'compression.density.fileDedupe': val,
        });
        expect(typeof ctx.ephemerals.densityFileDedupe()).toBe('boolean');
      }),
    );
  });

  it('densityRecencyPruning returns boolean for any boolean input', () => {
    fc.assert(
      fc.property(fc.boolean(), (val) => {
        const ctx = buildRuntimeContext({
          'compression.density.recencyPruning': val,
        });
        expect(typeof ctx.ephemerals.densityRecencyPruning()).toBe('boolean');
      }),
    );
  });
});
