/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { BuiltinCommandLoader } from './BuiltinCommandLoader.js';
import { createUnconfiguredBuiltinOwners } from '../__tests__/unconfigured-model-command.js';

describe('selected builtin registration policy', () => {
  it('reads live admission callbacks without a runtime graph', () => {
    let hooks = false;
    let skills = false;
    let admin = false;
    const loader = new BuiltinCommandLoader(
      createUnconfiguredBuiltinOwners(),
      () => hooks,
      () => skills,
      () => admin,
      null,
    );
    const names = () =>
      loader.loadCommandsSync().map((command) => command.name);
    expect(names()).not.toContain('hooks');
    expect(names()).not.toContain('skills');
    hooks = true;
    skills = true;
    expect(names()).toContain('hooks');
    const blocked = loader
      .loadCommandsSync()
      .find((item) => item.name === 'skills');
    expect(blocked?.subCommands).toStrictEqual([]);
    admin = true;
    const admitted = loader
      .loadCommandsSync()
      .find((item) => item.name === 'skills');
    expect(admitted?.subCommands?.some((item) => item.name === 'list')).toBe(
      true,
    );
  });
});
