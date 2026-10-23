/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { physicalHookCommand } from './physicalHookCommand.js';

function scriptPath(output: string): string {
  return `${output}.hook.ts`;
}

/**
 * Hook command that appends each hook input to `output` as one UTF-8 JSON
 * line. A real Bun script does the reading and writing so the bytes on disk do
 * not depend on the selected shell's redirection and encoding rules (Windows
 * PowerShell does not write UTF-8 for `>>`).
 */
export function jsonlHookCommand(output: string): string {
  const script = scriptPath(output);
  writeFileSync(
    script,
    `import { appendFileSync } from 'node:fs';
const input: unknown = JSON.parse(await Bun.stdin.text());
appendFileSync(${JSON.stringify(output)}, JSON.stringify(input) + '\\n', 'utf8');
`,
    'utf8',
  );
  return physicalHookCommand(script);
}

export async function removeJsonlHook(output: string): Promise<void> {
  await rm(output, { force: true });
  await rm(scriptPath(output), { force: true });
}
