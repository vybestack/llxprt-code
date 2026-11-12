/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { stepNamed } from './ocr-review-workflow-helpers.ts';
import { parseWorkflowYaml, workflowJob } from './typed-test-helpers.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const WORK = join(ROOT, 'tmp/lane');
const WORKFLOW = parseWorkflowYaml(
  readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8'),
);

function runSnippet(script: string, env: NodeJS.ProcessEnv): number | null {
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  }).status;
}

describe('release candidate archive handoff', () => {
  it('verifies the produced archive after transfer and rejects a modified archive', () => {
    const producer = stepNamed(
      workflowJob(WORKFLOW, 'candidate_amd64'),
      'Export candidate image and calculate digest',
    ).run;
    const armProducer = stepNamed(
      workflowJob(WORKFLOW, 'candidate_arm64'),
      'Export candidate image and calculate digest',
    ).run;
    const consumerRun = stepNamed(
      workflowJob(WORKFLOW, 'release'),
      'Verify and load candidate images',
    ).run;
    const consumer = consumerRun?.replace(
      '${{ steps.version.outputs.RELEASE_VERSION }}',
      '1.2.3',
    );
    if (
      producer === undefined ||
      armProducer === undefined ||
      consumer === undefined
    ) {
      throw new Error(
        'candidate archive producer and consumer snippets are required',
      );
    }
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    const root = mkdtempSync(join(WORK, 'handoff-'));
    const source = join(root, 'producer');
    const destination = join(root, 'consumer');
    const bin = join(root, 'bin');
    const archive = 'candidate-amd64.tar';

    try {
      mkdirSync(source);
      mkdirSync(destination);
      mkdirSync(bin);
      writeFileSync(
        join(bin, 'docker'),
        `#!/bin/sh\nif [ "$1" = save ]; then\n  printf 'candidate image bytes' > "$4"\nfi\n`,
      );
      chmodSync(join(bin, 'docker'), 0o755);
      const producerStatus = runSnippet(producer, {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        RUNNER_TEMP: source,
        GITHUB_OUTPUT: join(root, 'producer-output'),
      });
      expect(producerStatus).toBe(0);
      expect(
        runSnippet(armProducer, {
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          RUNNER_TEMP: source,
          GITHUB_OUTPUT: join(root, 'arm-producer-output'),
        }),
      ).toBe(0);

      for (const [name, suffix] of [
        ['candidate-amd64.tar', 'amd64'],
        ['candidate-arm64.tar', 'arm64'],
      ]) {
        const sourceArchive = join(source, name);
        const consumerDirectory = join(destination, `candidate-${suffix}`);
        mkdirSync(consumerDirectory);
        for (const file of [sourceArchive, `${sourceArchive}.sha256`]) {
          execFileSync('cp', [file, consumerDirectory]);
        }
      }
      const metadata = {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        RUNNER_TEMP: root,
        GITHUB_SHA: sourceSha,
        SOURCE_SHA: sourceSha,
        RELEASE_COMMIT_SHA: sourceSha,
        AMD64_SOURCE_SHA: sourceSha,
        ARM64_SOURCE_SHA: sourceSha,
        RELEASE_VERSION: '1.2.3',
        AMD64_RELEASE_VERSION: '1.2.3',
        ARM64_RELEASE_VERSION: '1.2.3',
        INPUT_ARTIFACT_DIGEST: 'input-digest',
        AMD64_INPUT_ARTIFACT_DIGEST: 'input-digest',
        ARM64_INPUT_ARTIFACT_DIGEST: 'input-digest',
        AMD64_ARTIFACT_DIGEST: 'amd64-artifact',
        ARM64_ARTIFACT_DIGEST: 'arm64-artifact',
        AMD64_IMAGE_SHA256: readFileSync(
          join(source, `${archive}.sha256`),
          'utf8',
        ).split(' ')[0],
        ARM64_IMAGE_SHA256: readFileSync(
          join(source, 'candidate-arm64.tar.sha256'),
          'utf8',
        ).split(' ')[0],
      };
      const consumerEnv = {
        ...metadata,
        RUNNER_TEMP: root,
      };
      for (const architecture of ['amd64', 'arm64']) {
        const candidateDirectory = join(root, `candidate-${architecture}`);
        mkdirSync(candidateDirectory);
        for (const filename of [
          `candidate-${architecture}.tar`,
          `candidate-${architecture}.tar.sha256`,
        ]) {
          execFileSync('cp', [
            join(destination, `candidate-${architecture}`, filename),
            candidateDirectory,
          ]);
        }
      }
      expect(runSnippet(consumer, consumerEnv)).toBe(0);

      writeFileSync(
        join(root, 'candidate-amd64', archive),
        'tampered candidate image',
      );
      expect(runSnippet(consumer, consumerEnv)).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
