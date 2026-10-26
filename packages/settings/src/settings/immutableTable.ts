/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Freezes a module-level lookup table and every table it holds, so a reader
 * that receives the registry cannot rewrite it on behalf of the whole process.
 *
 * The settings registry is static data shared by every consumer: one caller
 * appending to an entry's `enumValues` would change what every other caller
 * validates and what every provider request sends. Freezing makes such a write
 * fail at the write instead of silently editing shared state.
 *
 * Functions are left alone. A callback held in a table is a value this table
 * stores, not data this module owns; freezing it would reach into a callable
 * that other code may legitimately decorate.
 */
export function deepFreezeTable<T>(table: T): T {
  if (typeof table === 'function') {
    return table;
  }
  if (Array.isArray(table)) {
    for (const entry of table) {
      deepFreezeTable(entry);
    }
  } else if (typeof table === 'object' && table !== null) {
    for (const member of Object.values(table as Record<string, unknown>)) {
      deepFreezeTable(member);
    }
  }
  return Object.freeze(table);
}
