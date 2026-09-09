/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SubagentView } from '../../components/SubagentManagement/types.js';
import type { DialogStore } from './dialogStore.js';

/**
 * A single stable open/close handle per dialog kind routed through the
 * DialogStore. The AppContainerRuntime builds one DialogOpeners object once
 * from the store commands and threads it through the slash-command pipeline.
 */
export type DialogOpeners = {
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
};

export function createDialogOpeners(store: DialogStore): DialogOpeners {
  return {
    theme: {
      open: (payload) => store.commands.openDialog({ kind: 'theme', payload }),
      close: () => store.commands.closeDialog('theme'),
    },
    settings: {
      open: (payload) =>
        store.commands.openDialog({ kind: 'settings', payload }),
      close: () => store.commands.closeDialog('settings'),
    },
    auth: {
      open: (payload) => store.commands.openDialog({ kind: 'auth', payload }),
      close: () => store.commands.closeDialog('auth'),
    },
    oauthCode: {
      open: (payload) =>
        store.commands.openDialog({ kind: 'oauthCode', payload }),
      close: () => store.commands.closeDialog('oauthCode'),
    },
    editor: {
      open: (payload) => store.commands.openDialog({ kind: 'editor', payload }),
      close: () => store.commands.closeDialog('editor'),
    },
    provider: {
      open: (payload) =>
        store.commands.openDialog({ kind: 'provider', payload }),
      close: () => store.commands.closeDialog('provider'),
    },
    loadProfile: {
      open: (payload) =>
        store.commands.openDialog({ kind: 'loadProfile', payload }),
      close: () => store.commands.closeDialog('loadProfile'),
    },
    createProfile: {
      open: (payload) =>
        store.commands.openDialog({ kind: 'createProfile', payload }),
      close: () => store.commands.closeDialog('createProfile'),
    },
    profileList: {
      open: (payload) =>
        store.commands.openDialog({ kind: 'profileList', payload }),
      close: () => store.commands.closeDialog('profileList'),
    },
    profileDetail: {
      open: (payload) =>
        store.commands.openDialog({ kind: 'profileDetail', payload }),
      close: () => store.commands.closeDialog('profileDetail'),
    },
    profileEditor: {
      open: (payload) =>
        store.commands.openDialog({ kind: 'profileEditor', payload }),
      close: () => store.commands.closeDialog('profileEditor'),
    },
    tools: {
      open: (payload) => store.commands.openDialog({ kind: 'tools', payload }),
      close: () => store.commands.closeDialog('tools'),
    },
    permissions: {
      open: (payload) =>
        store.commands.openDialog({ kind: 'permissions', payload }),
      close: () => store.commands.closeDialog('permissions'),
    },
    logging: {
      open: (payload) =>
        store.commands.openDialog({ kind: 'logging', payload }),
      close: () => store.commands.closeDialog('logging'),
    },
    subagent: {
      open: (payload) =>
        store.commands.openDialog({ kind: 'subagent', payload }),
      close: () => store.commands.closeDialog('subagent'),
    },
  };
}
