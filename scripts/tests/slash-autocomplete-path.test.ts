/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withShortUiWorkspace } from '../short-ui-workspace.js';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('slash autocomplete working directory', () => {
  it('keeps the physical path short and the real CLI and fixtures reachable', () => {
    let temporary = '';
    withShortUiWorkspace(projectRoot, (directory) => {
      temporary = directory;
      expect(realpathSync(directory)).toBe(directory);
      expect(directory.length).toBeLessThan(55);
      expect(path.basename(directory)).toStartWith('llxprt-code-');
      expect(existsSync(path.join(directory, 'packages/cli/index.ts'))).toBe(
        true,
      );
      expect(
        existsSync(
          path.join(directory, 'scripts/system-settings.interactive-ui.json'),
        ),
      ).toBe(true);
    });
    expect(existsSync(temporary)).toBe(false);
  });

  it('cleans up the isolated cwd when a scenario fails', () => {
    let temporary = '';
    expect(() =>
      withShortUiWorkspace(projectRoot, (directory) => {
        temporary = directory;
        throw new Error('scenario failed');
      }),
    ).toThrow('scenario failed');
    expect(existsSync(temporary)).toBe(false);
  });
});
