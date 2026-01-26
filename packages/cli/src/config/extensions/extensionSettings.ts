/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * Schema for an individual extension setting definition.
 *
 * Extension settings describe configuration values that an extension requires
 * from the user, typically sourced from environment variables.
 *
 * @example
 * ```typescript
 * const apiKeySetting = {
 *   name: 'apiKey',
 *   description: 'Your API key for the service',
 *   envVar: 'MY_SERVICE_API_KEY',
 *   sensitive: true
 * };
 * ```
 */
export const ExtensionSettingSchema = z
  .object({
    /**
     * The name of the setting (used for identification and display)
     */
    name: z.string().min(1),

    /**
     * Optional human-readable description of what this setting is for
     */
    description: z.string().optional(),

    /**
     * The environment variable name where this setting's value should be sourced from
     */
    envVar: z.string().min(1),

    /**
     * Whether this setting contains sensitive data (e.g., API keys, passwords)
     * Sensitive settings may be masked in UI and logs
     */
    sensitive: z.boolean().default(false),
  })
  .strip();

/**
 * Type representing a single extension setting
 */
export type ExtensionSetting = z.infer<typeof ExtensionSettingSchema>;

/**
 * Schema for an array of extension settings
 */
export const ExtensionSettingsArraySchema = z.array(ExtensionSettingSchema);

/**
 * Type representing multiple extension settings
 */
export type ExtensionSettings = z.infer<typeof ExtensionSettingsArraySchema>;
