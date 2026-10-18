/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
import { OwnerDictionary } from '../../../journal/ownerDictionary.js';
import { HistoryService } from '../../../services/history/HistoryService.js';
import type { IContent } from '../../../services/history/IContent.js';
import type { JournalSession } from '../../../services/history/journalSession.js';
import { JournalRecordingService } from '../../journalRecordingService.js';
import { SessionDiscovery } from '../../SessionDiscovery.js';
import {
  SessionTransitionService,
  type ForkResult,
} from '../../SessionTransitionService.js';
import { PROJECT, journalSeams } from './recordedJournals.js';
import type { ContinueTarget } from '../../types.js';

export interface OwnedContent {
  readonly content: IContent;
  readonly origin: string | undefined;
}

export function useForkProof(): {
  history(): HistoryService;
  recorder(chatsDir: string, sessionId: string): JournalRecordingService;
  keep<T extends { dispose(): Promise<void> }>(value: T): T;
} {
  const resources: Array<{ dispose(): Promise<void> }> = [];
  const keep = <T extends { dispose(): Promise<void> }>(value: T): T => {
    resources.push(value);
    return value;
  };
  afterEach(async () => {
    for (const resource of resources.splice(0)) await resource.dispose();
  });
  return {
    keep,
    history: () => keep(new HistoryService({ backend: 'journal' })),
    recorder: (chatsDir, sessionId) =>
      keep(
        JournalRecordingService.create({
          sessionId,
          chatsDir,
          projectHash: PROJECT,
          workspaceDirs: ['/work'],
          provider: 'mistral',
          model: 'model',
          journal: journalSeams(),
        }),
      ),
  };
}

export async function ownedRows(
  session: JournalSession,
): Promise<OwnedContent[]> {
  const owners = await OwnerDictionary.load(session.store);
  const found: OwnedContent[] = [];
  for await (const { entry, content } of session.rows()) {
    const origin = owners.originOf(entry.owner);
    if (entry.owner !== 0 && origin === undefined) {
      throw new Error(`Missing origin for owner ${entry.owner}`);
    }
    found.push({ content, origin });
  }
  return found;
}

export async function primaryRows(
  history: HistoryService,
): Promise<OwnedContent[]> {
  return history.detachedValues.host().journal.readRows(async (view) => {
    const found: OwnedContent[] = [];
    for await (const content of view.rows()) {
      found.push({ content, origin: await view.originAt(found.length) });
    }
    return found;
  });
}

export async function forkCheckpoint(
  chats: string,
  name: string,
): Promise<ForkResult & { readonly recording: JournalRecordingService }> {
  const found = await SessionDiscovery.listContinueTargetsDetailedBounded(
    chats,
    PROJECT,
  );
  const target = found.targets.find(
    (candidate): candidate is Extract<ContinueTarget, { kind: 'checkpoint' }> =>
      candidate.kind === 'checkpoint' && candidate.checkpointName === name,
  );
  if (target === undefined) throw new Error(`No checkpoint ${name}`);
  const result = await new SessionTransitionService({
    journal: journalSeams(),
  }).forkFromCheckpoint(target, chats, PROJECT, 'mistral', 'child', ['/child']);
  if (!result.ok) throw new Error(result.error);
  if (!(result.recording instanceof JournalRecordingService)) {
    throw new Error('Expected journal fork');
  }
  return { ...result, recording: result.recording };
}
