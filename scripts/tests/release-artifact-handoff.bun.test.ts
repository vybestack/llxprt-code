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
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stepNamed } from './ocr-review-workflow-helpers.ts';
import { parseWorkflowYaml, workflowJob } from './typed-test-helpers.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW = parseWorkflowYaml(
  readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8'),
);

function runSnippet(
  script: string,
  env: NodeJS.ProcessEnv,
  cwd = ROOT,
): number | null {
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', script], {
    cwd,
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
    const root = mkdtempSync(
      join(tmpdir(), 'llxprt-release-artifact-handoff-'),
    );
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

describe('prepared release package tarball handoff', () => {
  it('copies exactly the consumer-proof tarballs named by its manifest and fails when one is missing', () => {
    const proofRun = stepNamed(
      workflowJob(WORKFLOW, 'prepare_artifact'),
      'Build and prove prepared release packages',
    ).run;
    if (proofRun === undefined) {
      throw new Error('prepared release consumer proof step is required');
    }
    const scriptStartMarker = "node -e '\n";
    const scriptEndMarker = '\n\' "$LLXPRT_RELEASE_PROOF_DIR/artifacts.json"';
    const scriptStart = proofRun.indexOf(scriptStartMarker);
    const scriptEnd = proofRun.indexOf(
      scriptEndMarker,
      scriptStart + scriptStartMarker.length,
    );
    if (scriptStart < 0 || scriptEnd < 0) {
      throw new Error('prepared release tarball copier script is required');
    }
    const script = proofRun.slice(
      scriptStart + scriptStartMarker.length,
      scriptEnd,
    );

    const root = mkdtempSync(join(tmpdir(), 'llxprt-release-package-handoff-'));
    const proof = join(root, 'release-proof');
    const upload = join(root, 'release-artifacts');
    const manifest = join(proof, 'artifacts.json');
    const tarballs = [
      'vybestack-llxprt-code-tools-1.2.3.tgz',
      'vybestack-llxprt-code-1.2.3.tgz',
    ];
    const runCopier = (destination: string): number | null =>
      spawnSync('node', ['-e', script, manifest, proof, destination], {
        encoding: 'utf8',
      }).status;

    try {
      mkdirSync(proof);
      mkdirSync(upload);
      for (const filename of tarballs) {
        writeFileSync(join(proof, filename), filename);
      }
      writeFileSync(
        manifest,
        JSON.stringify(
          tarballs.map((filename) => ({
            tarball: join(proof, filename),
          })),
        ),
      );

      expect(runCopier(upload)).toBe(0);
      expect(readdirSync(upload).sort()).toEqual(tarballs.sort());

      const missingOutput = join(root, 'missing-release-artifacts');
      const missingTarball = tarballs[1];
      if (missingTarball === undefined) {
        throw new Error('expected second fixture tarball');
      }
      mkdirSync(missingOutput);
      rmSync(join(proof, missingTarball));
      expect(runCopier(missingOutput)).not.toBe(0);
      expect(readdirSync(missingOutput)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('prepared release commit bundle handoff', () => {
  it('restores an unpublished commit in a fresh job and rejects missing or changed bundles', () => {
    const createCommit = stepNamed(
      workflowJob(WORKFLOW, 'prepare_artifact'),
      'Create prepared release commit',
    ).run;
    const prepare = stepNamed(
      workflowJob(WORKFLOW, 'prepare_artifact'),
      'Bundle prepared release commit',
    ).run;
    const consumer = stepNamed(
      workflowJob(WORKFLOW, 'candidate_amd64'),
      'Restore prepared release commit bundle',
    ).run;
    if (
      createCommit === undefined ||
      prepare === undefined ||
      consumer === undefined
    ) {
      throw new Error(
        'release commit bundle producer and consumer snippets are required',
      );
    }

    const root = mkdtempSync(
      join(tmpdir(), 'llxprt-prepared-release-commit-bundle-'),
    );
    const origin = join(root, 'origin.git');
    const producer = join(root, 'producer');
    const runnerTemp = join(root, 'runner-temp');
    const releaseBranch = 'release/v1.2.0';
    const git = (cwd: string, ...args: string[]): string =>
      execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

    try {
      mkdirSync(producer);
      mkdirSync(join(runnerTemp, 'release-artifacts'), { recursive: true });
      git(producer, 'init', '-b', 'main');
      git(producer, 'config', 'user.name', 'Release handoff test');
      git(producer, 'config', 'user.email', 'release-handoff@example.invalid');
      writeFileSync(join(producer, 'base.txt'), 'public base');
      git(producer, 'add', 'base.txt');
      git(producer, 'commit', '-m', 'public base');
      const baseSha = git(producer, 'rev-parse', 'HEAD');
      git(root, 'init', '--bare', origin);
      git(producer, 'remote', 'add', 'origin', origin);
      git(producer, 'push', 'origin', 'main');
      git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');

      git(producer, 'switch', '-c', releaseBranch);
      mkdirSync(join(producer, 'packages', 'sample'), { recursive: true });
      mkdirSync(join(producer, 'plugins', 'google-gemini'), {
        recursive: true,
      });
      mkdirSync(join(producer, 'plugins', 'google-mcp-auth'), {
        recursive: true,
      });
      writeFileSync(join(producer, 'package.json'), '{"version":"1.2.0"}');
      writeFileSync(join(producer, 'package-lock.json'), '{}');
      writeFileSync(join(producer, 'packages', 'sample', 'package.json'), '{}');
      writeFileSync(
        join(producer, 'plugins', 'google-gemini', 'package.json'),
        '{}',
      );
      writeFileSync(
        join(producer, 'plugins', 'google-mcp-auth', 'package.json'),
        '{}',
      );
      const commitOutput = join(root, 'create-commit-output');
      expect(
        runSnippet(
          createCommit,
          {
            GITHUB_OUTPUT: commitOutput,
            SHOULD_CREATE_BRANCH: 'true',
            RELEASE_TAG: 'v1.2.0',
          },
          producer,
        ),
      ).toBe(0);
      const releaseSha = readFileSync(commitOutput, 'utf8').match(
        /^release_commit_sha=(.+)$/m,
      )?.[1];
      if (releaseSha === undefined) {
        throw new Error('release commit step did not report its commit SHA');
      }
      expect(
        runSnippet(
          prepare,
          {
            RUNNER_TEMP: runnerTemp,
            PUBLIC_BASE_SHA: baseSha,
            RELEASE_COMMIT_SHA: releaseSha ?? '',
            RELEASE_BRANCH: releaseBranch,
          },
          producer,
        ),
      ).toBe(0);

      const bundle = join(
        runnerTemp,
        'release-artifacts',
        'release-commit.bundle',
      );
      const consumerTemp = join(root, 'consumer-temp');
      mkdirSync(join(consumerTemp, 'release-artifacts'), { recursive: true });
      execFileSync('cp', [bundle, join(consumerTemp, 'release-artifacts')]);
      const consumerEnv = {
        RUNNER_TEMP: consumerTemp,
        PUBLIC_BASE_SHA: baseSha,
        RELEASE_COMMIT_SHA: releaseSha,
        RELEASE_BRANCH: releaseBranch,
        SHOULD_CREATE_BRANCH: 'true',
      };

      const freshConsumer = join(root, 'consumer');
      git(root, 'clone', origin, freshConsumer);
      expect(git(freshConsumer, 'rev-parse', 'HEAD')).toBe(baseSha);
      expect(
        spawnSync('git', ['cat-file', '-e', releaseSha], { cwd: freshConsumer })
          .status,
      ).not.toBe(0);
      expect(runSnippet(consumer, consumerEnv, freshConsumer)).toBe(0);
      expect(git(freshConsumer, 'rev-parse', 'HEAD')).toBe(releaseSha);

      writeFileSync(
        join(consumerTemp, 'release-artifacts', 'release-commit.bundle'),
        'tampered',
      );
      const tamperedConsumer = join(root, 'tampered-consumer');
      git(root, 'clone', origin, tamperedConsumer);
      expect(runSnippet(consumer, consumerEnv, tamperedConsumer)).not.toBe(0);

      rmSync(join(consumerTemp, 'release-artifacts', 'release-commit.bundle'));
      const missingConsumer = join(root, 'missing-consumer');
      git(root, 'clone', origin, missingConsumer);
      expect(runSnippet(consumer, consumerEnv, missingConsumer)).not.toBe(0);

      const nightlyConsumer = join(root, 'nightly-consumer');
      git(root, 'clone', origin, nightlyConsumer);
      const nightlyOutput = join(root, 'nightly-output');
      expect(
        runSnippet(
          createCommit,
          {
            GITHUB_OUTPUT: nightlyOutput,
            SHOULD_CREATE_BRANCH: 'false',
            RELEASE_TAG: 'nightly',
          },
          nightlyConsumer,
        ),
      ).toBe(0);
      const nightlySha = readFileSync(nightlyOutput, 'utf8').match(
        /^release_commit_sha=(.+)$/m,
      )?.[1];
      if (nightlySha === undefined) {
        throw new Error('no-commit step did not report the public base SHA');
      }
      expect(nightlySha).toBe(baseSha);
      expect(
        runSnippet(
          consumer,
          {
            RUNNER_TEMP: join(root, 'no-bundle'),
            PUBLIC_BASE_SHA: baseSha,
            RELEASE_COMMIT_SHA: nightlySha,
            RELEASE_BRANCH: '',
            SHOULD_CREATE_BRANCH: 'false',
          },
          nightlyConsumer,
        ),
      ).toBe(0);
      expect(git(nightlyConsumer, 'rev-parse', 'HEAD')).toBe(baseSha);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
