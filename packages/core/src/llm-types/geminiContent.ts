/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Neutral structural shapes for the Gemini-style content/part wire format.
 *
 * These types model only the fields that core's history conversion layer
 * references. They are structurally compatible with (but do not import)
 * {@link @google/genai} `Part` / `Content`, so providers that pass concrete
 * SDK objects continue to work via TypeScript structural assignability.
 */

/**
 * Structural equivalent of {@link @google/genai} `FunctionCall`.
 */
export interface GeminiFunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

/**
 * Structural equivalent of {@link @google/genai} `FunctionResponse`.
 */
export interface GeminiFunctionResponse {
  id?: string;
  name?: string;
  response?: Record<string, unknown>;
}

/**
 * Structural equivalent of {@link @google/genai} `Blob`.
 */
export interface GeminiInlineData {
  mimeType?: string;
  data?: string;
  displayName?: string;
}

/**
 * Provider-extension key stamped on thinking parts so the original
 * source field name survives a Gemini round-trip.
 */
export interface GeminiPartExtension {
  /**
   * Source field name for round-trip serialization.
   * Known values: 'reasoning_content', 'reasoning', 'thinking', 'thought', 'think_tags'.
   * May also contain arbitrary user-configured field names (issue #2488).
   */
  llxprtSourceField?: string;
}

/**
 * Neutral structural shape of a single Gemini content part.
 *
 * Only the fields consumed by core's history conversion are modeled.
 * Concrete SDK `Part` objects are structurally assignable to this type.
 */
export interface GeminiContentPart extends GeminiPartExtension {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
  inlineData?: GeminiInlineData;
}

/**
 * Neutral structural shape of a Gemini `Content` message.
 *
 * Concrete SDK `Content` objects are structurally assignable to this type.
 */
export interface GeminiContent {
  role?: string;
  parts?: GeminiContentPart[];
}
