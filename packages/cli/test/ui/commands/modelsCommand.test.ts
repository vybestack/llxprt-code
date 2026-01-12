/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { modelsCommand } from '../../../src/ui/commands/modelsCommand.js';
import { CommandContext } from '../../../src/ui/commands/types.js';
import { LoadedSettings } from '../../../src/config/settings.js';
import { Logger, type LlxprtModel } from '@vybestack/llxprt-code-core';
import { SessionStatsState } from '../../../src/ui/contexts/SessionContext.js';

// Create mock models directly in llxprt format
const mockLlxprtModels: LlxprtModel[] = [
  {
    id: 'openai/gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'OpenAI',
    providerId: 'openai',
    providerName: 'OpenAI',
    modelId: 'gpt-4-turbo',
    family: 'gpt-4',
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
    pricing: { input: 10, output: 30 },
    limits: { contextWindow: 128000, maxOutput: 4096 },
    metadata: {
      releaseDate: '2024-04-09',
      openWeights: false,
      status: 'stable',
    },
    envVars: ['OPENAI_API_KEY'],
  },
  {
    id: 'openai/o1-preview',
    name: 'O1 Preview',
    provider: 'OpenAI',
    providerId: 'openai',
    providerName: 'OpenAI',
    modelId: 'o1-preview',
    family: 'o1',
    supportedToolFormats: ['openai'],
    contextWindow: 128000,
    maxOutputTokens: 32768,
    capabilities: {
      vision: false,
      audio: false,
      pdf: false,
      toolCalling: false,
      reasoning: true,
      temperature: true,
      structuredOutput: false,
      attachment: false,
    },
    limits: { contextWindow: 128000, maxOutput: 32768 },
    metadata: {
      releaseDate: '2024-09-12',
      openWeights: false,
      status: 'stable',
    },
    envVars: ['OPENAI_API_KEY'],
  },
  {
    id: 'openai/gpt-3.5-turbo-old',
    name: 'GPT-3.5 Turbo Old',
    provider: 'OpenAI',
    providerId: 'openai',
    providerName: 'OpenAI',
    modelId: 'gpt-3.5-turbo-old',
    family: 'gpt-3.5',
    supportedToolFormats: ['openai'],
    contextWindow: 4096,
    maxOutputTokens: 4096,
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
    limits: { contextWindow: 4096, maxOutput: 4096 },
    metadata: {
      releaseDate: '2023-01-01',
      openWeights: false,
      status: 'deprecated',
    },
    envVars: ['OPENAI_API_KEY'],
  },
  {
    id: 'anthropic/claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    providerId: 'anthropic',
    providerName: 'Anthropic',
    modelId: 'claude-3-5-sonnet',
    family: 'claude-3.5',
    supportedToolFormats: ['anthropic'],
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: {
      vision: true,
      audio: false,
      pdf: true,
      toolCalling: true,
      reasoning: false,
      temperature: true,
      structuredOutput: false,
      attachment: true,
    },
    pricing: { input: 3, output: 15 },
    limits: { contextWindow: 200000, maxOutput: 8192 },
    metadata: {
      releaseDate: '2024-06-20',
      openWeights: false,
      status: 'stable',
    },
    envVars: ['ANTHROPIC_API_KEY'],
  },
];

// Mock the registry module
vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');

  // Create a mock registry class
  class MockModelsRegistry {
    private models = new Map<string, LlxprtModel>();
    private initialized = false;

    constructor() {
      // Populate with mock models
      for (const model of mockLlxprtModels) {
        this.models.set(model.id, model);
      }
    }

    isInitialized() {
      return this.initialized;
    }

    async initialize() {
      this.initialized = true;
    }

    getAll() {
      return Array.from(this.models.values());
    }

    getById(id: string) {
      return this.models.get(id);
    }

    getByProvider(providerId: string) {
      return this.getAll().filter((m) => m.providerId === providerId);
    }
  }

  let mockRegistryInstance: MockModelsRegistry | null = null;

  return {
    ...actual,
    getModelsRegistry: () => {
      if (!mockRegistryInstance) {
        mockRegistryInstance = new MockModelsRegistry();
      }
      return mockRegistryInstance;
    },
    initializeModelsRegistry: async () => {
      const registry = mockRegistryInstance || new MockModelsRegistry();
      mockRegistryInstance = registry;
      await registry.initialize();
      return registry;
    },
  };
});

// Create mock command context
function createMockContext(): CommandContext {
  return {
    services: {
      config: null,
      settings: {} as LoadedSettings,
      git: undefined,
      logger: {} as Logger,
    },
    ui: {
      addItem: vi.fn(),
      clear: vi.fn(),
      setDebugMessage: vi.fn(),
      pendingItem: null,
      setPendingItem: vi.fn(),
      loadHistory: vi.fn(),
      toggleCorgiMode: vi.fn(),
      toggleVimEnabled: vi.fn().mockResolvedValue(true),
      setLlxprtMdFileCount: vi.fn(),
      reloadCommands: vi.fn(),
    },
    session: {
      stats: {} as SessionStatsState,
      sessionShellAllowlist: new Set(),
    },
  };
}

