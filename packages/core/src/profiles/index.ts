/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Profile workspace public surface.
 *
 * The profiles tree is split into four layers that core owns:
 *  - contracts: structural profile documents, commands, events, views, contexts
 *  - ports: dependency boundaries (repositories, credential resolvers, catalogs)
 *  - reduction: pure command reducers
 *  - resolution: intent-to-reference resolution (credential bindings, member auth)
 */

export * from './contracts/index.js';
export * from './ports/index.js';
export * from './reduction/index.js';
export * from './resolution/index.js';
