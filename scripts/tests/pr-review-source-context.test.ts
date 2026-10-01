/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, it } from 'bun:test';
import { collectSourceContext } from '../pr-review-source-context.ts';

it('retains the enclosing configuration key when the changed hunk omits it', () => {
  const source =
    '{\n "exclude": [\n' +
    Array.from({ length: 35 }, (_, i) => ` "case${i}.ts",`).join('\n') +
    '\n ]\n}';
  const result = collectSourceContext(
    [
      {
        filePath: 'tsconfig.json',
        content: '@@ -32 +32 @@\n- "case29.ts",\n+ "replacement.ts",',
      },
    ],
    'a'.repeat(40),
    'b'.repeat(40),
    () => source,
  );
  expect(result['tsconfig.json'][0].content).toContain('"exclude"');
  expect(result['tsconfig.json'][0].content).toContain('case29.ts');
});
it('shows a surviving implementation when only its local re-export barrel was deleted', () => {
  const result = collectSourceContext(
    [
      {
        filePath: 'src/index.ts',
        content:
          '+++ /dev/null\n@@ -1 +0,0 @@\n-export { Executor } from "./Executor.js";',
      },
    ],
    'a'.repeat(40),
    'b'.repeat(40),
    (revision, file) =>
      file === 'src/Executor.ts' && revision === 'b'.repeat(40)
        ? 'export class Executor { run(): void {} }'
        : null,
  );
  expect(
    result['src/index.ts'].some(
      (item) =>
        item.path === 'src/Executor.ts' &&
        item.content.includes('export class Executor'),
    ),
  ).toBe(true);
});