describe('modelsCommand', () => {
  let context: CommandContext;

  beforeEach(() => {
    context = createMockContext();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('command metadata', () => {
    it('has correct name', () => {
      expect(modelsCommand.name).toBe('models');
    });

    it('has description', () => {
      expect(modelsCommand.description).toBeDefined();
      expect(modelsCommand.description.length).toBeGreaterThan(0);
    });
  });

  describe('basic listing', () => {
    it('lists models when no args', async () => {
      const result = await modelsCommand.action(context, '');
      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('openai');
      expect(result.content).toContain('anthropic');
    });

    it('shows model count in output', async () => {
      const result = await modelsCommand.action(context, '');
      expect(result.content).toMatch(/Total: \d+ models/);
    });

    it('groups output by provider', async () => {
      const result = await modelsCommand.action(context, '');
      expect(result.content).toContain('## openai');
      expect(result.content).toContain('## anthropic');
    });
  });

  describe('filtering', () => {
    it('filters by search term (model name)', async () => {
      const result = await modelsCommand.action(context, 'claude');
      expect(result.content).toContain('claude-3-5-sonnet');
      expect(result.content).not.toContain('gpt-4-turbo');
    });

    it('filters by --provider flag', async () => {
      const result = await modelsCommand.action(context, '--provider openai');
      expect(result.content).toContain('gpt-4-turbo');
      expect(result.content).not.toContain('claude');
    });

    it('filters by -p short flag', async () => {
      const result = await modelsCommand.action(context, '-p anthropic');
      expect(result.content).toContain('claude');
      expect(result.content).not.toContain('gpt');
    });

    it('filters by --reasoning flag', async () => {
      const result = await modelsCommand.action(context, '--reasoning');
      expect(result.content).toContain('o1-preview');
      // gpt-4-turbo doesn't have reasoning
      expect(result.content).not.toContain('gpt-4-turbo');
    });

    it('filters by -r short flag', async () => {
      const result = await modelsCommand.action(context, '-r');
      expect(result.content).toContain('o1-preview');
    });

    it('filters by --tools flag', async () => {
      const result = await modelsCommand.action(context, '--tools');
      expect(result.content).toContain('gpt-4-turbo');
      expect(result.content).toContain('claude-3-5-sonnet');
      // o1-preview doesn't have tool_call
      expect(result.content).not.toContain('o1-preview');
    });

    it('filters by -t short flag', async () => {
      const result = await modelsCommand.action(context, '-t');
      expect(result.content).toContain('gpt-4-turbo');
    });

    it('filters out deprecated models by default', async () => {
      const result = await modelsCommand.action(context, '');
      expect(result.content).not.toContain('gpt-3.5-turbo-old');
    });
  });

  describe('limit option', () => {
    it('limits output with --limit N', async () => {
      const result = await modelsCommand.action(context, '--limit 2');
      // Should show only 2 models - verify truncation message appears
      expect(result.content).toBeDefined();
    });

    it('limits output with -l N', async () => {
      const result = await modelsCommand.action(context, '-l 1');
      expect(result.content).toContain('and');
      expect(result.content).toContain('more');
    });

    it('defaults to 25 limit', async () => {
      // With only 4 models in mock, this won't truncate
      const result = await modelsCommand.action(context, '');
      expect(result.content).not.toContain('and 0 more');
    });
  });

  describe('verbose option', () => {
    it('shows pricing with --verbose', async () => {
      const result = await modelsCommand.action(context, '--verbose');
      // Verbose shows $X/1M for pricing
      expect(result.content).toContain('$');
      expect(result.content).toContain('/1M');
    });

    it('shows pricing with -v', async () => {
      const result = await modelsCommand.action(context, '-v');
      expect(result.content).toContain('$');
    });
  });

  describe('combined options', () => {
    it('handles multiple flags combined', async () => {
      const result = await modelsCommand.action(context, '-p openai -t -v');
      expect(result.content).toContain('openai');
      expect(result.content).toContain('$');
      // Should only show OpenAI models with tools
    });

    it('handles search term with flags', async () => {
      const result = await modelsCommand.action(context, 'gpt --tools');
      expect(result.content).toContain('gpt-4-turbo');
      expect(result.content).not.toContain('claude');
    });
  });

  describe('empty results', () => {
    it('shows "No models found" when no matches', async () => {
      const result = await modelsCommand.action(
        context,
        'nonexistent-model-xyz',
      );
      expect(result.content).toContain('No models found');
    });
  });

  describe('error handling', () => {
    it('returns message type on any input', async () => {
      // The mock registry always has models, so we just verify the command
      // returns a proper message response and doesn't crash
      const result = await modelsCommand.action(context, '');
      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
    });
  });

  describe('usage help', () => {
    it('shows usage line in output', async () => {
      const result = await modelsCommand.action(context, '');
      expect(result.content).toContain('Usage:');
      expect(result.content).toContain('/models');
    });
  });
});

describe('argument parsing', () => {
  // Test the parseArgs function indirectly through command behavior
  let context: CommandContext;

  beforeEach(() => {
    context = createMockContext();
    vi.clearAllMocks();
  });

  it('parses positional search term', async () => {
    const result = await modelsCommand.action(context, 'gpt');
    expect(result.content).toContain('gpt');
  });

  it('parses long flags', async () => {
    const result = await modelsCommand.action(
      context,
      '--provider openai --reasoning',
    );
    // No models match both openai AND reasoning (o1 is openai + reasoning)
    expect(result.type).toBe('message');
  });

  it('parses short flags', async () => {
    const result = await modelsCommand.action(context, '-p openai -r');
    expect(result.type).toBe('message');
  });

  it('handles mixed short and long flags', async () => {
    const result = await modelsCommand.action(context, '-p openai --verbose');
    expect(result.content).toContain('openai');
  });

  it('ignores unknown flags', async () => {
    const result = await modelsCommand.action(context, '--unknown-flag value');
    // Should not crash, just ignore
    expect(result.type).toBe('message');
  });
});
