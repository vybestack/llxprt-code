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
 * Get a short preview of a message's content for debug logging.
 *
 * Handles strings, arrays of content parts, and arbitrary objects.
 * Truncates to maxLength with an ellipsis when content exceeds the limit.
 */
export function getContentPreview(
  content: unknown,
  maxLength = 200,
): string | undefined {
  if (content === null || content === undefined) {
    return undefined;
  }

  if (typeof content === 'string') {
    if (content.length <= maxLength) {
      return content;
    }
    return `${content.slice(0, maxLength)}…`;
  }

  if (Array.isArray(content)) {
    const textParts = (content as unknown[]).map((part) => {
      if (
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        (part as { type?: string }).type === 'text'
      ) {
        return (part as { text?: string }).text ?? '';
      }
      try {
        return JSON.stringify(part);
      } catch {
        return '[unserializable part]';
      }
    });
    const joined = textParts.join('\n');
    if (joined.length <= maxLength) {
      return joined;
    }
    return `${joined.slice(0, maxLength)}…`;
  }

  try {
    const serialized = JSON.stringify(content);
    if (serialized.length <= maxLength) {
      return serialized;
    }
    return `${serialized.slice(0, maxLength)}…`;
  } catch {
    return '[unserializable content]';
  }
}
