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
 * Returns the first truthy string argument, or `''` if none are truthy.
 *
 * Mirrors the semantics of the `||` operator for string fallback chains so
 * that an empty string falls through to the next value (unlike `??`, which
 * only treats `null`/`undefined` as missing). Using this helper makes
 * empty-string-aware fallbacks explicit without local lint suppression.
 */
export function firstTruthyString(
  ...values: ReadonlyArray<string | undefined>
): string {
  for (const value of values) {
    if (value !== undefined && value !== '') {
      return value;
    }
  }
  return '';
}

/**
 * Returns the value if truthy, otherwise `undefined`.
 *
 * Mirrors the semantics of `value || undefined` for optional fields where
 * empty-string, `0`, or `false` should normalize to `undefined`.
 */
export function orUndefined<T>(
  value: T | '' | 0 | false | null,
): T | undefined {
  if (value === '' || value === 0 || value === false || value === null) {
    return undefined;
  }
  return value;
}
