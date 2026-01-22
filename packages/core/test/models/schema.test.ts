/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  ModelsDevModelSchema,
  ModelsDevProviderSchema,
  ModelsDevApiResponseSchema,
  LlxprtModelSchema,
} from '../../src/models/schema.js';
import {
  minimalModel,
  fullModel,
  reasoningModel,
  deprecatedModel,
  openaiProvider,
  mockApiResponse,
  invalidModelData,
  invalidProviderData,
} from './__fixtures__/mock-data.js';

describe('ModelsDevModelSchema', () => {
  describe('valid models', () => {
    it('validates model with all fields', () => {
      const result = ModelsDevModelSchema.safeParse(fullModel);
      expect(result.success).toBe(true);
    });

    it('validates model with minimal required fields', () => {
      const result = ModelsDevModelSchema.safeParse(minimalModel);
      expect(result.success).toBe(true);
    });

    it('validates reasoning model', () => {
      const result = ModelsDevModelSchema.safeParse(reasoningModel);
      expect(result.success).toBe(true);
    });

    it('validates deprecated model with status', () => {
      const result = ModelsDevModelSchema.safeParse(deprecatedModel);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('deprecated');
      }
    });
  });

  describe('required fields', () => {
    it('fails when id is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _, ...modelWithoutId } = minimalModel;
      const result = ModelsDevModelSchema.safeParse(modelWithoutId);
      expect(result.success).toBe(false);
    });

    it('fails when name is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { name: _, ...modelWithoutName } = minimalModel;
      const result = ModelsDevModelSchema.safeParse(modelWithoutName);
      expect(result.success).toBe(false);
    });

    it('fails when limit is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { limit: _, ...modelWithoutLimit } = minimalModel;
      const result = ModelsDevModelSchema.safeParse(modelWithoutLimit);
      expect(result.success).toBe(false);
    });

    it('fails when release_date is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { release_date: _, ...modelWithoutDate } = minimalModel;
      const result = ModelsDevModelSchema.safeParse(modelWithoutDate);
      expect(result.success).toBe(false);
    });

    it('fails when open_weights is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { open_weights: _, ...modelWithoutOW } = minimalModel;
      const result = ModelsDevModelSchema.safeParse(modelWithoutOW);
      expect(result.success).toBe(false);
    });
  });

  describe('optional fields', () => {
    it('accepts undefined capability booleans', () => {
      // minimalModel has no capability booleans
      const result = ModelsDevModelSchema.safeParse(minimalModel);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tool_call).toBeUndefined();
        expect(result.data.reasoning).toBeUndefined();
        expect(result.data.temperature).toBeUndefined();
        expect(result.data.attachment).toBeUndefined();
      }
    });

    it('accepts undefined cost', () => {
      const result = ModelsDevModelSchema.safeParse(minimalModel);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cost).toBeUndefined();
      }
    });

    it('accepts undefined modalities', () => {
      const result = ModelsDevModelSchema.safeParse(minimalModel);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modalities).toBeUndefined();
      }
    });
  });

  describe('enum validation', () => {
    it('fails on invalid status value', () => {
      const modelWithBadStatus = {
        ...minimalModel,
        status: 'invalid-status',
      };
      const result = ModelsDevModelSchema.safeParse(modelWithBadStatus);
      expect(result.success).toBe(false);
    });

    it('accepts valid status values', () => {
      for (const status of ['alpha', 'beta', 'deprecated']) {
        const model = { ...minimalModel, status };
        const result = ModelsDevModelSchema.safeParse(model);
        expect(result.success).toBe(true);
      }
    });

    it('fails on invalid modality values', () => {
      const modelWithBadModality = {
        ...minimalModel,
        modalities: {
          input: ['text', 'invalid-modality'],
          output: ['text'],
        },
      };
      const result = ModelsDevModelSchema.safeParse(modelWithBadModality);
      expect(result.success).toBe(false);
    });
  });

  describe('cost object validation', () => {
    it('validates complete cost object', () => {
      const result = ModelsDevModelSchema.safeParse(fullModel);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cost?.input).toBe(10);
        expect(result.data.cost?.output).toBe(30);
        expect(result.data.cost?.cache_read).toBe(2.5);
      }
    });

    it('accepts cost with only required fields', () => {
      const modelWithMinimalCost = {
        ...minimalModel,
        cost: { input: 1, output: 2 },
      };
      const result = ModelsDevModelSchema.safeParse(modelWithMinimalCost);
      expect(result.success).toBe(true);
    });
  });

  describe('interleaved field', () => {
    it('accepts boolean true', () => {
      const model = { ...minimalModel, interleaved: true };
      const result = ModelsDevModelSchema.safeParse(model);
      expect(result.success).toBe(true);
    });

    it('accepts object form with field', () => {
      const model = {
        ...minimalModel,
        interleaved: { field: 'reasoning_content' },
      };
      const result = ModelsDevModelSchema.safeParse(model);
      expect(result.success).toBe(true);
    });

    it('fails on invalid interleaved field value', () => {
      const model = {
        ...minimalModel,
        interleaved: { field: 'invalid_field' },
      };
      const result = ModelsDevModelSchema.safeParse(model);
      expect(result.success).toBe(false);
    });
  });
});

