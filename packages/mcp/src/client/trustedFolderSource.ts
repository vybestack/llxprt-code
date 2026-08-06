/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The single configuration member the MCP client layer reads.
 *
 * Declared here rather than importing core's `Config` so that MCP's tool and
 * client modules depend on one method instead of the whole configuration
 * object. Core's `Config` satisfies this structurally, so composition roots
 * continue to pass it unchanged.
 *
 * This is part of reversing the core/mcp dependency: MCP declares core only as
 * a devDependency while importing it at runtime, so every core import removed
 * from this layer moves that packaging defect closer to resolution.
 */
export interface TrustedFolderSource {
  isTrustedFolder(): boolean;
}
