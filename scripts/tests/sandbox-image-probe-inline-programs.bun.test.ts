/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RUNTIME_PROBE } from '../sandbox-image-probe';

const nodeEvalPrefix = 'node --input-type=module -e ';

describe('sandbox image probe inline programs', () => {
  it('emits syntactically valid JavaScript for each shell-quoted Node eval', () => {
    const evalPrograms: string[] = [];
    let evalStart = RUNTIME_PROBE.indexOf(nodeEvalPrefix);
    while (evalStart !== -1) {
      const programStart = evalStart + nodeEvalPrefix.length;
      const programEnd = RUNTIME_PROBE.indexOf("'", programStart + 1);
      expect(RUNTIME_PROBE[programStart]).toBe("'");
      expect(programEnd).toBeGreaterThan(programStart);
      evalPrograms.push(RUNTIME_PROBE.slice(programStart, programEnd + 1));
      evalStart = RUNTIME_PROBE.indexOf(nodeEvalPrefix, programEnd + 1);
    }
    expect(evalPrograms.length).toBeGreaterThan(0);

    for (const quotedProgram of evalPrograms) {
      const shellResult = spawnSync(
        '/bin/sh',
        ['-c', `printf '%s' ${quotedProgram}`],
        { encoding: 'utf8' },
      );
      expect(shellResult.status, shellResult.stderr).toBe(0);

      const directory = mkdtempSync(join(tmpdir(), 'llxprt-probe-syntax-'));
      try {
        const programPath = join(directory, 'probe.mjs');
        writeFileSync(programPath, shellResult.stdout);
        const syntaxCheck = spawnSync('node', ['--check', programPath], {
          encoding: 'utf8',
        });
        expect(syntaxCheck.status, syntaxCheck.stderr).toBe(0);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });
});
