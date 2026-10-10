/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliBundleTargets } from '../bun-build.config.js';
import { releaseSourceEmittedSiblingPlugin } from '../source-emitted-sibling-resolution.js';

describe('release bundle emitted sibling resolution', () => {
  it('connects source-first resolution to every published CLI bundle target', () => {
    expect(
      cliBundleTargets.every((target) =>
        target.config.plugins?.some(
          (candidate) =>
            candidate.name === releaseSourceEmittedSiblingPlugin.name,
        ),
      ),
    ).toBe(true);
  });

  it('keeps the directly owned Zod dependency external for source-first bundles', () => {
    expect(
      cliBundleTargets.every((target) =>
        target.config.external?.includes('zod'),
      ),
    ).toBe(true);
  });

  it('bundles current TypeScript instead of stale mapped JS while retaining authored JS and JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-sibling-'));
    try {
      const dir = join(root, 'packages/core/src/recording');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(root, 'packages/core/package.json'),
        JSON.stringify({
          type: 'module',
          exports: { './recording/shipped.js': './src/recording/shipped.js' },
        }),
      );
      mkdirSync(join(root, 'packages/cli/src'), { recursive: true });
      writeFileSync(
        join(root, 'packages/cli/tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: { '@vybestack/llxprt-code-core/*': ['../core/src/*'] },
          },
        }),
      );
      writeFileSync(
        join(dir, 'RecordingIntegration.ts'),
        'export class RecordingIntegration { rememberRecordedHistory(): string { return "current-ts"; } }',
      );
      writeFileSync(
        join(dir, 'RecordingIntegration.js'),
        'export class RecordingIntegration {}\n//# sourceMappingURL=RecordingIntegration.js.map',
      );
      writeFileSync(
        join(dir, 'RecordingIntegration.js.map'),
        JSON.stringify({
          file: 'RecordingIntegration.js',
          sources: ['RecordingIntegration.ts'],
        }),
      );
      utimesSync(
        join(dir, 'RecordingIntegration.js'),
        new Date(),
        new Date(Date.now() + 10_000),
      );
      writeFileSync(
        join(dir, 'authored.js'),
        'export const authored = "independent-js";',
      );
      writeFileSync(
        join(dir, 'shipped.ts'),
        'export const shipped = "wrong-ts";',
      );
      writeFileSync(
        join(dir, 'shipped.js'),
        'export const shipped = "shipped-js";\n//# sourceMappingURL=shipped.js.map',
      );
      writeFileSync(
        join(dir, 'shipped.js.map'),
        JSON.stringify({ file: 'shipped.js', sources: ['shipped.ts'] }),
      );
      writeFileSync(join(dir, 'settings.json'), '{"setting":"json-retained"}');
      writeFileSync(
        join(dir, 'relative.ts'),
        "export { RecordingIntegration } from './RecordingIntegration.js'; export { authored } from './authored.js'; export { default as settings } from './settings.json';",
      );
      writeFileSync(
        join(root, 'packages/cli/src/entry.ts'),
        "import { RecordingIntegration, authored, settings } from '../../core/src/recording/relative.js'; import { RecordingIntegration as FromPackage } from '@vybestack/llxprt-code-core/recording/RecordingIntegration.js'; import { shipped } from '@vybestack/llxprt-code-core/recording/shipped.js'; console.log(JSON.stringify({ method: new FromPackage().rememberRecordedHistory(), sameClass: RecordingIntegration === FromPackage, authored, shipped, setting: settings.setting }));",
      );
      const built = await Bun.build({
        entrypoints: [join(root, 'packages/cli/src/entry.ts')],
        target: 'node',
        outdir: join(root, 'bundle'),
        plugins: [releaseSourceEmittedSiblingPlugin(root)],
      });
      expect(built.success).toBe(true);
      expect(built.outputs.map((output) => output.path)).toEqual([
        join(root, 'bundle/entry.js'),
      ]);
      const source = readFileSync(join(root, 'bundle/entry.js'), 'utf8');
      expect(source).toContain('rememberRecordedHistory()');
      const child = Bun.spawnSync({
        cmd: ['node', join(root, 'bundle/entry.js')],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(child.exitCode, child.stderr.toString()).toBe(0);
      expect(JSON.parse(child.stdout.toString())).toEqual({
        method: 'current-ts',
        sameClass: true,
        authored: 'independent-js',
        shipped: 'shipped-js',
        setting: 'json-retained',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
