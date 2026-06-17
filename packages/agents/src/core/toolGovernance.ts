/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { canonicalizeToolName } from '@vybestack/llxprt-code-tools';

export { canonicalizeToolName };

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
  /**
   * Whether an explicit allowlist was provided (even if empty).
   *
   * - `false`: no explicit allowlist → unrestricted (runtime/profile defaults
   *   apply). Disabled/excluded still block.
   * - `true`: an explicit allowlist was provided. When `allowed` is empty,
   *   this means "block all normal tools" (fail-closed).
   */
  allowedExplicit: boolean;
  disabled: Set<string>;
  excluded: Set<string>;
}

export function buildToolGovernance(
  config: ToolGovernanceConfig,
): ToolGovernance {
  const ephemerals =
    typeof config.getEphemeralSettings === 'function'
      ? (config.getEphemeralSettings() ?? {})
      : {};

  const allowedValue = ephemerals['tools.allowed'];
  const allowedExplicit = isStringArray(allowedValue);
  const allowedRaw: string[] = allowedExplicit ? allowedValue : [];

  let disabledRaw: string[];
  if (isStringArray(ephemerals['tools.disabled'])) {
    disabledRaw = ephemerals['tools.disabled'];
  } else if (isStringArray(ephemerals['disabled-tools'])) {
    disabledRaw = ephemerals['disabled-tools'];
  } else {
    disabledRaw = [];
  }

  const excludedRaw =
    typeof config.getExcludeTools === 'function'
      ? (config.getExcludeTools() ?? [])
      : [];

  return {
    allowed: new Set(allowedRaw.map(canonicalizeToolName)),
    allowedExplicit,
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

  if (governance.allowedExplicit && !governance.allowed.has(canonical)) {
    return true;
  }

  return false;
}
