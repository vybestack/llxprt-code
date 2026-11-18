/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4128: installed prompt files that are byte-identical to a default we
 * shipped earlier are upgraded to the current default even when the
 * installed manifest does not know them, and customized files that still
 * ask for a `<scratchpad>` are kept but reported.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PromptInstaller } from './prompt-installer.js';
import { CORE_DEFAULTS } from './defaults/core-defaults.js';
import { usePromptsDir } from './__tests__/prompt-installer.test-helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(path.join(here, '__tests__', 'fixtures', name), 'utf-8');
const CURRENT_COMPRESSION_DEFAULT = readFileSync(
  path.join(here, 'defaults', 'compression.md'),
  'utf-8',
);
const RETIRED_COMPRESSION_DEFAULTS = [
  'compression.retired-2025-08-04.md',
  'compression.retired-2026-02-12.md',
];

async function installCompressionDefault(baseDir: string) {
  return new PromptInstaller().install(baseDir, {
    'compression.md': CURRENT_COMPRESSION_DEFAULT,
  });
}

describe('PromptInstaller retired defaults (issue #4128)', () => {
  const promptsDir = usePromptsDir();

  for (const retired of RETIRED_COMPRESSION_DEFAULTS) {
    it(`upgrades an untracked copy of ${retired}`, async () => {
      const installed = path.join(promptsDir(), 'compression.md');
      await fs.writeFile(installed, fixture(retired));

      const result = await installCompressionDefault(promptsDir());

      expect(await fs.readFile(installed, 'utf-8')).toBe(
        CURRENT_COMPRESSION_DEFAULT,
      );
      expect(result.installed).toContain('compression.md');
      expect(result.conflicts).toStrictEqual([]);
      expect(result.notices).toStrictEqual([]);
    });
  }

  it('upgrades a retired copy even when the manifest recorded another hash', async () => {
    const installed = path.join(promptsDir(), 'compression.md');
    await fs.writeFile(
      path.join(promptsDir(), '.installed-manifest.json'),
      JSON.stringify({
        version: 1,
        files: {
          'compression.md': {
            hash: 'not-the-hash-of-the-installed-file',
            installedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    );
    await fs.writeFile(installed, fixture(RETIRED_COMPRESSION_DEFAULTS[0]));

    await installCompressionDefault(promptsDir());

    expect(await fs.readFile(installed, 'utf-8')).toBe(
      CURRENT_COMPRESSION_DEFAULT,
    );
  });

  it('keeps an edited copy that still asks for a scratchpad and reports it', async () => {
    const installed = path.join(promptsDir(), 'compression.md');
    const edited = `${fixture(RETIRED_COMPRESSION_DEFAULTS[0])}\nAlso list open questions.\n`;
    await fs.writeFile(installed, edited);

    const result = await installCompressionDefault(promptsDir());

    expect(await fs.readFile(installed, 'utf-8')).toBe(edited);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      path: 'compression.md',
      action: 'kept',
    });
    const scratchpadNotices = result.notices.filter((notice) =>
      notice.includes('<scratchpad>'),
    );
    expect(scratchpadNotices).toHaveLength(1);
    expect(scratchpadNotices[0]).toContain(installed);
  });

  it('keeps reporting the scratchpad on later installs', async () => {
    const installed = path.join(promptsDir(), 'compression.md');
    await fs.writeFile(
      installed,
      'Think in a <scratchpad> first, then write the <state_snapshot>.',
    );
    await installCompressionDefault(promptsDir());

    const second = await installCompressionDefault(promptsDir());

    expect(second.conflicts).toStrictEqual([]);
    expect(second.notices).toHaveLength(1);
    expect(second.notices[0]).toContain('<scratchpad>');
    expect(second.notices[0]).toContain(installed);
  });

  it('does not report an edited copy without a scratchpad tag', async () => {
    const installed = path.join(promptsDir(), 'compression.md');
    const edited =
      'Respond with only the <state_snapshot>. Do not write out notes or a scratchpad.';
    await fs.writeFile(installed, edited);

    const result = await installCompressionDefault(promptsDir());

    expect(await fs.readFile(installed, 'utf-8')).toBe(edited);
    expect(
      result.notices.filter((notice) => notice.includes('<scratchpad>')),
    ).toStrictEqual([]);
  });

  it('installs every compression prompt file into the prompts directory', async () => {
    const compressionFiles = Object.fromEntries(
      Object.entries(CORE_DEFAULTS).filter(([relativePath]) =>
        relativePath.startsWith('compression/'),
      ),
    );

    const result = await new PromptInstaller().install(
      promptsDir(),
      compressionFiles,
    );

    expect([...result.installed].sort()).toStrictEqual([
      'compression/security-preamble.md',
      'compression/trigger-with-prior-snapshot.md',
      'compression/trigger.md',
      'compression/verification-follow-up.md',
      'compression/verification-request.md',
    ]);
    for (const relativePath of result.installed) {
      const content = await fs.readFile(
        path.join(promptsDir(), relativePath),
        'utf-8',
      );
      expect(content.trim()).not.toBe('');
      expect(content.toLowerCase()).not.toContain('scratchpad');
    }
  });
});
