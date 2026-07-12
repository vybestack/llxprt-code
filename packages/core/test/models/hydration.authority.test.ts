/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RuntimeModel } from '../../src/runtime/contracts/RuntimeModel.js';
import { hydrateModelsWithRegistry } from '../../src/models/hydration.js';
import { getModelRegistry } from '../../src/models/registry.js';
import type { LlxprtModel } from '../../src/models/schema.js';

function makeBaseModel(
  id: string,
  overrides: Partial<RuntimeModel> = {},
): RuntimeModel {
  return {
    id,
    name: id,
    provider: 'codex',
    supportedToolFormats: ['openai'],
    ...overrides,
  };
}

function makeRegistryModel(id: string, contextWindow: number): LlxprtModel {
  return {
    id: `openai/${id}`,
    name: id,
    provider: 'openai',
    providerId: 'openai',
    providerName: 'OpenAI',
    modelId: id,
    supportedToolFormats: ['openai'],
    contextWindow,
    capabilities: {
      vision: false,
      audio: false,
      pdf: false,
      toolCalling: true,
      reasoning: true,
      temperature: true,
      structuredOutput: true,
      attachment: false,
    },
    limits: { contextWindow, maxOutput: 128_000 },
    metadata: {
      releaseDate: '2026-07-09',
      openWeights: false,
    },
    envVars: [],
  };
}

describe('hydrateModelsWithRegistry — provider geometry authority @issue:2483', () => {
  beforeEach(() => {
    const registry = getModelRegistry();

    // Force the registry to appear initialized
    vi.spyOn(registry, 'isInitialized').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves static-model contextWindow (geometryAuthority) over registry data', async () => {
    const registry = getModelRegistry();
    vi.spyOn(registry, 'getByProvider').mockReturnValue([
      makeRegistryModel('gpt-5.6-sol', 1048576),
    ]);

    const baseModels = [
      makeBaseModel('gpt-5.6-sol', {
        contextWindow: 262144,
        geometryAuthority: { contextWindow: true },
      }),
    ];

    const result = await hydrateModelsWithRegistry(baseModels, ['openai']);

    expect(result).toHaveLength(1);
    expect(result[0]?.contextWindow).toBe(262144);
    expect(result[0]?.hydrated).toBe(true);
  });

  it('refreshes ordinary provider-fallback contextWindow from registry (no marker)', async () => {
    const registry = getModelRegistry();
    vi.spyOn(registry, 'getByProvider').mockReturnValue([
      makeRegistryModel('gpt-4o', 128000),
    ]);

    // Ordinary provider model WITHOUT geometryAuthority — registry wins
    const baseModels = [makeBaseModel('gpt-4o', { contextWindow: 8000 })];

    const result = await hydrateModelsWithRegistry(baseModels, ['openai']);

    expect(result).toHaveLength(1);
    expect(result[0]?.contextWindow).toBe(128000);
  });

  it('falls back to registry contextWindow when provider does not supply one', async () => {
    const registry = getModelRegistry();
    vi.spyOn(registry, 'getByProvider').mockReturnValue([
      makeRegistryModel('gpt-4o', 128000),
    ]);

    const baseModels = [makeBaseModel('gpt-4o')];

    const result = await hydrateModelsWithRegistry(baseModels, ['openai']);

    expect(result).toHaveLength(1);
    expect(result[0]?.contextWindow).toBe(128000);
  });

  it('preserves static-model contextWindow for multiple codex tiers', async () => {
    const registry = getModelRegistry();
    vi.spyOn(registry, 'getByProvider').mockReturnValue([
      makeRegistryModel('gpt-5.6-sol', 1048576),
      makeRegistryModel('gpt-5.6-terra', 1048576),
      makeRegistryModel('gpt-5.6-luna', 1048576),
      makeRegistryModel('gpt-5.3-codex-spark', 1048576),
    ]);

    const baseModels: RuntimeModel[] = [
      makeBaseModel('gpt-5.6-sol', {
        contextWindow: 262144,
        geometryAuthority: { contextWindow: true },
      }),
      makeBaseModel('gpt-5.6-terra', {
        contextWindow: 262144,
        geometryAuthority: { contextWindow: true },
      }),
      makeBaseModel('gpt-5.6-luna', {
        contextWindow: 262144,
        geometryAuthority: { contextWindow: true },
      }),
      makeBaseModel('gpt-5.3-codex-spark', {
        contextWindow: 131072,
        geometryAuthority: { contextWindow: true },
      }),
    ];

    const result = await hydrateModelsWithRegistry(baseModels, ['openai']);

    const sol = result.find((m) => m.id === 'gpt-5.6-sol');
    const terra = result.find((m) => m.id === 'gpt-5.6-terra');
    const luna = result.find((m) => m.id === 'gpt-5.6-luna');
    const spark = result.find((m) => m.id === 'gpt-5.3-codex-spark');

    expect(sol?.contextWindow).toBe(262144);
    expect(terra?.contextWindow).toBe(262144);
    expect(luna?.contextWindow).toBe(262144);
    expect(spark?.contextWindow).toBe(131072);
  });

  it('preserves Spark explicit context geometry (131072) with marker', async () => {
    const registry = getModelRegistry();
    vi.spyOn(registry, 'getByProvider').mockReturnValue([
      makeRegistryModel('gpt-5.3-codex-spark', 1048576),
    ]);

    const baseModels = [
      makeBaseModel('gpt-5.3-codex-spark', {
        contextWindow: 131072,
        geometryAuthority: { contextWindow: true },
      }),
    ];

    const result = await hydrateModelsWithRegistry(baseModels, ['openai']);

    expect(result).toHaveLength(1);
    expect(result[0]?.contextWindow).toBe(131072);
  });

  it('allows registry to override maxOutputTokens when only contextWindow has authority', async () => {
    const registry = getModelRegistry();
    const registryModel = makeRegistryModel('gpt-5.6-sol', 1048576);
    registryModel.maxOutputTokens = 65536;
    vi.spyOn(registry, 'getByProvider').mockReturnValue([registryModel]);

    // Model claims authority ONLY for contextWindow, not maxOutputTokens.
    // Its maxOutputTokens (999) should be overridden by registry (65536).
    const baseModels = [
      makeBaseModel('gpt-5.6-sol', {
        contextWindow: 262144,
        maxOutputTokens: 999,
        geometryAuthority: { contextWindow: true },
      }),
    ];

    const result = await hydrateModelsWithRegistry(baseModels, ['openai']);

    expect(result).toHaveLength(1);
    const hydrated = result[0];
    expect(hydrated?.contextWindow).toBe(262144);
    expect(hydrated?.maxOutputTokens).toBe(65536);
  });

  it('preserves model maxOutputTokens when geometryAuthority marks it', async () => {
    const registry = getModelRegistry();
    const registryModel = makeRegistryModel('gpt-5.6-sol', 1048576);
    registryModel.maxOutputTokens = 65536;
    vi.spyOn(registry, 'getByProvider').mockReturnValue([registryModel]);

    const baseModels = [
      makeBaseModel('gpt-5.6-sol', {
        contextWindow: 262144,
        maxOutputTokens: 16384,
        geometryAuthority: {
          contextWindow: true,
          maxOutputTokens: true,
        },
      }),
    ];

    const result = await hydrateModelsWithRegistry(baseModels, ['openai']);

    expect(result).toHaveLength(1);
    const hydrated = result[0];
    expect(hydrated?.contextWindow).toBe(262144);
    expect(hydrated?.maxOutputTokens).toBe(16384);
  });
});
