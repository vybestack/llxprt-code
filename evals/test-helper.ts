/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { it } from 'vitest';
import fs from 'node:fs';
import {
  TestRig,
  type TestRigSetupOptions,
} from '@vybestack/llxprt-code-test-utils';

export * from '@vybestack/llxprt-code-test-utils';

export type EvalPolicy = 'ALWAYS_PASSES' | 'USUALLY_PASSES';

export function evalTest(policy: EvalPolicy, evalCase: EvalCase): void {
  const fn = async (): Promise<void> => {
    const rig = new TestRig();
    try {
      rig.setup(evalCase.name, evalCase.params);
      const result = await rig.run({ args: evalCase.prompt });
      await evalCase.assert(rig, result);
    } finally {
      await logToFile(
        evalCase.name,
        JSON.stringify(rig.readToolLogs(), null, 2),
      );
      await rig.cleanup();
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
