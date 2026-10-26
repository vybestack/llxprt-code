/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Freezes a module-level lookup table and every table it holds.
 *
 * These tables are process-wide static data: one caller appending to an entry,
 * or rewriting a mapping, would change behavior for every other caller.
 * Freezing makes such a write fail at the write instead of silently editing
 * shared state.
 *
 * Functions and class constructors are left alone. They are values these
 * tables reference, not data this module owns; freezing a shared tool class or
 * callback would stop its own module from decorating it.
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
