/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExtensionUpdateState } from '../ui/state/extensions.js';
import { checkForExtensionUpdate } from '../config/extensions/github.js';
import { loadUserExtensions } from '../config/extension.js';
import {
  updateExtension,
  type ExtensionUpdateInfo,
} from '../config/extensions/update.js';
import {
  Storage,
  getErrorMessage,
  type GeminiCLIExtension,
} from '@vybestack/llxprt-code-core';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HOUR_IN_MS = 60 * 60 * 1000;
const STATE_FILENAME = 'extension-update-state.json';

export type ExtensionAutoUpdateInstallMode =
  | 'immediate'
  | 'on-restart'
  | 'manual';
export type ExtensionAutoUpdateNotificationLevel =
  | 'silent'
  | 'toast'
  | 'dialog';

export interface ExtensionAutoUpdateSettings {
  enabled?: boolean;
  checkIntervalHours?: number;
  installMode?: ExtensionAutoUpdateInstallMode;
  notificationLevel?: ExtensionAutoUpdateNotificationLevel;
  perExtension?: Record<string, ExtensionAutoUpdatePerExtensionSetting>;
}

export interface ExtensionAutoUpdatePerExtensionSetting {
  enabled?: boolean;
  installMode?: ExtensionAutoUpdateInstallMode;
  notificationLevel?: ExtensionAutoUpdateNotificationLevel;
  checkIntervalHours?: number;
}

interface EffectiveExtensionAutoUpdateSettings {
  enabled: boolean;
  checkIntervalHours: number;
  installMode: ExtensionAutoUpdateInstallMode;
  notificationLevel: ExtensionAutoUpdateNotificationLevel;
  perExtension: Record<string, ExtensionAutoUpdatePerExtensionSetting>;
}

export interface ExtensionUpdateHistoryEntry {
  lastCheck?: number;
  lastUpdate?: number;
  lastError?: string;
  failureCount?: number;
  pendingInstall?: boolean;
  state?: ExtensionUpdateState;
}

type ExtensionUpdateStateFile = Record<string, ExtensionUpdateHistoryEntry>;

export interface ExtensionAutoUpdateStateStore {
  read(): Promise<ExtensionUpdateStateFile>;
  write(state: ExtensionUpdateStateFile): Promise<void>;
}

function clampIntervalHours(value: number | undefined): number {
  if (!value || Number.isNaN(value)) {
    return 24;
  }
  return Math.max(1, value);
}

function resolveSettings(
  raw?: ExtensionAutoUpdateSettings,
): EffectiveExtensionAutoUpdateSettings {
  return {
    enabled: raw?.enabled ?? true,
    checkIntervalHours: clampIntervalHours(raw?.checkIntervalHours ?? 24),
    installMode: raw?.installMode ?? 'immediate',
    notificationLevel: raw?.notificationLevel ?? 'toast',
    perExtension: raw?.perExtension ?? {},
  };
}

function createFileStateStore(): ExtensionAutoUpdateStateStore {
  const dir = Storage.getGlobalLlxprtDir();
  const filePath = path.join(dir, STATE_FILENAME);

  return {
    async read() {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        const data = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(data) as ExtensionUpdateStateFile;
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return {};
        }
        console.warn(
          '[extensions] Failed to read extension auto-update state:',
          getErrorMessage(error),
        );
        return {};
      }
    },
    async write(state: ExtensionUpdateStateFile) {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(
          filePath,
          JSON.stringify(state, null, 2),
          'utf-8',
        );
      } catch (error) {
        console.warn(
          '[extensions] Failed to persist extension auto-update state:',
          getErrorMessage(error),
        );
      }
    },
  };
}

interface ExtensionAutoUpdaterOptions {
  settings?: ExtensionAutoUpdateSettings;
  workspaceDir?: string;
  notify?: (message: string, level: 'info' | 'warn' | 'error') => void;
  stateStore?: ExtensionAutoUpdateStateStore;
  extensionLoader?: () => Promise<GeminiCLIExtension[]>;
  updateExecutor?: (
    extension: GeminiCLIExtension,
    cwd: string,
    currentState: ExtensionUpdateState,
    setExtensionUpdateState: (updateState: ExtensionUpdateState) => void,
  ) => Promise<ExtensionUpdateInfo | undefined>;
  updateChecker?: (
    extension: GeminiCLIExtension,
    setExtensionUpdateState: (updateState: ExtensionUpdateState) => void,
  ) => Promise<void>;
  now?: () => number;
}

interface EffectivePerExtensionSettings {
  enabled: boolean;
  checkIntervalHours: number;
  installMode: ExtensionAutoUpdateInstallMode;
  notificationLevel: ExtensionAutoUpdateNotificationLevel;
}

