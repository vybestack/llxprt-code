/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export function rememberCallId(
  ids: Set<string>,
  callId: string,
  limit: number,
): void {
  ids.add(callId);
  if (ids.size <= limit) return;
  for (const oldest of ids) {
    ids.delete(oldest);
    break;
  }
}
