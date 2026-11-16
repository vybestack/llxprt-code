/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageDirectory = dirname(
  fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
);
const invalidTypeFixturePath = fileURLToPath(
  new URL('../type-fixtures/invalid-contract.ts', import.meta.url),
);
const validContentUnionFixturePath = fileURLToPath(
  new URL('../type-fixtures/valid-content-unions.ts', import.meta.url),
);

describe('agent-core public type contracts', () => {
  it(
    'compiles positive image and audio union extraction fixtures',
    { timeout: 30_000 },
    () => {
      const configPath = fileURLToPath(
        new URL('../tsconfig.json', import.meta.url),
      );
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        packageDirectory,
      );
      const program = ts.createProgram({
        rootNames: [validContentUnionFixturePath],
        options: { ...parsed.options, noEmit: true },
      });
      const diagnostics = ts
        .getPreEmitDiagnostics(program)
        .filter(
          (diagnostic) =>
            diagnostic.file?.fileName === validContentUnionFixturePath,
        );
      expect(diagnostics).toStrictEqual([]);
    },
  );

  it(
    'rejects the negative public-contract compilation fixture',
    { timeout: 30_000 },
    () => {
      const configPath = fileURLToPath(
        new URL('../tsconfig.json', import.meta.url),
      );
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        packageDirectory,
      );
      const program = ts.createProgram({
        rootNames: [invalidTypeFixturePath],
        options: { ...parsed.options, noEmit: true },
        projectReferences: parsed.projectReferences,
      });
      const fixtureSource = ts.sys.readFile(invalidTypeFixturePath);
      if (!fixtureSource) throw new Error('Negative type fixture is missing.');
      const lineForMarker = (marker: string): number => {
        const line = fixtureSource
          .split('\n')
          .findIndex((entry) => entry.includes(marker));
        if (line < 0) throw new Error(`Missing diagnostic marker: ${marker}`);
        return line + 1;
      };
      const fixtureDiagnostics = ts
        .getPreEmitDiagnostics(program)
        .filter(
          (diagnostic) => diagnostic.file?.fileName === invalidTypeFixturePath,
        );
      const diagnostics = fixtureDiagnostics.map((diagnostic) => {
        const file = diagnostic.file;
        if (!file) throw new Error('Fixture diagnostic is missing its file.');
        return {
          code: diagnostic.code,
          line:
            file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
        };
      });

      expect(diagnostics).toContainEqual({
        code: 2353,
        line: lineForMarker('@expect-agent-property'),
      });
      expect(diagnostics).toContainEqual({
        code: 2322,
        line: lineForMarker('@expect-replay-data'),
      });
      expect(diagnostics).toContainEqual({
        code: 2353,
        line: lineForMarker('@expect-callback-property'),
      });
      expect(diagnostics).toContainEqual({
        code: 2322,
        line: lineForMarker('@expect-recovery-data'),
      });
      expect(diagnostics).toContainEqual({
        code: 2353,
        line: lineForMarker('@expect-policy-closed'),
      });
      expect(diagnostics).toContainEqual({
        code: 2322,
        line: lineForMarker('@expect-tool-choice'),
      });
      expect(diagnostics).toContainEqual({
        code: 2741,
        line: lineForMarker('@expect-policy-identity'),
      });
      expect(diagnostics).toContainEqual({
        code: 2353,
        line: lineForMarker('@expect-shell-shape'),
      });
      expect(diagnostics).toContainEqual({
        code: 2322,
        line: lineForMarker('@expect-import-notice'),
      });
      expect(diagnostics).toContainEqual({
        code: 2741,
        line: lineForMarker('@expect-regex-evidence'),
      });
      const regexEvidenceDiagnostic = fixtureDiagnostics.find(
        (diagnostic) =>
          diagnostic.code === 2741 &&
          diagnostic.file !== undefined &&
          diagnostic.start !== undefined &&
          diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line +
            1 ===
            lineForMarker('@expect-regex-evidence'),
      );
      expect(
        regexEvidenceDiagnostic &&
          ts.flattenDiagnosticMessageText(
            regexEvidenceDiagnostic.messageText,
            '\\n',
          ),
      ).toContain("Property 'input'");
      expect(diagnostics).toContainEqual({
        code: 2741,
        line: lineForMarker('@expect-request-boundary'),
      });
      expect(diagnostics).toContainEqual({
        code: 2322,
        line: lineForMarker('@expect-hook-fields'),
      });
      expect(diagnostics).toContainEqual({
        code: 2322,
        line: lineForMarker('@expect-approval-mode'),
      });
      expect(diagnostics).toContainEqual({
        code: 2322,
        line: lineForMarker('@expect-attempt-source'),
      });
      expect(diagnostics).toContainEqual({
        code: 2322,
        line: lineForMarker('@expect-policy-priority'),
      });
      expect(diagnostics).toContainEqual({
        code: 2322,
        line: lineForMarker('@expect-restriction-allow'),
      });
      expect(diagnostics).toContainEqual({
        code: 2322,
        line: lineForMarker('@expect-hook-audit'),
      });
      expect(diagnostics).toContainEqual({
        code: 2353,
        line: lineForMarker('@expect-source-stack-command'),
      });
      expect(diagnostics).toContainEqual({
        code: 2741,
        line: lineForMarker('@expect-replay-invalidation') - 1,
      });
      const replayInvalidationDiagnostic = fixtureDiagnostics.find(
        (diagnostic) =>
          diagnostic.code === 2741 &&
          diagnostic.file !== undefined &&
          diagnostic.start !== undefined &&
          diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line +
            1 ===
            lineForMarker('@expect-replay-invalidation') - 1,
      );
      expect(
        replayInvalidationDiagnostic &&
          ts.flattenDiagnosticMessageText(
            replayInvalidationDiagnostic.messageText,
            ' ',
          ),
      ).toContain("Property 'invalidatedReplay'");
      expect(diagnostics).toContainEqual({
        code: 2739,
        line: lineForMarker('@expect-hook-change-outcome') + 1,
      });
      const hookChangeDiagnostic = fixtureDiagnostics.find(
        (diagnostic) =>
          diagnostic.code === 2739 &&
          diagnostic.file !== undefined &&
          diagnostic.start !== undefined &&
          diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line +
            1 ===
            lineForMarker('@expect-hook-change-outcome') + 1,
      );
      const hookChangeMessage =
        hookChangeDiagnostic &&
        ts.flattenDiagnosticMessageText(
          hookChangeDiagnostic.messageText,
          '\\n',
        );
      expect(hookChangeMessage).toContain('disposition');
      expect(hookChangeMessage).toContain('changed');
      expect(hookChangeMessage).toContain('aggregate');
    },
  );
});
