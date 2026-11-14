/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { matchesPersistedSession } from './persisted-session-selection.js';
import { MAX_PERSISTED_STATE_BYTES } from './session-media-package-validation.js';
import {
  MediaReferenceIndex,
  stagePersistedSessionStates,
} from './session-media-package-state.js';

const sessionId = 'session-"\\雪';
const projectHash = 'project-hash';

describe('streamed persisted session ownership selection', () => {
  const directory = useTempDir('persisted-session-selection-');

  it('finds escaped ownership after a large history without treating nested keys as ownership', async () => {
    const path = join(directory(), 'history-first.json');
    await writeFile(
      path,
      JSON.stringify({
        history: [{ text: 'x'.repeat(200000), sessionId: 'other' }],
        projectHash,
        sessionId,
      }),
    );
    expect(await matchesPersistedSession(path, sessionId, projectHash)).toBe(
      true,
    );
  });

  it('keeps an escaped string intact across a read boundary', async () => {
    const path = join(directory(), 'split-escape.json');
    const serialized = JSON.stringify({ sessionId, projectHash });
    const padding = 65535 - serialized.indexOf(String.fromCharCode(92));
    await writeFile(path, `${' '.repeat(padding)}${serialized}`);
    expect(await matchesPersistedSession(path, sessionId, projectHash)).toBe(
      true,
    );
  });

  it('ignores a different session, a different project and ownership appearing only in history', async () => {
    const cases = [
      { sessionId: 'other', projectHash },
      { sessionId, projectHash: 'other' },
      { history: [{ sessionId, projectHash }] },
    ];
    for (const [index, contents] of cases.entries()) {
      const path = join(directory(), `unrelated-${index}.json`);
      await writeFile(path, JSON.stringify(contents));
      expect(await matchesPersistedSession(path, sessionId, projectHash)).toBe(
        false,
      );
    }
  });

  it('keeps the finite byte cap for a selected state', async () => {
    const path = join(directory(), 'persisted-session-oversized.json');
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(
        JSON.stringify({ sessionId, projectHash, history: [] }),
      );
      await handle.truncate(MAX_PERSISTED_STATE_BYTES + 1);
    } finally {
      await handle.close();
    }
    await expect(
      stagePersistedSessionStates(
        directory(),
        join(directory(), 'package'),
        sessionId,
        projectHash,
        new MediaReferenceIndex(),
      ),
    ).rejects.toThrow('Persisted session state exceeds finite byte limit');
  });

  it('does not select incomplete or non-JSON legacy files', async () => {
    for (const [index, contents] of ['{', '\0'.repeat(65537)].entries()) {
      const path = join(directory(), `invalid-${index}.json`);
      await writeFile(path, contents);
      expect(await matchesPersistedSession(path, sessionId, projectHash)).toBe(
        false,
      );
    }
  });
});
