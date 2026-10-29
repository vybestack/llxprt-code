/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeFile } from 'node:fs/promises';
import {
  assertSessionMemory,
  assertWholeHistoryControl,
  createWholeHistoryBufferingControl,
  measureRealisticSession,
} from '../../../../test-utils/src/core/session-memory-protocol.js';
import { nativeSessionAdapter } from './realistic-native-send.js';
import { seedNativeJournal } from './realistic-native-fixture.js';

const [route, mode, output, seed] = process.argv.slice(2);
if (mode === 'seed') {
  await seedNativeJournal(output, route === 'openai-responses-stateful');
} else {
  if (mode !== 'positive' && mode !== 'control')
    throw new Error('Expected route, seed/positive/control, and output path');
  const control =
    mode === 'control' ? createWholeHistoryBufferingControl() : undefined;
  try {
    const started = performance.now();
    const measurement = await measureRealisticSession(
      nativeSessionAdapter(route, seed),
      control,
    );
    await writeFile(output, JSON.stringify(measurement));
    process.stdout.write(
      `${JSON.stringify({ route, mode, elapsedMs: performance.now() - started })}\n`,
    );
    if (control === undefined) assertSessionMemory(measurement);
    else assertWholeHistoryControl(measurement, control);
  } finally {
    control?.release();
  }
}