describe('ModelsDevProviderSchema', () => {
  describe('valid providers', () => {
    it('validates provider with models', () => {
      const result = ModelsDevProviderSchema.safeParse(openaiProvider);
      expect(result.success).toBe(true);
    });

    it('validates provider with empty models', () => {
      const emptyProvider = {
        id: 'empty',
        name: 'Empty',
        env: ['API_KEY'],
        models: {},
      };
      const result = ModelsDevProviderSchema.safeParse(emptyProvider);
      expect(result.success).toBe(true);
    });
  });

  describe('required fields', () => {
    it('fails when env is missing', () => {
      const result = ModelsDevProviderSchema.safeParse(invalidProviderData);
      expect(result.success).toBe(false);
    });

    it('fails when env array is missing', () => {
      const providerWithoutEnv = {
        id: 'test',
        name: 'Test',
        models: {},
      };
      const result = ModelsDevProviderSchema.safeParse(providerWithoutEnv);
      expect(result.success).toBe(false);
    });

    it('fails when models is missing', () => {
      const providerWithoutModels = {
        id: 'test',
        name: 'Test',
        env: ['KEY'],
      };
      const result = ModelsDevProviderSchema.safeParse(providerWithoutModels);
      expect(result.success).toBe(false);
    });
  });

  describe('optional fields', () => {
    it('accepts undefined api', () => {
      const provider = {
        id: 'test',
        name: 'Test',
        env: ['KEY'],
        models: {},
      };
      const result = ModelsDevProviderSchema.safeParse(provider);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.api).toBeUndefined();
      }
    });
  });
});

describe('ModelsDevApiResponseSchema', () => {
  it('validates complete API response', () => {
    const result = ModelsDevApiResponseSchema.safeParse(mockApiResponse);
    expect(result.success).toBe(true);
  });

  it('validates empty response', () => {
    const result = ModelsDevApiResponseSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('fails when provider has invalid model', () => {
    const badResponse = {
      test: {
        id: 'test',
        name: 'Test',
        env: ['KEY'],
        models: {
          'bad-model': invalidModelData,
        },
      },
    };
    const result = ModelsDevApiResponseSchema.safeParse(badResponse);
    expect(result.success).toBe(false);
  });
});

describe('LlxprtModelSchema', () => {
  it('validates transformed model structure', () => {
    const llxprtModel = {
      id: 'openai/gpt-4',
      name: 'GPT-4',
      provider: 'OpenAI',
      providerId: 'openai',
      providerName: 'OpenAI',
      modelId: 'gpt-4',
      supportedToolFormats: ['openai'],
      contextWindow: 128000,
      maxOutputTokens: 4096,
      capabilities: {
        vision: true,
        audio: false,
        pdf: false,
        toolCalling: true,
        reasoning: false,
        temperature: true,
        structuredOutput: true,
        attachment: true,
      },
      limits: {
        contextWindow: 128000,
        maxOutput: 4096,
      },
      metadata: {
        releaseDate: '2024-01-01',
        openWeights: false,
      },
      envVars: ['OPENAI_API_KEY'],
    };

    const result = LlxprtModelSchema.safeParse(llxprtModel);
    expect(result.success).toBe(true);
  });

  it('requires all capability booleans', () => {
    const modelMissingCaps = {
      id: 'test/model',
      name: 'Test',
      provider: 'Test',
      providerId: 'test',
      providerName: 'Test',
      modelId: 'model',
      supportedToolFormats: ['openai'],
      capabilities: {
        vision: true,
        // Missing other capabilities
      },
      limits: { contextWindow: 8000, maxOutput: 4000 },
      metadata: { releaseDate: '2024-01-01', openWeights: false },
      envVars: ['KEY'],
    };

    const result = LlxprtModelSchema.safeParse(modelMissingCaps);
    expect(result.success).toBe(false);
  });

  it('accepts optional pricing', () => {
    const modelWithPricing = {
      id: 'test/model',
      name: 'Test',
      provider: 'Test',
      providerId: 'test',
      providerName: 'Test',
      modelId: 'model',
      supportedToolFormats: ['openai'],
      capabilities: {
        vision: false,
        audio: false,
        pdf: false,
        toolCalling: true,
        reasoning: false,
        temperature: true,
        structuredOutput: false,
        attachment: false,
      },
      pricing: {
        input: 10,
        output: 30,
      },
      limits: { contextWindow: 8000, maxOutput: 4000 },
      metadata: { releaseDate: '2024-01-01', openWeights: false },
      envVars: ['KEY'],
    };

    const result = LlxprtModelSchema.safeParse(modelWithPricing);
    expect(result.success).toBe(true);
  });

  it('validates status enum mapping', () => {
    const modelWithStatus = {
      id: 'test/model',
      name: 'Test',
      provider: 'Test',
      providerId: 'test',
      providerName: 'Test',
      modelId: 'model',
      supportedToolFormats: ['openai'],
      capabilities: {
        vision: false,
        audio: false,
        pdf: false,
        toolCalling: false,
        reasoning: false,
        temperature: false,
        structuredOutput: false,
        attachment: false,
      },
      limits: { contextWindow: 8000, maxOutput: 4000 },
      metadata: {
        releaseDate: '2024-01-01',
        openWeights: false,
        status: 'stable',
      },
      envVars: ['KEY'],
    };

    const result = LlxprtModelSchema.safeParse(modelWithStatus);
    expect(result.success).toBe(true);
  });
});
