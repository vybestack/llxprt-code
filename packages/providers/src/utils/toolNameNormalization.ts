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
  const normalized = (name || '').trim();

  // Strip Kimi-K2 style prefixes: "functions<name><digits>" or "call_functions<name><digits>"
  const kimiStripped = stripKimiPrefix(normalized);

  return kimiStripped.toLowerCase();
}

function stripKimiPrefix(name: string): string {
  const lower = name.toLowerCase();
  let rest: string | null = null;
  if (lower.startsWith('call_functions')) {
    rest = name.slice('call_functions'.length);
  } else if (lower.startsWith('functions')) {
    rest = name.slice('functions'.length);
  }
  if (rest === null || rest.length === 0) return name;
  // Strip trailing digits
  let end = rest.length;
  while (
    end > 0 &&
    rest.charCodeAt(end - 1) >= 48 &&
    rest.charCodeAt(end - 1) <= 57
  ) {
    end--;
  }
  if (end === rest.length) return name;
  const trimmed = rest.slice(0, end);
  return trimmed.length > 0 ? trimmed : name;
}
