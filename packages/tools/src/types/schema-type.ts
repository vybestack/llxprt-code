/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local replica of the {@link @google/genai} `Type` enum string values.
 *
 * The runtime values are identical to those produced by `@google/genai`
 * so that schemas serialized to the wire format are byte-for-byte
 * preserved after migration. This is a string enum (not const enum) so
 * that `Type.STRING` and `'STRING'` are interchangeable at the type level.
 *
 * Example: `{ type: Type.OBJECT }` serializes to `{ type: 'OBJECT' }`.
 */

export enum Type {
  TYPE_UNSPECIFIED = 'TYPE_UNSPECIFIED',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  INTEGER = 'INTEGER',
  BOOLEAN = 'BOOLEAN',
  ARRAY = 'ARRAY',
  OBJECT = 'OBJECT',
  NULL = 'NULL',
}
