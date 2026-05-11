/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type SettingsType =
  | 'boolean'
  | 'string'
  | 'number'
  | 'array'
  | 'object'
  | 'enum';

export type SettingsValue =
  | boolean
  | string
  | number
  | string[]
  | object
  | undefined;

/**
 * Setting datatypes that "toggle" through a fixed list of options
 * (e.g. an enum or true/false) rather than allowing for free form input
 * (like a number or string).
 */
export const TOGGLE_TYPES: ReadonlySet<SettingsType | undefined> = new Set([
  'boolean',
  'enum',
]);

export interface SettingEnumOption {
  value: string | number;
  label: string;
}

export interface SettingCollectionDefinition {
  type: SettingsType;
  description?: string;
  properties?: SettingsSchema;
  /** Enum type options  */
  options?: readonly SettingEnumOption[];
  /**
   * Optional reference identifier for generators that emit a `$ref`.
   * For example, a JSON schema generator can use this to point to a shared definition.
   */
  ref?: string;
}

export enum MergeStrategy {
  // Replace the old value with the new value. This is the default.
  REPLACE = 'replace',
  // Concatenate arrays.
  CONCAT = 'concat',
  // Merge arrays, ensuring unique values.
  UNION = 'union',
  // Shallow merge objects.
  SHALLOW_MERGE = 'shallow_merge',
}

export interface SettingDefinition {
  type: SettingsType;
  label: string;
  category: string;
  requiresRestart: boolean;
  default: SettingsValue;
  description?: string;
  parentKey?: string;
  childKey?: string;
  key?: string;
  properties?: SettingsSchema;
  showInDialog?: boolean;
  ignoreInDocs?: boolean;
  mergeStrategy?: MergeStrategy;
  /** Enum type options  */
  options?: readonly SettingEnumOption[];
  /**
   * For collection types (e.g. arrays), describes the shape of each item.
   */
  items?: SettingCollectionDefinition;
  /**
   * For map-like objects without explicit `properties`, describes the shape of the values.
   */
  additionalProperties?: SettingCollectionDefinition;
  /**
   * Optional reference identifier for generators that emit a `$ref`.
   */
  ref?: string;
  subSettings?: SettingsSchema;
  /**
   * For number types, the minimum allowed value.
   */
  minimum?: number;
  /**
   * For number types, the maximum allowed value.
   */
  maximum?: number;
}

export interface SettingsSchema {
  [key: string]: SettingDefinition;
}

export type MemoryImportFormat = 'tree' | 'flat';
export type DnsResolutionOrder = 'ipv4first' | 'verbatim';
export type ToolEnabledState = 'enabled' | 'disabled';
