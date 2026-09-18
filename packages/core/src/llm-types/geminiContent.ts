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
 * Only the inbound parse direction survives here: these types model the
 * fields consumed by core's history conversion layer (the
 * `ContentConverters.toIContent`/`toIContents` parse surface,
 * `geminiResponseMapper`, history/session loading). They are structurally
 * compatible with (but do not import) the provider wire `Part`/`Content`
 * shapes, so concrete wire objects continue to work via TypeScript
 * structural assignability.
 *
 * The outbound request direction was deleted with its converter surface
 * (#2628); the member shapes only it referenced (FunctionCall,
 * FunctionResponse, InlineData, the standalone part-extension interface)
 * were folded into the part shape below.
 */

/**
 * Neutral structural shape of a single Gemini content part.
 *
 * Only the fields consumed by core's history conversion are modeled.
 * Concrete wire `Part` objects are structurally assignable to this type.
 */
export interface GeminiContentPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    id?: string;
    name?: string;
    response?: Record<string, unknown>;
  };
  inlineData?: {
    mimeType?: string;
    data?: string;
    displayName?: string;
  };
  /**
   * Source field name for round-trip serialization.
   * Known values: 'reasoning_content', 'reasoning', 'thinking', 'thought', 'think_tags'.
   * May also contain arbitrary user-configured field names (issue #2488).
   */
  llxprtSourceField?: string;
  llxprtThoughtBlockId?: string;
  llxprtThoughtBlockStatus?: 'delta' | 'complete';
  llxprtThoughtIsHidden?: boolean;
  /**
   * Part-level discriminant stamped alongside a failed-tool `functionResponse`
   * so the inbound decoder only fires on parts we encoded (issue #3076).
   * Without it a SUCCESSFUL tool whose result happens to be shaped like
   * `{ status: 'error', error: ... }` would be misdecoded into a failure.
   */
  llxprtToolFailure?: boolean;
}

/**
 * Neutral structural shape of a Gemini `Content` message.
 *
 * Concrete wire `Content` objects are structurally assignable to this type.
 */
export interface GeminiContent {
  role?: string;
  parts?: GeminiContentPart[];
}
