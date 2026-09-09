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
  permissions: {
    open: (payload: Record<string, never>) => void;
    close: () => void;
  };
  logging: {
    open: (payload: { entries: unknown[] }) => void;
    close: () => void;
  };
  subagent: {
    open: (payload: { initialView?: SubagentView; initialName?: string }) => void;
    close: () => void;
  };
};

export function createDialogOpeners(store: DialogStore): DialogOpeners {
  return {
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
