/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  canonicalizeToolName,
  INVALID_TOOL_NAME,
} from '@vybestack/llxprt-code-tools';

export {
  canonicalizeApiQualifiedToolName,
  canonicalizeToolName,
  INVALID_TOOL_NAME,
} from '@vybestack/llxprt-code-tools';

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
    allowed: buildGovernanceNameSet(allowedRaw),
    allowedExplicit,
    disabled: buildGovernanceNameSet(disabledRaw),
    excluded: buildGovernanceNameSet(excludedRaw),
  };
}

function buildGovernanceNameSet(rawNames: string[]): Set<string> {
  return new Set(rawNames.flatMap(getExplicitToolNameCandidates));
}

const API_TOOL_NAMESPACE_PREFIXES = new Set([
  'api',
  'function',
  'functions',
  'github',
]);

interface ParsedToolName {
  canonical: string;
  segments: string[];
  prefix: string;
}

function parseToolName(toolName: string): ParsedToolName | undefined {
  const canonical = canonicalizeToolName(toolName);
  if (canonical === INVALID_TOOL_NAME) {
    return undefined;
  }

  const segments = canonical.split('.');
  const prefix = segments[0]?.toLowerCase() ?? '';
  return { canonical, segments, prefix };
}

function appendCandidate(candidates: string[], name: string): void {
  const canonical = canonicalizeToolName(name);
  if (canonical !== INVALID_TOOL_NAME && canonical.length > 0) {
    candidates.push(canonical);
  }
}

function buildToolNameCandidates(parsed: ParsedToolName): string[] {
  const { canonical, segments, prefix } = parsed;
  const candidates = [canonical];
  const hasKnownApiPrefix = API_TOOL_NAMESPACE_PREFIXES.has(prefix);

  if (segments.length > 1 && hasKnownApiPrefix) {
    if (segments.length > 2) {
      appendCandidate(candidates, segments.slice(1).join('.'));
    }
    if (segments.length === 2 || prefix === 'api') {
      appendCandidate(candidates, segments[segments.length - 1] ?? '');
    }
  }

  return candidates;
}

export function getToolNameCandidates(toolName: string): string[] {
  const parsed = parseToolName(toolName);
  return parsed ? Array.from(new Set(buildToolNameCandidates(parsed))) : [];
}

export const getExplicitToolNameCandidates = getToolNameCandidates;

export function isToolBlocked(
  toolName: string,
  governance: ToolGovernance,
): boolean {
  const candidates = getToolNameCandidates(toolName);

  if (candidates.some((canonical) => governance.excluded.has(canonical))) {
    return true;
  }

  if (candidates.some((canonical) => governance.disabled.has(canonical))) {
    return true;
  }

  if (
    governance.allowedExplicit &&
    !candidates.some((canonical) => governance.allowed.has(canonical))
  ) {
    return true;
  }

  return false;
}
