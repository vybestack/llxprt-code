/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  ScratchRootOwner,
  NamedWriterOwnership,
} from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-storage';
import { seedSessionBrowserResize } from './seed-session-browser-resize.js';

const projectRoot = process.cwd();
const storage = new Storage(projectRoot);
const scratchRoots = new ScratchRootOwner();
const namedWriters = new NamedWriterOwnership();
for (let index = 0; index < 24; index++) {
  await seedSessionBrowserResize({
    scratchRoots,
    namedWriters,
    chatsDir: storage.getProjectChatsDir(),
    projectRoot,
    sessionId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  });
}
