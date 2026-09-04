/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  removeFixtureDirectory,
  writePortableExecutable,
} from './sandbox-fixture-compiler.js';

describe('portable sandbox fixture compiler', () => {
  it('reports status and both output streams when compilation fails', () => {
    const fixtureRoot = path.resolve('tmp');
    fs.mkdirSync(fixtureRoot, { recursive: true });
    const failureFixtureDir = fs.mkdtempSync(
      path.join(fixtureRoot, 'issue3479-compile-failure-'),
    );
    let compilationError: unknown;

    try {
      writePortableExecutable(
        'invalid-fixture',
        'const invalidSyntax: = true;\n',
        failureFixtureDir,
      );
    } catch (error) {
      compilationError = error;
    } finally {
      removeFixtureDirectory(failureFixtureDir);
    }

    if (!(compilationError instanceof Error)) {
      throw new Error('Invalid fixture compilation did not throw an Error');
    }
    // On Windows the compiled fixture name gains ".exe" and bun prints
    // backslashed paths inside the quoted stderr; normalize separators and
    // accept the platform suffix so the shape assertion holds everywhere.
    expect(compilationError.message.replace(/\\/g, '/')).toMatch(
      /^Failed to compile invalid-fixture(\.exe)?\.\nstatus: 1\nstdout: ""\nstderr: ".+"$/s,
    );
  });
});
