/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Durable skill & extension config (REQ-021).
 *
 * Skills wrap the real `SkillManager` (`@vybestack/llxprt-code-core`):
 * `getAllSkills`/`getSkills`/`setDisabledSkills`. The disabled set is persisted
 * via `SettingsService` (`disabledSkills` key) so the choice survives beyond a
 * single manager instance and is reapplied on the manager.
 *
 * Extensions wrap a real `ExtensionLoader.getExtensions()` (active extension
 * list) and persist the durable disabled set via `SettingsService`
 * (`disabledExtensions` key). No live `Agent` instance required.
 */

import type {
  ManageSkillsInput,
  ManageSkillsResult,
  ManageSkillsSkill,
  ManageExtensionsInput,
  ManageExtensionsResult,
  ManageExtensionsExtension,
} from './types.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

const DISABLED_SKILLS_KEY = 'disabledSkills';
const DISABLED_EXTENSIONS_KEY = 'disabledExtensions';

function readStringSet(
  settingsService: SettingsService | undefined,
  key: string,
): string[] {
  if (settingsService === undefined) {
    return [];
  }
  const raw = settingsService.get(key);
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

function applyDisabledChange(
  current: readonly string[],
  names: readonly string[],
  action: 'enable' | 'disable',
): string[] {
  const set = new Set(current);
  if (action === 'disable') {
    for (const name of names) {
      set.add(name);
    }
  } else {
    for (const name of names) {
      set.delete(name);
    }
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/**
 * List, enable, or disable skills. Mutations update the manager's disabled
 * flags and persist the durable disabled set via SettingsService when provided.
 */
export function manageSkills(input: ManageSkillsInput): ManageSkillsResult {
  let disabled = readStringSet(input.settingsService, DISABLED_SKILLS_KEY);

  if (input.action !== 'list') {
    disabled = applyDisabledChange(disabled, input.names ?? [], input.action);
    input.manager.setDisabledSkills(disabled);
    if (input.settingsService !== undefined) {
      input.settingsService.set(DISABLED_SKILLS_KEY, disabled);
    }
  } else if (disabled.length > 0) {
    // Reapply the durable disabled set so the listing reflects persisted state.
    input.manager.setDisabledSkills(disabled);
  }

  const skills: ManageSkillsSkill[] = input.manager
    .getAllSkills()
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      disabled: skill.disabled === true,
      source: skill.source,
    }));

  return { action: input.action, skills, disabled };
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

/**
 * List, enable, or disable extensions. The active list is read from the real
 * loader; the durable disabled set is persisted via SettingsService.
 */
export function manageExtensions(
  input: ManageExtensionsInput,
): ManageExtensionsResult {
  let disabled = readStringSet(input.settingsService, DISABLED_EXTENSIONS_KEY);

  if (input.action !== 'list') {
    disabled = applyDisabledChange(disabled, input.names ?? [], input.action);
    if (input.settingsService !== undefined) {
      input.settingsService.set(DISABLED_EXTENSIONS_KEY, disabled);
    }
  }

  const disabledSet = new Set(disabled);
  const extensions: ManageExtensionsExtension[] = input.loader
    .getExtensions()
    .map((extension) => ({
      name: extension.name,
      version: extension.version,
      isActive: extension.isActive,
      disabled: disabledSet.has(extension.name),
    }));

  return { action: input.action, extensions, disabled };
}
