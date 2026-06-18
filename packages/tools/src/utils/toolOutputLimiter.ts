/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ToolOutputSettingsProvider {
  getEphemeralSettings(): Record<string, unknown>;
}

export const DEFAULT_MAX_TOKENS = 50000;
export const DEFAULT_TRUNCATE_MODE = 'warn';
export const ESCAPE_BUFFER_PERCENTAGE = 0.8;

export interface TruncatedOutput {
  content: string;
  wasTruncated: boolean;
  originalTokens?: number;
  message?: string;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function getEffectiveTokenLimit(maxTokens: number): number {
  return Math.floor(maxTokens * ESCAPE_BUFFER_PERCENTAGE);
}

export interface OutputLimitConfig {
  maxTokens?: number;
  truncateMode?: 'warn' | 'truncate' | 'sample';
}

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

function shouldSkipTruncation(
  rawMaxTokens: unknown,
  maxTokens: number,
  tokens: number,
  effectiveLimit: number,
): boolean {
  const skipConditions = [
    rawMaxTokens === false,
    rawMaxTokens === '',
    maxTokens === 0,
    Number.isNaN(maxTokens),
    tokens <= effectiveLimit,
  ];
  return skipConditions.some((condition) => condition);
}

function truncateWarn(
  originalTokens: number,
  effectiveLimit: number,
  toolName: string,
): TruncatedOutput {
  return {
    content: '',
    wasTruncated: true,
    originalTokens,
    message: `${toolName} output exceeded token limit (${originalTokens} > ${effectiveLimit}). The results were found but are too large to display. Please:\n1. Use more specific search patterns or file paths to narrow results\n2. Search for specific function/class names instead of generic terms\n3. Look in specific directories rather than the entire codebase\n4. Use exact match patterns when possible`,
  };
}

function truncateHard(
  content: string,
  originalTokens: number,
  effectiveLimit: number,
): TruncatedOutput {
  const approxChars = Math.floor(
    content.length * (effectiveLimit / originalTokens),
  );
  return {
    content: `${content.slice(0, Math.max(0, approxChars))}\n\n[Output truncated due to token limit]`,
    wasTruncated: true,
    originalTokens,
    message: `Output truncated from ${originalTokens} to ${effectiveLimit} tokens`,
  };
}

function sampleLines(
  content: string,
  originalTokens: number,
  effectiveLimit: number,
  maxTokens: number | undefined,
): TruncatedOutput {
  const lines = content.split('\n');
  if (lines.length > 1) {
    const targetLines = Math.max(1, Math.floor(effectiveLimit / 10));
    const step = Math.ceil(lines.length / targetLines);
    const sampledLines: string[] = [];

    for (let i = 0; i < lines.length; i += step) {
      const candidateLines = [...sampledLines, lines[i]];
      if (estimateTokens(candidateLines.join('\n')) > effectiveLimit) {
        break;
      }
      sampledLines.push(lines[i]);
    }

    if (sampledLines.length > 0) {
      return {
        content:
          sampledLines.join('\n') +
          `\n\n[Sampled ${sampledLines.length} of ${lines.length} lines due to token limit]`,
        wasTruncated: true,
        originalTokens,
        message: `Output sampled to fit within ${maxTokens} token limit`,
      };
    }
  }

  return truncateHard(content, originalTokens, effectiveLimit);
}

export function limitOutputTokens(
  content: string,
  config: ToolOutputSettingsProvider,
  toolName: string,
): TruncatedOutput {
  const limits = getOutputLimits(config);
  const maxTokens = limits.maxTokens ?? DEFAULT_MAX_TOKENS;
  const rawMaxTokens = limits.maxTokens as unknown;
  const effectiveLimit = getEffectiveTokenLimit(maxTokens);
  const tokens = estimateTokens(content);

  if (shouldSkipTruncation(rawMaxTokens, maxTokens, tokens, effectiveLimit)) {
    return { content, wasTruncated: false };
  }

  if (limits.truncateMode === 'warn') {
    return truncateWarn(tokens, effectiveLimit, toolName);
  }
  if (limits.truncateMode === 'truncate') {
    return truncateHard(content, tokens, effectiveLimit);
  }

  return sampleLines(content, tokens, effectiveLimit, limits.maxTokens);
}

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
    return {
      llmContent: result.message,
      returnDisplay: `## Token Limit Exceeded\n\n${result.message}`,
    };
  }

  return {
    llmContent: result.content,
    returnDisplay:
      result.content + (result.message ? `\n\n## Note\n${result.message}` : ''),
  };
}
