/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import {
  appendBodyEvidence,
  writeCompactBody,
} from '../lib/body-evidence-writer.js';

const [mode, root, label] = process.argv.slice(2);
if (!root || !label) throw new Error('Missing process evidence identity');
if (mode === 'append') {
  for (let index = 0; index < 4; index++)
    await appendBodyEvidence(
      join(root, 'concurrent.jsonl'),
      { label, index },
      `${label}:${index}:actual`,
      `${label}:${index}:expected`,
      {
        BODY_EVIDENCE_MODE: 'sha256+gzip-stream',
        BODY_EVIDENCE_ROOT: root,
        BODY_EVIDENCE_ATTEMPT: label,
      },
    );
} else if (mode === 'interrupt') {
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  async function* pending(): AsyncGenerator<Uint8Array> {
    yield Buffer.from('started-body');
    writeFileSync(join(root, 'ready'), 'ready');
    await setTimeout(60_000, undefined, { signal: controller.signal });
    yield Buffer.from('terminal-body');
  }
  try {
    await writeCompactBody(root, pending(), {
      attempt: label,
      case: 'interrupted',
      side: 'actual',
      signal: controller.signal,
    });
  } catch {
    process.exitCode = 143;
  }
} else throw new Error('Invalid process evidence mode');
