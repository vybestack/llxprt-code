/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { RecordingIntegration } from '@vybestack/llxprt-code-core/recording/RecordingIntegration.js';
import { RECORD_KIND } from '@vybestack/llxprt-code-core/journal/recordKinds.js';
import {
  JournalResumeBoot,
  resumePointOf,
} from '@vybestack/llxprt-code-core/recording/journalResume.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { historyOriginId } from '@vybestack/llxprt-code-core/services/history/historyOriginId.js';
import { z } from 'zod';
import {
  diskToolState,
  observedRecording,
  recordingFile,
  report,
} from './service-tool-recorders.js';
import {
  completedTool,
  localProvider,
  modelName,
  requestFacts,
  resultBlock,
  serviceToolChat,
  toolGate,
  toolId,
} from './service-tool-runtime.js';

const directory = z.string().min(1).parse(process.argv[2]);
const role = z.enum(['primary', 'none']).parse(process.argv[3]);
const exitMode = z.enum(['crash', 'clean']).parse(process.argv[4]);
const primary = await observedRecording(directory, 'primary');
const history = new HistoryService({});
await history.adoptResumeBoot(
  primary.recording,
  new JournalResumeBoot(
    primary.recording,
    await resumePointOf(primary.recording),
  ),
);
const origin = {};
const primaryIntegration = new RecordingIntegration(primary.recording);
await primaryIntegration.subscribeToJournal(history, origin);
const sessions = [await primary.recording.session()];
const responseGate = toolGate();
const nextGate = toolGate();
let entries = 0;
let nextStarted = false;
const files = [recordingFile(primary.recording)];
const facts = (): Record<string, unknown> => ({
  entries,
  nextStarted,
  seqs: sessions.map((session) => session.store.published?.commitSeq ?? 0),
  flushes: [primary.flushes()],
});
const provider = localProvider((options) => {
  entries++;
  if (entries === 2) report('transport-entry', facts());
  return (async function* (): AsyncGenerator<IContent> {
    const request = await requestFacts(options.contents);
    if (entries === 1) {
      yield {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: toolId,
            name: 'lookup',
            parameters: { query: 'durability' },
          },
        ],
      };
      return;
    }
    report('transport-request', {
      ...facts(),
      request,
      disk: await Promise.all(files.map(diskToolState)),
    });
    await responseGate.promise;
    yield {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'subsequent response must not survive crash' },
      ],
    };
  })();
});
const setup = serviceToolChat(history, provider, 'primary', directory);
const execution = {
  historyOrigin: origin,
  transcriptPath: () => files[0],
  persistSemanticMediaPurge: async (): Promise<never> => {
    throw new Error('Unexpected purge');
  },
};
process.on('message', (input: unknown) => {
  const command = z.enum(['next', 'probe', 'release', 'respond']).parse(input);
  if (command === 'next') nextGate.resolve();
  if (command === 'release') {
    primary.seams.release();
  }
  if (command === 'respond') responseGate.resolve();
  if (command === 'probe') {
    void Bun.sleep(100).then(async () =>
      report('probe', {
        ...facts(),
        disk: await Promise.all(files.map(diskToolState)),
      }),
    );
  }
});

try {
  await setup.chat.sendMessage({ message: 'Run lookup.' }, 'first', execution);
  await history.waitForCommit();
  await primaryIntegration.flushAtTurnBoundary();
  report('ready', {
    ...facts(),
    files,
    owner: historyOriginId(origin),
    disk: await Promise.all(files.map(diskToolState)),
  });
  await nextGate.promise;
  const selected = primary;
  const trailers = (): number =>
    selected.seams.events.filter(
      (event) => event.type === 'write' && event.kind === RECORD_KIND.TRAILER,
    ).length;
  const beforeTrailers = trailers();
  if (role !== 'none') selected.failures.gateTrailerAt = beforeTrailers;
  setup.chat.recordCompletedToolCalls(modelName, [completedTool()]);
  nextStarted = true;
  const send = (async (): Promise<void> => {
    for await (const _event of await setup.chat.sendMessageStream(
      { message: [resultBlock] },
      'second',
    )) {
      /* consume the production stream */
    }
  })();
  void send.catch((error: unknown) =>
    report('send-error', { error: String(error) }),
  );
  while (trailers() === beforeTrailers && entries < 2) await Bun.sleep(5);
  report('held', {
    ...facts(),
    disk: await Promise.all(files.map(diskToolState)),
  });
  await send;
  if (exitMode === 'crash')
    throw new Error('Crash driver unexpectedly completed response');
  report('completed', {
    ...facts(),
    disk: await Promise.all(files.map(diskToolState)),
  });
} finally {
  primary.seams.release();
  await primaryIntegration.dispose();
  await history.dispose();
  await primary.recording.dispose();
  await setup.close();
}
report('closed', {});
process.disconnect();
