/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { PerformResumeActionReturn } from '../commands/types.js';
export function bindCommandOwnerResume(
  resume: (
    action: PerformResumeActionReturn,
  ) => Promise<{ readonly warnings: readonly string[] }>,
  refresh: () => void,
): (action: PerformResumeActionReturn) => Promise<readonly string[]> {
  return async (action) => {
    const result = await resume(action);
    refresh();
    return result.warnings;
  };
}
