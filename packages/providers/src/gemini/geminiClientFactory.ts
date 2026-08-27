/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeminiClient, GeminiClientOptions } from './geminiWireTypes.js';

/**
 * Constructs the Gemini client behind the narrow `GeminiClient` seam.
 *
 * The provider builds Gemini wire requests and parses Gemini wire responses
 * directly, so it needs only `generateContent` and `generateContentStream`.
 * Isolating construction here means the SDK underneath can be replaced without
 * touching the request-building, response-mapping or server-tool paths, which
 * no longer reference `@google/genai` types at all.
 *
 * The structural cast is required because the SDK's own parameter types are
 * narrower than the wire format it accepts: `contents` is declared as a union
 * of several convenience shapes, while this provider always passes the
 * canonical `Content[]`.
 */
export async function createGeminiClient(
  options: GeminiClientOptions,
): Promise<GeminiClient> {
  const { GoogleGenAI } = await import('@google/genai');
  // Returned as-is rather than reprojected onto `{ models }`: reading `.models`
  // here would make construction eager, and callers reach it lazily.
  return new GoogleGenAI(options) as unknown as GeminiClient;
}
