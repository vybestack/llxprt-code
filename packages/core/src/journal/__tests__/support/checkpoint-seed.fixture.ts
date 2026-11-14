/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { sessionWithCheckpoints } from './compactionMemory.js';

const file = process.argv.find((_, index) => index === 2);
const count = Number(process.argv[3]);
if (file === undefined || !Number.isSafeInteger(count) || count < 0)
  throw new Error('Checkpoint seed needs a file and a nonnegative count');
const store = await sessionWithCheckpoints(file, count);
await store.close();
