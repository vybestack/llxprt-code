/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { MIN_MEDIA_PROBE_TURNS } from './issue-3199-media-memory-benchmark.js';
import { describeProcessFailure } from './issue-3199-media-memory-lifecycle.js';

const runtime = process.argv[2];
if (runtime !== 'bun' && runtime !== 'node') {
  throw new Error('Media memory runner runtime must be bun or node');
}
const outputDirectory = resolve(
  process.argv[3] ?? `${tmpdir()}/llxprt-issue-3199-${runtime}-${Date.now()}`,
);
const turns = Number.parseInt(process.argv[4] ?? '6', 10);
if (!Number.isInteger(turns) || turns < MIN_MEDIA_PROBE_TURNS) {
  throw new Error(
    `Media memory runner needs at least ${MIN_MEDIA_PROBE_TURNS} turns`,
  );
}
mkdirSync(outputDirectory, { recursive: true });
const reportPath = resolve(outputDirectory, 'media-memory-report.json');
const targetPath = resolve('scripts/issue-3199-media-memory-target.ts');
let executableTarget = targetPath;
if (runtime === 'node') {
  const build = await Bun.build({
    entrypoints: [targetPath],
    outdir: outputDirectory,
    target: 'node',
    format: 'esm',
    naming: 'node-media-memory-target.mjs',
  });
  if (!build.success) {
    throw new AggregateError(
      build.logs,
      'Failed to bundle the Node media memory target',
    );
  }
  executableTarget = resolve(outputDirectory, 'node-media-memory-target.mjs');
}
const command = runtime;
const argumentsForTarget =
  runtime === 'node'
    ? ['--expose-gc', executableTarget, reportPath, String(turns)]
    : [executableTarget, reportPath, String(turns)];
const child = spawnSync(command, argumentsForTarget, {
  cwd: resolve('.'),
  env: { ...process.env },
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
writeFileSync(resolve(outputDirectory, 'target.stdout'), child.stdout ?? '');
writeFileSync(resolve(outputDirectory, 'target.stderr'), child.stderr ?? '');
if (child.error !== undefined) {
  throw new Error(`Failed to spawn ${runtime} media memory target`, {
    cause: child.error,
  });
}
if (child.status !== 0) {
  throw new Error(
    describeProcessFailure(
      runtime,
      child.status,
      child.signal,
      child.stderr ?? '',
    ),
  );
}
const report = readFileSync(reportPath, 'utf8');
const parsed: unknown = JSON.parse(report);
if (typeof parsed !== 'object' || parsed === null) {
  throw new Error('Media memory target did not write a report object');
}
if (Reflect.get(parsed, 'runtime') !== runtime) {
  throw new Error(`Media memory target reported the wrong runtime`);
}
const plateau = Reflect.get(parsed, 'plateau');
if (typeof plateau !== 'object' || plateau === null) {
  throw new Error('Media memory target omitted plateau results');
}
if (Reflect.get(plateau, 'overallWithinTolerance') !== true) {
  throw new Error('Media memory target did not satisfy every metric plateau');
}
const uniqueContentCount = Reflect.get(parsed, 'uniqueContentCount');
const contentIds = Reflect.get(parsed, 'contentIds');
if (!Number.isSafeInteger(uniqueContentCount) || uniqueContentCount < 2) {
  throw new Error(
    'Media memory target did not report unique content identities',
  );
}
if (
  !Array.isArray(contentIds) ||
  new Set(contentIds).size !== contentIds.length ||
  contentIds.length !== uniqueContentCount
) {
  throw new Error('Media memory target reused a content identity across turns');
}
process.stdout.write(
  `${report.trim()}\nartifactDirectory=${outputDirectory}\n`,
);