export class ExtensionAutoUpdater {
  private readonly settings: EffectiveExtensionAutoUpdateSettings;
  private readonly workspaceDir: string;
  private readonly notify?: ExtensionAutoUpdaterOptions['notify'];
  private readonly stateStore: ExtensionAutoUpdateStateStore;
  private readonly extensionLoader: () => Promise<GeminiCLIExtension[]>;
  private readonly updateExecutor: (
    extension: GeminiCLIExtension,
    cwd: string,
    currentState: ExtensionUpdateState,
    setExtensionUpdateState: (updateState: ExtensionUpdateState) => void,
  ) => Promise<ExtensionUpdateInfo | undefined>;
  private readonly updateChecker: (
    extension: GeminiCLIExtension,
    setExtensionUpdateState: (updateState: ExtensionUpdateState) => void,
  ) => Promise<void>;
  private readonly now: () => number;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isChecking = false;
  private disposed = false;

  constructor(options: ExtensionAutoUpdaterOptions = {}) {
    this.settings = resolveSettings(options.settings);
    this.workspaceDir = options.workspaceDir ?? process.cwd();
    this.notify = options.notify;
    this.stateStore = options.stateStore ?? createFileStateStore();
    this.extensionLoader =
      options.extensionLoader ?? (async () => loadUserExtensions());
    this.updateExecutor =
      options.updateExecutor ??
      ((extension, cwd, currentState, setExtensionUpdateState) =>
        updateExtension(
          extension,
          cwd,
          async () => true, // Auto-approve in background mode
          currentState,
          (action) => {
            if (action.type === 'SET_STATE') {
              setExtensionUpdateState(action.payload.state);
            }
          },
        ));
    this.updateChecker = options.updateChecker ?? checkForExtensionUpdate;
    this.now = options.now ?? Date.now;
  }

  /**
   * Starts the background auto-update loop.
   * Returns a cleanup function that stops scheduling additional checks.
   */
  start(): () => void {
    if (!this.settings.enabled || this.disposed) {
      return () => {};
    }

    void this.runCycle();
    const intervalMs = this.settings.checkIntervalHours * HOUR_IN_MS;
    this.intervalHandle = setInterval(() => {
      void this.runCycle();
    }, intervalMs);

    return () => this.stop();
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.disposed = true;
  }

  async checkNow(): Promise<void> {
    await this.runCycle();
  }

  private async runCycle(): Promise<void> {
    if (!this.settings.enabled || this.disposed || this.isChecking) {
      return;
    }
    this.isChecking = true;
    try {
      const [state, extensions] = await Promise.all([
        this.stateStore.read(),
        this.extensionLoader(),
      ]);
      const extensionsByName = new Map(
        extensions.map((extension) => [extension.name, extension]),
      );

      await this.applyPendingInstalls(state, extensionsByName);

      for (const extension of extensions) {
        await this.processExtension(extension, state);
      }

      await this.stateStore.write(state);
    } finally {
      this.isChecking = false;
    }
  }

  private getEffectiveSettingsForExtension(
    extensionName: string,
  ): EffectivePerExtensionSettings {
    const override = this.settings.perExtension[extensionName];
    return {
      enabled: override?.enabled ?? this.settings.enabled,
      installMode: override?.installMode ?? this.settings.installMode,
      notificationLevel:
        override?.notificationLevel ?? this.settings.notificationLevel,
      checkIntervalHours: clampIntervalHours(
        override?.checkIntervalHours ?? this.settings.checkIntervalHours,
      ),
    };
  }

  private async applyPendingInstalls(
    state: ExtensionUpdateStateFile,
    extensionsByName: Map<string, GeminiCLIExtension>,
  ): Promise<void> {
    for (const [name, entry] of Object.entries(state)) {
      if (!entry.pendingInstall) {
        continue;
      }
      const extension = extensionsByName.get(name);
      if (!extension || !extension.installMetadata) {
        entry.pendingInstall = false;
        entry.lastError = `Extension "${name}" is no longer installed.`;
        entry.state = ExtensionUpdateState.ERROR;
        continue;
      }
      const settings = this.getEffectiveSettingsForExtension(name);
      await this.performUpdate(extension, entry, settings);
    }
  }

