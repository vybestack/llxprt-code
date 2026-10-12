/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';
import path from 'node:path';
import { initializeParser } from '../utils/shell-parser.js';

import * as configConstructor from './configConstructor.js';
import { ConfigBase } from './configBase.js';

import type {
  MemorySettings,
  ConfigParameters,
  ConfigInitializationDependencies,
  RedactionConfig,
  ApprovalMode,
  TelemetrySettings,
} from './configTypes.js';

// Re-export all types for backward compatibility
export {
  type MemorySettings,
  type ConfigParameters,
  type RedactionConfig,
  ApprovalMode,
  type AccessibilitySettings,
  type BugCommandSettings,
  type ChatCompressionSettings,
  type SummarizeToolOutputSettings,
  type ComplexityAnalyzerSettings,
  type OutputSettings,
  type IntrospectionAgentSettings,
  type TelemetrySettings,
  type LlxprtExtension,
  type ExtensionInstallMetadata,
  type ShellReplacementMode,
  normalizeShellReplacement,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
  type MCPServerConfig,
  AuthProviderType,
  type SandboxConfig,
  type ActiveExtension,
  type FailoverContext,
  type BucketFailoverHandler,
  type OnAuthErrorHandler,
  type MCPOAuthConfig,
  type AnyToolInvocation,
  type SkillDefinition,
  type FileFilteringOptions,
} from './configTypes.js';
// Re-export constants for backward compatibility
export {
  DEFAULT_FILE_FILTERING_OPTIONS,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
  DEFAULT_AUTOCOMPLETE_IGNORE_DIRS,
  DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS,
  DEFAULT_AUTOCOMPLETE_MAX_DEPTH,
} from './constants.js';

import type { ShellExecutionConfig } from '../services/shellExecutionService.js';

export class Config extends ConfigBase {
  readonly profileDirectory: string | undefined;
  readonly subagentDirectory: string | undefined;
  readonly initialWorkspaceTrust: boolean | undefined;

  constructor(params: ConfigParameters) {
    super();
    this.initialWorkspaceTrust = params.trustedFolder;
    this.profileDirectory = params.profileDirectory;
    this.subagentDirectory = params.subagentDirectory;
    configConstructor.applyConfigParams(
      this as unknown as configConstructor.ConfigConstructorTarget,
      params,
    );
  }

  private initializationPromise: Promise<void> | undefined;

  hasInitializationStarted(): boolean {
    return this.initializationPromise !== undefined;
  }

  /** Must only be called once; use ensureInitialized for idempotent adoption. */
  initialize(dependencies?: ConfigInitializationDependencies): Promise<void> {
    if (this.initializationPromise !== undefined) {
      throw Error('Config was already initialized');
    }
    this.initializationPromise = this.performInitialization(dependencies);
    // Return the exact stored promise so callers (ensureInitialized) that
    // observe this.initializationPromise see the SAME object identity. A
    // plain `return` (not async) preserves referential identity.
    return this.initializationPromise;
  }

  /**
   * Initializes once and shares the original result with adopting callers.
   * A failed initialization remains failed rather than exposing partial state.
   */
  ensureInitialized(
    dependencies?:
      | ConfigInitializationDependencies
      | (() => ConfigInitializationDependencies),
  ): Promise<void> {
    if (this.initializationPromise === undefined) {
      const resolvedDependencies =
        typeof dependencies === 'function' ? dependencies() : dependencies;
      this.initializationPromise =
        this.performInitialization(resolvedDependencies);
    }
    return this.initializationPromise;
  }

  private async performInitialization(
    dependencies?: ConfigInitializationDependencies,
  ): Promise<void> {
    const initializationMessageBus = dependencies?.messageBus;
    if (!initializationMessageBus) {
      throw new Error(
        'Config.initialize requires an explicit session/runtime MessageBus dependency.',
      );
    }
    await dependencies.initializeIde?.();
    await initializeParser();
    await dependencies.initializeTools();
    if (!dependencies.startMcp) {
      throw new Error(
        'Config initialization requires an explicit MCP runtime handoff',
      );
    }
    await dependencies.startMcp();
    this.initialized = true;
    dependencies.startMcpDiscovery();
    await dependencies.startExtensions?.();

    await dependencies.startLsp?.();

    await dependencies.initializeMemory?.();

    // Reserved for future model switching tracking
    void this._modelSwitchedDuringSession;
  }

  getModel(): string {
    return this.originalModel;
  }

