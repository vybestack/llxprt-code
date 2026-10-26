/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeFile } from 'node:fs/promises';
import {
  assertSessionMemory,
  assertWholeHistoryControl,
  createWholeHistoryBufferingControl,
  measureRealisticSession,
} from '../../../../test-utils/src/core/session-memory-protocol.js';
import { nativeSessionAdapter } from './realistic-native-send.js';

const [route, mode, output] = process.argv.slice(2);
if (process.argv.length !== 5 || (mode !== 'positive' && mode !== 'control'))
  throw new Error('Expected route, positive/control, and output path');
const control =
  mode === 'control' ? createWholeHistoryBufferingControl() : undefined;
try {
  const measurement = await measureRealisticSession(
    nativeSessionAdapter(route),
    control,
  );
  await writeFile(output, JSON.stringify(measurement));
  if (control === undefined) assertSessionMemory(measurement);
  else assertWholeHistoryControl(measurement, control);
} finally {
  control?.release();
}
