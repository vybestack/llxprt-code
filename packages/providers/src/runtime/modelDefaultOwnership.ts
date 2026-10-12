/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const USER_OWNED_SWITCH_PRESERVED_KEYS: readonly string[] =
  Object.freeze([
    'reasoning.effortWireFormat',
    'reasoning.enabledWireFormat',
    'reasoning.effortMap',
    'reasoning.enabledMap',
  ]);

/**
 * Issue #3255 alias ephemeral keys whose values are objects: the registered
 * reasoning maps. Shared with provider switch so the alias surface and the
 * ownership record cannot drift apart on which keys carry maps.
 */
export const REASONING_OBJECT_VALUED_EPHEMERAL_KEYS: readonly string[] =
  Object.freeze(['reasoning.effortMap', 'reasoning.enabledMap']);
