/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ActiveImageProfile } from '@vybestack/llxprt-code-core';
import {
  ephemeralSettingHelp,
  parseEphemeralSettingValue,
} from '@vybestack/llxprt-code-providers/runtime.js';
import {
  resolveAlias,
  validateSetting,
  type EphemeralSettings,
} from '@vybestack/llxprt-code-settings';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { parseValue } from './setCommand.js';
import { buildSetimageSchema } from './setimageCommandSchema.js';
import {
  CommandKind,
  type MessageActionReturn,
  type SlashCommand,
} from './types.js';

function message(
  content: string,
  messageType: 'info' | 'error' = 'info',
): MessageActionReturn {
  return { type: 'message', messageType, content };
}

function unset(
  active: ActiveImageProfile,
  parts: string[],
): MessageActionReturn {
  const [, key, subkey] = parts;
  if (!key || parts.length > (key === 'modelparam' ? 3 : 2)) {
    return message(
      'Usage: /setimage unset <key> or /setimage unset modelparam [key]',
      'error',
    );
  }
  if (key === 'modelparam') {
    const modelParams = subkey ? { ...active.profile.modelParams } : {};
    if (subkey) delete modelParams[subkey];
    getRuntimeApi().setActiveImageProfile({
      ...active,
      profile: { ...active.profile, modelParams },
    });
    return message(
      subkey
        ? `Model parameter '${subkey}' cleared`
        : 'All image model parameters cleared',
    );
  }
  const resolved = resolveAlias(key);
  if (!Object.hasOwn(ephemeralSettingHelp, resolved)) {
    return message(`Invalid setting key: ${key}`, 'error');
  }
  const ephemeralSettings: EphemeralSettings & Record<string, unknown> = {
    ...active.profile.ephemeralSettings,
  };
  delete ephemeralSettings[resolved];
  getRuntimeApi().setActiveImageProfile({
    ...active,
    profile: { ...active.profile, ephemeralSettings },
  });
  return message(`Ephemeral setting '${key}' cleared`);
}

function setModelParam(
  active: ActiveImageProfile,
  parts: string[],
): MessageActionReturn {
  if (parts.length < 3)
    return message('Usage: /setimage modelparam <key> <value>', 'error');
  const key = parts[1];
  const parsed = parseValue(parts.slice(2).join(' '));
  const validation = validateSetting(key, parsed);
  if (!validation.success)
    return message(
      validation.message ?? `Invalid value for model parameter '${key}'`,
      'error',
    );
  const value = validation.value ?? parsed;
  getRuntimeApi().setActiveImageProfile({
    ...active,
    profile: {
      ...active.profile,
      modelParams: { ...active.profile.modelParams, [key]: value },
    },
  });
  return message(
    `Model parameter '${key}' set to ${typeof value === 'string' ? value : JSON.stringify(value)}`,
  );
}

function setEphemeral(
  active: ActiveImageProfile,
  parts: string[],
): MessageActionReturn {
  const key = resolveAlias(parts[0]);
  if (parts.length < 2) {
    return Object.hasOwn(ephemeralSettingHelp, key)
      ? message(`${key}: ${ephemeralSettingHelp[key]}`)
      : message('Usage: /setimage <key> <value>', 'error');
  }
  const parsed = parseEphemeralSettingValue(key, parts.slice(1).join(' '));
  if (!parsed.success) return message(parsed.message, 'error');
  getRuntimeApi().setActiveImageProfile({
    ...active,
    profile: {
      ...active.profile,
      ephemeralSettings: {
        ...active.profile.ephemeralSettings,
        [key]: parsed.value,
      },
    },
  });
  return message(
    `Ephemeral setting '${key}' set to ${JSON.stringify(parsed.value)} (session only, use /profile save image <name> to persist)`,
  );
}

export const setimageCommand: SlashCommand = {
  name: 'setimage',
  description: 'set image model parameters or ephemeral settings',
  kind: CommandKind.BUILT_IN,
  schema: buildSetimageSchema(),
  action: async (_context, args): Promise<MessageActionReturn> => {
    const active = getRuntimeApi().getActiveImageProfile();
    if (!active)
      return message(
        'No active image configuration. Run /model image first.',
        'error',
      );
    const parts = args.trim().split(/\s+/);
    if (parts[0] === 'unset') return unset(active, parts);
    if (parts[0] === 'modelparam') return setModelParam(active, parts);
    return setEphemeral(active, parts);
  },
};
