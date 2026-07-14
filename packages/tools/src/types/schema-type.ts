/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider-neutral schema type enum for tool parameter JSON schemas.
 *
 * The runtime values are string literals that match the wire format
 * produced by the tool schema layer. This is a string enum (not const
 * enum) so that `Type.STRING` and `'STRING'` are interchangeable at
 * the type level.
 *
 * Example: `{ type: Type.OBJECT }` serializes to `{ type: 'OBJECT' }`.
 */

export enum Type {
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  INTEGER = 'INTEGER',
  BOOLEAN = 'BOOLEAN',
  ARRAY = 'ARRAY',
  OBJECT = 'OBJECT',
}
