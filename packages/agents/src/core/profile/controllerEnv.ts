/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the {@link ProfileReductionEnvironment} the pure reducer runs against.
 *
 * All async port access happens here, before reduction: provider templates are
 * materialized from the catalog, load/save targets and load-balancer members are
 * loaded from the repository, and member captures carry each standard member's
 * model menu. Records are built as plain local objects; nothing here mutates state,
 * documents, or any caller-owned record.
 */

import {
  isStandardProfileDocument,
  ProfileRepositoryConflictError,
  type CapturedStandardSource,
  type ProfileCommand,
  type ProfileDocument,
  type ProfileReductionEnvironment,
  type ProfileState,
  type SourceFingerprint,
  type StandardProfileDocument,
} from '@vybestack/llxprt-code-core';
import type { ProfileControllerDeps } from './controllerTypes.js';

/**
 * The provider a command targets, when the command materializes a provider template:
 * a `/provider` command, or a provider-only startup.
 */
function commandProvider(command: ProfileCommand): string | undefined {
  if (command.kind === 'provider') {
    return command.provider;
  }
  if (
    command.kind === 'startup' &&
    command.provider !== undefined &&
    command.profileName === undefined
  ) {
    return command.provider;
  }
  return undefined;
}

/**
 * Materialize the reduction environment for a command.
 *
 * A provider command (or a provider-only startup) prefers the catalog's restricted
 * template for the provider, falling back to a template fabricated from the provider
 * default model only when the catalog supplies none; a provider with neither is left
 * without a template so the reducer invalids it. A load command (or a profile-named
 * startup) loads the repository document and keeps the fingerprint the load returned.
 * Members of any load-balancer document in the current state or in a just-loaded
 * repository document are captured with their model menus, except the active state's
 * first member, whose committed capture is reused so an explicit fork never rereads
 * the file.
 */
export async function buildReductionEnvironment(
  state: ProfileState,
  command: ProfileCommand,
  deps: ProfileControllerDeps,
): Promise<ProfileReductionEnvironment> {
  // The environment surfaces are readonly for the reducer, so the builder
  // accumulates into plain local records and hands ownership over at return.
  const providerTemplates: Record<string, StandardProfileDocument> = {};
  const providerModelMenus: Record<string, readonly string[]> = {};
  const repository: Record<
    string,
    { document: ProfileDocument; fingerprint: SourceFingerprint }
  > = {};
  const memberCaptures: Record<string, CapturedStandardSource> = {};

  const provider = commandProvider(command);
  if (provider !== undefined) {
    const template = await deps.catalog.getProviderTemplate(provider);
    if (template !== undefined) {
      providerTemplates[provider] = template;
    } else {
      const model = await deps.catalog.getDefaultModel(provider);
      // settings-backed adapter materializes restricted connection defaults at cutover #2640
      if (model !== undefined) {
        providerTemplates[provider] = {
          version: 1,
          type: 'standard',
          provider,
          model,
          modelParams: {},
          ephemeralSettings: {},
        };
      }
    }
    if (provider in providerTemplates) {
      const menu = await catalogModelMenu(provider, deps);
      if (menu !== undefined) {
        providerModelMenus[provider] = menu;
      }
    }
  }

  let loadedName: string | undefined;
  if (command.kind === 'load') {
    loadedName = command.name;
  } else if (command.kind === 'startup' && command.profileName !== undefined) {
    loadedName = command.profileName;
  }

  const loadedDocuments: ReadonlyArray<{
    name: string;
    document: ProfileDocument;
  }> =
    loadedName === undefined
      ? []
      : await loadRepositoryEntry(loadedName, repository, deps);

  await captureMembers(state, loadedDocuments, memberCaptures, deps);

  return {
    providerTemplates,
    providerModelMenus,
    repository,
    memberCaptures,
    isApplicationOwnedKey: deps.isApplicationOwnedKey,
  };
}

/**
 * Capture a provider's model menu before reduction runs. A catalog that offers no menu
 * leaves no entry: the reducer then treats a chosen model as unverified instead of
 * invalid, matching the environment contract.
 */
async function catalogModelMenu(
  provider: string,
  deps: ProfileControllerDeps,
): Promise<readonly string[] | undefined> {
  try {
    return await deps.catalog.listModels(provider);
  } catch {
    return undefined;
  }
}

async function loadRepositoryEntry(
  name: string,
  repository: Record<
    string,
    { document: ProfileDocument; fingerprint: SourceFingerprint }
  >,
  deps: ProfileControllerDeps,
): Promise<ReadonlyArray<{ name: string; document: ProfileDocument }>> {
  let entry: {
    document: ProfileDocument;
    fingerprint: SourceFingerprint;
  };
  try {
    entry = await deps.repository.load(name);
  } catch (error) {
    if (error instanceof ProfileRepositoryConflictError) {
      throw error;
    }
    return [];
  }
  // The fingerprint paired with the document is the one the load itself returned:
  // a separate stat afterwards could observe a newer file and pair it with the
  // older document, so identity and captures always share the load's pairing.
  repository[name] = {
    document: entry.document,
    fingerprint: entry.fingerprint,
  };
  return [{ name, document: entry.document }];
}

async function captureMembers(
  state: ProfileState,
  loadedDocuments: ReadonlyArray<{ name: string; document: ProfileDocument }>,
  memberCaptures: Record<string, CapturedStandardSource>,
  deps: ProfileControllerDeps,
): Promise<void> {
  const memberNames: string[] = [];
  const seen = new Set<string>();
  const add = (name: string): void => {
    if (!seen.has(name)) {
      seen.add(name);
      memberNames.push(name);
    }
  };

  const stateDocument =
    state.status === 'configured' ? state.document : undefined;
  if (stateDocument !== undefined && stateDocument.type === 'loadbalancer') {
    for (const member of stateDocument.profiles) {
      add(member);
    }
    // The live load-balancer state already holds the immutable capture of its
    // first member: an explicit-member fork of that member must fork the capture
    // the workspace committed with, never a fresh reread of the file.
    if (state.status === 'configured' && state.activeMember !== undefined) {
      memberCaptures[stateDocument.profiles[0]] = state.activeMember;
    }
  }
  for (const entry of loadedDocuments) {
    if (entry.document.type === 'loadbalancer') {
      for (const member of entry.document.profiles) {
        add(member);
      }
    }
  }

  for (const member of memberNames) {
    if (Object.prototype.hasOwnProperty.call(memberCaptures, member) === true) {
      continue;
    }
    await captureMember(member, memberCaptures, deps);
  }
}

async function captureMember(
  member: string,
  memberCaptures: Record<string, CapturedStandardSource>,
  deps: ProfileControllerDeps,
): Promise<void> {
  let document: ProfileDocument;
  try {
    const entry = await deps.repository.load(member);
    document = entry.document;
  } catch {
    return;
  }
  if (!isStandardProfileDocument(document)) {
    return;
  }
  const models = (await catalogModelMenu(document.provider, deps)) ?? [];
  memberCaptures[member] = {
    revision: 0,
    provider: document.provider,
    sourceDocument: document,
    models,
  };
}
