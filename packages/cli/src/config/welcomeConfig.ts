/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { USER_SETTINGS_DIR } from './paths.js';

export const WELCOME_CONFIG_FILENAME = 'welcomeConfig.json';

export function getWelcomeConfigPath(): string {
  if (process.env['LLXPRT_CODE_WELCOME_CONFIG_PATH']) {
    return process.env['LLXPRT_CODE_WELCOME_CONFIG_PATH'];
  }
  return path.join(USER_SETTINGS_DIR, WELCOME_CONFIG_FILENAME);
}

export interface WelcomeConfig {
  welcomeCompleted: boolean;
  completedAt?: string;
  skipped?: boolean;
}

let cachedConfig: WelcomeConfig | undefined;

export function resetWelcomeConfigForTesting(): void {
  cachedConfig = undefined;
}

export function loadWelcomeConfig(): WelcomeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getWelcomeConfigPath();

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      cachedConfig = JSON.parse(content) as WelcomeConfig;
      return cachedConfig;
    }
  } catch (_error) {
    // If parsing fails, return default
  }

  cachedConfig = { welcomeCompleted: false };
  return cachedConfig;
}

export function saveWelcomeConfig(config: WelcomeConfig): void {
  const configPath = getWelcomeConfigPath();

  try {
    const dirPath = path.dirname(configPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    cachedConfig = config;
  } catch (error) {
    console.error('Error saving welcome config:', error);
  }
}

export function markWelcomeCompleted(skipped: boolean = false): void {
  saveWelcomeConfig({
    welcomeCompleted: true,
    completedAt: new Date().toISOString(),
    skipped,
  });
}

export function isWelcomeCompleted(): boolean {
  return loadWelcomeConfig().welcomeCompleted;
}
