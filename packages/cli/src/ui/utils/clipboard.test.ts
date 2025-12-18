/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildOsc52,
  copyTextToClipboard,
  writeOsc52ToTerminal,
} from './clipboard.js';

const copyToClipboard = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./commandUtils.js', () => ({
  copyToClipboard,
}));

describe('clipboard utils', () => {
  const originalTmux = process.env.TMUX;

  beforeEach(() => {
    vi.resetAllMocks();
    if (originalTmux === undefined) {
      delete process.env.TMUX;
    } else {
      process.env.TMUX = originalTmux;
    }
  });

  afterEach(() => {
    if (originalTmux === undefined) {
      delete process.env.TMUX;
    } else {
      process.env.TMUX = originalTmux;
    }
  });

  describe('buildOsc52', () => {
    it('builds a plain OSC52 sequence', () => {
      delete process.env.TMUX;
      const base64 = Buffer.from('hello').toString('base64');
      expect(buildOsc52('hello')).toBe(`\u001b]52;c;${base64}\u0007`);
    });

    it('wraps OSC52 for tmux', () => {
      process.env.TMUX = '1';
      const base64 = Buffer.from('hello').toString('base64');
      const osc52 = `\u001b]52;c;${base64}\u0007`;
      expect(buildOsc52('hello')).toBe(`\u001bPtmux;\u001b${osc52}\u001b\\`);
    });
  });

  describe('writeOsc52ToTerminal', () => {
    it('does not write for empty text', () => {
      const stdout = { write: vi.fn() } as unknown as NodeJS.WriteStream;
      writeOsc52ToTerminal('', stdout);
      expect(stdout.write).not.toHaveBeenCalled();
    });

    it('writes OSC52 to stdout', () => {
      delete process.env.TMUX;
      const stdout = { write: vi.fn() } as unknown as NodeJS.WriteStream;
      writeOsc52ToTerminal('hello', stdout);
      expect(stdout.write).toHaveBeenCalledTimes(1);
      expect(stdout.write).toHaveBeenCalledWith(buildOsc52('hello'));
    });
  });

  describe('copyTextToClipboard', () => {
    it('attempts OSC52 and platform clipboard', async () => {
      delete process.env.TMUX;
      const stdout = { write: vi.fn() } as unknown as NodeJS.WriteStream;
      await copyTextToClipboard('hello', stdout);
      expect(stdout.write).toHaveBeenCalledTimes(1);
      expect(copyToClipboard).toHaveBeenCalledWith('hello');
    });

    it('does not throw if platform clipboard copy fails', async () => {
      copyToClipboard.mockRejectedValueOnce(new Error('clipboard failed'));
      const stdout = { write: vi.fn() } as unknown as NodeJS.WriteStream;
      await expect(
        copyTextToClipboard('hello', stdout),
      ).resolves.toBeUndefined();
      expect(stdout.write).toHaveBeenCalledTimes(1);
      expect(copyToClipboard).toHaveBeenCalledWith('hello');
    });
  });
});
