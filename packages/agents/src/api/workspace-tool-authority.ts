/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolRegistry } from '@vybestack/llxprt-code-tools';

export class WorkspaceToolAuthority {
  constructor(private readonly isTrusted: () => boolean) {}

  publish(registry: ToolRegistry): void {
    registry.bindWorkspaceAuthority(() => this.isTrusted());
  }
}
