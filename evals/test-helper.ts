/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { it } from 'vitest';
import fs from 'node:fs';
import { TestRig } from '@vybestack/llxprt-code-test-utils';

export * from '@vybestack/llxprt-code-test-utils';

export type EvalPolicy = 'ALWAYS_PASSES' | 'USUALLY_PASSES';

export function evalTest(policy: EvalPolicy, evalCase: EvalCase) {
  const fn = async () => {
    const rig = new TestRig();
    try {
      await rig.setup(evalCase.name, evalCase.params);
      const result = await rig.run({ args: evalCase.prompt });
      await evalCase.assert(rig, result);

      // Log before cleanup if requested
      if (evalCase.log) {
        await logToFile(
          evalCase.name,
          JSON.stringify(rig.readToolLogs(), null, 2),
        );
      }
    } finally {
      await rig.cleanup();
    }
  };

  if (policy === 'USUALLY_PASSES' && !process.env.RUN_EVALS) {
    it.skip(evalCase.name, fn);
  } else {
    it(evalCase.name, fn);
  }
}

export interface EvalCase {
  name: string;
  params?: Record<string, any>;
  prompt: string;
  assert: (rig: TestRig, result: string) => Promise<void>;
  log?: boolean;
}

async function logToFile(name: string, content: string) {
  const logDir = 'evals/logs';
  await fs.promises.mkdir(logDir, { recursive: true });
  const sanitizedName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const logFile = `${logDir}/${sanitizedName}.log`;
  await fs.promises.writeFile(logFile, content);
}
