/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, describe, expect, it } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { initializeEvidenceLane } from '../../packages/test-utils/src/body-evidence-writer.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

function receiptBodies(root: string): Buffer[] {
  return readdirSync(root)
    .filter((name) => name.endsWith('.body.gz'))
    .map((name) => gunzipSync(readFileSync(join(root, name))));
}

const scratch = realpathSync(
  mkdtempSync(join(tmpdir(), 'body-evidence-boundary-')),
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('real BODY capture evidence boundary', () => {
  it('saves both real transport attempts before the simulated retry failure', async () => {
    const parent = mkdtempSync(join(scratch, 'capture-'));
    const root = join(parent, 'evidence');
    initializeEvidenceLane(root);
    const before = { ...process.env };
    try {
      process.env.BODY_EVIDENCE_MODE = 'sha256+gzip-stream';
      process.env.BODY_EVIDENCE_ROOT = root;
      process.env.BODY_EVIDENCE_ATTEMPT = 'real-retry';
      const actual = await captureCuratedBody(
        'anthropic',
        [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: '😀real input' }],
          },
        ],
        false,
        true,
        true,
      );
      const decoded = receiptBodies(root);
      expect(decoded).toHaveLength(2);
      expect(decoded.every((bytes) => bytes.equals(Buffer.from(actual)))).toBe(
        true,
      );
    } finally {
      for (const name of [
        'BODY_EVIDENCE_MODE',
        'BODY_EVIDENCE_ROOT',
        'BODY_EVIDENCE_ATTEMPT',
      ]) {
        if (before[name] === undefined) delete process.env[name];
        else process.env[name] = before[name];
      }
    }
  });
});
