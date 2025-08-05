/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';

// Default limits
export const DEFAULT_MAX_TOKENS = 50000;
export const DEFAULT_TRUNCATE_MODE = 'warn';

// Simple token estimation - roughly 4 characters per token
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface OutputLimitConfig {
  maxTokens?: number;
  truncateMode?: 'warn' | 'truncate' | 'sample';
}

export interface TruncatedOutput {
  content: string;
  wasTruncated: boolean;
  originalTokens?: number;
  message?: string;
}

/**
 * Get output limit configuration from ephemeral settings
 */
export function getOutputLimits(config: Config): OutputLimitConfig {
  const ephemeralSettings = config.getEphemeralSettings();

  return {
    maxTokens:
      (ephemeralSettings['tool-output-max-tokens'] as number | undefined) ??
      DEFAULT_MAX_TOKENS,
    truncateMode:
      (ephemeralSettings['tool-output-truncate-mode'] as
        | 'warn'
        | 'truncate'
        | 'sample'
        | undefined) ?? DEFAULT_TRUNCATE_MODE,
  };
}

/**
 * Check if content exceeds token limit and handle according to truncate mode
 */
export function limitOutputTokens(
  content: string,
  config: Config,
  toolName: string,
): TruncatedOutput {
  const limits = getOutputLimits(config);
  const tokens = estimateTokens(content);

  if (!limits.maxTokens || tokens <= limits.maxTokens) {
    return {
      content,
      wasTruncated: false,
    };
  }

  // Content exceeds limit
  const originalTokens = tokens;

  if (limits.truncateMode === 'warn') {
    // Return empty content with warning message
    return {
      content: '',
      wasTruncated: true,
      originalTokens,
      message: `${toolName} output exceeded token limit (${originalTokens} > ${limits.maxTokens}). Please use more specific patterns to reduce output size.`,
    };
  } else if (limits.truncateMode === 'truncate') {
    // Truncate content to fit within limit
    const maxChars = limits.maxTokens * 4; // Rough estimate
    const truncatedContent = content.substring(0, maxChars);

    return {
      content: truncatedContent + '\n\n[Output truncated due to token limit]',
      wasTruncated: true,
      originalTokens,
      message: `Output truncated from ${originalTokens} to ${limits.maxTokens} tokens`,
    };
  } else {
    // 'sample' mode - for line-based content, sample evenly
    const lines = content.split('\n');
    if (lines.length > 1) {
      const targetLines = Math.floor(limits.maxTokens / 10); // Rough estimate of tokens per line
      const step = Math.ceil(lines.length / targetLines);
      const sampledLines: string[] = [];

      for (let i = 0; i < lines.length; i += step) {
        sampledLines.push(lines[i]);
        if (estimateTokens(sampledLines.join('\n')) > limits.maxTokens * 0.9) {
          break;
        }
      }

      return {
        content:
          sampledLines.join('\n') +
          `\n\n[Sampled ${sampledLines.length} of ${lines.length} lines due to token limit]`,
        wasTruncated: true,
        originalTokens,
        message: `Output sampled to fit within ${limits.maxTokens} token limit`,
      };
    } else {
      // Single line or non-line content, fall back to truncate
      const maxChars = limits.maxTokens * 4; // Rough estimate
      const truncatedContent = content.substring(0, maxChars);

      return {
        content: truncatedContent + '\n\n[Output truncated due to token limit]',
        wasTruncated: true,
        originalTokens,
        message: `Output truncated from ${originalTokens} to ${limits.maxTokens} tokens`,
      };
    }
  }
}

/**
 * Format output with truncation handling
 */
export function formatLimitedOutput(result: TruncatedOutput): {
  llmContent: string;
  returnDisplay: string;
} {
  if (!result.wasTruncated) {
    return {
      llmContent: result.content,
      returnDisplay: result.content,
    };
  }

  if (result.message && !result.content) {
    // Warn mode - no content
    return {
      llmContent: result.message,
      returnDisplay: `## Token Limit Exceeded\n\n${result.message}`,
    };
  }

  // Truncate or sample mode
  return {
    llmContent: result.content,
    returnDisplay:
      result.content + (result.message ? `\n\n## Note\n${result.message}` : ''),
  };
}