  isRestrictiveSandbox(): boolean {
    const sandboxConfig = this.getSandbox();
    const seatbeltProfile = process.env.SEATBELT_PROFILE;
    return (
      !!sandboxConfig &&
      sandboxConfig.command === 'sandbox-exec' &&
      !!seatbeltProfile &&
      seatbeltProfile.startsWith('restrictive-')
    );
  }

  /**
   * All the excluded tools from static configuration, loaded extensions, or
   * other sources.
   *
   * May change over time.
   */
  getExcludeTools(): string[] | undefined {
    const excludeToolsSet = new Set([...(this.excludeTools ?? [])]);
    for (const extension of this.getExtensions()) {
      if (!extension.isActive) {
        continue;
      }
      for (const tool of extension.excludeTools ?? []) {
        excludeToolsSet.add(tool);
      }
    }
    return [...excludeToolsSet];
  }

  getMemorySettings(): MemorySettings {
    return {
      ...this.memorySettings,
      filenames: [...this.memorySettings.filenames],
      filtering: { ...this.memorySettings.filtering },
    };
  }

  getProvidedInstructions(): string {
    return this.providedInstructions;
  }

  setApprovalMode(mode: ApprovalMode): void {
    this.approvalMode = mode;
  }

  updateSystemInstructionIfInitialized(): void | Promise<void> {}

  getContinueSessionRef(): string | null {
    if (typeof this.continueSession === 'string') {
      return this.continueSession;
    }
    return this.continueSession ? '__CONTINUE_LATEST__' : null;
  }

  // Conversation logging configuration methods
  getConversationLoggingEnabled(): boolean {
    // Check CLI flags first when conversation logging flags are introduced.
    // Today this reads environment variables and the settings file.

    // Check environment variables
    const envVar = process.env.LLXPRT_LOG_CONVERSATIONS;
    if (envVar !== undefined) {
      return envVar.toLowerCase() === 'true';
    }

    // Check settings file
    return this.telemetrySettings.logConversations ?? false;
  }

  getConversationLogPath(): string {
    // Check environment variable first
    const envPath = process.env.LLXPRT_CONVERSATION_LOG_PATH;
    if (envPath) {
      return this.expandPath(envPath);
    }

    // Check settings file
    if (this.telemetrySettings.conversationLogPath) {
      return this.expandPath(this.telemetrySettings.conversationLogPath);
    }

    // Default path
    return path.join(this.globalDataRoot, 'conversations');
  }

  getRedactionConfig(): RedactionConfig {
    return {
      redactApiKeys: this.telemetrySettings.redactSensitiveData ?? true,
      redactCredentials: this.telemetrySettings.redactSensitiveData ?? true,
      redactFilePaths: this.telemetrySettings.redactFilePaths ?? false,
      redactUrls: this.telemetrySettings.redactUrls ?? false,
      redactEmails: this.telemetrySettings.redactEmails ?? false,
      redactPersonalInfo: this.telemetrySettings.redactPersonalInfo ?? false,
      customPatterns: this.telemetrySettings.customRedactionPatterns,
    };
  }

  getTelemetrySettings(): TelemetrySettings {
    return configConstructor.withClonedPerf(this.telemetrySettings);
  }

  private expandPath(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return filePath.replace('~', process.env.HOME ?? '');
    }
    return filePath;
  }

  setPtyTerminalSize(
    width: number | undefined,
    height: number | undefined,
  ): void {
    if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
      this.ptyTerminalWidth = Math.floor(width);
    } else {
      this.ptyTerminalWidth = undefined;
    }

    if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
      this.ptyTerminalHeight = Math.floor(height);
    } else {
      this.ptyTerminalHeight = undefined;
    }
  }

  getShellExecutionConfig(): ShellExecutionConfig {
    const ephemeralSettings = this.initialSettings;
    const inactivitySeconds = Number(
      ephemeralSettings['shell-inactivity-timeout-seconds'] ?? 120,
    );

    const rawLimit = ephemeralSettings['shell-output-retention-max-bytes'];

    return {
      terminalWidth: this.getPtyTerminalWidth(),
      terminalHeight: this.getPtyTerminalHeight(),
      showColor: this.getAllowPtyThemeOverride(),
      scrollback: this.getPtyScrollbackLimit(),
      inactivityTimeoutMs:
        inactivitySeconds === -1 ? undefined : inactivitySeconds * 1000,
      outputRetentionMaxBytes:
        typeof rawLimit === 'number' ? rawLimit : undefined,
      isSandboxOrCI: !!this.getSandbox() || process.env.CI === 'true',
    };
  }

  /**
   * Get disabled hooks list
   */
  getDisabledHooks(): string[] {
    return [...this.disabledHooks];
  }

  async dispose(): Promise<void> {}
}
