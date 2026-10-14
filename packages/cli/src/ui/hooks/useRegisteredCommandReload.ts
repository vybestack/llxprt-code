/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useRef } from 'react';

export function useRegisteredCommandReload() {
  const reloadCommandsRef = useRef<() => void>(() => {});
  const reloadRegisteredCommands = useCallback(
    () => reloadCommandsRef.current(),
    [],
  );
  return { reloadCommandsRef, reloadRegisteredCommands };
}
