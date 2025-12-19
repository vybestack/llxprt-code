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
      const result = await copyTextToClipboard('hello', stdout);
      expect(stdout.write).toHaveBeenCalledTimes(1);
      expect(copyToClipboard).toHaveBeenCalledWith('hello');
      // Issue #885: copyTextToClipboard should return success status
      expect(result.success).toBe(true);
      expect(result.text).toBe('hello');
    });

    it('returns failure result when platform clipboard copy fails', async () => {
      // Issue #885: When clipboard copy fails, we should know about it
      copyToClipboard.mockRejectedValueOnce(new Error('clipboard failed'));
      const stdout = { write: vi.fn() } as unknown as NodeJS.WriteStream;
      const result = await copyTextToClipboard('hello', stdout);
      // OSC52 should still succeed, but we should know the system clipboard failed
      expect(result.success).toBe(false);
      expect(result.text).toBe('hello');
      expect(result.error).toBeDefined();
    });

    it('does not throw if platform clipboard copy fails', async () => {
      copyToClipboard.mockRejectedValueOnce(new Error('clipboard failed'));
      const stdout = { write: vi.fn() } as unknown as NodeJS.WriteStream;
      // Should not throw - resolves to a result object instead
      await expect(copyTextToClipboard('hello', stdout)).resolves.toBeDefined();
      expect(stdout.write).toHaveBeenCalledTimes(1);
      expect(copyToClipboard).toHaveBeenCalledWith('hello');
    });

    it('returns success for empty text', async () => {
      const stdout = { write: vi.fn() } as unknown as NodeJS.WriteStream;
      const result = await copyTextToClipboard('', stdout);
      expect(result.success).toBe(true);
      expect(result.text).toBe('');
      // OSC52 should not be written for empty text
      expect(stdout.write).not.toHaveBeenCalled();
    });
  });
});
