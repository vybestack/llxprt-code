/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2951 non-regression — on macOS/Linux Ctrl+J is a distinct key from
 * Ctrl+Enter and must keep inserting a newline in every state, including while
 * streaming. `loadKeyHandlerForPlatform` pins the platform to 'darwin' only
 * for the duration of the dynamic import (restoring it in `finally`), so
 * `resolveKeyBindings` returns the platform-neutral defaults without leaking
 * a process-global mutation.
 */

import { describe, expect, it, mock } from 'bun:test';
import {
  FakeTextBuffer,
  loadKeyHandlerForPlatform,
  makeDeps,
  plainEnterKey,
  windowsCtrlEnterKey,
} from './steerKey.fixture.js';

// `inputPromptKeyHandlers` transitively imports `clipboardy`, whose Windows
// backend spawns a native binary at module load via `is64bitSync()`. With the
// platform pinned to 'darwin' for the import, that spawn targets a macOS
// command that does not exist on a Windows host and throws ENOENT. The stub is
// therefore only strictly required when this file runs ON a Windows host; it is
// harmless elsewhere, and the clipboard is irrelevant to key-binding
// resolution.
void mock.module('clipboardy', () => ({
  default: {
    write: async () => {},
    read: async () => '',
    writeSync: () => {},
    readSync: () => '',
  },
}));

const handleInputKey = await loadKeyHandlerForPlatform('darwin');

describe('issue #2951 non-regression — macOS/Linux Ctrl+J (darwin module graph)', () => {
  it('inserts a newline for { name: "j", ctrl: true } even while streaming and never steers', () => {
    const buffer = new FakeTextBuffer('typing');
    const deps = makeDeps(buffer, {
      // Simulate streaming: if STEER wrongly matched Ctrl+J on darwin it would
      // consume the key and clear the buffer instead of inserting a newline.
      handleSteer: () => true,
    });

    handleInputKey(windowsCtrlEnterKey, deps);

    // On darwin STEER has no Ctrl+J alias, so the key falls through to NEWLINE:
    // the text is preserved and a new empty line is appended.
    expect(buffer.lines).toEqual(['typing', '']);
  });

  it('still submits on a plain Enter (SUBMIT behaviour unchanged)', () => {
    const buffer = new FakeTextBuffer('submit me');
    let submitted: string | null = null;
    const deps = makeDeps(buffer, {
      handleSubmit: (value) => {
        submitted = value;
      },
      handleSteer: () => true,
    });

    handleInputKey(plainEnterKey, deps);

    expect(submitted).toBe('submit me');
    expect(buffer.lines).toEqual(['submit me']);
  });
});