  private async processExtension(
    extension: GeminiCLIExtension,
    state: ExtensionUpdateStateFile,
  ): Promise<void> {
    if (!extension.installMetadata) {
      return;
    }

    const settings = this.getEffectiveSettingsForExtension(extension.name);
    if (!settings.enabled) {
      return;
    }

    const entry = state[extension.name] ?? (state[extension.name] = {});
    const now = this.now();
    const intervalMs = settings.checkIntervalHours * HOUR_IN_MS;
    if (entry.lastCheck && now - entry.lastCheck < intervalMs) {
      return;
    }
    entry.lastCheck = now;
    entry.state = ExtensionUpdateState.CHECKING_FOR_UPDATES;

    try {
      // Convert Extension to GeminiCLIExtension for the updateChecker
      const geminiExtension: GeminiCLIExtension = {
        name: extension.name,
        version: extension.version,
        isActive: true,
        path: extension.path,
        installMetadata: extension.installMetadata,
        contextFiles: extension.contextFiles || [],
      };

      // Call the update checker which will update entry.state via callback
      // Initialize with explicit type to prevent narrowing
      let resultState: ExtensionUpdateState | undefined;
      await this.updateChecker(geminiExtension, (updateState) => {
        resultState = updateState;
        entry.state = updateState;
      });

      entry.lastError = undefined;
      // Check the state after update checker completes
      if (resultState === ExtensionUpdateState.UPDATE_AVAILABLE) {
        await this.handleUpdateAvailable(extension, entry, settings);
      } else if (
        resultState === ExtensionUpdateState.UP_TO_DATE ||
        resultState === ExtensionUpdateState.NOT_UPDATABLE
      ) {
        entry.failureCount = 0;
      }
    } catch (error) {
      entry.lastError = getErrorMessage(error);
      entry.failureCount = (entry.failureCount ?? 0) + 1;
      entry.state = ExtensionUpdateState.ERROR;
      this.notifyWithLevel(
        'error',
        `Failed to check extension "${extension.name}" for updates: ${entry.lastError}`,
        settings.notificationLevel,
      );
    }
  }

  private async handleUpdateAvailable(
    extension: GeminiCLIExtension,
    entry: ExtensionUpdateHistoryEntry,
    settings: EffectivePerExtensionSettings,
  ): Promise<void> {
    switch (settings.installMode) {
      case 'immediate':
        await this.performUpdate(extension, entry, settings);
        break;
      case 'on-restart':
        entry.pendingInstall = true;
        this.notifyWithLevel(
          'info',
          `Extension "${extension.name}" update queued; it will install on the next restart.`,
          settings.notificationLevel,
        );
        break;
      case 'manual':
      default:
        this.notifyWithLevel(
          'info',
          `Update available for extension "${extension.name}". Run "llxprt extensions update ${extension.name}" to install.`,
          settings.notificationLevel,
        );
        break;
    }
  }

  private async performUpdate(
    extension: GeminiCLIExtension,
    entry: ExtensionUpdateHistoryEntry,
    settings: EffectivePerExtensionSettings,
  ): Promise<void> {
    try {
      entry.state = ExtensionUpdateState.UPDATING;

      // Convert Extension to GeminiCLIExtension for the updateExecutor
      const geminiExtension: GeminiCLIExtension = {
        name: extension.name,
        version: extension.version,
        isActive: true,
        path: extension.path,
        installMetadata: extension.installMetadata,
        contextFiles: extension.contextFiles || [],
      };

      const info = await this.updateExecutor(
        geminiExtension,
        this.workspaceDir,
        entry.state,
        (updateState) => {
          entry.state = updateState;
        },
      );

      if (!info) {
        throw new Error('Update returned undefined');
      }

      entry.lastUpdate = this.now();
      entry.pendingInstall = false;
      entry.state = ExtensionUpdateState.UPDATED_NEEDS_RESTART;
      entry.failureCount = 0;
      entry.lastError = undefined;
      this.notifyWithLevel(
        'info',
        `Extension "${info.name}" updated to ${info.updatedVersion}. Restart llxprt-code to load the new version.`,
        settings.notificationLevel,
      );
    } catch (error) {
      entry.lastError = getErrorMessage(error);
      entry.failureCount = (entry.failureCount ?? 0) + 1;
      entry.state = ExtensionUpdateState.ERROR;
      this.notifyWithLevel(
        'error',
        `Failed to update extension "${extension.name}": ${entry.lastError}`,
        settings.notificationLevel,
      );
    }
  }

  private notifyWithLevel(
    level: 'info' | 'warn' | 'error',
    message: string,
    notificationLevel: ExtensionAutoUpdateNotificationLevel,
  ): void {
    if (notificationLevel === 'silent' && level !== 'error') {
      return;
    }

    if (this.notify) {
      this.notify(message, level);
      return;
    }

    const prefix = '[extensions]';
    if (level === 'error') {
      console.error(prefix, message);
    } else if (level === 'warn') {
      console.warn(prefix, message);
    } else {
      console.log(prefix, message);
    }
  }
}
