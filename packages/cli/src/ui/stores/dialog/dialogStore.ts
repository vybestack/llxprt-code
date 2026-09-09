/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';
import { createStore, type Store } from '../createStore.js';
import type { LlxprtExtension, IdeInfo } from '@vybestack/llxprt-code-core';
import type { SubagentView } from '../../components/SubagentManagement/types.js';
import type {
  WelcomeState,
  ModelInfo,
} from '../../hooks/useWelcomeOnboarding.js';
import type { ModelsDialogData } from '../../commands/types.js';

export interface ConfirmationRequest {
  prompt: ReactNode;
  onConfirm: (confirmed: boolean) => void;
}

export interface DialogPayloadMap {
  workspaceMigration: { extensions: LlxprtExtension[] };
  idePrompt: { ide: IdeInfo };
  folderTrust: Record<string, never>;
  welcome: {
    state: WelcomeState;
    availableProviders: string[];
    availableModels: ModelInfo[];
  };
  confirmation: ConfirmationRequest;
  extensionUpdateConfirm: ConfirmationRequest;
  theme: Record<string, never>;
  settings: Record<string, never>;
  auth: Record<string, never>;
  oauthCode: Record<string, never>;
  editor: Record<string, never>;
  provider: Record<string, never>;
  loadProfile: Record<string, never>;
  createProfile: Record<string, never>;
  profileList: Record<string, never>;
  profileDetail: { profileName: string };
  profileEditor: { profileName: string };
  tools: { action: 'enable' | 'disable' };
  privacy: Record<string, never>;
  permissions: Record<string, never>;
  logging: { entries: unknown[] };
  subagent: { initialView?: SubagentView; initialName?: string };
  models: ModelsDialogData;
  sessionBrowser: Record<string, never>;
  modelConfig: Record<string, never>;
  policies: Record<string, never>;
}

export type DialogKind = keyof DialogPayloadMap;

export type DialogRequest = {
  [K in DialogKind]: {
    kind: K;
    payload: DialogPayloadMap[K];
  };
}[DialogKind];

export type ConfirmationDialogRequest = DialogRequest & {
  kind: 'confirmation' | 'extensionUpdateConfirm';
};

export interface DialogState {
  requests: DialogRequest[];
  confirmationRequest: Extract<DialogRequest, { kind: 'confirmation' }> | null;
  confirmUpdateLlxprtExtensionRequests: Array<
    Extract<DialogRequest, { kind: 'extensionUpdateConfirm' }>
  >;
}

export interface DialogCommands {
  openDialog: (request: DialogRequest) => void;
  closeDialog: (kind: DialogKind) => void;
  updateDialogPayload: <K extends DialogKind>(
    kind: K,
    patch: Partial<DialogPayloadMap[K]>,
  ) => void;
  setConfirmationRequest: (
    request: Extract<DialogRequest, { kind: 'confirmation' }> | null,
  ) => void;
  addConfirmUpdateExtensionRequest: (
    request: Extract<DialogRequest, { kind: 'extensionUpdateConfirm' }>,
  ) => void;
  resolveConfirmUpdateExtensionRequest: (
    request: Extract<DialogRequest, { kind: 'extensionUpdateConfirm' }>,
  ) => void;
}

export interface DialogStore {
  store: Store<DialogState>;
  commands: DialogCommands;
}

/**
 * Dialog render priority, matching today's DialogManager if-chain order:
 * early dialogs first (workspaceMigration through extensionUpdateConfirm), then the
 * body order. Lower index renders first when multiple dialogs are open.
 */
export const DIALOG_PRIORITY: readonly DialogKind[] = [
  'workspaceMigration',
  'idePrompt',
  'folderTrust',
  'welcome',
  'confirmation',
  'extensionUpdateConfirm',
  'theme',
  'settings',
  'auth',
  'oauthCode',
  'editor',
  'provider',
  'loadProfile',
  'createProfile',
  'profileList',
  'profileDetail',
  'profileEditor',
  'tools',
  'privacy',
  'permissions',
  'logging',
  'subagent',
  'models',
  'sessionBrowser',
  'modelConfig',
  'policies',
] as const;

const priorityIndex = new Map<DialogKind, number>(
  DIALOG_PRIORITY.map((kind, index) => [kind, index]),
);

