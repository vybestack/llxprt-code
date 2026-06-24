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
 * Normalize tool name by stripping Kimi-K2 style prefixes.
 *
 * Handles malformed tool names where the model concatenates prefixes like
 * "functions" or "call_functions" with the actual tool name:
 * - "functionslist_directory" -> "list_directory"
 * - "call_functionslist_directory6" -> "list_directory"
 * - "call_functionsglob7" -> "glob"
 */
export function normalizeToolName(name: string): string {
  let normalized = (name || '').trim();

  const kimiPrefixMatch = /^(?:call_)?functions([a-z_]+[a-z])(\d*)$/i.exec(
    normalized,
  );
  if (kimiPrefixMatch) {
    normalized = kimiPrefixMatch[1];
  }

  return normalized.toLowerCase();
}
