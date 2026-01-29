/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExtensionSetting } from './extensionSettings.js';

/**
 * Filters settings that don't have values in the existing values record.
 *
 * @param settings - Array of extension settings to check
 * @param existingValues - Record of existing setting values keyed by envVar
 * @returns Array of settings that are missing values (undefined or empty string)
 */
export function getMissingSettings(
  settings: ExtensionSetting[],
  existingValues: Record<string, string | undefined>,
): ExtensionSetting[] {
  return settings.filter((setting) => {
    const value = existingValues[setting.envVar];
    return value === undefined || value === '';
  });
}

/**
 * Formats a user-friendly prompt text for a setting.
 *
 * @param setting - The extension setting to create a prompt for
 * @returns Formatted prompt string
 */
export function formatSettingPrompt(setting: ExtensionSetting): string {
  let prompt = `${setting.name}`;

  if (setting.description) {
    prompt += ` (${setting.description})`;
  }

  if (setting.sensitive) {
    prompt += ' [sensitive - input will be hidden]';
  }

  prompt += ': ';

  return prompt;
}

/**
 * Prompts the user for any missing extension settings.
 *
 * If all settings already have values, returns the existing values immediately.
 * If any settings are missing, prompts the user for each one.
 * If the user enters an empty string for any prompt, cancels and returns null.
 *
 * @param settings - Array of extension settings that may need values
 * @param existingValues - Record of existing setting values keyed by envVar
 * @returns Promise resolving to complete settings record, or null if cancelled
 */
export async function maybePromptForSettings(
  settings: ExtensionSetting[],
  existingValues: Record<string, string | undefined>,
): Promise<Record<string, string> | null> {
  const missingSettings = getMissingSettings(settings, existingValues);

  // If no settings are missing, return existing values (filtered to non-undefined)
  if (missingSettings.length === 0) {
    const result: Record<string, string> = {};
    for (const setting of settings) {
      const value = existingValues[setting.envVar];
      if (value !== undefined && value !== '') {
        result[setting.envVar] = value;
      }
    }
    return result;
  }

  // Prompt for missing settings
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const newValues: Record<string, string> = {};

  for (const setting of missingSettings) {
    const prompt = formatSettingPrompt(setting);

    let value = '';
    if (setting.sensitive && process.stdin.isTTY) {
      // Hide input for sensitive settings by suppressing echo
      value = await new Promise<string>((resolve) => {
        process.stdout.write(prompt);
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();

        let input = '';
        const onData = (data: Buffer): void => {
          const char = data.toString('utf-8');
          if (char === '\n' || char === '\r') {
            stdin.setRawMode(wasRaw);
            stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolve(input);
          } else if (char === '\x7f' || char === '\b') {
            // Backspace
            input = input.slice(0, -1);
          } else if (char === '\x03') {
            // Ctrl+C
            stdin.setRawMode(wasRaw);
            stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolve('');
          } else {
            input += char;
          }
        };
        stdin.on('data', onData);
      });
    } else {
      value = await new Promise<string>((resolve) => {
        rl.question(prompt, (answer) => {
          resolve(answer);
        });
      });
    }

    // Empty input means cancel
    if (value === '') {
      rl.close();
      return null;
    }

    newValues[setting.envVar] = value;
  }

  rl.close();

  // Merge new values with existing values
  const result: Record<string, string> = {};
  for (const setting of settings) {
    const newValue = newValues[setting.envVar];
    const existingValue = existingValues[setting.envVar];

    if (newValue !== undefined) {
      result[setting.envVar] = newValue;
    } else if (existingValue !== undefined && existingValue !== '') {
      result[setting.envVar] = existingValue;
    }
  }

  return result;
}
