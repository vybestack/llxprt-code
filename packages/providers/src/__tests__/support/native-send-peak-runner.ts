/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import { recordOf, sendThroughRoute, WIRE_ROUTES } from './wireBodyCapture.js';
import {
  sendPeakHistory,
  streamSendPeakRows,
  type SendPeakShape,
  type SendPeakSize,
} from './sendPeakShapes.js';
import {
  judgeSendPeak,
  type SendPeakBody,
  type SendPeakPlan,
} from './sendPeakMeasurement.js';
import { runSendPeakChild, type SendPeakRun } from './sendPeakRunner.js';
import { parseSendTrap, SEND_TRAP_ENV } from './sendPeakTraps.js';

async function oracle(
  shape: SendPeakShape,
  size: SendPeakSize,
): Promise<SendPeakBody> {
  const route = WIRE_ROUTES.find(
    (candidate) => candidate.id === 'openai-chat-plain',
  );
  if (route === undefined) throw new Error('Missing plain Chat route');
  const body = recordOf(
    await sendThroughRoute(route, sendPeakHistory(shape, size), 'rows'),
  );
  return { bytes: body.length, sha256: body.sha256 };
}

function writeRows(
  root: string,
  shape: SendPeakShape,
  size: SendPeakSize,
): number {
  const directory = join(root, shape, size);
  mkdirSync(directory, { recursive: true });
  let count = 0;
  for (const row of streamSendPeakRows(shape, size)) {
    writeFileSync(join(directory, `${count++}.row`), serialize(row));
  }
  return count;
}

export async function runNativeSendPeak(
  shape: SendPeakShape = 'text-only',
): Promise<SendPeakRun> {
  const parent = join(
    import.meta.dir,
    '../../../../../tmp/p6/native-memory-run-aw/corpora',
  );
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, `${shape}-`));
  const oracles = {
    small: await oracle(shape, 'small'),
    large: await oracle(shape, 'large'),
  };
  const plan: SendPeakPlan = {
    source: 'rows',
    rounds: 1,
    estimate: true,
    shapes: {
      [shape]: {
        small: writeRows(root, shape, 'small'),
        large: writeRows(root, shape, 'large'),
      },
    },
  };
  writeFileSync(join(root, 'plan.json'), JSON.stringify(plan));
  const trap = parseSendTrap(process.env[SEND_TRAP_ENV]);
  const result = await runSendPeakChild('openai-chat-plain', root, trap, true);
  const series = result[shape];
  if (series === undefined) throw new Error('Missing native measurement');
  const run = { series, oracles, verdict: judgeSendPeak(series, oracles) };
  if (process.env.SEND_PEAK_LOG !== undefined)
    appendFileSync(
      process.env.SEND_PEAK_LOG,
      `${JSON.stringify({ native: true, shape, root, trap: trap ?? null, ...run })}\n`,
    );
  return run;
}
