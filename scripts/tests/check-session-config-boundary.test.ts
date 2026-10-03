/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { scanSessionConfigBoundary } from '../check-session-config-boundary.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(configBody: string, consumerBody: string, extra = ''): string {
  const root = mkdtempSync(
    join(import.meta.dir, '../../tmp/session-boundary-'),
  );
  roots.push(root);
  const core = join(root, 'packages/core/src/config');
  const agent = join(root, 'packages/agents/src/api');
  mkdirSync(core, { recursive: true });
  mkdirSync(agent, { recursive: true });
  writeFileSync(
    join(root, 'packages/core/tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        baseUrl: '.',
        paths: { '@fixture/core/*': ['./src/config/*'] },
      },
      include: ['src/**/*.ts'],
    }),
  );
  writeFileSync(
    join(root, 'packages/agents/tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        baseUrl: '.',
        paths: { '@fixture/core/*': ['../core/src/config/*'] },
      },
      include: ['src/**/*.ts'],
    }),
  );
  writeFileSync(join(core, 'config.ts'), configBody);
  writeFileSync(join(agent, 'consumer.ts'), consumerBody);
  writeFileSync(
    join(agent, 'consumer.test.ts'),
    'class Config { getAsyncTaskManager() {} } new Config().getAsyncTaskManager();',
  );
  writeFileSync(join(agent, 'fixture.ts'), extra);
  return root;
}

const base = `export class ConfigBaseCore {}
export class Config extends ConfigBaseCore {
  getModel(): string { return 'model'; }
}`;

function rows(root: string): string[] {
  return scanSessionConfigBoundary(root).map(
    (finding) =>
      `${relative(root, finding.file)}:${finding.line}:${finding.member}:${finding.role}`,
  );
}

describe('session Config boundary', () => {
  it('is registered in normal lint, including the scoped runner path', () => {
    const root = join(import.meta.dir, '../..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const runner = readFileSync(join(root, 'scripts/run-lint.ts'), 'utf8');
    expect(pkg.scripts['lint:session-config-boundary']).toBe(
      'bun scripts/check-session-config-boundary.ts',
    );
    expect(runner).toContain("'lint:session-config-boundary'");
  });

  it('exits nonzero with file, line, member and role on a forbidden getter', () => {
    const root = fixture(
      `${base.slice(0, -1)} getAsyncTaskManager() { return {}; } }`,
      '',
    );
    const result = spawnSync(
      process.execPath,
      [
        join(import.meta.dir, '../check-session-config-boundary.ts'),
        '--root',
        root,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('packages/core/src/config/config.ts:');
    expect(result.stderr).toContain('getAsyncTaskManager (ownership)');
  });

  it('rejects a live getter declared on Config and aliased, indexed and deps.config calls', () => {
    const root = fixture(
      `${base.slice(0, -1)}
 getAsyncTaskManager(): object { return {}; }
}`,
      `import { Config as SessionConfig } from '@fixture/core/config.js';
export function use(deps: { config: SessionConfig }) {
  const alias = deps.config;
  alias.getAsyncTaskManager();
  deps.config['getAsyncTaskManager']();
  const { getAsyncTaskManager } = deps.config;
  getAsyncTaskManager();
  type Projected = SessionConfig['getAsyncTaskManager'];
  const projected: Projected = alias.getAsyncTaskManager;
  return projected;
}`,
    );
    const findings = rows(root);
    expect(
      findings.some(
        (row) =>
          row.includes('config.ts:') &&
          row.includes(':getAsyncTaskManager:ownership'),
      ),
    ).toBe(true);
    expect(
      findings.filter((row) => row.includes(':getAsyncTaskManager:consumer'))
        .length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('rejects service construction inside core config and injected service parameters', () => {
    const root = fixture(
      `import { AsyncTaskManager } from './service.js';
export class ConfigBaseCore {
  constructor(private readonly tasks: AsyncTaskManager) {}
  getTaskManager(): AsyncTaskManager { return new AsyncTaskManager(); }
}`,
      '',
      '',
    );
    writeFileSync(
      join(root, 'packages/core/src/config/service.ts'),
      'export class AsyncTaskManager {}',
    );
    const findings = rows(root);
    expect(
      findings.some((row) => row.includes(':AsyncTaskManager:construction')),
    ).toBe(true);
    expect(findings.some((row) => row.includes(':tasks:injection'))).toBe(true);
  });

  it('scans production TSX even when a package tsconfig excludes it', () => {
    const root = fixture(
      `${base.slice(0, -1)} getAsyncTaskManager() { return {}; } }`,
      '',
    );
    writeFileSync(
      join(root, 'packages/agents/tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          baseUrl: '.',
          paths: { '@fixture/core/*': ['../core/src/config/*'] },
        },
        files: ['src/api/fixture.ts'],
      }),
    );
    writeFileSync(
      join(root, 'packages/agents/src/api/consumer.tsx'),
      `import { Config } from '@fixture/core/config.js';
export const consume = (config: Config) => config['getAsyncTaskManager']();`,
    );
    expect(
      rows(root).some(
        (row) => row.includes('consumer.tsx:') && row.includes(':consumer'),
      ),
    ).toBe(true);
  });

  it('rejects service factories in Config constructor target contracts', () => {
    const root = fixture(base, '');
    writeFileSync(
      join(root, 'packages/core/src/config/configConstructor.ts'),
      `import { AsyncTaskManager } from './service.js';
export interface ConfigConstructorTarget {
  taskFactory: () => AsyncTaskManager;
}`,
    );
    writeFileSync(
      join(root, 'packages/core/src/config/service.ts'),
      'export class AsyncTaskManager {}',
    );
    expect(
      rows(root).some((row) => row.includes(':taskFactory:injection')),
    ).toBe(true);
  });

  it('accepts declarative config values, unrelated names, session-owned services and test fixtures', () => {
    const root = fixture(
      base,
      `import { Config } from '@fixture/core/config.js';
class Unrelated { getAsyncTaskManager(): object { return {}; } }
export function run(deps: { config: Config }) {
  const { getModel } = deps.config;
  new Unrelated().getAsyncTaskManager();
  return getModel();
}`,
      `class AsyncTaskManager {}
export class AgentSession { readonly tasks = new AsyncTaskManager(); }`,
    );
    expect(rows(root)).toEqual([]);
  });
});