function dialogPriority(kind: DialogKind): number {
  const index = priorityIndex.get(kind);
  if (index === undefined) {
    throw new Error(`Unknown dialog kind: ${kind}`);
  }
  return index;
}

function initialDialogState(): DialogState {
  return {
    requests: [],
    confirmationRequest: null,
    confirmUpdateLlxprtExtensionRequests: [],
  };
}

/**
 * Highest-priority dialog that would render right now. Includes the confirmation
 * slot and the head of the extension-update-confirm FIFO at their ranked
 * positions.
 */
export function selectActiveDialog(state: DialogState): DialogRequest | null {
  const candidates: DialogRequest[] = [...state.requests];
  if (state.confirmationRequest) {
    candidates.push(state.confirmationRequest);
  }
  const fifo = state.confirmUpdateLlxprtExtensionRequests;
  if (fifo.length > 0) {
    candidates.push(fifo[0]);
  }
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((best, candidate) =>
    dialogPriority(candidate.kind) < dialogPriority(best.kind)
      ? candidate
      : best,
  );
}

function createExtensionConfirmCommands(
  store: Store<DialogState>,
): Pick<
  DialogCommands,
  'addConfirmUpdateExtensionRequest' | 'resolveConfirmUpdateExtensionRequest'
> {
  const addConfirmUpdateExtensionRequest = (
    request: Extract<DialogRequest, { kind: 'extensionUpdateConfirm' }>,
  ): void => {
    store.setState((prev) => ({
      ...prev,
      confirmUpdateLlxprtExtensionRequests: [
        ...prev.confirmUpdateLlxprtExtensionRequests,
        request,
      ],
    }));
  };

  const resolveConfirmUpdateExtensionRequest = (
    request: Extract<DialogRequest, { kind: 'extensionUpdateConfirm' }>,
  ): void => {
    store.setState((prev) => ({
      ...prev,
      confirmUpdateLlxprtExtensionRequests:
        prev.confirmUpdateLlxprtExtensionRequests.filter((r) => r !== request),
    }));
  };

  return {
    addConfirmUpdateExtensionRequest,
    resolveConfirmUpdateExtensionRequest,
  };
}

export function createDialogStore(): DialogStore {
  const store = createStore<DialogState>(initialDialogState());

  const openDialog = (request: DialogRequest): void => {
    if (request.kind === 'confirmation') {
      store.setState((prev) => ({ ...prev, confirmationRequest: request }));
      return;
    }
    if (request.kind === 'extensionUpdateConfirm') {
      store.setState((prev) => ({
        ...prev,
        confirmUpdateLlxprtExtensionRequests: [
          ...prev.confirmUpdateLlxprtExtensionRequests,
          request,
        ],
      }));
      return;
    }
    store.setState((prev) => {
      const existing = prev.requests.find((r) => r.kind === request.kind);
      if (!existing) {
        return { ...prev, requests: [...prev.requests, request] };
      }
      // Same kind already open: replace payload in place (idempotent reopen).
      return {
        ...prev,
        requests: prev.requests.map((r) =>
          r.kind === request.kind ? request : r,
        ),
      };
    });
  };

  const closeDialog = (kind: DialogKind): void => {
    store.setState((prev) => ({
      ...prev,
      requests: prev.requests.filter((r) => r.kind !== kind),
    }));
  };

  const updateDialogPayload = <K extends DialogKind>(
    kind: K,
    patch: Partial<DialogPayloadMap[K]>,
  ): void => {
    store.setState((prev) => ({
      ...prev,
      requests: prev.requests.map((r) => {
        if (r.kind !== kind) {
          return r;
        }
        return {
          ...r,
          payload: { ...r.payload, ...patch },
        } as DialogRequest;
      }),
    }));
  };

  const setConfirmationRequest = (
    request: Extract<DialogRequest, { kind: 'confirmation' }> | null,
  ): void => {
    store.setState((prev) => ({ ...prev, confirmationRequest: request }));
  };

  const extensionConfirmCommands = createExtensionConfirmCommands(store);

  return {
    store,
    commands: {
      openDialog,
      closeDialog,
      updateDialogPayload,
      setConfirmationRequest,
      addConfirmUpdateExtensionRequest:
        extensionConfirmCommands.addConfirmUpdateExtensionRequest,
      resolveConfirmUpdateExtensionRequest:
        extensionConfirmCommands.resolveConfirmUpdateExtensionRequest,
    },
  };
}
