/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readPrimarySelection,
  type PrimarySelectionRunner,
} from './primarySelection.js';

describe('readPrimarySelection', () => {
  it('reads Wayland PRIMARY with wl-paste and preserves exact text', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const runner: PrimarySelectionRunner = async (command, args) => {
      calls.push({ command, args });
      return ' first\nsecond\n';
    };

    const text = await readPrimarySelection(
      { WAYLAND_DISPLAY: 'wayland-1', DISPLAY: ':0' },
      runner,
      () => true,
    );

    expect(text).toBe(' first\nsecond\n');
    expect(calls).toStrictEqual([
      { command: 'wl-paste', args: ['--no-newline', '--primary'] },
    ]);
  });

  it('uses X11 PRIMARY reader and never the regular clipboard selection', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const runner: PrimarySelectionRunner = async (command, args) => {
      calls.push({ command, args });
      return 'selected';
    };

    await expect(
      readPrimarySelection(
        { DISPLAY: ':0' },
        runner,
        (name) => name === 'xclip',
      ),
    ).resolves.toBe('selected');
    expect(calls).toStrictEqual([
      { command: 'xclip', args: ['-selection', 'primary', '-o'] },
    ]);
  });

  it('reports missing tools or failed selection reads with actionable errors', async () => {
    await expect(
      readPrimarySelection(
        { DISPLAY: ':0' },
        async () => '',
        () => false,
      ),
    ).rejects.toThrow(/xclip.*xsel/i);
    await expect(
      readPrimarySelection(
        { WAYLAND_DISPLAY: 'wayland-1' },
        async () => {
          throw new Error('PRIVATE selection');
        },
        () => true,
      ),
    ).rejects.toThrow(/PRIMARY/i);
  });

  it('returns empty PRIMARY as empty text without fallback', async () => {
    const calls: string[] = [];
    const runner: PrimarySelectionRunner = async (command) => {
      calls.push(command);
      return '';
    };

    await expect(
      readPrimarySelection(
        { WAYLAND_DISPLAY: 'wayland-1' },
        runner,
        () => true,
      ),
    ).resolves.toBe('');
    expect(calls).toStrictEqual(['wl-paste']);
  });
});

describe('PRIMARY backend failures', () => {
  it('treats the known wl-paste no-selection diagnostic as empty', async () => {
    await expect(
      readPrimarySelection(
        { WAYLAND_DISPLAY: 'wayland-1', DISPLAY: ':0' },
        async () => {
          throw Object.assign(new Error('command failed'), {
            code: 1,
            stderr: 'Nothing is copied\n',
            stdout: '',
          });
        },
        () => true,
      ),
    ).resolves.toBe('');
  });

  it.each([
    'Failed to connect to a Wayland server',
    'PRIVATE selection',
    'Nothing is copied\nPRIVATE selection',
  ])('redacts other exit-one failures: %s', async (stderr) => {
    await expect(
      readPrimarySelection(
        { WAYLAND_DISPLAY: 'wayland-1', DISPLAY: ':0' },
        async () => {
          throw Object.assign(new Error('PRIVATE backend'), {
            code: 1,
            stderr,
            stdout: '',
          });
        },
        () => true,
      ),
    ).rejects.toThrow(
      'Unable to read the PRIMARY selection with wl-paste; check desktop selection access.',
    );
  });

  it('uses xsel PRIMARY when xclip is unavailable', async () => {
    const commands: string[] = [];
    const text = await readPrimarySelection(
      { DISPLAY: ':0' },
      async (command, args) => {
        commands.push([command, ...args].join(' '));
        return 'selected\r\ntext';
      },
      (command) => command === 'xsel',
    );
    expect(commands).toStrictEqual(['xsel --primary --output']);
    expect(text.split('\r\n')).toHaveLength(2);
  });
});

describe('PRIMARY real process boundary', () => {
  describe.skipIf(process.platform !== 'linux')('Linux desktop reader', () => {
    let directory: string;
    let originalEnvironment: NodeJS.ProcessEnv;
    beforeEach(async () => {
      originalEnvironment = { ...process.env };
      await mkdir(
        fileURLToPath(
          new URL(
            '../../../../../project-plans/.tmp-issue3956/',
            import.meta.url,
          ),
        ),
        { recursive: true },
      );
      directory = await mkdtemp(
        fileURLToPath(
          new URL(
            '../../../../../project-plans/.tmp-issue3956/reader-',
            import.meta.url,
          ),
        ),
      );
      const fixture = fileURLToPath(
        new URL('./fixtures/primary-reader.fixtures.ts', import.meta.url),
      );
      await chmod(fixture, 0o755);
      await symlink(fixture, path.join(directory, 'wl-paste'));
      process.env.PATH = `${directory}${path.delimiter}${process.env.PATH}`;
      process.env.PRIMARY_FIXTURE_PID = path.join(directory, 'pid');
    });
    afterEach(async () => {
      process.env = originalEnvironment;
      await rm(directory, { recursive: true, force: true });
    });

    it('decodes UTF8 and passes only the fixed PRIMARY argv', async () => {
      process.env.PRIMARY_FIXTURE_MODE = 'text';
      const text = await readPrimarySelection({ WAYLAND_DISPLAY: 'fixture' });
      expect(JSON.parse(text)).toStrictEqual({
        args: ['--no-newline', '--primary'],
        text: '😀 café\n最後\n',
      });
    });

    it('returns empty for the actual nonzero wl-paste no-selection result', async () => {
      process.env.PRIMARY_FIXTURE_MODE = 'empty';
      await expect(
        readPrimarySelection({ WAYLAND_DISPLAY: 'fixture' }),
      ).resolves.toBe('');
    });

    it.each(['error', 'overflow', 'hang'])(
      'bounds and redacts a real %s process',
      async (mode) => {
        process.env.PRIMARY_FIXTURE_MODE = mode;
        const started = Date.now();
        await expect(
          readPrimarySelection({ WAYLAND_DISPLAY: 'fixture' }),
        ).rejects.toThrow(
          'Unable to read the PRIMARY selection with wl-paste; check desktop selection access.',
        );
        expect(Date.now() - started).toBeLessThan(3000);
        const pid = Number(await readFile(path.join(directory, 'pid'), 'utf8'));
        expect(() => process.kill(pid, 0)).toThrow(/ESRCH|No such process/);
      },
      7000,
    );
  });
});
