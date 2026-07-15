/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  HookEventName,
  HookType,
  type HookDefinition,
} from '@vybestack/llxprt-code-core';

/**
 * The hooks shape used by the CLI extension loader: a record mapping valid
 * HookEventName keys to arrays of HookDefinition objects. This matches the
 * core `Config.getHooks()` return type.
 */
export interface LegacyHookEntry {
  command: string;
  args?: string[];
}

type ExecutableHooks = { [K in HookEventName]?: HookDefinition[] };
type ManifestHookEntry = HookDefinition[] | LegacyHookEntry;
type ManifestHooks = ExecutableHooks & Record<string, ManifestHookEntry>;

/** Validated manifest hooks, including the gemini-cli named-hook format. */
export type Hooks = ManifestHooks | undefined;

/**
 * Valid hook event names, matching the core HookEventName enum.
 */
const HOOK_EVENT_NAMES = Object.values(HookEventName);

/**
 * Hook config schema: a command hook with a `type` of "command" and a
 * `command` string. Optional fields: `name`, `description`, `timeout`.
 *
 * Matches the core `CommandHookConfig` / `HookConfig` types.
 */
const HOOK_CONFIG_SCHEMA = z.object({
  type: z.literal(HookType.Command),
  command: z.string().min(1, 'Hook command cannot be empty'),
  name: z.string().optional(),
  description: z.string().optional(),
  timeout: z.number().optional(),
});

/**
 * Hook definition schema: an object that contains a `hooks` array of
 * HookConfig entries. Optional fields: `matcher`, `sequential`.
 *
 * Matches the core `HookDefinition` interface.
 */
const HOOK_DEFINITION_SCHEMA = z.object({
  matcher: z.string().optional(),
  sequential: z.boolean().optional(),
  hooks: z
    .array(HOOK_CONFIG_SCHEMA)
    .min(1, 'Hook definition must contain at least one hook'),
});

/**
 * Modern hooks schema: maps valid HookEventName keys to arrays of
 * HookDefinition objects. This matches the core HookRegistry schema:
 * `{ [K in HookEventName]?: HookDefinition[] }`.
 */
export const HOOKS_SCHEMA = z
  .record(z.nativeEnum(HookEventName), z.array(HOOK_DEFINITION_SCHEMA))
  .optional();

/**
 * Legacy hook entry schema: a single command object with a `command` string
 * and optional `args` array. This is the pre-HookEventName schema used by
 * gemini-cli extensions (e.g. `{ 'pre-commit': { command: 'lint' } }`).
 */
const LEGACY_HOOK_ENTRY_SCHEMA = z.object({
  command: z.string().min(1, 'Hook command cannot be empty'),
  args: z.array(z.string()).optional(),
});

/**
 * Maximum allowed hook name length.
 */
const MAX_HOOK_NAME_LENGTH = 128;

/**
 * Reserved property names that must never be used as hook names to prevent
 * prototype pollution.
 */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate a legacy hook name string for safety. Throws on invalid names.
 *
 * Rejects:
 * - Empty or whitespace-only names
 * - Names exceeding MAX_HOOK_NAME_LENGTH
 * - Reserved prototype keys
 * - Names with characters outside [a-zA-Z0-9_-]
 */
function validateLegacyHookName(name: string): void {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('Hook name cannot be empty or whitespace-only.');
  }
  if (name.length > MAX_HOOK_NAME_LENGTH) {
    throw new Error(
      `Hook name cannot exceed ${MAX_HOOK_NAME_LENGTH} characters.`,
    );
  }
  if (RESERVED_KEYS.has(name)) {
    throw new Error(
      `Hook name "${name}" is a reserved key and cannot be used.`,
    );
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Hook name "${name}" contains invalid characters.`);
  }
}

/**
 * Validate a hooks record that may use EITHER the modern HookEventName-keyed
 * schema (HookDefinition[] values) OR the legacy named-hook schema
 * (command-object values). Discrimination is key-based:
 *
 * - If the key is a valid HookEventName, the value MUST be a HookDefinition[]
 *   (modern schema). Non-array values are rejected.
 * - If the key is NOT a valid HookEventName, the value MUST be a legacy
 *   command object `{ command: string, args?: string[] }`. The key is
 *   validated for safety (no shell metacharacters, path traversal, etc.).
 * - Array values with non-HookEventName keys are rejected as invalid event
 *   names.
 *
 * Modern: `{ BeforeTool: [{ hooks: [{ type: 'command', command: 'lint' }] }] }`
 * Legacy: `{ 'pre-commit': { command: 'lint' } }`
 *
 * @param hooks - The hooks object to validate
 * @throws Error if any hook name or definition is invalid
 * @returns The validated hooks object, typed as the core Hooks shape
 */
export function validateHooks(hooks: unknown): Hooks {
  if (hooks === undefined) {
    return undefined;
  }
  if (typeof hooks !== 'object' || hooks === null) {
    throw new Error('Invalid hooks: must be an object.');
  }

  const validEventNames = new Set<string>(HOOK_EVENT_NAMES);
  const result: ManifestHooks = {};

  // Detect prototype pollution via __proto__ key in JSON. When JSON.parse
  // encounters {"__proto__": ...}, it sets the object's prototype rather than
  // creating an own enumerable property, so Object.entries won't include it.
  // Check the prototype to catch this case.
  const hooksProto = Object.getPrototypeOf(hooks);
  if (hooksProto !== null && hooksProto !== Object.prototype) {
    throw new Error(
      'Hook name "__proto__" is a reserved key and cannot be used.',
    );
  }

  for (const [key, value] of Object.entries(hooks)) {
    const isModernKey = validEventNames.has(key);

    if (isModernKey) {
      if (!Array.isArray(value)) {
        throw new Error(`Hook definition for "${key}" must be an array.`);
      }
      const parsed = z.array(HOOK_DEFINITION_SCHEMA).parse(value);
      result[key] = parsed;
    } else if (Array.isArray(value)) {
      throw new Error(
        `Invalid hook event name: "${key}". Must be one of: ${HOOK_EVENT_NAMES.join(', ')}.`,
      );
    } else if (typeof value === 'object' && value !== null) {
      validateLegacyHookName(key);
      const parsed = LEGACY_HOOK_ENTRY_SCHEMA.parse(value);
      result[key] = parsed;
    } else {
      throw new Error(
        `Invalid hook definition for "${key}": expected an object or array.`,
      );
    }
  }
  return result;
}

/**
 * Selects executable event hooks for the core HookRegistry. Legacy named hooks
 * remain in the manifest for install/update consent, but are not core events.
 */
export function getExecutableHooks(hooks: Hooks): ExecutableHooks | undefined {
  if (hooks === undefined) {
    return undefined;
  }

  const executableEntries: Record<string, unknown> = {};
  for (const eventName of HOOK_EVENT_NAMES) {
    const value = hooks[eventName];
    if (Array.isArray(value)) {
      executableEntries[eventName] = value;
    }
  }

  const executableHooks = HOOKS_SCHEMA.parse(executableEntries);
  return Object.keys(executableHooks ?? {}).length > 0
    ? executableHooks
    : undefined;
}
