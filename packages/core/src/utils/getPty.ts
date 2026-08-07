/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Subset of the node-pty module API used by the shell execution service. */
import type { IPty } from '@lydell/node-pty';
import type { PtyExecutionMethod } from '../services/shellExecutionTypes.js';
import { isBunPosix } from './runtime.js';
import { createBunPty } from './bunPtyAdapter.js';

export interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      cwd?: string;
      name?: string;
      cols?: number;
      rows?: number;
      env?: Record<string, string | undefined>;
      handleFlowControl?: boolean;
    },
  ): IPty;
}

export type PtyImplementation = {
  module: PtyModule;
  name: PtyExecutionMethod;
} | null;

/**
 * How the node-pty backends are loaded.
 *
 * Injectable so the backend-selection logic can be exercised with a backend
 * that loads and one that does not, on every runtime. Substituting the module
 * registry instead is not portable: this package's suites run under Bun, whose
 * test runner cannot reset the registry and evaluates a module-mock factory
 * once, eagerly — so a per-test module mock silently yields the real module
 * (issue #3061).
 */
export interface PtyBackendLoaders {
  loadPrimary: () => Promise<PtyModule>;
  loadFallback: () => Promise<PtyModule>;
}

const DEFAULT_PTY_BACKEND_LOADERS: PtyBackendLoaders = {
  loadPrimary: () => import('@lydell/node-pty'),
  loadFallback: () => import('node-pty'),
};

export async function loadNodePty(
  loaders: PtyBackendLoaders = DEFAULT_PTY_BACKEND_LOADERS,
): Promise<PtyImplementation> {
  try {
    const module = await loaders.loadPrimary();
    return { module, name: 'lydell-node-pty' };
  } catch {
    try {
      const module = await loaders.loadFallback();
      return { module, name: 'node-pty' };
    } catch {
      return null;
    }
  }
}

/**
 * Resolve the PTY implementation for the current runtime.
 *
 * - **Bun + POSIX**: a `Bun.Terminal` adapter (`bun-pty`). `@lydell/node-pty`
 *   silently hangs under Bun POSIX (oven-sh/bun#25822), so it is bypassed.
 * - **Node / Windows**: `@lydell/node-pty` (preferred) with a `node-pty`
 *   fallback.
 */
export const getPty = async (
  loaders: PtyBackendLoaders = DEFAULT_PTY_BACKEND_LOADERS,
): Promise<PtyImplementation> => {
  if (isBunPosix()) {
    return {
      module: {
        spawn: (file, args, options) => createBunPty(file, args, options),
      },
      name: 'bun-pty',
    };
  }

  return loadNodePty(loaders);
};
