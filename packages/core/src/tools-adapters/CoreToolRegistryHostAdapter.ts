/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IToolRegistryHost } from '@vybestack/llxprt-code-tools';

type CoreToolRegistryHostBoundary = {
  getEphemeralSettings?(): Record<string, unknown> | null | undefined;
  getCoreTools?(): string[] | undefined;
  getExcludeTools?(): string[] | undefined;
  getToolDiscoveryCommand?(): string | undefined;
  getToolCallCommand?(): string | undefined;
  isToolEnabled?(name: string): boolean;
};

export class CoreToolRegistryHostAdapter implements IToolRegistryHost {
  constructor(
    private readonly host: CoreToolRegistryHostBoundary,
    private readonly trust?: { isTrustedFolder(): boolean },
  ) {}

  getEphemeralSettings(): Record<string, unknown> | null | undefined {
    return this.host.getEphemeralSettings?.();
  }

  getCoreTools(): string[] | undefined {
    return this.host.getCoreTools?.();
  }

  getExcludeTools(): string[] | undefined {
    return this.host.getExcludeTools?.();
  }

  getToolDiscoveryCommand(): string | undefined {
    return this.host.getToolDiscoveryCommand?.();
  }

  getToolCallCommand(): string | undefined {
    return this.host.getToolCallCommand?.();
  }

  isToolEnabled(name: string): boolean {
    return this.host.isToolEnabled?.(name) ?? true;
  }

  isTrustedFolder(): boolean {
    return this.trust?.isTrustedFolder() ?? false;
  }
}
