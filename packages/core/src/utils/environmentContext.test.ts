/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  getDirectoryContextString,
  getEnvironmentContext,
} from './environmentContext.js';
import type { Config } from '../config/config.js';

function makeConfig(directories: string[], environmentMemory: string): Config {
  return {
    getWorkspaceContext: () =>
      ({
        getDirectories: () => directories,
      }) as unknown as ReturnType<Config['getWorkspaceContext']>,
    getFileService: () => undefined as never,
    getEnvironmentMemory: () => environmentMemory,
  } as Partial<Config> as Config;
}

describe('getEnvironmentContext', () => {
  it('includes date, OS, working-directory preamble, and environment memory', async () => {
    const config = makeConfig(['/test/dir'], 'Memory line');

    const parts = await getEnvironmentContext(config);

    expect(parts).toHaveLength(1);
    const text = parts[0].text;
    expect(text).toContain('This is LLxprt Code.');
    expect(text).toContain("Today's date is");
    expect(text).toContain(`My operating system is: ${process.platform}`);
    expect(text).toContain("I'm currently working in the directory: /test/dir");
    expect(text).toContain('Memory line');
  });

  it('lists multiple directories with the following-directories preamble', async () => {
    const config = makeConfig(['/test/dir1', '/test/dir2'], '');

    const parts = await getEnvironmentContext(config);

    expect(parts).toHaveLength(1);
    expect(parts[0].text).toContain(
      "I'm currently working in the following directories:\n  - /test/dir1\n  - /test/dir2",
    );
  });

  it('does not render a folder-tree listing', async () => {
    const config = makeConfig(['/test/dir'], 'Memory line');

    const parts = await getEnvironmentContext(config);

    const text = parts[0].text;
    expect(text).not.toContain('Here is the folder structure');
    expect(text).not.toContain('Showing up to');
    expect(text).not.toContain('items (files + folders)');
  });

  it('returns exactly one env part', async () => {
    const config = makeConfig(['/test/dir'], '');

    const parts = await getEnvironmentContext(config);

    expect(parts).toHaveLength(1);
  });
});

describe('getDirectoryContextString', () => {
  it('returns a single-directory preamble for one workspace directory', async () => {
    const config = makeConfig(['/test/dir'], '');

    await expect(getDirectoryContextString(config)).resolves.toBe(
      "I'm currently working in the directory: /test/dir",
    );
  });

  it('returns a bulleted preamble for multiple workspace directories', async () => {
    const config = makeConfig(['/test/dir1', '/test/dir2'], '');

    await expect(getDirectoryContextString(config)).resolves.toBe(
      "I'm currently working in the following directories:\n  - /test/dir1\n  - /test/dir2",
    );
  });

  it('resolves to a string (async public contract)', async () => {
    const config = makeConfig(['/test/dir'], '');

    const preamble = getDirectoryContextString(config);

    expect(preamble).toBeInstanceOf(Promise);
    expect(typeof (await preamble)).toBe('string');
  });
});
