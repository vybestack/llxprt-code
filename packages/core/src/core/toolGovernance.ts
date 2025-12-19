/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeToolName, toSnakeCase } from '../tools/toolNameUtils.js';

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

export interface ToolGovernanceConfig {
  getEphemeralSettings?: () => Record<string, unknown> | undefined;
  getExcludeTools?: () => string[] | undefined;
}

export interface ToolGovernance {
  allowed: Set<string>;
  disabled: Set<string>;
  excluded: Set<string>;
}

function hasMultipleWords(name: string): boolean {
  const withoutFirst = name.slice(1);
  return /[A-Z]/.test(withoutFirst) || name.includes('_') || name.includes('-');
}

export function canonicalizeToolName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return '';
  }

  let nameToProcess = trimmed;

  if (trimmed.endsWith('Tool') && trimmed.length > 4) {
    const withoutTool = trimmed.slice(0, -4);
    if (hasMultipleWords(withoutTool)) {
      nameToProcess = withoutTool;
    }
  }

  const normalized = normalizeToolName(nameToProcess);
  if (normalized !== null) {
    return normalized;
  }

  return toSnakeCase(nameToProcess).toLowerCase();
}

export function buildToolGovernance(
  config: ToolGovernanceConfig,
): ToolGovernance {
  const ephemerals =
    typeof config.getEphemeralSettings === 'function'
      ? (config.getEphemeralSettings() ?? {})
      : {};

  const allowedRaw = isStringArray(ephemerals['tools.allowed'])
    ? ephemerals['tools.allowed']
    : [];

  const disabledRaw = isStringArray(ephemerals['tools.disabled'])
    ? ephemerals['tools.disabled']
    : isStringArray(ephemerals['disabled-tools'])
      ? ephemerals['disabled-tools']
      : [];

  const excludedRaw =
    typeof config.getExcludeTools === 'function'
      ? (config.getExcludeTools() ?? [])
      : [];

  return {
    allowed: new Set(allowedRaw.map(canonicalizeToolName)),
    disabled: new Set(disabledRaw.map(canonicalizeToolName)),
    excluded: new Set(excludedRaw.map(canonicalizeToolName)),
  };
}

export function isToolBlocked(
  toolName: string,
  governance: ToolGovernance,
): boolean {
  const canonical = canonicalizeToolName(toolName);

  if (governance.excluded.has(canonical)) {
    return true;
  }

  if (governance.disabled.has(canonical)) {
    return true;
  }

  if (governance.allowed.size > 0 && !governance.allowed.has(canonical)) {
    return true;
  }

  return false;
}
