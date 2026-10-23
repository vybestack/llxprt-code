/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';

describe('workspace metadata through discovery and continuation', () => {
  const directory = useTempDir('issue854-metadata-budget-');

  it('preserves workspace metadata in real discovery and continuation', async () => {
    const recording = JournalRecordingService.create({
      sessionId: 'metadata-budget',
      projectHash: 'budget-project',
      chatsDir: directory(),
      provider: 'test',
      model: 'test',
      workspaceDirs: ['/workspace/雪', '/workspace/second'],
    });
    await recording.setSessionName('workspace-session');
    await recording.dispose();
    const file = recording.getFilePath();
    if (file === null) throw new Error('Missing recorded journal');
    const discovered =
      await SessionDiscovery.listContinueTargetsDetailedBounded(
        directory(),
        'budget-project',
      );
    expect(discovered).toHaveProperty('targets.length', 1);
    const result = await readJournalSnapshot(file, 'budget-project');
    expect(result).toHaveProperty('metadata.workspaceDirs', [
      '/workspace/雪',
      '/workspace/second',
    ]);
    expect(await readJournalFileFacts(file)).toHaveProperty(
      'facts.directories',
      ['/workspace/雪', '/workspace/second'],
    );
  });
});
