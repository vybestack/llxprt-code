/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { CommandContext } from '../commands/types.js';
import { requireSessionAgent } from '../commands/historyServiceAccess.js';

export async function writeSlashOutput(
  context: CommandContext,
  type: 'user' | 'info' | 'error',
  text: string,
  writeRawOutput: () => void,
): Promise<void> {
  if (
    Object.getOwnPropertyDescriptor(context, 'recordingOwner')?.value !==
    'agent'
  ) {
    writeRawOutput();
    return;
  }
  const agent = requireSessionAgent(context);
  const history = agent.agentClient.getHistoryService();
  if (history === null) throw new Error('Session history is unavailable');
  await history.appendDisplay(
    { type: type === 'info' ? 'slash' : type },
    text,
    agent.session,
  );
}
