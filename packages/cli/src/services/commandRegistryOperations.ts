/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CoreEvent, coreEvents } from '@vybestack/llxprt-code-core';
import { CommandService } from './CommandService.js';
import {
  BuiltinCommandLoader,
  type BuiltinCommandOwners,
} from './BuiltinCommandLoader.js';
import type { ICommandLoader } from './types.js';
import type { SlashCommand } from '../ui/commands/types.js';

export type ReadBuiltinCommands = (
  owners: BuiltinCommandOwners,
) => readonly SlashCommand[];
export type LoadRegisteredCommands = (
  owners: BuiltinCommandOwners,
  signal: AbortSignal,
) => Promise<readonly SlashCommand[]>;
export type SubscribeCommandChanges = (
  reload: () => void,
) => (() => void) | undefined;

export function createBuiltinCommandLoaderFactory(
  readHooksEnabled: () => boolean,
  readSkillsEnabled: () => boolean,
  readAdminSkillsEnabled: () => boolean,
  readExtensionPolicy: () => ((name: string, path: string) => boolean) | null,
): (owners: BuiltinCommandOwners) => BuiltinCommandLoader {
  return (owners) =>
    new BuiltinCommandLoader(
      owners,
      readHooksEnabled,
      readSkillsEnabled,
      readAdminSkillsEnabled,
      readExtensionPolicy(),
    );
}

export function createRegisteredCommandLoader(
  createBuiltinLoader: (owners: BuiltinCommandOwners) => ICommandLoader,
  createMcpLoader: () => ICommandLoader,
  createFileLoader: () => ICommandLoader,
): LoadRegisteredCommands {
  return async (owners, signal) => {
    const loaders: ICommandLoader[] = [createBuiltinLoader(owners)];
    if (process.env.LLXPRT_CODE_BUILTIN_COMMANDS_ONLY !== 'true') {
      loaders.unshift(createMcpLoader());
      loaders.push(createFileLoader());
    }
    const service = await CommandService.create(loaders, signal);
    return service.getCommands();
  };
}

export function createCommandChangeSubscription(
  subscribeIde: (listener: () => void) => (() => void) | undefined,
  subscribeMcp: (listener: () => void) => (() => void) | undefined,
): SubscribeCommandChanges {
  return (reload) => {
    const listener = () => reload();
    const removeIde = subscribeIde(listener);
    const removeMcp = subscribeMcp(listener);
    coreEvents.on(CoreEvent.FolderTrustChanged, listener);
    return () => {
      removeIde?.();
      removeMcp?.();
      coreEvents.off(CoreEvent.FolderTrustChanged, listener);
    };
  };
}
