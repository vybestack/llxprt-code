/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { encoding_for_model } from '@dqbd/tiktoken';
import { TextDecoder } from 'node:util';

export interface ToolOutputSettingsProvider {
  getEphemeralSettings(): Record<string, unknown>;
}

// Default limits
export const DEFAULT_MAX_TOKENS = 50000;
export const DEFAULT_TRUNCATE_MODE = 'warn';

export interface MiddleClipResult {
  content: string;
  wasTruncated: boolean;
  originalLength: number;
}

// Escape overhead buffer to account for JSON stringification inflation
export const ESCAPE_BUFFER_PERCENTAGE = 0.8; // Use 80% of limit to leave 20% buffer

let cachedEncoder: ReturnType<typeof encoding_for_model> | null = null;
let encoderInitFailed = false;
const utf8Decoder = new TextDecoder();
const isWindows = process.platform === 'win32';

function getEncoder(): ReturnType<typeof encoding_for_model> | null {
  if (encoderInitFailed) {
    return null;
  }

  if (!cachedEncoder) {
    try {
      cachedEncoder = encoding_for_model('gpt-4o');
      if (!isWindows) {
        process.once('exit', () => {
          cachedEncoder?.free();
        });
      }
    } catch (_error) {
      encoderInitFailed = true;
      return null;
    }
  }

  return cachedEncoder;
}

function encodeText(text: string): Uint32Array | null {
  const encoder = getEncoder();
  if (!encoder) {
    return null;
  }

  try {
    return encoder.encode(text);
  } catch (_error) {
    return null;
  }
}

// Token estimation using tiktoken for better accuracy
export function estimateTokens(text: string): number {
  const encoded = encodeText(text);

  if (encoded) {
    return encoded.length;
  }

  // Fallback to simple heuristic if tiktoken fails.
  return Math.ceil(text.length / 3);
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
 * Clip text by removing the middle while preserving configurable head/tail.
 * Useful for console-style output where both the start (setup/context)
 * and end (results/errors) are important.
 */
export function clipMiddle(
  content: string,
  maxChars: number,
  headRatio: number,
  tailRatio: number,
): MiddleClipResult {
  const length = content.length;

  if (maxChars <= 0 || length <= maxChars) {
    return {
      content,
      wasTruncated: false,
      originalLength: length,
    };
  }

  const totalRatio = headRatio + tailRatio;
  const safeTotalRatio = totalRatio > 0 ? totalRatio : 1;
  const headPortion = Math.max(
    0,
    Math.floor((headRatio / safeTotalRatio) * maxChars),
  );
  const tailPortion = Math.max(
    0,
    Math.floor((tailRatio / safeTotalRatio) * maxChars),
  );

  const adjustedTailPortion = Math.min(tailPortion, maxChars - headPortion);
  const adjustedHeadPortion = Math.min(
    headPortion,
    maxChars - adjustedTailPortion,
  );

  const head = content.slice(0, adjustedHeadPortion);
  const tail = content.slice(length - adjustedTailPortion);

  const marker = `
...[middle clipped due to token limits]...
`;

  return {
    content: `${head}${marker}${tail}`,
    wasTruncated: true,
    originalLength: length,
  };
}

/**
 * Get output limit configuration from ephemeral settings
 */
export function getOutputLimits(
  config: ToolOutputSettingsProvider,
): OutputLimitConfig {
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
  config: ToolOutputSettingsProvider,
  toolName: string,
): TruncatedOutput {
  const limits = getOutputLimits(config);
  const maxTokens = limits.maxTokens ?? DEFAULT_MAX_TOKENS;
  const effectiveLimit = getEffectiveTokenLimit(maxTokens);

  const encodedContent = encodeText(content);
  const tokens = encodedContent?.length ?? Math.ceil(content.length / 3);

  if (!maxTokens || tokens <= effectiveLimit) {
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
      message: `${toolName} output exceeded token limit (${originalTokens} > ${effectiveLimit}). The results were found but are too large to display. Please:
1. Use more specific search patterns or file paths to narrow results
2. Search for specific function/class names instead of generic terms
3. Look in specific directories rather than the entire codebase
4. Use exact match patterns when possible`,
    };
  } else if (limits.truncateMode === 'truncate') {
    // Truncate content to fit within effective limit (accounting for escape buffer)
    const encoder = getEncoder();
    const targetTokenCount = Math.max(0, Math.min(effectiveLimit, tokens));

    let truncatedContent = '';
    let truncatedTokenCount = 0;

    if (encodedContent && encoder) {
      const truncatedTokens = encodedContent.subarray(0, targetTokenCount);
      truncatedContent = utf8Decoder.decode(encoder.decode(truncatedTokens));
      truncatedTokenCount = truncatedTokens.length;
    } else {
      const ratio =
        originalTokens > 0 ? Math.min(1, targetTokenCount / originalTokens) : 0;
      const approxChars = Math.floor(content.length * ratio);
      truncatedContent = content.slice(0, approxChars);
      truncatedTokenCount = Math.ceil(truncatedContent.length / 3);
    }

    return {
      content: `${truncatedContent}\n\n[Output truncated due to token limit]`,
      wasTruncated: true,
      originalTokens,
      message: `Output truncated from ${originalTokens} to ${truncatedTokenCount} tokens`,
    };
  } else {
    // 'sample' mode - for line-based content, sample evenly
    const lines = content.split('\n');
    if (lines.length > 1) {
      const targetLines = Math.max(1, Math.floor(effectiveLimit / 10)); // Rough estimate of tokens per line
      const step = Math.ceil(lines.length / targetLines);
      const sampledLines: string[] = [];

      for (let i = 0; i < lines.length; i += step) {
        sampledLines.push(lines[i]);
        if (estimateTokens(sampledLines.join('\n')) > effectiveLimit) {
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
      const encoder = getEncoder();
      const targetTokenCount = Math.max(0, Math.min(effectiveLimit, tokens));

      let truncatedContent = '';
      let truncatedTokenCount = 0;

      if (encodedContent && encoder) {
        const truncatedTokens = encodedContent.subarray(0, targetTokenCount);
        truncatedContent = utf8Decoder.decode(encoder.decode(truncatedTokens));
        truncatedTokenCount = truncatedTokens.length;
      } else {
        const ratio =
          originalTokens > 0
            ? Math.min(1, targetTokenCount / originalTokens)
            : 0;
        const approxChars = Math.floor(content.length * ratio);
        truncatedContent = content.slice(0, approxChars);
        truncatedTokenCount = Math.ceil(truncatedContent.length / 3);
      }

      return {
        content: `${truncatedContent}\n\n[Output truncated due to token limit]`,
        wasTruncated: true,
        originalTokens,
        message: `Output truncated from ${originalTokens} to ${truncatedTokenCount} tokens`,
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
