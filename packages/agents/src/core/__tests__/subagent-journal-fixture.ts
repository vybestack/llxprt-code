/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

export function makeRecordingInputs() {
  const directory = mkdtempSync(join(tmpdir(), 'orchestrator-journal-'));
  directories.add(directory);
  return {
    storage: {
      getProjectTempDir: () => directory,
      getProjectChatsDir: () => join(directory, 'chats'),
    },
    getWorkspaceContext: () => ({
      getDirectories: (): readonly string[] => [directory],
    }),
  };
}
