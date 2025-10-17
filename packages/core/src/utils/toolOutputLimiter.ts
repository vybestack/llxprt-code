/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { encoding_for_model } from '@dqbd/tiktoken';
import { Config } from '../config/config.js';

// Default limits
export const DEFAULT_MAX_TOKENS = 50000;
export const DEFAULT_TRUNCATE_MODE = 'warn';

// Escape overhead buffer to account for JSON stringification inflation
export const ESCAPE_BUFFER_PERCENTAGE = 0.8; // Use 80% of limit to leave 20% buffer

// Token estimation using tiktoken for better accuracy

export function estimateTokens(text: string): number {
  try {
    const encoder = encoding_for_model('gpt-4o');
    try {
      return encoder.encode(text).length;
    } finally {
      encoder.free();
    }
  } catch (_error) {
    // Fallback to simple heuristic if tiktoken fails
    // This is the OLD heuristic that badly underestimates short-line-heavy or binary-ish output
    // return Math.ceil(text.length / 4);

    // NEW heuristic: more accurate for typical code/text content
    // Roughly estimate 3 characters per token for a better baseline
    return Math.ceil(text.length / 3);
  }
}

export function estimateTokensWithEscapeBuffer(text: string): number {
  // Estimate tokens for the content that will be JSON-escaped
  const escapedText = JSON.stringify(text);
  return estimateTokens(escapedText);
}

export function getEffectiveTokenLimit(maxTokens: number): number {
  return Math.floor(maxTokens * ESCAPE_BUFFER_PERCENTAGE);
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
 * Uses escape buffer to account for JSON stringification inflation
 */
export function limitOutputTokens(
  content: string,
  config: Config,
  toolName: string,
): TruncatedOutput {
  const limits = getOutputLimits(config);
  const tokens = estimateTokensWithEscapeBuffer(content);

  if (!limits.maxTokens || tokens <= limits.maxTokens) {
    return {
      content,
      wasTruncated: false,
    };
  }

  // Content exceeds limit (after accounting for escape buffer)
  const originalTokens = tokens;

  if (limits.truncateMode === 'warn') {
    // Return empty content with warning message
    return {
      content: '',
      wasTruncated: true,
      originalTokens,
      message: `${toolName} output exceeded token limit (${originalTokens} > ${limits.maxTokens}). The results were found but are too large to display. Please:
1. Use more specific search patterns or file paths to narrow results
2. Search for specific function/class names instead of generic terms
3. Look in specific directories rather than the entire codebase
4. Use exact match patterns when possible`,
    };
  } else if (limits.truncateMode === 'truncate') {
    // Truncate content to fit within effective limit (accounting for escape buffer)
    // Use binary search to find the right truncation point
    let low = 0;
    let high = content.length;
    let bestContent = '';

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidateContent = content.substring(0, mid);
      const candidateTokens = estimateTokensWithEscapeBuffer(candidateContent);

      if (candidateTokens <= limits.maxTokens) {
        bestContent = candidateContent;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return {
      content: bestContent + '\n\n[Output truncated due to token limit]',
      wasTruncated: true,
      originalTokens,
      message: `Output truncated from ${originalTokens} to ${estimateTokensWithEscapeBuffer(bestContent)} tokens`,
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
      // Single line or non-line content, fall back to truncate with escape buffer
      let low = 0;
      let high = content.length;
      let bestContent = '';

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidateContent = content.substring(0, mid);
        const candidateTokens =
          estimateTokensWithEscapeBuffer(candidateContent);

        if (candidateTokens <= limits.maxTokens) {
          bestContent = candidateContent;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      return {
        content: bestContent + '\n\n[Output truncated due to token limit]',
        wasTruncated: true,
        originalTokens,
        message: `Output truncated from ${originalTokens} to ${estimateTokensWithEscapeBuffer(bestContent)} tokens`,
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
