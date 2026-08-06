/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Opt-in local real-provider acceptance test for Codex gpt-image-2 image
 * generation/editing through the ACTUAL BUILT CLI.
 *
 * Enabled with `LLXPRT_RUN_REAL_PROVIDER_TESTS=true`. Unconditionally skips
 * when `CI=true` (Codex OAuth cannot be provisioned in CI workflows yet).
 *
 * Uses the default saved profile name `codex` (override with
 * `LLXPRT_CODEX_IMAGE_PROFILE`). Performs exactly one generation and one edit
 * to control cost:
 *
 *   1. Generate: -O cat.png -P "Draw a simple black-and-white line-art cat..."
 *   2. Edit:     -I cat.png -O cat-with-mouse.png -P "Preserve... add a mouse..."
 *
 * Structural assertions (mandatory):
 *   - Both files exist, are valid nonempty PNGs with nonzero dimensions.
 *   - The original cat.png is byte-for-byte unchanged after the edit.
 *   - The edited output differs from the original.
 *   - Command output reports each exact path and contains no base64.
 *
 * Honors `KEEP_OUTPUT=true` so retained runs preserve the images.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { TestRig } from './test-helper.js';
import fs from 'node:fs';
import path from 'node:path';

const runningInCI = process.env.CI === 'true';
const realProviderOptIn = process.env.LLXPRT_RUN_REAL_PROVIDER_TESTS === 'true';
const codexProfileName = process.env.LLXPRT_CODEX_IMAGE_PROFILE || 'codex';
const skipTests = runningInCI || !realProviderOptIn;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function isValidPng(bytes: Buffer): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return false;
  }
  if (bytes.length < 24) return false;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0;
}

describe.skipIf(skipTests)(
  'Codex Image real-provider acceptance (built CLI)',
  () => {
    let rig: TestRig;

    beforeEach(async () => {
      rig = new TestRig();
      await rig.setup('codex-image-real');
    });

    afterEach(async () => {
      await rig.cleanup();
    });

    it.skipIf(skipTests)(
      'generates a cat then edits in a mouse via the built CLI image flags',
      async () => {
        const workspaceDir = rig.testDir as string;

        const generateArgs = [
          '--profile-load',
          codexProfileName,
          '--ide-mode',
          'disable',
          '--image-output',
          'cat.png',
          '--image-prompt',
          'Draw a simple black-and-white line-art cat centered on a plain white background. Do not include other animals.',
        ];

        const generateOutput = await rig.runCommand(generateArgs);
        const generateCapture = rig.getLastRunCapture();

        expect(generateCapture?.exitCode).toBe(0);

        const catPath = path.join(workspaceDir, 'cat.png');
        expect(fs.existsSync(catPath)).toBe(true);
        const catBytes = fs.readFileSync(catPath);
        expect(catBytes.length).toBeGreaterThan(0);
        expect(isValidPng(catBytes)).toBe(true);

        expect(generateOutput).toContain(catPath);
        expect(generateOutput).not.toMatch(/[A-Za-z0-9+/]{1000,}={0,2}/);

        const catOriginal = Buffer.from(catBytes);

        const editArgs = [
          '--profile-load',
          codexProfileName,
          '--ide-mode',
          'disable',
          '--image-input',
          'cat.png',
          '--image-output',
          'cat-with-mouse.png',
          '--image-prompt',
          'Preserve the black-and-white line-art cat and add one small line-art mouse next to the cat.',
        ];

        const editOutput = await rig.runCommand(editArgs);
        const editCapture = rig.getLastRunCapture();

        expect(editCapture?.exitCode).toBe(0);

        const editedPath = path.join(workspaceDir, 'cat-with-mouse.png');
        expect(fs.existsSync(editedPath)).toBe(true);
        const editedBytes = fs.readFileSync(editedPath);
        expect(editedBytes.length).toBeGreaterThan(0);
        expect(isValidPng(editedBytes)).toBe(true);

        expect(editOutput).toContain(editedPath);
        expect(editOutput).not.toMatch(/[A-Za-z0-9+/]{1000,}={0,2}/);

        const catReread = fs.readFileSync(catPath);
        expect(catReread.equals(catOriginal)).toBe(true);
        expect(editedBytes.equals(catOriginal)).toBe(false);

        if (process.env.KEEP_OUTPUT === 'true') {
          process.stdout.write(
            `\nKEEP_OUTPUT=true: images retained in ${workspaceDir}\n`,
          );
        }
      },
      120_000,
    );
  },
);
