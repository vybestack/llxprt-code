/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** Trim a checkpoint name and reject an empty one. */
export function requireCheckpointName(operation: string, name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error(`Cannot ${operation}: name must not be empty`);
  }
  return trimmed;
}
