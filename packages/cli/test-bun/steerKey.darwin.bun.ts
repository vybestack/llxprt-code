/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2951 non-regression — on macOS/Linux Ctrl+J is a distinct key from
 * Ctrl+Enter and must keep inserting a newline in every state, including while
 * streaming. The platform is pinned to 'darwin' before the key-matcher module
 * graph loads so `resolveKeyBindings` returns the platform-neutral defaults.
 *
 * The pin is process-global, so it is restored in `afterAll` to keep this file
 * self-contained even if a runner ever reuses processes.
 */

const originalPlatform = process.platform;

Object.defineProperty(process, 'platform', {
  value: 'darwin',
  configurable: true,
});

import { afterAll, describe, expect, it, mock } from 'bun:test';
import {
  FakeTextBuffer,
  makeDeps,
  plainEnterKey,
  windowsCtrlEnterKey,
} from './steerKey.fixture.js';

// `inputPromptKeyHandlers` transitively imports `clipboardy`, whose Windows
// backend spawns a native binary at module load via `is64bitSync()`. With the
// platform pinned to 'darwin' above, that spawn targets a macOS command that
// does not exist on a Windows host and throws ENOENT. The stub is therefore
// only strictly required when this file runs ON a Windows host; it is harmless
// elsewhere, and the clipboard is irrelevant to key-binding resolution.
mock.module('clipboardy', () => ({
  default: {
    write: async () => {},
    read: async () => '',
    writeSync: () => {},
    readSync: () => '',
  },
}));

const { handleInputKey } = await import(
  '../src/ui/components/inputPromptKeyHandlers.js'
);

afterAll(() => {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  });
});

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
