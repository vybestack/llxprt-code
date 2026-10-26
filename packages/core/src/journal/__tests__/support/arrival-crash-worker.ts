/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalSession } from '../../../services/history/journalSession.js';
import { JournalArrivalRecorder } from '../../arrival-recorder.js';
import { encodeContentRow } from '../../../services/history/journalRowCodec.js';

const path = process.argv[2];
const session = await JournalSession.create(path);
const recorder = new JournalArrivalRecorder(session.store);
const row = await recorder.beginRow(
  encodeContentRow({ speaker: 'ai', blocks: [] }, { owner: 0 }),
  { id: 'crashed-attempt', submissionId: 'prompt' },
);
const block = await recorder.beginBlock(row, 0);
await recorder.appendField(
  block,
  new TextEncoder().encode('acknowledged content'),
);
await recorder.flush();
process.stdout.write('durable-prefix\n');
setInterval(() => {}, 1000);
