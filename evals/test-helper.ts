/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { it } from 'vitest';
import fs from 'node:fs';
import { z } from 'zod';
import {
  TestRig,
  type TestRigSetupOptions,
  type RunCapture,
} from '@vybestack/llxprt-code-test-utils';

export * from '@vybestack/llxprt-code-test-utils';

export type EvalPolicy = 'ALWAYS_PASSES' | 'USUALLY_PASSES';

const EvalOutputSchema = z.object({ response: z.string() });

export function buildEvalArgs(prompt: string): string[] {
  return [`--prompt=${prompt}`, '--output-format', 'json'];
}

export function extractModelResponse(output: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('Expected valid JSON output from LLxprt CLI');
  }

  const result = EvalOutputSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.join('.');
        return `${path === '' ? '<root>' : path}: ${issue.message}`;
      })
      .join('; ');
    throw new Error(
      `Expected LLxprt CLI JSON output to include a string response: ${details}`,
    );
  }
  return result.data.response;
}

/**
 * Serialized shape of the eval artifact written to evals/logs. Contains the
 * structured process-run capture (separate stdout/stderr/exitCode/timedOut)
 * alongside the extracted tool-call records for post-run diagnosis.
 */
export interface EvalArtifact {
  readonly schemaVersion: 1;
  readonly capture: RunCapture | null;
  readonly toolCalls: ReturnType<TestRig['readToolLogs']> | EvalArtifactError;
}

interface EvalArtifactError {
  readonly error: string;
}

export function formatEvalLog(
  capture: RunCapture | null,
  toolCalls: ReturnType<TestRig['readToolLogs']> | EvalArtifactError,
): string {
  const artifact: EvalArtifact = { schemaVersion: 1, capture, toolCalls };
  return JSON.stringify(artifact, null, 2);
}

export function evalTest(policy: EvalPolicy, evalCase: EvalCase): void {
  const fn = async (): Promise<void> => {
    const rig = new TestRig();
    let primaryError: unknown;
    let failed = false;
    try {
      rig.setup(evalCase.name, evalCase.params);
      const cliOutput = await rig.run({ args: buildEvalArgs(evalCase.prompt) });
      await evalCase.assert(rig, extractModelResponse(cliOutput));
    } catch (error) {
      failed = true;
      primaryError = error;
    }

    let finalizationError: unknown;
    try {
      await finalizeEval(rig, evalCase.name);
    } catch (error) {
      finalizationError = error;
    }

    if (failed) {
      if (finalizationError !== undefined) {
        throw new AggregateError(
          [primaryError, finalizationError],
          'Eval failed and diagnostics finalization also failed',
          { cause: primaryError },
        );
      }
      throw primaryError;
    }
    if (finalizationError !== undefined) {
      throw finalizationError;
    }
  };

  const runEvals = process.env.RUN_EVALS;
  if (
    policy === 'USUALLY_PASSES' &&
    (runEvals === undefined || runEvals === '')
  ) {
    it.skip(evalCase.name, fn);
  } else {
    it(evalCase.name, fn);
  }
}

export interface EvalCase {
  name: string;
  params?: TestRigSetupOptions;
  prompt: string;
  assert: (rig: TestRig, result: string) => Promise<void>;
}

async function finalizeEval(rig: TestRig, name: string): Promise<void> {
  const capture = rig.getLastRunCapture();
  let toolCalls: ReturnType<TestRig['readToolLogs']> | EvalArtifactError;
  try {
    toolCalls = rig.readToolLogs();
  } catch (error) {
    toolCalls = {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let artifactError: unknown;
  try {
    await logToFile(name, formatEvalLog(capture, toolCalls));
  } catch (error) {
    artifactError = error;
  }

  let cleanupError: unknown;
  try {
    await rig.cleanup();
  } catch (error) {
    cleanupError = error;
  }

  if (artifactError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [artifactError, cleanupError],
      'Writing eval diagnostics and cleaning up both failed',
      { cause: artifactError },
    );
  }
  if (artifactError !== undefined) {
    throw artifactError;
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
}

// Canonical deterministic contract for the save_memory eval: the prompt
// instructs the model to answer exactly this value.
const CANONICAL_ANSWER = '$blue$';

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Predicate for `expectToolCallSuccess`. Accepts a save_memory tool-call's
 * serialized args only when the persisted `fact` equals the canonical fact
 * after whitespace/case normalization. Deterministic exact-value comparison:
 * paraphrases, negations, wrong tokens, and bare mentions are all rejected.
 *
 * `token` is accepted to match the tool-call predicate signature and pins the
 * expected token; the canonical favorite-color relation is fixed.
 */
export function saveMemoryFactEquals(token: string): (args: string) => boolean {
  const expected = normalize(`my favorite color is ${token}`);
  return (args: string): boolean => {
    const parsed: unknown = safeJsonParse(args);
    if (!isStringRecord(parsed)) {
      return false;
    }
    const fact = parsed['fact'];
    if (typeof fact !== 'string') {
      return false;
    }
    return normalize(fact) === expected;
  };
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Assert that model output equals the canonical dollar-wrapped answer
 * (`$blue$`) after trimming outer whitespace and case-folding. Surrounding
 * prose is rejected. Deterministic exact-value comparison.
 */
export function assertFavoriteColorBlueOutput(output: string): void {
  if (typeof output !== 'string' || output.trim().length === 0) {
    throw new Error('Expected LLM to return some output');
  }
  if (normalize(output) !== normalize(CANONICAL_ANSWER)) {
    throw new Error(
      `Expected the exact answer "${CANONICAL_ANSWER}" (case-insensitive, outer whitespace ignored). ` +
        `Received output length: ${output.length}.`,
    );
  }
}

async function logToFile(name: string, content: string): Promise<void> {
  const logDir = 'evals/logs';
  await fs.promises.mkdir(logDir, { recursive: true });
  const sanitizedName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const logFile = `${logDir}/${sanitizedName}.log`;
  await fs.promises.writeFile(logFile, content);
}
