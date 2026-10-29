/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gpt56SourceProjection } from './gpt56-source-projection.js';

let root: string;
let owners: Gpt56SourceProjection[];
function owner(
  text = '{"cost":2,"dimensions":{"width":32,"height":32}}\n',
): Gpt56SourceProjection {
  const directory = mkdtempSync(join(root, 'owned-'));
  const path = join(directory, 'image-costs.jsonl');
  writeFileSync(path, text);
  const projection = new Gpt56SourceProjection({
    protocol: 'openai-responses',
    directory,
    segments: [],
    imageCosts: {
      source: { path },
      provider: 'openai-responses',
      model: 'gpt-5.6',
    },
  });
  owners.push(projection);
  return projection;
}

describe('lease-bound disk image costs', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'image-costs-'));
    owners = [];
  });
  afterEach(async () => {
    await Promise.all(owners.map((p) => p.dispose()));
    rmSync(root, { recursive: true, force: true });
  });
  lifetimeTests();
  integrityTests();
  failureTests();
});

function lifetimeTests(): void {
  describe('media reader lifetime', () => {
    it('keeps media immutable and lease-owned through disposal and refuses use after release', async () => {
      const projection = owner();
      const lease = projection.acquire();
      const disposal = projection.dispose();
      const count = await lease.countImageTokens({
        provider: 'codex',
        model: 'gpt-5.6-sol',
      });
      expect(count).toBe(2);
      expect(Object.isFrozen(projection.imageCosts)).toBe(true);
      expect(Object.isFrozen(projection.imageCosts?.source)).toBe(true);
      await lease();
      await disposal;
      expect(existsSync(projection.imageCosts?.source.path ?? '')).toBe(false);
      await expect(lease.countImageTokens({})).rejects.toThrow('released');
    });
    it('waits for an active disk media read when its lease is released', async () => {
      const projection = owner();
      const path = projection.imageCosts?.source.path;
      if (!path) throw new Error('Missing cost path');
      for (let i = 0; i < 4095; i++)
        appendFileSync(
          path,
          '{"cost":2,"dimensions":{"width":32,"height":32}}\n',
        );
      const lease = projection.acquire();
      const pending = lease.countImageTokens({
        provider: 'openai',
        model: 'gpt-5.6',
      });
      const release = lease();
      const disposal = projection.dispose();
      expect(existsSync(path)).toBe(true);
      expect(await pending).toBe(8192);
      await release;
      await disposal;
      expect(existsSync(path)).toBe(false);
    });
  });
}

function integrityTests(): void {
  describe('media record integrity', () => {
    it.each([
      '{bad}\n',
      '{"cost":1.5}\n',
      '{"cost":9007199254740992}\n',
      '{"cost":2,"dimensions":{"width":"32","height":32}}\n',
      '{"cost":1,"dimensions":{"width":32,"height":32}}\n',
      '{"cost":1844}',
    ])(
      'rejects malformed, stale or incomplete disk media record %s and releases ownership',
      async (text) => {
        const projection = owner(text);
        const lease = projection.acquire();
        await expect(
          lease.countImageTokens({ provider: 'openai', model: 'gpt-5.6' }),
        ).rejects.toThrow(/JSON|image cost record|image cost disagrees/);
        await lease();
        await projection.dispose();
        expect(existsSync(projection.imageCosts?.source.path ?? '')).toBe(
          false,
        );
      },
    );
    it('rejects a sidecar path outside the transferred directory', () => {
      mkdirSync(join(root, 'owned'));
      expect(
        () =>
          new Gpt56SourceProjection({
            protocol: 'openai-responses',
            directory: join(root, 'owned'),
            segments: [],
            imageCosts: {
              source: { path: join(root, 'outside') },
              provider: 'openai',
              model: 'gpt-5.6',
            },
          }),
      ).toThrow('belong');
    });
  });
}

function failureTests(): void {
  describe('media reader adverse I/O', () => {
    it.each(['cancel', 'io', 'adapter-cancel', 'adapter-io'])(
      'closes an actually opened media reader after %s and clears owned sources',
      async (mode) => {
        const output = join(root, mode + '.json');
        const child = Bun.spawn(
          [
            process.execPath,
            join(import.meta.dir, 'gpt56-source-media-failure.test-helper.ts'),
            mode,
            output,
          ],
          { stdout: 'ignore', stderr: 'pipe' },
        );
        const stderr = await new Response(child.stderr).text();
        expect(stderr).toBe('');
        expect(await child.exited).toBe(0);
        const result: unknown = JSON.parse(readFileSync(output, 'utf8'));
        expect(result).toMatchObject({
          rejected: true,
          opened: 1,
          remaining: 0,
          disposed: true,
          workspaceEmpty: true,
        });
      },
      180000,
    );
  });
}
