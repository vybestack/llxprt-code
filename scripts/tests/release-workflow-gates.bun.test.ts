/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { relative, resolve } from 'node:path';
import {
  asRecord,
  asString,
  asStringArray,
  jobSteps,
  parseWorkflowYaml,
  workflowJob,
} from './typed-test-helpers.ts';
import { readRootFile } from './ocr-review-workflow-helpers.ts';

const workflow = parseWorkflowYaml(
  readRootFile('.github/workflows/release.yml'),
);
const jobs = asRecord(workflow['jobs']);
const verificationJobs = [
  'verify_preflight',
  'verify_shards',
  'integration',
  'candidate_amd64',
  'candidate_arm64',
] as const;

function standardArtifactAction(actionName: string): string {
  const ratchetMarker = `# ratchet:actions/${actionName}@v`;
  const candidates = [
    readRootFile('.github/workflows/nightly.yml'),
    readRootFile('.github/workflows/evals-nightly.yml'),
  ].flatMap((source) =>
    source
      .split('\n')
      .filter((line) => line.includes(ratchetMarker))
      .map((line) => {
        const match = line.match(
          /uses:\s*['"]?(actions\/[a-z-]+@[a-f0-9]+)['"]?\s+# ratchet:actions\/[a-z-]+@v(\d+)/,
        );
        if (match === null) {
          throw new Error(`Malformed ratcheted action line: ${line}`);
        }
        return match;
      }),
  );
  const latest = candidates.reduce<RegExpMatchArray | undefined>(
    (selected, candidate) =>
      selected === undefined || Number(candidate[2]) > Number(selected[2])
        ? candidate
        : selected,
    undefined,
  );
  if (latest === undefined) {
    throw new Error(`No ratcheted pin found for actions/${actionName}`);
  }
  return latest[1] as string;
}

const checkCommandsBefore = [
  'npm run format',
  'npm run build',
  'npm run lint:ci',
  'npm run typecheck',
  'npm run lint:agents-api-surface',
  'npm run test:ci',
  'npm run test:integration:sandbox:none',
  'bun scripts/sandbox-image-probe.ts --engine docker --image "$SANDBOX_SMOKE_IMAGE" --platform linux/amd64',
  'bun scripts/sandbox-image-probe.ts --engine docker --image "$SANDBOX_SMOKE_IMAGE" --platform linux/arm64',
];

const checkCommandsAfter = [
  'npm run format',
  'npm run build',
  'npm run lint:ci',
  'npm run typecheck',
  'npm run lint:agents-api-surface',
  'npm run lint:test-shards',
  'bun scripts/test.ts --shard "${{ matrix.shard }}"',
  'npm run test:integration:sandbox:none',
  'bun scripts/sandbox-image-probe.ts --engine docker --image llxprt-sandbox:candidate-amd64 --platform linux/amd64',
  'bun scripts/sandbox-image-probe.ts --engine docker --image llxprt-sandbox:candidate-arm64 --platform linux/arm64',
];

function needsOf(jobName: string): string[] {
  return asStringArray(workflowJob(workflow, jobName)['needs']);
}
describe('release artifact action compatibility', () => {
  it('uses the repository artifact action pins and publishes each compared digest', () => {
    const uploadAction = standardArtifactAction('upload-artifact');
    const downloadAction = standardArtifactAction('download-artifact');

    for (const job of Object.values(jobs)) {
      const jobRecord = asRecord(job);
      const steps = jobSteps(jobRecord);
      for (const step of steps) {
        if (typeof step.uses !== 'string') continue;
        const uses = step.uses;
        if (uses.startsWith('actions/upload-artifact@')) {
          expect(uses).toBe(uploadAction);
        } else if (uses.startsWith('actions/download-artifact@')) {
          expect(uses).toBe(downloadAction);
        }
      }

      const outputs =
        jobRecord.outputs === undefined ? {} : asRecord(jobRecord.outputs);
      for (const [outputName, outputValue] of Object.entries(outputs)) {
        const match = asString(outputValue).match(
          /steps\.([^.]+)\.outputs\.artifact-digest/,
        );
        if (match === null) continue;
        const sourceStep = steps.find((step) => step.id === match[1]);
        expect(
          asString(sourceStep?.uses),
          `${outputName} must come from the repository upload-artifact action`,
        ).toBe(uploadAction);
      }
    }

    const prepareSteps = jobSteps(workflowJob(workflow, 'prepare_artifact'));
    const preparedUpload = prepareSteps.find(
      (step) => step.name === 'Upload prepared release artifacts',
    );
    expect(asRecord(preparedUpload?.with)['include-hidden-files']).toBe(true);
  });
});

function runCommands(jobName: string): string[] {
  return jobSteps(workflowJob(workflow, jobName))
    .map((step) => step.run)
    .filter((run): run is string => typeof run === 'string');
}

describe('prepared release commit wiring', () => {
  it('uploads the bundle with prepared artifacts and restores it before each release checkout', () => {
    const prepareSteps = jobSteps(workflowJob(workflow, 'prepare_artifact'));
    const bundleIndex = prepareSteps.findIndex(
      (step) => step.name === 'Bundle prepared release commit',
    );
    const uploadIndex = prepareSteps.findIndex(
      (step) => step.name === 'Upload prepared release artifacts',
    );
    expect(bundleIndex).toBeGreaterThanOrEqual(0);
    expect(uploadIndex).toBeGreaterThan(bundleIndex);
    expect(asString(prepareSteps[bundleIndex]?.run)).toContain(
      'release-commit.bundle',
    );

    for (const jobName of ['candidate_amd64', 'candidate_arm64', 'release']) {
      const steps = jobSteps(workflowJob(workflow, jobName));
      const restoreIndex = steps.findIndex(
        (step) => step.name === 'Restore prepared release commit bundle',
      );
      expect(
        restoreIndex,
        `${jobName} must restore its commit bundle`,
      ).toBeGreaterThanOrEqual(0);
      const artifactIndex = steps.findIndex(
        (step) => step.name === 'Download prepared release artifacts',
      );
      expect(
        artifactIndex,
        `${jobName} must download the bundle artifact`,
      ).toBeGreaterThanOrEqual(0);
      expect(artifactIndex).toBeLessThan(restoreIndex);
      const restore = steps[restoreIndex];
      const restoreRun = asString(restore?.run);
      expect(restoreRun).toContain('git bundle verify "$bundle"');
      expect(restoreRun).toContain(
        'git checkout --detach "$RELEASE_COMMIT_SHA"',
      );
      expect(restoreRun).toContain(
        'test "$(git rev-parse HEAD)" = "$RELEASE_COMMIT_SHA"',
      );
      expect(restoreRun.indexOf('git bundle verify')).toBeLessThan(
        restoreRun.indexOf('git checkout --detach'),
      );
      expect(restoreRun).toContain('SHOULD_CREATE_BRANCH');
      expect(restoreRun).toContain(
        'test "$RELEASE_COMMIT_SHA" = "$PUBLIC_BASE_SHA"',
      );
    }
  });
});

describe('prepared release artifact inventory', () => {
  it('keeps consumer-proof scratch outside the uploaded handoff and uploads only its diagnostics separately', () => {
    const prepareSteps = jobSteps(workflowJob(workflow, 'prepare_artifact'));
    const proofStep = prepareSteps.find(
      (step) => step.name === 'Build and prove prepared release packages',
    );
    const uploadStep = prepareSteps.find(
      (step) => step.name === 'Upload prepared release artifacts',
    );
    const diagnosticsStep = prepareSteps.find(
      (step) => step.name === 'Upload release consumer proof',
    );
    if (proofStep === undefined || uploadStep === undefined) {
      throw new Error(
        'release proof and prepared artifact upload are required',
      );
    }

    const proofEnv = asRecord(proofStep.env);
    const proofDirectory = asString(proofEnv.LLXPRT_RELEASE_PROOF_DIR).replace(
      '${{ runner.temp }}',
      '/runner-temp',
    );
    const uploadConfig = asRecord(uploadStep.with);
    const uploadDirectory = asString(uploadConfig.path).replace(
      '${{ runner.temp }}',
      '/runner-temp',
    );
    const relativeProofPath = relative(
      resolve(uploadDirectory),
      resolve(proofDirectory),
    );

    expect(
      relativeProofPath === '' ||
        (!relativeProofPath.startsWith('../') && relativeProofPath !== '..'),
      'proof scratch must not be the uploaded directory or a child of it',
    ).toBe(false);
    const proofRun = asString(proofStep.run);
    expect(proofRun).toContain('path.basename(artifact.tarball)');
    expect(proofRun).toContain('fs.statSync(source).isFile()');
    expect(proofRun).toContain(
      'fs.copyFileSync(source, path.join(artifactDirectory, filename))',
    );
    expect(proofRun).not.toContain('cp -R "$LLXPRT_RELEASE_PROOF_DIR"');

    expect(diagnosticsStep).toBeDefined();
    expect(asString(diagnosticsStep?.['if'])).toContain('always()');
    expect(asString(diagnosticsStep?.uses)).toBe(uploadStep.uses);
    const diagnostics = asRecord(diagnosticsStep?.with);
    expect(asString(diagnostics['if-no-files-found'])).toBe('warn');
    expect(asString(diagnostics.path)).toContain(
      '${{ runner.temp }}/release-proof/*.json',
    );
    expect(asString(diagnostics.path)).toContain(
      '${{ runner.temp }}/release-proof/*.log',
    );
    expect(asString(diagnostics.path)).toContain(
      '${{ runner.temp }}/release-proof/local/*.log',
    );
    expect(asString(diagnostics.path)).toContain(
      '${{ runner.temp }}/release-proof/global/*.log',
    );
  });
});

describe('issue #4033 release workflow gates', () => {
  it('makes promotion depend on every verification and architecture smoke job', () => {
    const needs = needsOf('release');
    for (const jobName of [...verificationJobs, 'prepare_artifact']) {
      expect(needs, `promotion must need ${jobName}`).toContain(jobName);
    }
  });

  it('has no package or image publication steps in verification jobs', () => {
    for (const jobName of verificationJobs) {
      for (const step of jobSteps(workflowJob(workflow, jobName))) {
        const description = `${jobName}: ${step.name ?? '<unnamed>'}`;
        const command = typeof step.run === 'string' ? step.run : '';
        const action = typeof step.uses === 'string' ? step.uses : '';
        const config = step.with === undefined ? {} : asRecord(step.with);

        expect(description).not.toMatch(/publish|push|release and tag/i);
        expect(command).not.toMatch(
          /npm publish|docker push|imagetools create|gh release create|git push/i,
        );
        expect(action).not.toMatch(/npm-publish|release|registry-push/i);
        expect(config.push).not.toBe(true);
      }
    }
  });
  it('builds image candidates locally and smoke-tests them before export', () => {
    for (const [jobName, buildName, smokeName] of [
      [
        'candidate_amd64',
        'Build amd64 candidate image',
        'Smoke test amd64 candidate',
      ],
      [
        'candidate_arm64',
        'Build arm64 candidate image',
        'Smoke test arm64 candidate',
      ],
    ]) {
      const steps = jobSteps(workflowJob(workflow, jobName));
      const buildIndex = steps.findIndex((step) => step.name === buildName);
      const smokeIndex = steps.findIndex((step) => step.name === smokeName);
      expect(
        buildIndex,
        `${jobName} must build an image`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        smokeIndex,
        `${jobName} must smoke-test its image`,
      ).toBeGreaterThanOrEqual(0);
      const buildConfig = asRecord(steps[buildIndex]?.with);
      expect(buildConfig.push).toBe(false);
      expect(buildConfig.load).toBe(true);
      expect(asString(buildConfig.labels)).toContain(
        'needs.prepare_artifact.outputs.image_labels',
      );
      expect(buildIndex).toBeLessThan(smokeIndex);
    }
  });

  it('verifies prepared package tarballs before building image candidates', () => {
    for (const jobName of ['candidate_amd64', 'candidate_arm64']) {
      const steps = jobSteps(workflowJob(workflow, jobName));
      const restoreIndex = steps.findIndex(
        (step) => step.name === 'Restore and verify sandbox input tarballs',
      );
      const buildIndex = steps.findIndex((step) =>
        (step.name ?? '').startsWith('Build '),
      );
      expect(restoreIndex).toBeGreaterThanOrEqual(0);
      expect(asString(steps[restoreIndex]?.run)).toContain(
        'sha256sum --check release-package-tarballs.sha256',
      );
      expect(restoreIndex).toBeLessThan(buildIndex);
    }
  });

  it('preserves the preflight checks, integration suite, and both image smokes', () => {
    const commandsByJob = Object.fromEntries(
      Object.keys(jobs).map((jobName) => [jobName, runCommands(jobName)]),
    );
    const allCommands = Object.values(commandsByJob).flat().join('\n');

    for (const command of checkCommandsAfter) {
      expect(
        allCommands,
        `missing release check command: ${command}`,
      ).toContain(command);
    }
    expect(allCommands).not.toContain('npm run test:ci');
    expect(checkCommandsBefore).toContain('npm run test:ci');
    expect(checkCommandsAfter).not.toContain('npm run test:ci');
    const normalizedAfter = checkCommandsAfter
      .filter(
        (command) =>
          command !== 'npm run lint:test-shards' &&
          command !== 'bun scripts/test.ts --shard "${{ matrix.shard }}"',
      )
      .map((command) =>
        command
          .replace('llxprt-sandbox:candidate-amd64', '"$SANDBOX_SMOKE_IMAGE"')
          .replace('llxprt-sandbox:candidate-arm64', '"$SANDBOX_SMOKE_IMAGE"'),
      );
    expect(normalizedAfter).toEqual(
      checkCommandsBefore.filter((command) => command !== 'npm run test:ci'),
    );

    const strategy = asRecord(
      workflowJob(workflow, 'verify_shards')['strategy'],
    );
    const matrix = asRecord(strategy['matrix']);
    const partitions = (matrix['include'] as unknown[]).map((item) => {
      const shard = asRecord(item);
      return `${asString(shard.shard)}:${asString(shard.partition)}`;
    });
    expect(partitions).toEqual([
      'cli:1of3',
      'cli:2of3',
      'cli:3of3',
      'agents:1of1',
      'providers:1of1',
      'core:1of1',
      'rest:1of1',
      'scripts:1of1',
    ]);
  });

  it('carries the source SHA, version, and artifact digests to the promotion job', () => {
    const prepareOutputs = asRecord(
      workflowJob(workflow, 'prepare_artifact')['outputs'],
    );
    expect(asString(prepareOutputs.image_labels)).toContain(
      'steps.image_metadata.outputs.labels',
    );

    const release = workflowJob(workflow, 'release');
    const versionStep = jobSteps(release).find((step) => step.id === 'version');
    const versionEnv = asRecord(versionStep?.env);
    expect(asString(versionEnv.RELEASE_TAG)).toContain(
      'needs.prepare_artifact.outputs.release_tag',
    );
    expect(asString(versionEnv.RELEASE_VERSION)).toContain(
      'needs.prepare_artifact.outputs.release_version',
    );
    expect(asString(versionEnv.NPM_TAG)).toContain(
      'needs.prepare_artifact.outputs.npm_tag',
    );
    const env = asRecord(release['env']);
    expect(asString(env.SOURCE_SHA)).toContain(
      'needs.prepare_artifact.outputs.source_sha',
    );
    expect(asString(env.RELEASE_VERSION)).toContain(
      'needs.prepare_artifact.outputs.release_version',
    );
    expect(asString(env.INPUT_ARTIFACT_DIGEST)).toContain(
      'needs.prepare_artifact.outputs.artifact_digest',
    );
    expect(asString(env.AMD64_ARTIFACT_DIGEST)).toContain(
      'needs.candidate_amd64.outputs.artifact_digest',
    );
    expect(asString(env.ARM64_ARTIFACT_DIGEST)).toContain(
      'needs.candidate_arm64.outputs.artifact_digest',
    );
    expect(asString(env.AMD64_INPUT_ARTIFACT_DIGEST)).toContain(
      'needs.candidate_amd64.outputs.input_artifact_digest',
    );
    expect(asString(env.ARM64_INPUT_ARTIFACT_DIGEST)).toContain(
      'needs.candidate_arm64.outputs.input_artifact_digest',
    );
    expect(asString(env.AMD64_SOURCE_SHA)).toContain(
      'needs.candidate_amd64.outputs.source_sha',
    );
    expect(asString(env.ARM64_SOURCE_SHA)).toContain(
      'needs.candidate_arm64.outputs.source_sha',
    );
    expect(asString(env.AMD64_RELEASE_VERSION)).toContain(
      'needs.candidate_amd64.outputs.release_version',
    );
    expect(asString(env.ARM64_RELEASE_VERSION)).toContain(
      'needs.candidate_arm64.outputs.release_version',
    );

    for (const jobName of ['candidate_amd64', 'candidate_arm64']) {
      const outputs = asRecord(workflowJob(workflow, jobName)['outputs']);
      expect(asString(outputs.source_sha)).toContain(
        'needs.prepare_artifact.outputs.source_sha',
      );
      expect(asString(outputs.release_version)).toContain(
        'needs.prepare_artifact.outputs.release_version',
      );
      expect(asString(outputs.input_artifact_digest)).toContain(
        'needs.prepare_artifact.outputs.artifact_digest',
      );
    }
  });

  it('completes artifact and candidate verification before publishing in the required order', () => {
    const steps = jobSteps(workflowJob(workflow, 'release'));
    const names = steps.map((step) => step.name ?? '');
    const indexOf = (name: string): number => {
      const index = names.indexOf(name);
      expect(index, `missing promotion step: ${name}`).toBeGreaterThanOrEqual(
        0,
      );
      return index;
    };
    const verificationIndex = indexOf(
      'Verify prepared release artifact digests',
    );
    const candidateIndex = indexOf('Verify and load candidate images');
    const pushIndex = indexOf('Push release branch after all release gates');
    const npmIndex = indexOf('Publish @vybestack/llxprt-code-tools');
    const vscodeIndex = indexOf('Publish VS Code extension');
    const homebrewIndex = indexOf('Update Homebrew formula');
    const imagesIndex = indexOf('Publish tested sandbox candidates');
    const releaseIndex = indexOf('Create GitHub Release and Tag');

    expect(verificationIndex).toBeLessThan(pushIndex);
    expect(candidateIndex).toBeLessThan(pushIndex);
    expect(pushIndex).toBeLessThan(npmIndex);
    expect(npmIndex).toBeLessThan(vscodeIndex);
    expect(vscodeIndex).toBeLessThan(homebrewIndex);
    expect(homebrewIndex).toBeLessThan(imagesIndex);
    expect(imagesIndex).toBeLessThan(releaseIndex);
  });

  it('promotes only digest-verified prepared artifacts without rebuilding or installing source', () => {
    const prepare = workflowJob(workflow, 'prepare_artifact');
    const preparationSteps = jobSteps(prepare);
    const preparation = preparationSteps
      .map((step) => step.run ?? '')
      .join('\n');
    const releaseSteps = jobSteps(workflowJob(workflow, 'release'));

    expect(preparation).toContain('npm pack');
    expect(preparation).toContain('sha256sum');
    expect(preparation).toContain(
      'scripts/tests/release-bound-artifact-helpers.ts',
    );
    expect(preparation).toContain('build:vscode');
    expect(preparation).toContain('release-artifacts.sha256');

    const releaseRuns = releaseSteps.flatMap((step) =>
      (step.run ?? '').split('\n').map((line) => line.trimStart()),
    );
    expect(releaseRuns.join('\n')).toContain(
      'sha256sum --check release-artifacts.sha256',
    );
    expect(releaseRuns.join('\n')).toContain('npm publish');
    const forbiddenCommands = [
      'npm ci',
      'npm install',
      'npm pack',
      'npm version',
      'npm run build',
      'npm run build:packages',
      'npm run prepare:package',
      'npm run bundle:cli',
      'npm run build:vscode',
      'bun install',
    ];
    for (const line of releaseRuns) {
      expect(
        forbiddenCommands.some(
          (command) => line === command || line.startsWith(`${command} `),
        ),
        `promotion must not prepare source artifacts: ${line}`,
      ).toBe(false);
    }

    const publishSteps = releaseSteps.filter((step) =>
      /^(Publish |Update Homebrew|Create GitHub Release and Tag)/.test(
        step.name ?? '',
      ),
    );
    expect(publishSteps.length).toBeGreaterThan(0);
    for (const step of publishSteps) {
      const description = `${step.run ?? ''}\n${JSON.stringify(step.env ?? {})}`;
      expect(
        description,
        `${step.name} must consume a prepared artifact`,
      ).toMatch(/release-artifacts|candidate-amd64/);
    }

    const prepareOutputs = asRecord(prepare['outputs']);
    expect(asString(prepareOutputs.release_commit_sha)).toContain(
      'steps.create_release_commit.outputs.release_commit_sha',
    );
    const checkout = releaseSteps.find(
      (step) => step.name === 'Checkout prepared release commit base',
    );
    expect(JSON.stringify(checkout?.with)).toContain('github.sha');
    expect(
      releaseSteps.findIndex(
        (step) => step.name === 'Restore prepared release commit bundle',
      ),
    ).toBeGreaterThan(
      releaseSteps.findIndex(
        (step) => step.name === 'Checkout prepared release commit base',
      ),
    );
    expect(
      releaseRuns.some((line) =>
        line.includes(
          'needs.prepare_artifact.outputs.release_commit_sha }}:refs/heads/',
        ),
      ),
    ).toBe(true);
  });
});
