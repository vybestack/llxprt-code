/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createPrivateFileWriter,
  ensurePrivateDirectory,
  type PrivateFileWriter,
} from './private-port-file.js';

const actualFs = { ...(await import('node:fs/promises')) };

/**
 * Holds file creation open so a test can keep a replacement in flight, then
 * lets it finish or fail on demand. Everything else is the real filesystem.
 */
interface CreationGate {
  entered: Promise<void>;
  release: () => void;
  fail: (error: Error) => void;
}

let activeGate:
  | {
      entered: () => void;
      released: Promise<void>;
    }
  | undefined;

void vi.mock('node:fs/promises', () => ({
  ...actualFs,
  writeFile: async (...args: Parameters<typeof actualFs.writeFile>) => {
    const gate = activeGate;
    if (gate !== undefined) {
      gate.entered();
      await gate.released;
    }
    return actualFs.writeFile(...args);
  },
}));

function holdFileCreation(): CreationGate {
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release!: () => void;
  let fail!: (error: Error) => void;
  const released = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  released.catch(() => undefined);
  activeGate = { entered: enter, released };
  return { entered, release, fail };
}

describe('private port file helpers', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-port-file-'));
  });

  afterEach(async () => {
    activeGate = undefined;
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('createPrivateFileWriter', () => {
    let writer: PrivateFileWriter;

    beforeEach(() => {
      writer = createPrivateFileWriter();
    });

    it('creates the file with the given content', async () => {
      const file = path.join(root, 'port.json');

      await writer.write(file, '{"port":1}');

      expect(await fs.readFile(file, 'utf8')).toBe('{"port":1}');
    });

    it.skipIf(process.platform === 'win32')(
      'creates the file readable only by its owner',
      async () => {
        const file = path.join(root, 'port.json');

        await writer.write(file, 'secret');

        expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      },
    );

    it('applies overlapping replacements of the same file in request order', async () => {
      const file = path.join(root, 'port.json');

      const writes = ['one', 'two', 'three', 'four', 'five'].map((content) =>
        writer.write(file, content),
      );
      await Promise.all(writes);

      expect(await fs.readFile(file, 'utf8')).toBe('five');
    });

    it('keeps replacing a file after an earlier queued write failed', async () => {
      const file = path.join(root, 'port.json');
      await fs.mkdir(file);

      const failed = writer.write(file, 'blocked');
      await expect(failed).rejects.toThrow(/EISDIR|EPERM/);
      await fs.rmdir(file);
      await writer.write(file, 'recovered');

      expect(await fs.readFile(file, 'utf8')).toBe('recovered');
    });

    it.skipIf(process.platform === 'win32')(
      'replaces a previous world-readable file',
      async () => {
        const file = path.join(root, 'port.json');
        await fs.writeFile(file, 'old', { mode: 0o644 });
        await fs.chmod(file, 0o644);

        await writer.write(file, 'new');

        expect(await fs.readFile(file, 'utf8')).toBe('new');
        expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      },
    );

    it.skipIf(process.platform === 'win32')(
      'does not write through a symlink planted at the target path',
      async () => {
        const victim = path.join(root, 'victim.txt');
        await fs.writeFile(victim, 'untouched');
        const file = path.join(root, 'port.json');
        await fs.symlink(victim, file);

        await writer.write(file, 'secret');

        expect(await fs.readFile(victim, 'utf8')).toBe('untouched');
        expect((await fs.lstat(file)).isSymbolicLink()).toBe(false);
        expect(await fs.readFile(file, 'utf8')).toBe('secret');
      },
    );

    describe('close', () => {
      it('rejects writes requested after close and leaves the file alone', async () => {
        const file = path.join(root, 'port.json');
        const drained = writer.close();

        await expect(writer.write(file, 'late')).rejects.toThrow(/closed/i);
        await drained;

        await expect(fs.stat(file)).rejects.toThrow(/ENOENT/);
      });

      it('closes admission synchronously, before any queued write has run', async () => {
        const file = path.join(root, 'port.json');
        const queued = writer.write(file, 'queued');

        const drained = writer.close();
        const late = writer.write(file, 'late');

        await expect(late).rejects.toThrow(/closed/i);
        await queued;
        await drained;
        expect(await fs.readFile(file, 'utf8')).toBe('queued');
      });

      it('waits for every queued replacement before it resolves', async () => {
        const file = path.join(root, 'port.json');
        const gate = holdFileCreation();
        const settled: string[] = [];
        const writes = ['one', 'two', 'three'].map((content) =>
          writer.write(file, content).then(() => settled.push(content)),
        );
        await gate.entered;

        let closeResolved = false;
        const drained = writer.close().then(() => {
          closeResolved = true;
        });
        await Promise.resolve();
        expect(closeResolved).toBe(false);

        activeGate = undefined;
        gate.release();
        await drained;

        expect(settled).toEqual(['one', 'two', 'three']);
        expect(await fs.readFile(file, 'utf8')).toBe('three');
        await Promise.all(writes);
      });

      it('drains queued replacements that fail and still resolves', async () => {
        const file = path.join(root, 'port.json');
        const gate = holdFileCreation();
        const outcomes: string[] = [];
        const record = (name: string) => (promise: Promise<void>) =>
          promise.then(
            () => outcomes.push(`${name} written`),
            () => outcomes.push(`${name} failed`),
          );
        const first = record('first')(writer.write(file, 'first'));
        const second = record('second')(writer.write(file, 'second'));
        await gate.entered;

        const drained = writer.close();
        gate.fail(new Error('disk full'));
        await drained;

        expect(outcomes).toEqual(['first failed', 'second failed']);
        await Promise.all([first, second]);
      });

      it('resolves after a failed replacement and stays closed', async () => {
        const file = path.join(root, 'port.json');
        await fs.mkdir(file);
        const failed = writer.write(file, 'blocked');
        const drained = writer.close();

        await expect(failed).rejects.toThrow(/EISDIR|EPERM/);
        await drained;

        await expect(writer.write(file, 'late')).rejects.toThrow(/closed/i);
      });

      it('can be closed more than once', async () => {
        const file = path.join(root, 'port.json');
        await writer.write(file, 'content');

        await writer.close();
        await writer.close();

        expect(await fs.readFile(file, 'utf8')).toBe('content');
      });

      it('does not affect writers created separately', async () => {
        const file = path.join(root, 'port.json');
        const other = createPrivateFileWriter();
        await writer.close();

        await other.write(file, 'still open');

        expect(await fs.readFile(file, 'utf8')).toBe('still open');
      });
    });
  });

  describe('ensurePrivateDirectory', () => {
    it('creates a missing directory', async () => {
      const dir = path.join(root, 'ide');

      await ensurePrivateDirectory(dir);

      expect((await fs.stat(dir)).isDirectory()).toBe(true);
    });

    it.skipIf(process.platform === 'win32')(
      'creates the directory accessible only by its owner',
      async () => {
        const dir = path.join(root, 'ide');

        await ensurePrivateDirectory(dir);

        expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
      },
    );

    it.skipIf(process.platform === 'win32')(
      'tightens an existing directory that others can read',
      async () => {
        const dir = path.join(root, 'ide');
        await fs.mkdir(dir, { mode: 0o755 });
        await fs.chmod(dir, 0o755);

        await ensurePrivateDirectory(dir);

        expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
      },
    );

    it.skipIf(process.platform === 'win32')(
      'rejects a symlink in place of the directory',
      async () => {
        const elsewhere = path.join(root, 'elsewhere');
        await fs.mkdir(elsewhere);
        const dir = path.join(root, 'ide');
        await fs.symlink(elsewhere, dir);

        await expect(ensurePrivateDirectory(dir)).rejects.toThrow(
          /not a directory/i,
        );
      },
    );

    it('rejects a regular file in place of the directory', async () => {
      const dir = path.join(root, 'ide');
      await fs.writeFile(dir, 'not a dir');

      await expect(ensurePrivateDirectory(dir)).rejects.toThrow(
        /not a directory/i,
      );
    });
  });
});
