/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
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

function runCommands(jobName: string): string[] {
  return jobSteps(workflowJob(workflow, jobName))
    .map((step) => step.run)
    .filter((run): run is string => typeof run === 'string');
}

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
});
