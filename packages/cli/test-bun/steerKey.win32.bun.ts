/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2951 — end-to-end behavioural tests for Windows Ctrl+Enter steering.
 *
 * Windows consoles deliver Ctrl+Enter as a bare line feed (0x0A), which the
 * keypress parser reports as `{ name: 'j', ctrl: true }`. With the win32
 * STEER alias that key must steer the active turn while streaming and insert a
 * newline otherwise — matching the documented macOS/Linux Ctrl+Enter contract.
 *
 * `keyMatchers` resolves the platform once at module-evaluation time, so
 * `loadKeyHandlerForPlatform` pins `process.platform` only for the duration of
 * the dynamic import and restores it in `finally` — see its doc comment for
 * why that makes the pin immune to test ordering and runner process reuse.
 */

import { describe, expect, it } from 'bun:test';
import {
  FakeTextBuffer,
  loadKeyHandlerForPlatform,
  makeDeps,
  plainEnterKey,
  windowsCtrlEnterKey,
} from './steerKey.fixture.js';

const handleInputKey = await loadKeyHandlerForPlatform('win32');

describe('issue #2951 — Windows Ctrl+Enter steering (win32 module graph)', () => {
  it('steers when streaming with a non-empty buffer and clears the buffer', () => {
    const buffer = new FakeTextBuffer('steer me');
    let steeredText: string | null = null;
    const deps = makeDeps(buffer, {
      handleSteer: (text) => {
        steeredText = text;
        return true;
      },
    });

    handleInputKey(windowsCtrlEnterKey, deps);

    expect(steeredText).toBe('steer me');
    // Buffer is cleared, and no newline was appended.
    expect(buffer.lines).toEqual(['']);
  });

  it('steers all queued submissions when streaming with an empty buffer and a non-empty queue', () => {
    const buffer = new FakeTextBuffer('');
    let steerAllCalls = 0;
    const deps = makeDeps(buffer, {
      // While streaming, useSteer still returns false for empty text.
      handleSteer: () => false,
      queuedSubmissionCount: 2,
      steerAllQueuedSubmissions: () => {
        steerAllCalls += 1;
      },
    });

    handleInputKey(windowsCtrlEnterKey, deps);

    expect(steerAllCalls).toBe(1);
    // The key was consumed by the steer-all branch: no newline was inserted.
    expect(buffer.lines).toEqual(['']);
  });

  it('inserts a newline when streaming with an empty buffer and no queued submissions', () => {
    const buffer = new FakeTextBuffer('');
    const deps = makeDeps(buffer, {
      // useSteer returns false for empty text even while streaming.
      handleSteer: () => false,
    });

    handleInputKey(windowsCtrlEnterKey, deps);

    expect(buffer.lines).toEqual(['', '']);
  });

  it('inserts a newline (not a steer) when idle, even with a non-empty buffer', () => {
    const buffer = new FakeTextBuffer('not streaming');
    const deps = makeDeps(buffer, {
      // Idle: handleSteer reports not streaming, so STEER is not consumed and
      // the key falls through to NEWLINE.
      handleSteer: () => false,
    });

    handleInputKey(windowsCtrlEnterKey, deps);

    // The text is preserved and a new empty line is appended.
    expect(buffer.lines).toEqual(['not streaming', '']);
  });

  it('still submits on a plain Enter (proving the STEER alias did not disturb SUBMIT)', () => {
    const buffer = new FakeTextBuffer('submit me');
    let submitted: string | null = null;
    const deps = makeDeps(buffer, {
      handleSubmit: (value) => {
        submitted = value;
      },
      // If the STEER alias wrongly matched a plain Enter, this would consume
      // the key and clear the buffer instead of submitting.
      handleSteer: () => true,
    });

    handleInputKey(plainEnterKey, deps);

    expect(submitted).toBe('submit me');
    expect(buffer.lines).toEqual(['submit me']);
  });
});
