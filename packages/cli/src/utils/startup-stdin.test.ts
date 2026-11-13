/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import { StartupStdinBuffer, stripTerminalReplies } from './startup-stdin.js';
import {
  createKeypressPipeline,
  type Key,
} from '../ui/contexts/KeypressContext.js';

describe('startup stdin buffering', () => {
  it('lets a startup dialog accept new keys without consuming the queued prompt', () => {
    const stdin = new PassThrough();
    const buffer = new StartupStdinBuffer(stdin);
    const received: string[] = [];
    stdin.write('queued prompt');
    buffer.connect((chunk) => received.push(chunk));
    const stopDialog = buffer.acceptDialogInput();
    stdin.write('dialog selection');
    expect(received).toStrictEqual(['dialog selection']);
    stopDialog();
    stdin.write(' queued suffix');
    buffer.release();
    expect(received).toStrictEqual([
      'dialog selection',
      'queued prompt queued suffix',
    ]);
    buffer.dispose();
  });

  it.each(['hello\n', '\x1b[200~hello\nworld\x1b[201~\n'])(
    'submits cooked-mode startup Enter while preserving pasted newlines: %j',
    (input) => {
      const stdin = new PassThrough();
      const buffer = new StartupStdinBuffer(stdin);
      const keys: Key[] = [];
      stdin.write(input);
      buffer.connect(
        createKeypressPipeline((key) => keys.push(key), {
          isStartupInput: () => buffer.isReplaying,
        }),
      );
      buffer.release();
      expect(keys[keys.length - 1]).toMatchObject({
        name: 'return',
        shift: false,
        ctrl: false,
      });
      expect(
        keys
          .slice(0, -1)
          .map((key) => key.sequence)
          .join(''),
      ).toBe(input.startsWith('\x1b') ? 'hello\nworld' : 'hello');
      buffer.dispose();
    },
  );

  it('preserves ordered input until both the decoder and composer are ready', () => {
    const stdin = new PassThrough();
    const buffer = new StartupStdinBuffer(stdin);
    const received: string[] = [];
    stdin.write('first');
    buffer.connect((chunk) => received.push(chunk));
    stdin.write(' second\r');
    expect(received).toStrictEqual([]);
    buffer.release();
    stdin.write('third');
    expect(received).toStrictEqual(['first second\r', 'third']);
    buffer.dispose();
    stdin.write('ignored');
    expect(received.join('')).toBe('first second\rthird');
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('accepts composer readiness before the decoder attaches without losing input', () => {
    const stdin = new PassThrough();
    const buffer = new StartupStdinBuffer(stdin);
    const received: string[] = [];
    buffer.release();
    stdin.write('early');
    buffer.connect((chunk) => received.push(chunk));
    buffer.release();
    stdin.write('late');
    expect(received).toStrictEqual(['early', 'late']);
    buffer.dispose();
  });

  it('drops startup capability replies but keeps typed keys around them', () => {
    const stdin = new PassThrough();
    const buffer = new StartupStdinBuffer(stdin);
    const received: string[] = [];
    stdin.write('he\x1b[?0u\x1b]11;rgb:0000/0000/0000\x07');
    stdin.write('l\x1bP>|tmux 3.5\x1b\\\x1b[>4;1m\x1b[?62;22c');
    stdin.write('lo\x1b[A\r');
    buffer.connect((chunk) => received.push(chunk));
    buffer.release();
    expect(received).toStrictEqual(['hello\x1b[A\r']);
    expect(stripTerminalReplies('\x1b[13u\x1b[1;5A')).toBe('\x1b[13u\x1b[1;5A');
    buffer.dispose();
  });

  it('decodes split UTF-8 bytes without corrupting buffered characters', () => {
    const stdin = new PassThrough();
    const buffer = new StartupStdinBuffer(stdin);
    const received: string[] = [];
    const bytes = Buffer.from('a🌙b');
    stdin.write(bytes.subarray(0, 3));
    stdin.write(bytes.subarray(3));
    buffer.connect((chunk) => received.push(chunk));
    buffer.release();
    expect(received.join('')).toBe('a🌙b');
    buffer.dispose();
  });
});
