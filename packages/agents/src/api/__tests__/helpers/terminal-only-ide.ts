/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceIdePort } from '@vybestack/llxprt-code-core';

function unavailable(): never {
  throw new Error('Terminal-only fixture does not support IDE mode');
}

/** A terminal host never acquires a desktop IDE client. */
export function createTerminalOnlyIdePort(): WorkspaceIdePort {
  return {
    isEnabled: () => false,
    setEnabled: (enabled) => {
      if (enabled) unavailable();
    },
    readConnection: () => ({ available: false, diffingEnabled: false }),
    readContext: () => undefined,
    readWorkspaceTrust: () => undefined,
    subscribeContext: () => () => {},
    subscribeWorkspaceTrust: () => () => {},
    subscribeConnection: () => () => {},
    connect: async () => {},
    disconnect: async () => {},
    openDiff: unavailable,
    resolveDiff: unavailable,
  };
}
