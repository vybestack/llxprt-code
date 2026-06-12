/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IToolRegistryHost } from '@vybestack/llxprt-code-tools';

type PromptRegistryBoundary = { clear(): void };

type SettingsServiceBoundary = {
  getAllGlobalSettings?(): Record<string, unknown> | undefined;
  get?(key: string): unknown;
};

type CoreToolRegistryHostBoundary = {
  getEphemeralSettings?(): Record<string, unknown> | null | undefined;
  getCoreTools?(): string[] | undefined;
  getExcludeTools?(): string[] | undefined;
  getToolDiscoveryCommand?(): string | undefined;
  getToolCallCommand?(): string | undefined;
  getPromptRegistry?(): PromptRegistryBoundary | undefined;
  getSettingsService?(): SettingsServiceBoundary | undefined;
  isToolEnabled?(name: string): boolean;
  isTrustedFolder?(): boolean;
};

export class CoreToolRegistryHostAdapter implements IToolRegistryHost {
  constructor(private readonly host: CoreToolRegistryHostBoundary) {}

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

  getPromptRegistry(): PromptRegistryBoundary | undefined {
    return this.host.getPromptRegistry?.();
  }

  getSettingsService(): SettingsServiceBoundary | undefined {
    return this.host.getSettingsService?.();
  }

  isToolEnabled(name: string): boolean {
    return this.host.isToolEnabled?.(name) ?? true;
  }

  isTrustedFolder(): boolean {
    return this.host.isTrustedFolder?.() ?? false;
  }
}
