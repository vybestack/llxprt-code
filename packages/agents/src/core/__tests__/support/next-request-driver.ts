/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { z } from 'zod';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nextRequestRuntime } from './next-request-runtime.js';
import { report } from './service-tool-recorders.js';
import { toolGate } from './service-tool-runtime.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const directory = z.string().min(1).parse(process.argv[2]);
const variant = z
  .enum(['directory', 'ide', 'turn', 'client', 'pause', 'two-group'])
  .parse(process.argv[3]);
z.literal('primary').parse(process.argv[4]);
const group = z.coerce.number().int().min(1).max(2).parse(process.argv[5]);
const ending = z.enum(['failure', 'cancel']).parse(process.argv[6]);
const rig = await nextRequestRuntime(directory, variant, ending);
const nextAbort = new AbortController();
const terminalEvents: string[] = [];
const next = toolGate();
process.on('message', (input: unknown) => {
  const command = z.enum(['next', 'probe', 'release', 'respond']).parse(input);
  if (command === 'next') next.resolve();
  if (command === 'respond') {
    if (ending === 'cancel') nextAbort.abort();
    rig.response.resolve();
  }
  if (command === 'release') {
    rig.primary.release();
  }
  if (command === 'probe')
    void Bun.sleep(100).then(async () =>
      report('probe', { ...rig.facts(), disk: await rig.disk() }),
    );
});
const pending: ContentBlock[] = [];
let firstSettled = false;
let admissionSettled = false;
let nextAttempted = false;
async function clientSend(
  message: string | ContentBlock[],
  prompt: string,
): Promise<void> {
  if (prompt === 'next') nextAttempted = true;
  for await (const event of rig.client.sendMessageStream(
    message,
    prompt === 'next' ? nextAbort.signal : new AbortController().signal,
    prompt,
  )) {
    if (prompt === 'next') terminalEvents.push(event.type);
    else if (event.type === 'error')
      throw new Error(`Unexpected client error: ${JSON.stringify(event)}`);
  }
}
try {
  if (variant === 'turn') await rig.client.resetChat();
  if (variant !== 'turn' && variant !== 'pause') {
    await clientSend('initial input', 'initial');
    await rig.history.waitForCommit();
  }
  await writeFile(
    join(directory, 'payload.txt'),
    'independent tool bytes\n雪 end',
  );
  report('ready', { ...rig.facts(), files: rig.files, disk: await rig.disk() });
  await next.promise;
  const selected = rig.primary;
  const rowTargets = {
    turn: 2,
    'two-group': 2 + group,
    pause: group + 1,
    ide: 3,
    directory: 3,
    client: 3,
  };
  selected.arm(rowTargets[variant]);
  const work = (async (): Promise<void> => {
    if (variant === 'turn') {
      const first = rig.client
        .getChat()
        .sendMessage({ message: 'held standalone input' }, 'initial')
        .then(() => {
          firstSettled = true;
        });
      while (selected.held() === undefined) await Bun.sleep(5);
      const second = clientSend('pending next input', 'next');
      await Promise.all([first, second]);
      return;
    }
    if (variant === 'pause') {
      await rig.send('pause at the tool boundary');
      firstSettled = true;
    } else if (variant === 'client') {
      const done = toolGate();
      const channel = rig.agent.tools.openClientChannel();
      const detach = channel.subscribe({
        onAllToolCallsComplete: (calls) => {
          for (const call of calls)
            pending.push(...call.response.responseParts);
          admissionSettled = true;
          done.resolve();
        },
      });
      await channel.ready;
      await channel.schedule(
        {
          callId: 'w21-client',
          name: 'read_file',
          args: { absolute_path: join(directory, 'payload.txt') },
          isClientInitiated: false,
          prompt_id: 'client',
        },
        new AbortController().signal,
      );
      await done.promise;
      detach();
      await channel.release();
    } else {
      await rig.admit();
      admissionSettled = true;
    }
    await clientSend(
      pending.length > 0
        ? [...pending, { type: 'text', text: 'pending next input' }]
        : 'pending next input',
      'next',
    );
  })();
  void work.catch((error: unknown) =>
    report('send-error', { error: String(error) }),
  );
  while (selected.held() === undefined && rig.facts().entries < 2)
    await Bun.sleep(5);
  await Bun.sleep(100);
  report('held', {
    ...rig.facts(),
    firstSettled,
    admissionSettled,
    nextAttempted,
    candidate: selected.held(),
    disk: await rig.disk(),
  });
  while (rig.request() === undefined) await Bun.sleep(5);
  report('transport', {
    ...rig.facts(),
    firstSettled,
    admissionSettled,
    nextAttempted,
    request: rig.request(),
    providerRows: rig.providerRows(),
    liveRows: await Array.fromAsync(rig.history.streamRawHistory()),
    disk: await rig.disk(),
  });
  await work;
  await rig.history.waitForCommit();
  report('completed', {
    ...rig.facts(),
    terminalEvents,
    disk: await rig.disk(),
  });
} finally {
  await rig.close();
}
report('closed', {});
process.disconnect();
