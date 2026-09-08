/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Property tests for sanctioned dynamic module loaders (issue #2758).
 *
 * The guard bans computed `import()` specifiers so a genai import cannot hide
 * behind a value the scanner cannot read. A module loader that resolves a
 * user-installed provider package is the one legitimate exception: its
 * specifier is a parameter, so it can never be a literal.
 *
 * That exception is EARNED, not granted. The guard keeps every genai check on
 * a sanctioned loader and additionally requires the file to contain no
 * `@google/` reference at all, which is what defeats a name assembled from
 * fragments. These tests pin all three properties.
 */

import { describe, expect, it } from 'bun:test';
import {
  DYNAMIC_MODULE_LOADERS,
  isSanctionedDynamicLoader,
} from '../genai-enclave/config.ts';
import {
  runScript,
  withFixture,
  writeRequiredManifests,
} from './genai-enclave-guard-helpers.ts';

const SANCTIONED_PATH = DYNAMIC_MODULE_LOADERS[0].path;
const UNSANCTIONED_PATH = 'packages/providers/src/composition/notALoader.ts';

const COMPUTED_IMPORT_SOURCE = [
  'export async function load(specifier: string): Promise<unknown> {',
  '  return import(specifier);',
  '}',
  '',
].join('\n');

describe('sanctioned dynamic module loaders', () => {
  it('registers exactly the runtime plugin loader, by exact path', () => {
    // Exact paths only: a prefix would silently extend the exemption to
    // sibling files that never earned it.
    expect(DYNAMIC_MODULE_LOADERS.map((loader) => loader.path)).toEqual([
      'packages/providers/src/composition/runtimePlugins/loadRuntimePlugins.ts',
    ]);
    expect(isSanctionedDynamicLoader(SANCTIONED_PATH)).toBe(true);
    expect(isSanctionedDynamicLoader(UNSANCTIONED_PATH)).toBe(false);
  });

  it('requires a justification on every entry', () => {
    for (const loader of DYNAMIC_MODULE_LOADERS) {
      expect(loader.justification.length).toBeGreaterThan(40);
    }
  });

  it('accepts a computed import in a sanctioned loader that is genai-free', async () => {
    const result = await withFixture(async ({ root, write }) => {
      writeRequiredManifests(write);
      write(SANCTIONED_PATH, COMPUTED_IMPORT_SOURCE);
      return runScript(root);
    });

    expect(result.stdout + result.stderr).not.toContain('computed');
    expect(result.code).toBe(0);
  });

  it('rejects a computed import in a file that is not sanctioned', async () => {
    const result = await withFixture(async ({ root, write }) => {
      writeRequiredManifests(write);
      write(UNSANCTIONED_PATH, COMPUTED_IMPORT_SOURCE);
      return runScript(root);
    });

    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(UNSANCTIONED_PATH);
    expect(result.stdout + result.stderr).toContain('computed');
  });

  it('rejects a sanctioned loader that names the genai package', async () => {
    const result = await withFixture(async ({ root, write }) => {
      writeRequiredManifests(write);
      write(
        SANCTIONED_PATH,
        "import { GoogleGenAI } from '@google/genai';\n" +
          COMPUTED_IMPORT_SOURCE,
      );
      return runScript(root);
    });

    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(SANCTIONED_PATH);
  });

  it('rejects a specifier assembled across the @google/ boundary', async () => {
    // A contiguous '@google/' check misses this: the text never contains that
    // substring. Screening the distinctive words is what catches it.
    const result = await withFixture(async ({ root, write }) => {
      writeRequiredManifests(write);
      write(
        SANCTIONED_PATH,
        "const sdk = '@' + 'google/genai';\n" +
          'export async function load(): Promise<unknown> {\n' +
          '  return import(sdk);\n' +
          '}\n',
      );
      return runScript(root);
    });

    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(SANCTIONED_PATH);
  });

  it('rejects a computed specifier that is not a parameter of its own function', async () => {
    // The structural half of the exemption. Even with no genai text anywhere,
    // a loader may not compute a specifier of its own choosing.
    const result = await withFixture(async ({ root, write }) => {
      writeRequiredManifests(write);
      write(
        SANCTIONED_PATH,
        "const chosen = ['a', 'b'].join('-');\n" +
          'export async function load(): Promise<unknown> {\n' +
          '  return import(chosen);\n' +
          '}\n',
      );
      return runScript(root);
    });

    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('computed');
  });

  it('rejects a specifier derived from a parameter rather than being the parameter', async () => {
    const result = await withFixture(async ({ root, write }) => {
      writeRequiredManifests(write);
      write(
        SANCTIONED_PATH,
        'export async function load(specifier: string): Promise<unknown> {\n' +
          "  return import(specifier + '/sub');\n" +
          '}\n',
      );
      return runScript(root);
    });

    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('computed');
  });

  it('rejects a sanctioned loader that assembles the genai name from fragments', async () => {
    // The evasion the plain computed-import ban could not catch on its own:
    // no literal '@google/genai' appears, so a literal-matching scanner sees
    // nothing. The genai-free property is what closes it.
    const result = await withFixture(async ({ root, write }) => {
      writeRequiredManifests(write);
      write(
        SANCTIONED_PATH,
        "const sdk = '@google/' + 'genai';\n" +
          'export async function load(): Promise<unknown> {\n' +
          '  return import(sdk);\n' +
          '}\n',
      );
      return runScript(root);
    });

    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(SANCTIONED_PATH);
  });
});
