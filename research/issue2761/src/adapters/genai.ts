/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `@google/genai` side of every probe.
 *
 * Mirrors what `GeminiProvider.createNonOAuthGenerator` /
 * `buildGoogleGenAIOptions` do today: construct a `GoogleGenAI` with an API
 * key plus `httpOptions` (headers, optional baseUrl) and call
 * `models.generateContent` / `models.generateContentStream`.
 */

import { GoogleGenAI, type GoogleGenAIOptions } from '@google/genai';

export interface GenAIClientOptions {
  readonly baseUrl?: string;
  readonly headers?: Record<string, string>;
}

/** The User-Agent llxprt stamps on every Gemini call today. */
export function llxprtUserAgent(): string {
  return `LLxprt-Code/probe-2761 (${process.platform}; ${process.arch})`;
}

export function createGenAI(
  apiKey: string,
  options: GenAIClientOptions = {},
): GoogleGenAI {
  const httpOptions: NonNullable<GoogleGenAIOptions['httpOptions']> = {
    headers: {
      'User-Agent': llxprtUserAgent(),
      ...(options.headers ?? {}),
    },
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
  };
  return new GoogleGenAI({ apiKey, vertexai: false, httpOptions });
}
