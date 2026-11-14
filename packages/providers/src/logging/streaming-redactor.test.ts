/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { RedactionConfig } from '@vybestack/llxprt-code-core/config/config.js';
import { ConfigBasedRedactor } from './ConfigBasedRedactor.js';
import { StreamingRedactor } from './streaming-redactor.js';

const config: RedactionConfig = {
  redactApiKeys: true,
  redactCredentials: true,
  redactFilePaths: true,
  redactUrls: true,
  redactEmails: true,
  redactPersonalInfo: true,
  customPatterns: [
    {
      name: 'test',
      pattern: /PRIVATE:[a-z]+/g,
      replacement: '[CUSTOM]',
      enabled: true,
    },
  ],
};
const examples = [
  'before sk-' + 'a'.repeat(40) + ' after',
  'sk-proj-' + 'B'.repeat(48),
  'sk-ant-' + 'c'.repeat(95),
  'AIza' + 'D'.repeat(35),
  'password = "swordfish" and pwd: token pass\n=\nsecret!',
  'Bearer abcdefghijklmnopqrstuvwxyz.0123 end',
  '/a/b/.ssh/id_rsa /root/.env.local /home/alice/work /Users/bob/code',
  'mail alice@example.com and invalid@@example.com',
  'phone 123-456-7890 and card 1234 5678-9012 3456.',
  'https://example.com/path?q=secret PRIVATE:secret end',
  'emoji 🙂 and quotes " backslash \\ newline\n',
];

function streamText(text: string, split: number): string {
  const redactor = new StreamingRedactor(config);
  return (
    redactor.push(text.slice(0, split)) +
    redactor.push(text.slice(split)) +
    redactor.finish()
  );
}

describe('bounded redaction rules', () => {
  it('uses the longest finite rule and bounds open-ended repetitions without logging a secret tail', () => {
    const custom: RedactionConfig = {
      ...config,
      redactEmails: false,
      redactPersonalInfo: false,
      customPatterns: [
        {
          name: 'long',
          pattern: /LONG:[a-z]{10000}/g,
          replacement: '[LONG]',
          enabled: true,
        },
      ],
    };
    const redactor = new StreamingRedactor(custom);
    const text = 'LONG:' + 'x'.repeat(10000);
    let output = '';
    for (let offset = 0; offset < text.length; offset += 17)
      output += redactor.push(text.slice(offset, offset + 17));
    expect(output + redactor.finish()).toBe('[LONG]');
    const oversized = new StreamingRedactor(config);
    expect(
      () => oversized.push('sk-' + 'x'.repeat(9000)) + oversized.finish(),
    ).toThrow('exceeds the bounded repetition limit');
  });
});

function assertBound(retained: number, limit: number): void {
  expect(retained).toBeLessThanOrEqual(limit);
}

describe('streaming response redaction', () => {
  it('preserves redaction when emission windows advance through secrets', () => {
    const text = ('safe. '.repeat(1500) + examples.join('\n')).repeat(3);
    const expected = new ConfigBasedRedactor(config).redactResponseContent(
      text,
      'test',
    );
    for (const size of [7, 31, 1024, 8191]) {
      const redactor = new StreamingRedactor(config);
      let output = '';
      for (let offset = 0; offset < text.length; offset += size) {
        output += redactor.push(text.slice(offset, offset + size));
        assertBound(redactor.retainedChars, redactor.retentionLimit);
      }
      expect(output + redactor.finish()).toBe(expected);
    }
  });

  it('matches whole-response redaction at every secret split offset', () => {
    const legacy = new ConfigBasedRedactor(config);
    for (const text of examples) {
      const expected = legacy.redactResponseContent(text, 'test');
      for (let split = 0; split <= text.length; split++) {
        expect(streamText(text, split)).toBe(expected);
      }
      const redactor = new StreamingRedactor(config);
      let output = '';
      for (const character of text) output += redactor.push(character);
      expect(output + redactor.finish()).toBe(expected);
    }
  });

  it('retains only the computed rule windows while emitting a session-sized response', () => {
    const redactor = new StreamingRedactor(config);
    const chunk = 'ordinary response text. '.repeat(128);
    let written = 0;
    for (let index = 0; index < 22000; index++) {
      written += redactor.push(chunk).length;
      assertBound(redactor.retainedChars, redactor.retentionLimit);
    }
    written += redactor.finish().length;
    expect(written).toBe(chunk.length * 22000);
    expect(redactor.retainedChars).toBe(0);
  });

  it('rejects a whole-response retaining control with the same bound assertion', () => {
    const redactor = new StreamingRedactor(config);
    let retained = '';
    const chunk = 'control response '.repeat(128);
    expect(() => {
      for (let index = 0; index < 22000; index++) {
        retained += chunk;
        assertBound(retained.length, redactor.retentionLimit);
      }
    }).toThrow(/toBeLessThanOrEqual/);
  });

  it('preserves custom captures, non-global replacement and boundary context', () => {
    const custom: RedactionConfig = {
      ...config,
      customPatterns: [
        {
          name: 'test',
          pattern: /\b(secret)-(\d+)\b/,
          replacement: '$2:$1',
          enabled: true,
        },
        {
          name: 'test',
          pattern: /(?<=prefix)token(?=suffix)/g,
          replacement: '[TOKEN]',
          enabled: true,
        },
      ],
    };
    const text = 'xsecret-12 secret-34 secret-56 prefixtokensuffix';
    const redactor = new StreamingRedactor(custom);
    let output = '';
    for (const character of text) output += redactor.push(character);
    expect(output + redactor.finish()).toBe(
      new ConfigBasedRedactor(custom).redactResponseContent(text, 'test'),
    );
  });
});
