/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Writable } from 'node:stream';
import winston from 'winston';
import { logFormat } from './logger.js';

/** Builds a real winston logger around the production format and captures output. */
function captureLogger(): {
  log: winston.Logger;
  output: () => string[];
} {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk);
      callback();
    },
  });
  const log = winston.createLogger({
    level: 'info',
    format: logFormat,
    transports: [new winston.transports.Stream({ stream })],
  });
  return { log, output: () => text.split('\n').filter((l) => l !== '') };
}

/** True for any control or line-separator character other than the layout newline. */
function isRawBreakOrControl(char: string): boolean {
  if (char === '\n') {
    return false;
  }
  const code = char.charCodeAt(0);
  if (code < 0x20 || code === 0x2028 || code === 0x2029) {
    return true;
  }
  return code >= 0x7f && code <= 0x9f;
}

describe('a2a logger format', () => {
  it('keeps an ordinary message on a single leveled line', () => {
    const { log, output } = captureLogger();

    log.info('[CoreAgent] Task created');

    const lines = output();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[INFO\] .* -- \[CoreAgent\] Task created$/);
  });

  it('cannot be made to forge a log entry through a CR/LF in the message', () => {
    const { log, output } = captureLogger();

    log.info('Received request: ', {
      message: 'harmless\r\n[ERROR] 2026-01-01 -- forged entry',
    });

    const lines = output();
    expect(lines.filter((l) => l.startsWith('[ERROR]'))).toStrictEqual([]);
    expect(lines.filter((l) => l.startsWith('[INFO]'))).toHaveLength(1);
    expect(lines[0]).toContain('forged entry');
  });

  it('escapes other control characters, including ANSI escape sequences', () => {
    const { log, output } = captureLogger();

    log.warn('cleared\u001b[2J screen\u0000 and \u2028 separator');

    const joined = output().join('\n');
    const forbidden = [...joined].filter((char) => {
      const code = char.charCodeAt(0);
      return code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029;
    });
    expect(forbidden).toStrictEqual([]);
    expect(joined).toContain('cleared');
    expect(joined).toContain('screen');
  });

  it('still prints structured metadata after the message', () => {
    const { log, output } = captureLogger();

    log.info('with body', { body: { command: 'a\nb' } });

    const joined = output().join('\n');
    expect(joined).toContain('"command": "a\\nb"');
  });

  it('escapes line-separator characters in nested metadata values and property names', () => {
    const { log, output } = captureLogger();

    log.info('with body', {
      body: { list: ['x\u0085y', { deep: 'p\u2028q\u2029r' }] },
      'key\u2028name\u0085': 'v',
    });

    const joined = output().join('\n');
    const forbidden = [...joined].filter(isRawBreakOrControl);
    expect(forbidden).toStrictEqual([]);
    expect(joined).toContain('x\\u0085y');
    expect(joined).toContain('p\\u2028q\\u2029r');
    expect(joined).toContain('key\\u2028name\\u0085');
  });
});
