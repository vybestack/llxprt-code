/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LlxprtExtension, IdeInfo } from '@vybestack/llxprt-code-core';
import type { SubagentView } from '../../components/SubagentManagement/types.js';
import type { ModelsDialogData } from '../../commands/types.js';
import type {
  DialogKind,
  DialogPayloadMap,
  DialogRequest,
  DialogStore,
} from './dialogStore.js';

/**
 * A single stable open/close handle per dialog kind routed through the
 * DialogStore. The AppContainerRuntime builds one DialogOpeners object once
 * from the store commands and threads it through the slash-command pipeline.
 */
export type DialogOpeners = {
  workspaceMigration: {
    open: (payload: { extensions: LlxprtExtension[] }) => void;
    close: () => void;
  };
  idePrompt: {
    open: (payload: { ide: IdeInfo }) => void;
    close: () => void;
  };
  folderTrust: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  welcome: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  theme: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  settings: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  auth: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  oauthCode: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  editor: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  provider: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  loadProfile: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  createProfile: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  profileList: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  profileDetail: {
    open: (payload: { profileName: string }) => void;
    close: () => void;
  };
  profileEditor: {
    open: (payload: { profileName: string }) => void;
    close: () => void;
  };
  tools: {
    open: (payload: { action: 'enable' | 'disable' }) => void;
    close: () => void;
  };
  permissions: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  logging: {
    open: (payload: { entries: unknown[] }) => void;
    close: () => void;
  };
  subagent: {
    open: (payload: {
      initialView?: SubagentView;
      initialName?: string;
    }) => void;
    close: () => void;
  };
  privacy: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  models: {
    open: (payload: ModelsDialogData) => void;
    close: () => void;
  };
  sessionBrowser: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  modelConfig: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  policies: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
};

/**
 * One stable open/close handle routed through the DialogStore for a single
 * dialog kind. The payload type follows DialogPayloadMap so a kind cannot
 * be opened with the wrong payload shape.
 */
function createKindOpener<K extends DialogKind>(
  store: DialogStore,
  kind: K,
): {
  open: (payload: DialogPayloadMap[K]) => void;
  close: () => void;
} {
  return {
    open: (payload) =>
      store.commands.openDialog({ kind, payload } as DialogRequest),
    close: () => store.commands.closeDialog(kind),
  };
}

/**
 * Openers for kinds whose payload is only the open request itself
 * (Record<string, never> in DialogPayloadMap).
 */
function createVoidPayloadOpeners(
  store: DialogStore,
): Pick<
  DialogOpeners,
  | 'folderTrust'
  | 'welcome'
  | 'theme'
  | 'settings'
  | 'auth'
  | 'oauthCode'
  | 'editor'
  | 'provider'
  | 'loadProfile'
  | 'createProfile'
  | 'profileList'
  | 'permissions'
  | 'privacy'
  | 'sessionBrowser'
  | 'modelConfig'
  | 'policies'
> {
  return {
    folderTrust: createKindOpener(store, 'folderTrust'),
    welcome: createKindOpener(store, 'welcome'),
    theme: createKindOpener(store, 'theme'),
    settings: createKindOpener(store, 'settings'),
    auth: createKindOpener(store, 'auth'),
    oauthCode: createKindOpener(store, 'oauthCode'),
    editor: createKindOpener(store, 'editor'),
    provider: createKindOpener(store, 'provider'),
    loadProfile: createKindOpener(store, 'loadProfile'),
    createProfile: createKindOpener(store, 'createProfile'),
    profileList: createKindOpener(store, 'profileList'),
    permissions: createKindOpener(store, 'permissions'),
    privacy: createKindOpener(store, 'privacy'),
    sessionBrowser: createKindOpener(store, 'sessionBrowser'),
    modelConfig: createKindOpener(store, 'modelConfig'),
    policies: createKindOpener(store, 'policies'),
  };
}

/** Openers for kinds that carry a typed payload. */
function createPayloadOpeners(
  store: DialogStore,
): Pick<
  DialogOpeners,
  | 'workspaceMigration'
  | 'idePrompt'
  | 'profileDetail'
  | 'profileEditor'
  | 'tools'
  | 'logging'
  | 'subagent'
  | 'models'
> {
  return {
    workspaceMigration: createKindOpener(store, 'workspaceMigration'),
    idePrompt: createKindOpener(store, 'idePrompt'),
    profileDetail: createKindOpener(store, 'profileDetail'),
    profileEditor: createKindOpener(store, 'profileEditor'),
    tools: createKindOpener(store, 'tools'),
    logging: createKindOpener(store, 'logging'),
    subagent: createKindOpener(store, 'subagent'),
    models: createKindOpener(store, 'models'),
  };
}

export function createDialogOpeners(store: DialogStore): DialogOpeners {
  return {
    ...createVoidPayloadOpeners(store),
    ...createPayloadOpeners(store),
  };
}
