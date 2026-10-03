/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  scanWorkspaceConfigBoundary,
  unexpectedWorkspaceConfigSites,
} from '../check-workspace-config-boundary.ts';

const root = join(import.meta.dir, '../..');
const configPath = join(root, 'packages/core/src/config/config.ts');
const consumerPath = join(root, 'packages/agents/src/api/fromConfig.ts');
const constructorPath = join(
  root,
  'packages/core/src/config/configConstructor.ts',
);
const baselinePath = join(
  root,
  'project-plans/issue2615/workspace-config-sites.json',
);

function inserted(path: string, text: string): ReadonlyMap<string, string> {
  return new Map([[path, `${readFileSync(path, 'utf8')}\n${text}\n`]]);
}

describe('workspace Config service ratchet on production package programs', () => {
  it('runs in the normal and scoped lint paths', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const runner = readFileSync(join(root, 'scripts/run-lint.ts'), 'utf8');
    expect(pkg.scripts['lint:workspace-config-boundary']).toBe(
      'bun scripts/check-workspace-config-boundary.ts',
    );
    expect(runner).toContain("'lint:workspace-config-boundary'");
  });

  it('rejects new service ownership, lazy construction, structural aliases and indexed reach-through', () => {
    const config = readFileSync(configPath, 'utf8');
    const configInsertion = `
  private readonly injectedWorkspaceSkillManager?: WorkspaceBoundarySkillManager;
  readonly makeWorkspaceSkillManager = () => new WorkspaceBoundarySkillManager();
  getInjectedWorkspaceSkillManager(): WorkspaceBoundarySkillManager {
    return new WorkspaceBoundarySkillManager();
  }
`;
    const consumerInsertion = `
import type { SkillManager as WorkspaceBoundarySkillManager } from '@vybestack/llxprt-code-core/skills/skillManager.js';
export function workspaceBoundaryProbe(host: { getSkillManager(): WorkspaceBoundarySkillManager }, config: import('@vybestack/llxprt-code-core').Config) {
  const alias = host;
  const callback = () => alias.getSkillManager();
  const projected: import('@vybestack/llxprt-code-core').Config['getSkillManager'] = config['getSkillManager'];
  const { getSkillManager: delegated } = config;
  return [callback(), projected(), delegated()];
}`;
    const sites = scanWorkspaceConfigBoundary(
      root,
      new Map([
        [
          configPath,
          `${config.replace('  getHookSystem(): HookSystem | undefined {', `${configInsertion}\n  getHookSystem(): HookSystem | undefined {`)}\nimport { SkillManager as WorkspaceBoundarySkillManager } from '../skills/skillManager.js';`,
        ],
        [
          consumerPath,
          `${readFileSync(consumerPath, 'utf8')}\n${consumerInsertion}`,
        ],
      ]),
    );
    const newSites = unexpectedWorkspaceConfigSites(sites, baselinePath);
    expect(
      newSites.some(
        (site) =>
          site.kind === 'ownership' &&
          site.member === 'injectedWorkspaceSkillManager',
      ),
    ).toBe(true);
    expect(
      newSites.some(
        (site) =>
          site.kind === 'ownership' &&
          site.member === 'makeWorkspaceSkillManager',
      ),
    ).toBe(true);
    expect(
      newSites.some(
        (site) =>
          site.kind === 'ownership' &&
          site.member === 'getInjectedWorkspaceSkillManager',
      ),
    ).toBe(true);
    expect(newSites.some((site) => site.kind === 'construction')).toBe(true);
    expect(
      newSites.some(
        (site) =>
          site.kind === 'consumer' &&
          site.expression.includes('alias.getSkillManager'),
      ),
    ).toBe(true);
    expect(
      newSites.some(
        (site) =>
          site.kind === 'consumer' &&
          site.expression.includes("config['getSkillManager']"),
      ),
    ).toBe(true);
    expect(newSites.some((site) => site.kind === 'projection')).toBe(true);
    expect(
      newSites.some(
        (site) =>
          site.kind === 'consumer' &&
          site.expression.includes('getSkillManager: delegated'),
      ),
    ).toBe(true);
  }, 30000);

  it('rejects a new workspace service constructor contract field', () => {
    const source = readFileSync(constructorPath, 'utf8');
    const modified = source.replace(
      'export interface ConfigConstructorTarget {',
      `export interface ConfigConstructorTarget {
  injectedWorkspaceSkills?: import('../skills/skillManager.js').SkillManager;`,
    );
    const sites = scanWorkspaceConfigBoundary(
      root,
      new Map([[constructorPath, modified]]),
    );
    expect(
      unexpectedWorkspaceConfigSites(sites, baselinePath).some(
        (site) =>
          site.member === 'injectedWorkspaceSkills' &&
          site.kind === 'ownership',
      ),
    ).toBe(true);
  }, 30000);

  it('allows declarative Config data without new service sites', () => {
    const sites = scanWorkspaceConfigBoundary(
      root,
      inserted(
        consumerPath,
        `export function workspaceBoundaryData(config: import('@vybestack/llxprt-code-core').Config) {
  const model = config.getModel();
  return model;
}`,
      ),
    );
    expect(unexpectedWorkspaceConfigSites(sites, baselinePath)).toEqual([]);
    expect(
      sites.some(
        (site) =>
          site.member === 'McpClientManager' && site.kind === 'construction',
      ),
    ).toBe(true);
    expect(
      sites.some(
        (site) =>
          site.member === 'workspaceContext' && site.kind === 'ownership',
      ),
    ).toBe(true);
  }, 30000);
});
