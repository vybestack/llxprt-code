import ts from 'typescript';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { loadData, selectAffectedShards } from '../../affected-test-shards.ts';
import type { GraphData } from '../../check-affected-test-shards.ts';

export function createProviderGraphFixture(repoRoot: string): {
  readonly root: string;
  readonly data: GraphData;
  readonly dataPath: string;
  readonly check: (data: GraphData) => ReturnType<typeof spawnSync>;
  readonly injectProductionImport: () => void;
  readonly dispose: () => void;
} {
  const root = mkdtempSync(join(repoRoot, 'tmp/provider-graph-'));
  const source = loadData(
    join(repoRoot, 'scripts/affected-test-shards.data.json'),
  );
  const data: GraphData = {
    ...source,
    importEdges: {
      providers: source.importEdges.providers.filter(
        (edge) => edge !== 'telemetry',
      ),
    },
    testOnlyEdges: {
      providers: [...source.testOnlyEdges.providers, 'telemetry'],
    },
    observers: {},
    pathObservers: [],
  };
  const files = execFileSync(
    'git',
    ['ls-files', 'packages/providers/**/*.ts', 'packages/providers/**/*.tsx'],
    { cwd: repoRoot, encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(repoRoot, file), join(root, file));
    if (!/\.(?:test|spec)\./.test(file) && !file.includes('/__tests__/')) {
      const sourceText = readFileSync(join(root, file), 'utf8');
      const parsed = ts.createSourceFile(
        file,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
      );
      const ranges = parsed.statements
        .filter(
          (statement) =>
            ts.isImportDeclaration(statement) &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            statement.moduleSpecifier.text.startsWith(
              '@vybestack/llxprt-code-telemetry',
            ),
        )
        .map((statement) => ({
          start: statement.getStart(parsed),
          end: statement.end,
        }));
      let normalized = sourceText;
      for (const range of ranges.reverse())
        normalized =
          normalized.slice(0, range.start) + normalized.slice(range.end);
      writeFileSync(join(root, file), normalized);
    }
  }
  for (const file of data.sharedInputs) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', 'packages'], { cwd: root });
  const dataPath = join(root, 'graph.json');
  return {
    root,
    data,
    dataPath,
    check: (candidate) => {
      writeFileSync(dataPath, JSON.stringify(candidate));
      return spawnSync(
        process.execPath,
        [
          join(repoRoot, 'scripts/check-affected-test-shards.ts'),
          '--root',
          root,
          '--data',
          dataPath,
        ],
        { encoding: 'utf8', timeout: 30_000 },
      );
    },
    injectProductionImport: () => {
      const file = 'packages/providers/src/production-control.ts';
      writeFileSync(
        join(root, file),
        "import '@vybestack/llxprt-code-telemetry';\n",
      );
      execFileSync('git', ['add', file], { cwd: root });
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function observeProviderGraphControls(repoRoot: string): {
  readonly checks: ReadonlyArray<ReturnType<typeof spawnSync>>;
  readonly selections: ReadonlyArray<readonly string[]>;
} {
  const fixture = createProviderGraphFixture(repoRoot);
  const production: GraphData = {
    ...fixture.data,
    importEdges: {
      providers: [...fixture.data.importEdges.providers, 'telemetry'],
    },
    testOnlyEdges: {
      providers: fixture.data.testOnlyEdges.providers.filter(
        (edge) => edge !== 'telemetry',
      ),
    },
  };
  const select = (path: string): readonly string[] =>
    selectAffectedShards({
      event: 'pull_request',
      changedPaths: [path],
      dataPath: fixture.dataPath,
    }).selectedShards;
  try {
    const correctTest = fixture.check(fixture.data);
    const testSelections = [
      select('packages/telemetry/src/index.ts'),
      select('packages/telemetry/src/index.test.ts'),
      select('packages/settings/src/index.ts'),
    ];
    const wrongProduction = fixture.check(production);
    fixture.injectProductionImport();
    const wrongTest = fixture.check(fixture.data);
    const correctProduction = fixture.check(production);
    const productionSelections = [
      select('packages/telemetry/src/index.ts'),
      select('packages/telemetry/src/index.test.ts'),
      select('packages/settings/src/index.ts'),
    ];
    return {
      checks: [correctTest, wrongProduction, wrongTest, correctProduction],
      selections: [...testSelections, ...productionSelections],
    };
  } finally {
    fixture.dispose();
  }
}
