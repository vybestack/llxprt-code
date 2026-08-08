/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Narrow capability interfaces over core's `Config`.
 *
 * Each names the members one use case reads, so a consumer depends on one to
 * three members rather than the ~349 the compiler reports on `Config`. Core's
 * `Config` satisfies each structurally, so composition roots keep passing it
 * and nothing moves at runtime.
 *
 * Not exported from the package root: these are consumer-owned use-case
 * contracts. Publishing them would rebuild a god-object out of whatever the
 * package collectively needs. Add an interface per use case rather than
 * widening one to fit an unrelated caller.
 *
 * Part of the #2615 Config decomposition.
 */

import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderManager.js';
import type { SandboxConfig } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { Storage } from '@vybestack/llxprt-code-storage';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';

/** Reads whether debug output is enabled. */
export interface DebugModeSource {
  getDebugMode(): boolean;
}

/** Reaches the profile manager. */
export interface ProfileManagerSource {
  getProfileManager(): ProfileManager | undefined;
}

/** Reaches session storage. */
export interface StorageSource {
  readonly storage: Storage;
}

/** Reads and writes ephemeral (session-scoped) settings. */
export interface EphemeralSettingsAccess {
  getEphemeralSetting(key: string): unknown;
  setEphemeralSetting(key: string, value: unknown): void;
}

/** Reads interactivity and records the detected terminal background. */
export interface TerminalThemeAccess {
  isInteractive(): boolean;
  setTerminalBackground(terminalBackground: string | undefined): void;
}

/** Reads the project root alongside session storage. */
export interface ProjectStorageSource extends StorageSource {
  getProjectRoot(): string;
}

/** Startup flags the CLI entry point reads to choose a launch mode. */
export interface LaunchModeFlags {
  getExperimentalZedIntegration(): boolean;
  getListExtensions(): boolean;
}

/** What sandbox launch reads. */
export interface SandboxLaunchConfig extends DebugModeSource {
  getSandbox(): SandboxConfig | undefined;
}

/** What the seatbelt profile builder reads. */
export interface SeatbeltConfig extends DebugModeSource {
  getTargetDir(): string;
  getWorkspaceContext(): WorkspaceContext;
}

/** What session cleanup reads. */
export interface SessionCleanupConfig extends DebugModeSource, StorageSource {
  getSessionId(): string;
}

/** What the non-interactive session entry reads. */
export interface NonInteractiveSessionConfig {
  getQuestion(): string | undefined;
  isInteractive(): boolean;
}

/** What the interactive UI bootstrap reads. */
export interface InteractiveUIConfig extends DebugModeSource {
  getProjectRoot(): string;
}

/** What zed session setup reads. */
export interface ZedSessionConfig extends EphemeralSettingsAccess {
  getProviderManager(): RuntimeProviderManager | undefined;
  getTargetDir(): string;
  getToolRegistry(): ToolRegistry;
}
