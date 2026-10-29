/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { JournalRecordingService } from '../../../../recording/journalRecordingService.js';
import { JournalHistoryStore } from '../../journalHistoryStore.js';
import { JournalSession } from '../../journalSession.js';

/**
 * The child of the SIGKILL test. It records rows and facts through a history
 * store and a journal recorder, waits for the mutation boundary, tells its
 * parent the file path and the number of rows acked, then idles until it is
 * killed. Arguments: the directory to work in, the session id, the row count.
 */
if (process.argv.length !== 5) {
  throw new Error('usage: recorderAckChild <directory> <sessionId> <rowCount>');
}
const [directory, sessionId, rowCount] = process.argv.slice(2);

const recorder = JournalRecordingService.create({
  sessionId,
  projectHash: 'project',
  chatsDir: path.join(directory, 'chats'),
  workspaceDirs: ['/work/a'],
  provider: 'anthropic',
  model: 'model-1',
});
const primary = await JournalSession.create(
  path.join(directory, 'primary.llxj'),
);
const store = new JournalHistoryStore(primary);
await store.attachJournal(recorder, true, undefined, 'agent-a');
for (let at = 0; at < Number(rowCount); at += 1) {
  store.apply({
    kind: 'content',
    content: {
      speaker: 'human',
      blocks: [{ type: 'text', text: `row ${at}` }],
    },
    origin: 'agent-a',
  });
}
recorder.recordSessionMetadata('Acked title');
await store.waitForDurable();
await store.settleFanout();
await recorder.flush();
const filePath = recorder.getFilePath();
if (filePath === null) throw new Error('the recorder wrote no file');
process.stdout.write(`ACKED ${filePath}\n`);
setInterval(() => undefined, 1000);
