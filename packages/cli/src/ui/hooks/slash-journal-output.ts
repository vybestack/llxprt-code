/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core';

export async function writeSlashOutput(
  history: HistoryService | null,
  origin: Parameters<HistoryService['appendDisplay']>[2],
  recordingOwner: 'agent' | undefined,
  type: 'user' | 'info' | 'error',
  text: string,
  writeRawOutput: () => void,
): Promise<void> {
  if (recordingOwner !== 'agent') {
    writeRawOutput();
    return;
  }
  if (history === null) throw new Error('Session history is unavailable');
  await history.appendDisplay(
    { type: type === 'info' ? 'slash' : type },
    text,
    origin,
  );
}
