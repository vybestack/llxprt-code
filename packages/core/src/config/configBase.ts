/**
 * ConfigBase — extends ConfigBaseCore with abstract methods and complex logic.
 * Simple field declarations and trivial accessors live in ConfigBaseCore.
 * Complex method implementations live in Config (extends ConfigBase) in config.ts.
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import { DebugLogger } from '../debug/DebugLogger.js';
import { GitService } from '../services/gitService.js';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import { createToolRegistry as _createToolRegistry } from './toolRegistryFactory.js';
import { shutdownLsp } from './lspIntegration.js';
import type { LspServiceClient } from '../lsp/lsp-service-client.js';
import type { LspConfig } from '../lsp/types.js';
import {
  normalizeStreamingValue,
  normalizeContextLimit,
} from './ephemeralSettingsHelpers.js';
import { disposeScheduler as _disposeScheduler } from './schedulerSingleton.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  type ShellReplacementMode,
  normalizeShellReplacement,
} from './configTypes.js';
import { ConfigBaseCore } from './configBaseCore.js';

export abstract class ConfigBase extends ConfigBaseCore {
  // Abstract methods implemented by Config subclass
  abstract initializeContentGeneratorConfig: () => Promise<void>;
  abstract getJitContextEnabled(): boolean;
  abstract getExcludeTools(): string[] | undefined;
  abstract getAsyncTaskManager(): AsyncTaskManager | undefined;

  async refreshAuth(authMethod?: string) {
    const logger = new DebugLogger('llxprt:config:refreshAuth');
    logger.debug(
      () => `refreshAuth invoked (authMethod=${authMethod ?? 'default'})`,
    );
    await this.initializeContentGeneratorConfig();
  }

  getSessionId(): string {
    return this.adoptedSessionId ?? this.sessionId;
  }

  /**
   * @fix FIX-1336-SESSION-ADOPTION
   * Adopt a restored session's ID for use by TodoStore and other session-scoped services.
   * This allows --continue to properly restore todos from the previous session.
   */
  adoptSessionId(sessionId: string): void {
    const logger = new DebugLogger('llxprt:config:session');
    logger.debug(
      `adoptSessionId: adopting ${sessionId} (was ${this.sessionId})`,
    );
    this.adoptedSessionId = sessionId;
  }

  resetModelToDefault(): void {
    this.contentGeneratorConfig.model = this.originalModel;
    this.inFallbackMode = false;
    this.model = this.originalModel;
  }

  getGlobalMemory(): string {
    if (this.getJitContextEnabled() && this.contextManager) {
      return this.contextManager.getGlobalMemory();
    }
    return this.userMemory;
  }

  getEnvironmentMemory(): string {
    if (this.getJitContextEnabled() && this.contextManager) {
      return this.contextManager.getEnvironmentMemory();
    }
    return '';
  }

  getCoreMemory(): string | undefined {
    if (this.getJitContextEnabled() && this.contextManager) {
      return this.contextManager.getCoreMemory();
    }
    return undefined;
  }

  getLlxprtMdFileCount(): number {
    if (this.getJitContextEnabled() && this.contextManager) {
      return this.contextManager.getContextFileCount();
    }
    return this.llxprtMdFileCount;
  }

  getCoreMemoryFileCount(): number {
    if (this.getJitContextEnabled() && this.contextManager) {
      return this.contextManager.getCoreMemoryFileCount();
    }
    return 0;
  }

  getLlxprtMdFilePaths(): string[] {
    if (this.getJitContextEnabled() && this.contextManager) {
      return Array.from(this.contextManager.getLoadedPaths());
    }
    return this.llxprtMdFilePaths;
  }

  async getGitService(): Promise<GitService> {
    if (!this.gitService) {
      this.gitService = new GitService(this.targetDir, this.storage);
      await this.gitService.initialize();
    }
    return this.gitService;
  }

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
   * @requirement REQ-D01-002
   * @requirement REQ-D01-003
   * @pseudocode lines 122-133
   */
  async createToolRegistry(messageBus: MessageBus): Promise<ToolRegistry> {
    const result = await _createToolRegistry(this, this, messageBus);
    this.allPotentialTools = result.allPotentialTools;
    return result.registry;
  }

  disposeScheduler(sessionId: string): void {
    _disposeScheduler(sessionId);
  }

  setDisabledHooks(hooks: string[]): void {
    this.disabledHooks = hooks;
    // Persist to settings service under the split-schema key
    this.settingsService.set('hooksConfig.disabled', hooks);
  }

  /**
   * Get LSP service client if available.
   * @plan PLAN-20250212-LSP.P33
   * @requirement REQ-DIAG-010, REQ-CFG-010, REQ-CFG-015, REQ-CFG-020
   * @returns LspServiceClient instance or undefined if not initialized or disabled
   */
  getLspServiceClient(): LspServiceClient | undefined {
    return this._lspState.lspServiceClient;
  }

  /**
   * Get LSP configuration.
   * @plan PLAN-20250212-LSP.P33
   * @requirement REQ-DIAG-010, REQ-CFG-010, REQ-CFG-015, REQ-CFG-020
   * @returns LspConfig or undefined (undefined means LSP disabled)
   */
  getLspConfig(): LspConfig | undefined {
    return this._lspState.lspConfig;
  }

  async shutdownLspService(): Promise<void> {
    await shutdownLsp(this._lspState, this.toolRegistry);
  }

  // ---- Ephemeral settings ----

  private normalizeAndPersistStreaming(value: unknown): unknown {
    const normalized = normalizeStreamingValue(value);
    if (normalized !== value && normalized !== undefined) {
      this.settingsService.set('streaming', normalized);
      return normalized;
    }
    return normalized;
  }

  getEphemeralSetting(key: string): unknown {
    const rawValue = this.settingsService.get(key);
    if (key === 'streaming') {
      return this.normalizeAndPersistStreaming(rawValue);
    }
    if (key === 'context-limit') {
      const normalized = normalizeContextLimit(rawValue);
      if (normalized !== undefined) {
        if (normalized !== rawValue) {
          this.settingsService.set(key, normalized);
        }
        return normalized;
      }
      return undefined;
    }
    return rawValue;
  }

  setEphemeralSetting(key: string, value: unknown): void {
    let settingValue = value;
    if (key === 'streaming') {
      settingValue = normalizeStreamingValue(value);
    }
    if (key === 'context-limit') {
      settingValue =
        value === undefined ? undefined : normalizeContextLimit(value);
    }

    if (
      key === 'streaming' &&
      settingValue !== undefined &&
      typeof settingValue !== 'string'
    ) {
      throw new Error(
        'Streaming setting must resolve to "enabled" or "disabled"',
      );
    }

    this.settingsService.set(key, settingValue);

    // @plan PLAN-20260130-ASYNCTASK.P21
    // @requirement REQ-ASYNC-012
    // Propagate task-max-async changes to AsyncTaskManager
    if (key === 'task-max-async') {
      let normalizedValue: number;
      if (typeof settingValue === 'number') {
        normalizedValue = settingValue;
      } else if (typeof settingValue === 'string') {
        const parsed = parseInt(settingValue, 10);
        normalizedValue = isNaN(parsed) ? 0 : parsed;
      } else {
        normalizedValue = 0;
      }
      const asyncTaskManager = this.getAsyncTaskManager();
      if (asyncTaskManager) {
        asyncTaskManager.setMaxAsyncTasks(normalizedValue);
      }
    }

    // Clear provider caches when auth settings or base-url change
    const cacheClearKeys = new Set([
      'auth-key',
      'auth-keyfile',
      'base-url',
      'socket-timeout',
      'socket-keepalive',
      'socket-nodelay',
      'streaming',
    ]);
    if (cacheClearKeys.has(key)) {
      if (!this.providerManager) {
        return;
      }

      const activeProvider = this.providerManager.getActiveProvider();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider manager may have no active provider during settings updates.
      if (activeProvider === undefined || activeProvider === null) {
        return;
      }

      if (
        'clearClientCache' in activeProvider &&
        typeof activeProvider.clearClientCache === 'function'
      ) {
        const providerWithClearCache = activeProvider as {
          clearClientCache: () => void;
        };
        providerWithClearCache.clearClientCache();
      }
      if (
        'clearAuthCache' in activeProvider &&
        typeof activeProvider.clearAuthCache === 'function'
      ) {
        const providerWithClearAuth = activeProvider as {
          clearAuthCache: () => void;
        };
        providerWithClearAuth.clearAuthCache();
      }
    }
  }

  getEphemeralSettings(): Record<string, unknown> {
    const allSettings = this.settingsService.getAllGlobalSettings();
    if ('streaming' in allSettings) {
      const normalized = this.normalizeAndPersistStreaming(
        allSettings.streaming,
      );
      if (normalized !== undefined) {
        allSettings.streaming = normalized;
      }
    }
    return allSettings;
  }

  getShellReplacement(): ShellReplacementMode {
    const ephemeralValue = this.getEphemeralSetting('shell-replacement');
    if (ephemeralValue !== undefined) {
      return normalizeShellReplacement(
        ephemeralValue as ShellReplacementMode | boolean,
      );
    }
    return this.shellReplacement;
  }
}
