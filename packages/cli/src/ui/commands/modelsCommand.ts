/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import {
  getModelsRegistry,
  initializeModelsRegistry,
  type LlxprtModel,
} from '@vybestack/llxprt-code-core';

/**
 * Format model info for display
 */
function formatModel(model: LlxprtModel, verbose = false): string {
  const parts: string[] = [];

  // Basic info
  parts.push(`${model.id}`);
  if (model.name !== model.id && model.name !== model.modelId) {
    parts.push(`(${model.name})`);
  }

  // Context window
  if (model.contextWindow) {
    parts.push(`ctx:${formatNumber(model.contextWindow)}`);
  }

  // Capabilities
  const caps: string[] = [];
  if (model.capabilities?.toolCalling) caps.push('tools');
  if (model.capabilities?.reasoning) caps.push('reasoning');
  if (model.capabilities?.vision) caps.push('vision');
  if (caps.length > 0) {
    parts.push(`[${caps.join(',')}]`);
  }

  if (verbose && model.pricing?.input !== undefined) {
    parts.push(`$${model.pricing.input}/1M`);
  }

  return parts.join(' ');
}

/**
 * Format large numbers with K/M suffixes
 */
function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

/**
 * Parse command arguments
 */
function parseArgs(args: string): {
  provider?: string;
  search?: string;
  reasoning?: boolean;
  tools?: boolean;
  verbose?: boolean;
  limit?: number;
} {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const result: ReturnType<typeof parseArgs> = {};

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '--provider' || part === '-p') {
      result.provider = parts[++i];
    } else if (part === '--reasoning' || part === '-r') {
      result.reasoning = true;
    } else if (part === '--tools' || part === '-t') {
      result.tools = true;
    } else if (part === '--verbose' || part === '-v') {
      result.verbose = true;
    } else if (part === '--limit' || part === '-l') {
      result.limit = parseInt(parts[++i], 10);
    } else if (!part.startsWith('-')) {
      result.search = part;
    }
  }

  return result;
}

export const modelsCommand: SlashCommand = {
  name: 'models',
  description: 'list and search models from registry',
  kind: CommandKind.BUILT_IN,
  action: async (
    _context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    try {
      // Initialize registry if needed
      await initializeModelsRegistry();
      const registry = getModelsRegistry();

      // Parse arguments
      const { provider, search, reasoning, tools, verbose, limit } =
        parseArgs(args);

      // Get models
      let models = registry.getAll();

      // Filter by provider
      if (provider) {
        models = models.filter(
          (m) =>
            m.providerId === provider ||
            m.provider.toLowerCase().includes(provider.toLowerCase()),
        );
      }

      // Filter by search term
      if (search) {
        const term = search.toLowerCase();
        models = models.filter(
          (m) =>
            m.id.toLowerCase().includes(term) ||
            m.name.toLowerCase().includes(term) ||
            m.modelId.toLowerCase().includes(term),
        );
      }

      // Filter by capabilities
      if (reasoning) {
        models = models.filter((m) => m.capabilities?.reasoning);
      }
      if (tools) {
        models = models.filter((m) => m.capabilities?.toolCalling);
      }

      // Filter deprecated
      models = models.filter((m) => m.metadata?.status !== 'deprecated');

      // Sort by provider then name
      models.sort((a, b) => {
        if (a.providerId !== b.providerId) {
          return a.providerId.localeCompare(b.providerId);
        }
        return a.name.localeCompare(b.name);
      });

      // Apply limit
      const displayLimit = limit ?? 25;
      const totalCount = models.length;
      const displayed = models.slice(0, displayLimit);

      if (displayed.length === 0) {
        return {
          type: 'message',
          messageType: 'info',
          content: 'No models found matching criteria.',
        };
      }

      // Group by provider for display
      const byProvider = new Map<string, LlxprtModel[]>();
      for (const model of displayed) {
        const existing = byProvider.get(model.providerId) || [];
        existing.push(model);
        byProvider.set(model.providerId, existing);
      }

      // Format output
      const lines: string[] = [];
      for (const [providerId, providerModels] of byProvider) {
        lines.push(`\n## ${providerId}`);
        for (const model of providerModels) {
          lines.push(`  ${formatModel(model, verbose)}`);
        }
      }

      if (totalCount > displayLimit) {
        lines.push(
          `\n... and ${totalCount - displayLimit} more (use --limit N to see more)`,
        );
      }

      lines.push(`\nTotal: ${totalCount} models`);
      lines.push(
        '\nUsage: /models [search] [--provider NAME] [--reasoning] [--tools] [--verbose] [--limit N]',
      );

      return {
        type: 'message',
        messageType: 'info',
        content: lines.join('\n'),
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to list models: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
