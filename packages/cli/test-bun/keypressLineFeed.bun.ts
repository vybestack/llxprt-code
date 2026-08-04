/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2951 — byte-level pin for how the keypress decoder reports a bare
 * line feed.
 *
 * Windows consoles deliver Ctrl+Enter as a bare line feed (0x0A) with no
 * escape sequence and no modifier bits, which this decoder reports as
 * `{ name: 'j', ctrl: true }` — indistinguishable from a real Ctrl+J. The
 * win32 STEER alias added by `resolveKeyBindings` depends on exactly that.
 *
 * If a future decoder change remaps 0x0A to `return`, STEER would become
 * double-bound on Windows and Ctrl+J would silently start steering on every
 * platform. These assertions make that change fail here, loudly, first.
 *
 * Runs against `createKeypressPipeline`, the same factory `KeypressProvider`
 * uses, so the composition order under test cannot drift from production.
 */

import { describe, expect, it } from 'bun:test';
import type { Key } from '../src/ui/contexts/KeypressContext.js';
import { createKeypressPipeline } from '../src/ui/contexts/KeypressContext.js';

/** Feeds raw bytes through the real pipeline and collects decoded keys. */
function decode(data: string): Key[] {
  const keys: Key[] = [];
  const listener = createKeypressPipeline((key) => keys.push(key));
  listener(data);
  return keys;
}

describe('keypress decoding of bare control bytes (issue #2951)', () => {
  it('reports a bare line feed (0x0A) as Ctrl+J, not as return', () => {
    const keys = decode('\x0a');

    expect(keys).toHaveLength(1);
    expect(keys[0]!.name).toBe('j');
    expect(keys[0]!.ctrl).toBe(true);
    expect(keys[0]!.name).not.toBe('return');
  });

  it('reports a carriage return (0x0D) as return', () => {
    const keys = decode('\x0d');

    expect(keys).toHaveLength(1);
    expect(keys[0]!.name).toBe('return');
  });

  it('distinguishes 0x0A from 0x0D, which is why the win32 alias is needed', () => {
    // The whole fix rests on these two bytes decoding differently. Windows
    // sends the first for Ctrl+Enter; the STEER default binding matches only
    // the second.
    const lineFeed = decode('\x0a')[0]!;
    const carriageReturn = decode('\x0d')[0]!;

    expect(lineFeed.name).not.toBe(carriageReturn.name);
    expect(carriageReturn.ctrl).toBe(false);
  });
});
