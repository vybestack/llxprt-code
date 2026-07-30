/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

/**
 * Resolve the workspace directories for file-path linking.
 *
 * When an explicit `workspaceDirectories` prop is provided (e.g. from a
 * parent component), it takes precedence. Otherwise the directories are
 * resolved from the active CLI runtime. If no runtime is registered, the
 * result is `undefined` and file-path linking is gracefully disabled.
 *
 * The resolution is memoized so the runtime call chain only runs when the
 * prop identity changes, avoiding unnecessary work on re-renders.
 */
export function useResolvedWorkspaceDirectories(
  workspaceDirectories?: readonly string[],
): readonly string[] | undefined {
  const { getCliRuntimeServices } = useRuntimeApi();

  return useMemo(() => {
    if (workspaceDirectories) {
      return workspaceDirectories;
    }
    try {
      return getCliRuntimeServices()
        .config.getWorkspaceContext()
        .getDirectories();
    } catch {
      return undefined;
    }
  }, [workspaceDirectories, getCliRuntimeServices]);
}
