/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 D3c/D4: golden fixtures for the chat sends the one-request corpus
 * cannot see (request dump files, continuation requests). One JSON file per
 * kind and route in `__tests__/fixtures/chat-send/`, regenerated with the same
 * switch as the wire-body corpus:
 *
 *   WIRE_BODY_GOLDEN_UPDATE=1 bun test src/__tests__/<test file>
 *
 * from packages/providers (refused when CI is set).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TextRecord {
  readonly sha256: string;
  readonly length: number;
  /** The exact text, kept only while small. */
  readonly text?: string;
}

const MAX_STORED_TEXT_BYTES = 16 * 1024;

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'chat-send',
);

export function textRecord(text: string): TextRecord {
  const bytes = Buffer.from(text, 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return bytes.byteLength > MAX_STORED_TEXT_BYTES
    ? { sha256, length: bytes.byteLength }
    : { sha256, length: bytes.byteLength, text };
}

export function describeTextDifference(
  expected: TextRecord,
  actual: TextRecord,
): string | undefined {
  if (expected.sha256 === actual.sha256 && expected.length === actual.length) {
    return undefined;
  }
  const head = `bytes differ: expected ${expected.length} bytes sha256 ${expected.sha256}, got ${actual.length} bytes sha256 ${actual.sha256}`;
  if (expected.text === undefined || actual.text === undefined) return head;
  let at = 0;
  const shorter = Math.min(expected.text.length, actual.text.length);
  while (
    at < shorter &&
    expected.text.charCodeAt(at) === actual.text.charCodeAt(at)
  ) {
    at += 1;
  }
  const excerpt = (value: string): string =>
    JSON.stringify(value.slice(Math.max(0, at - 60), at + 100));
  return `${head}\nfirst difference at char ${at}: expected ${excerpt(expected.text)} got ${excerpt(actual.text)}`;
}

function fixturePath(name: string): string {
  return join(FIXTURE_DIR, `${name}.json`);
}

export function readFixture<T>(name: string): Readonly<Record<string, T>> {
  const path = fixturePath(name);
  if (!existsSync(path)) {
    throw new Error(
      `missing golden fixture ${path}; regenerate intentionally with WIRE_BODY_GOLDEN_UPDATE=1`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeFixture(
  name: string,
  cases: Readonly<Record<string, unknown>>,
): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(fixturePath(name), `${JSON.stringify(cases, null, 2)}\n`);
}
