/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import stripJsonComments from 'strip-json-comments';
import * as commentJson from 'comment-json';
import { Storage } from '@vybestack/llxprt-code-storage';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';

/**
 * Narrow shape of the user-scope settings file fields that the OAuth cluster
 * reads/writes. Mirrors the subset of the CLI's `Settings` that
 * {@link IOAuthSettingsProvider} exposes.
 */
interface FileOAuthSettingsData {
  oauthEnabledProviders?: Record<string, boolean>;
  providerApiKeys?: Record<string, string>;
  providerKeyfiles?: Record<string, string>;
  providerBaseUrls?: Record<string, string>;
}

function readUserSettings(settingsPath: string): FileOAuthSettingsData {
  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(stripJsonComments(content)) as FileOAuthSettingsData;
    }
  } catch {
    // Failed to load user settings; fall back to empty defaults.
  }
  return {};
}

/**
 * File-backed {@link IOAuthSettingsProvider} that reads the user-scope global
 * settings file directly (via {@link Storage.getGlobalSettingsPath}).
 *
 * This replaces the CLI-coupled `LoadedSettingsOAuthAdapter` for the isolated
 * runtime path, removing the dependency on the CLI's `LoadedSettings` type
 * while preserving behavior: user-scope only, trusted, reading the same
 * `oauthEnabledProviders` / `providerApiKeys` / `providerKeyfiles` /
 * `providerBaseUrls` fields.
 */
export class FileOAuthSettingsProvider implements IOAuthSettingsProvider {
  private readonly settingsPath: string;

  constructor(settingsPath: string = Storage.getGlobalSettingsPath()) {
    this.settingsPath = settingsPath;
  }

  isOAuthEnabled(provider: string): boolean {
    return (
      readUserSettings(this.settingsPath).oauthEnabledProviders?.[provider] ??
      false
    );
  }

  getProviderApiKey(provider: string): string | undefined {
    return readUserSettings(this.settingsPath).providerApiKeys?.[provider];
  }

  getProviderKeyfile(provider: string): string | undefined {
    return readUserSettings(this.settingsPath).providerKeyfiles?.[provider];
  }

  getProviderBaseUrl(provider: string): string | undefined {
    return readUserSettings(this.settingsPath).providerBaseUrls?.[provider];
  }

  getOAuthEnabledProviders(): Record<string, boolean> {
    return readUserSettings(this.settingsPath).oauthEnabledProviders ?? {};
  }

  setOAuthEnabled(provider: string, enabled: boolean): void {
    const current = readUserSettings(this.settingsPath);
    const merged: Record<string, boolean> = {
      ...(current.oauthEnabledProviders ?? {}),
    };
    merged[provider] = enabled;

    // Preserve existing comments/formatting in the settings file by parsing
    // the original content with comment-json and updating in place, mirroring
    // the CLI's saveSettings behavior. We mutate the existing
    // `oauthEnabledProviders` node when present (rather than replacing it) so
    // that comments attached to that nested object survive. Fall back to a
    // plain JSON write when the file is absent or cannot be parsed with
    // comments.
    let outputContent: string;
    try {
      const originalContent = fs.existsSync(this.settingsPath)
        ? fs.readFileSync(this.settingsPath, 'utf-8')
        : '';
      if (originalContent.trim().length > 0) {
        const parsedWithComments = commentJson.parse(
          originalContent,
        ) as commentJson.CommentObject;
        const root = parsedWithComments as Record<string, unknown>;
        const existing = root.oauthEnabledProviders;
        if (existing !== null && typeof existing === 'object') {
          // Update the existing comment-json node in place to keep its
          // attached comments; assign the single changed key only.
          (existing as Record<string, boolean>)[provider] = enabled;
        } else {
          root.oauthEnabledProviders = merged;
        }
        outputContent = commentJson.stringify(parsedWithComments, null, 2);
      } else {
        outputContent = JSON.stringify(
          { ...current, oauthEnabledProviders: merged },
          null,
          2,
        );
      }
    } catch {
      outputContent = JSON.stringify(
        { ...current, oauthEnabledProviders: merged },
        null,
        2,
      );
    }

    fs.writeFileSync(this.settingsPath, outputContent, 'utf-8');
  }
}

/**
 * Builds a {@link FileOAuthSettingsProvider} from the user-scope settings file
 * on disk, returning `undefined` when no user settings file exists.
 *
 * Preserves the prior `loadSettingsForIsolatedRuntime` semantics (return
 * `undefined` when the file is absent so `OAuthManager` falls back to its
 * built-in defaults).
 */
export function createFileOAuthSettingsProvider():
  | IOAuthSettingsProvider
  | undefined {
  const settingsPath = Storage.getGlobalSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return undefined;
  }
  return new FileOAuthSettingsProvider(settingsPath);
}
