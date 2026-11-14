/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES_DIR = join(import.meta.dir, '..', '..', '..');

/**
 * A test that is skipped on one history backend stops running when the default
 * flips. Each backend-specific test builds the store and recorder it tests by
 * naming the backend; no test is skipped on the backend condition.
 */
const BACKEND_WORDS = ['journalBackendSelected', 'selectBackend'];
/** How far past `skip(` or `skipIf(` the condition is looked for. */
const CONDITION_REACH = 160;

function skipsOnBackend(source: string): boolean {
  return source
    .split(/\bskip(?:If)?\(/)
    .slice(1)
    .some((rest) => {
      const condition = rest.slice(0, CONDITION_REACH);
      return BACKEND_WORDS.some((word) => condition.includes(word));
    });
}

function sourceDirectories(): string[] {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(PACKAGES_DIR, entry.name, 'src'));
}

function testFilesIn(source: string): string[] {
  let found: string[];
  try {
    found = readdirSync(source, { recursive: true, encoding: 'utf8' });
  } catch (error: unknown) {
    if (Reflect.get(Object(error), 'code') === 'ENOENT') return [];
    throw error;
  }
  return found
    .filter((relative) => /\.test\.tsx?$/.test(relative))
    .map((relative) => join(source, relative));
}

function testFilesUnderSource(): string[] {
  // This file spells the forbidden skip in its detector controls.
  return sourceDirectories()
    .flatMap(testFilesIn)
    .filter((file) => file !== import.meta.path);
}

describe('backend-specific tests are never skipped on the backend', () => {
  it('finds the test files it scans', () => {
    expect(testFilesUnderSource().length).toBeGreaterThan(100);
  });

  it('detects a skip on the backend condition (control)', () => {
    expect(skipsOnBackend("it.skipIf(journalBackendSelected)('x', f)")).toBe(
      true,
    );
    expect(
      skipsOnBackend("it\n  .skipIf(selectBackend() === 'journal')('x', f)"),
    ).toBe(true);
    expect(skipsOnBackend("it.skipIf(process.platform === 'win32')")).toBe(
      false,
    );
  });

  it('has no test file that skips on journalBackendSelected or selectBackend', () => {
    const offenders = testFilesUnderSource().filter((file) =>
      skipsOnBackend(readFileSync(file, 'utf8')),
    );
    expect(offenders).toStrictEqual([]);
  });
});
