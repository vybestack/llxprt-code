/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, test } from 'bun:test';
import ts from 'typescript';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { productionPolicy } from '../check-runtime-state-boundary.js';
import { compilerConfiguration } from '../runtime-source-discovery.js';
import { scanRuntimeServiceProgram } from './runtime-service-shape-guard.js';

for (const augmentation of [
  undefined,
  '',
  'declare global { interface HTMLTextAreaElement { acquireServices(): { clock: Clock; session: Session }; } }',
  'declare module "buffer" { namespace Blob { function acquireServices(): { clock: Clock; session: Session }; } }',
  'declare module "buffer" { namespace Blob { const callback: () => { clock: Clock; session: Session }; } }',
  'declare module "buffer" { interface Blob { acquireServices(): { clock: Clock; session: Session }; } }',
]) {
  test(`actual Clipboard DOM closure ${augmentation ?? 'untouched data'}`, () => {
    const config = compilerConfiguration(
      process.cwd(),
      'packages/providers/tsconfig.noemit.json',
    );
    const file = resolve(
      'packages/providers/src/value-selector-virtual-fixture.ts',
    );
    const source = `import 'buffer'; import type { ProviderManager as Clock } from './ProviderManager.js'; import type { OAuthManager as Session } from './auth/oauth-manager.js'; export type { Clock, Session };\n${augmentation === undefined ? '' : "declare global { interface HTMLTextAreaElement { readonly resourceConstructor: typeof import('buffer').Blob } }"}\n${augmentation ?? ''}`;
    const base = ts.createCompilerHost(config.options, true);
    const program = ts.createProgram({
      rootNames: [
        ...config.fileNames.filter(
          (f) => !/\.(test|spec)\./.test(f) && !f.includes('/__tests__/'),
        ),
        file,
      ],
      options: config.options,
      projectReferences: config.projectReferences,
      host: {
        ...base,
        getSourceFile: (name, version) =>
          name === file
            ? ts.createSourceFile(file, source, version, true)
            : base.getSourceFile(name, version),
      },
    });
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')),
    ).toEqual([]);
    const policyServices = productionPolicy.services.flatMap((root) => {
      const pkg = root.file.split('/').slice(0, 2).join('/');
      const build = `${pkg}/tsconfig.build.json`;
      const owner = compilerConfiguration(
        process.cwd(),
        existsSync(build) ? build : `${pkg}/tsconfig.json`,
      );
      const candidates = [
        resolve(root.file),
        ...(owner.fileNames.includes(resolve(root.file))
          ? ts
              .getOutputFileNames(
                owner,
                resolve(root.file),
                !ts.sys.useCaseSensitiveFileNames,
              )
              .filter((name) => /\.d\.(?:ts|mts|cts)$/.test(name))
          : []),
      ];
      return candidates
        .filter((name) => program.getSourceFile(name))
        .map((file) => ({ file, exportName: root.exportName }));
    });
    expect(policyServices.length).toBeGreaterThanOrEqual(10);
    const findings = scanRuntimeServiceProgram(
      program,
      {
        services: policyServices,
        configs: [],
      },
      [resolve('packages/providers/src/auth/ClipboardService.ts')],
    );
    if (!augmentation) expect(findings).toEqual([]);
    else
      expect(
        findings
          .filter((f) => f.rule === 'runtime-service-bundle')
          .map((f) => [f.line, f.column]),
      ).toEqual([
        [20, 13],
        [20, 24],
        [25, 7],
        [25, 33],
        [35, 7],
        [35, 33],
      ]);
  }, 120000);
}
