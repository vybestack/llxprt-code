/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function testRegex(pattern: string, flags?: string): RegExp {
  return new RegExp(pattern, flags);
}
