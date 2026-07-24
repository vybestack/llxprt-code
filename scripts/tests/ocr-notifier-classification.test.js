/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  commandText,
  normalize,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.js';

const OCR_WORKFLOW_PATH = '.github/workflows/ocr-review.yml';
const require = createRequire(import.meta.url);
const NOTIFIER_WORKFLOW_PATH =
  '.github/workflows/ocr-infrastructure-notifier.yml';

function loadWorkflow(workflowPath) {
  const source = readRootFile(workflowPath);
  const parsed = yaml.load(source);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${workflowPath} did not parse to a YAML mapping`);
  }
  return { source, parsed };
}

function loadClassificationScript(classifyJob) {
  const classifyStep = stepNamed(classifyJob, 'Classify completed OCR run');
  const script = commandText(classifyStep);
  if (!script) {
    throw new Error('OCR notifier classification script should not be empty');
  }
  return script;
}

async function executeClassificationScript({
  script,
  jobs,
  runConclusion,
  artifactFiles,
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ocr-notifier-classification-'));
  const artifactPath = path.join(root, 'ocr-review-output');
  const outputs = {};
  const warnings = [];
  let failure = null;

  try {
    if (artifactFiles) {
      mkdirSync(artifactPath);
      for (const [fileName, contents] of Object.entries(artifactFiles)) {
        writeFileSync(path.join(artifactPath, fileName), contents);
      }
    }

    const sandbox = {
      github: {
        rest: {
          actions: {
            listJobsForWorkflowRun: async () => ({ data: { jobs } }),
          },
        },
      },
      context: {
        repo: { owner: 'test-owner', repo: 'test-repo' },
      },
      core: {
        setOutput: (name, value) => {
          outputs[name] = String(value);
        },
        setFailed: (message) => {
          failure = String(message);
        },
        warning: (message) => {
          warnings.push(String(message));
        },
        info: () => {},
      },
      process: {
        env: {
          ARTIFACT_PATH: artifactPath,
          RUN_CONCLUSION: runConclusion,
          RUN_ID: '12345',
        },
      },
      require,
      console,
      Array,
      Boolean,
      Error,
      JSON,
      Map,
      Number,
      Object,
      Set,
      String,
    };

    await vm.runInNewContext(`(async () => { ${script} })()`, sandbox);
    return { outputs, warnings, failure };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function markerJob(stepName) {
  return [
    {
      name: 'Record OCR outcome',
      conclusion: 'success',
      steps: [{ name: stepName, conclusion: 'success' }],
    },
  ];
}

function evaluateNotifyCondition(condition, classification) {
  const wrappedExpression = String(condition).trim();
  const expression = wrappedExpression
    .slice(3, wrappedExpression.length - 2)
    .trim()
    .replaceAll('needs.classify-ocr-run', "needs['classify-ocr-run']")
    .replaceAll('.outputs.classification', ".outputs['classification']");
  return Boolean(
    vm.runInNewContext(expression, {
      needs: {
        'classify-ocr-run': {
          result: 'success',
          outputs: { classification },
        },
      },
    }),
  );
}

describe('OCR workflow_run notification classification', () => {
  let ocrWorkflow;
  let notifierWorkflow;
  let classifyJob;
  let notifyJob;
  let classificationScript;

  beforeAll(() => {
    ocrWorkflow = loadWorkflow(OCR_WORKFLOW_PATH).parsed;
    notifierWorkflow = loadWorkflow(NOTIFIER_WORKFLOW_PATH).parsed;
    classifyJob = notifierWorkflow.jobs?.['classify-ocr-run'];
    notifyJob = notifierWorkflow.jobs?.['notify-ocr-infrastructure-failure'];
    if (!classifyJob || !notifyJob) {
      throw new Error(
        'OCR notifier should contain separate classify-ocr-run and notify-ocr-infrastructure-failure jobs',
      );
    }
    classificationScript = loadClassificationScript(classifyJob);
  });

  const truthTable = [
    {
      name: 'policy failure',
      marker: 'Record OCR outcome: policy-failure',
      conclusion: 'failure',
      classification: 'policy-failure',
      notify: false,
    },
    {
      name: 'non-blocking infrastructure failure',
      marker: 'Record OCR outcome: infrastructure-failure',
      conclusion: 'success',
      classification: 'infrastructure-failure',
      notify: true,
    },
    {
      name: 'ordinary success',
      marker: 'Record OCR outcome: success',
      conclusion: 'success',
      classification: 'success',
      notify: false,
    },
    {
      name: 'unexpected job failure',
      marker: 'Record OCR outcome: unexpected-failure',
      conclusion: 'failure',
      classification: 'unexpected-failure',
      notify: true,
    },
    {
      name: 'conflict-skipped review',
      marker: 'Record OCR outcome: review-skipped',
      conclusion: 'success',
      classification: 'review-skipped',
      notify: false,
    },
  ];

  for (const scenario of truthTable) {
    it(`classifies ${scenario.name} without an artifact and gates privileged notification`, async () => {
      const result = await executeClassificationScript({
        script: classificationScript,
        jobs: markerJob(scenario.marker),
        runConclusion: scenario.conclusion,
      });

      expect(result.failure).toBeNull();
      expect(result.outputs.classification).toBe(scenario.classification);
      expect(
        evaluateNotifyCondition(notifyJob.if, result.outputs.classification),
      ).toBe(scenario.notify);
    });
  }

  const artifactFallbackTable = [
    {
      name: 'policy failure',
      conclusion: 'failure',
      files: { 'ocr-policy-failure.txt': 'scope policy failed\n' },
      classification: 'policy-failure',
    },
    {
      name: 'non-blocking infrastructure failure',
      conclusion: 'success',
      files: {
        'ocr-infrastructure-failure.txt': 'phase=review; reason=timeout\n',
      },
      classification: 'infrastructure-failure',
    },
    {
      name: 'ordinary success',
      conclusion: 'success',
      files: {
        'ocr-exit-code.txt': '0\n',
        'ocr-result.json': '{"comments":[]}\n',
      },
      classification: 'success',
    },
    {
      name: 'unexpected job failure',
      conclusion: 'failure',
      files: {},
      classification: 'unexpected-failure',
    },
  ];

  for (const scenario of artifactFallbackTable) {
    it(`uses artifact fallback to classify ${scenario.name}`, async () => {
      const result = await executeClassificationScript({
        script: classificationScript,
        jobs: [],
        runConclusion: scenario.conclusion,
        artifactFiles: scenario.files,
      });

      expect(result.failure).toBeNull();
      expect(result.outputs.classification).toBe(scenario.classification);
    });
  }

  it('records durable trusted OCR outcomes in unprivileged source-workflow jobs', () => {
    const outcomeJob = ocrWorkflow.jobs?.['record-ocr-outcome'];
    const skippedJob = ocrWorkflow.jobs?.['record-skipped-ocr-outcome'];

    expect(outcomeJob?.permissions).toEqual({});
    expect(skippedJob?.permissions).toEqual({});
    expect(outcomeJob?.needs).toEqual(['mergeability-gate', 'code-review']);
    expect(skippedJob?.needs).toEqual(['mergeability-gate']);
    for (const scenario of truthTable.slice(0, 4)) {
      expect(stepNamed(outcomeJob, scenario.marker)).toBeTruthy();
    }
    expect(
      stepNamed(skippedJob, 'Record OCR outcome: review-skipped'),
    ).toBeTruthy();
    expect(normalize(skippedJob.if)).toContain(
      normalize("needs.mergeability-gate.outputs.should-run != 'true'"),
    );
    expect(JSON.stringify({ outcomeJob, skippedJob })).not.toContain(
      'secrets.',
    );
  });

  it('classifies job metadata and artifacts before entering the issues-write job', () => {
    expect(notifierWorkflow.permissions).toEqual({});
    expect(classifyJob.permissions).toEqual({ actions: 'read' });
    expect(classifyJob.permissions?.issues).toBeUndefined();
    expect(notifyJob.permissions).toEqual({ issues: 'write' });
    expect(notifyJob.needs).toBe('classify-ocr-run');
    expect(normalize(notifyJob.if)).toBe(
      normalize(
        "${{ needs.classify-ocr-run.result == 'success' && (needs.classify-ocr-run.outputs.classification == 'infrastructure-failure' || needs.classify-ocr-run.outputs.classification == 'unexpected-failure') }}",
      ),
    );

    const downloadStep = stepNamed(classifyJob, 'Download OCR artifacts');
    expect(downloadStep['continue-on-error']).toBe(true);
    expect(downloadStep.with['run-id']).toBe(
      '${{ github.event.workflow_run.id }}',
    );
    expect(
      notifyJob.steps.some((step) => step.name === 'Download OCR artifacts'),
    ).toBe(false);

    const notifyStep = stepNamed(
      notifyJob,
      'Notify OCR infrastructure failure issue',
    );
    expect(notifyStep.if).toBeUndefined();
    expect(JSON.stringify(notifyJob)).not.toContain('always()');
    expect(JSON.stringify(notifyJob)).not.toContain('secrets.');
    expect(JSON.stringify(notifyJob)).not.toContain('OCR_LLM_TOKEN');
    expect(JSON.stringify(notifyJob)).not.toContain('OCR_LLM_URL');
  });

  it('fails closed instead of notifying when durable job metadata is contradictory', async () => {
    const result = await executeClassificationScript({
      script: classificationScript,
      jobs: [
        ...markerJob('Record OCR outcome: policy-failure'),
        ...markerJob('Record OCR outcome: infrastructure-failure'),
      ],
      runConclusion: 'failure',
    });

    expect(result.failure).toContain('multiple durable OCR outcomes');
    expect(result.outputs.classification).toBeUndefined();
  });
});
