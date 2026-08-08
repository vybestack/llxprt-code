/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Re-export barrel for the config roles subpath.
 *
 * TypeScript with `moduleResolution: "nodenext"` resolves the subpath
 * `@vybestack/llxprt-code-core/config/roles.js` through the `paths` mapping to
 * `../core/src/config/roles.js`. Because `roles/` is a directory (not a file),
 * the mapping needs a `roles.ts` file to land on source rather than falling
 * back to dist. This file provides that anchor and re-exports everything from
 * the directory barrel.
 */

export * from './roles/index.js';
