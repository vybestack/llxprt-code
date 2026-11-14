/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as promises from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalTodoStore } from '@vybestack/llxprt-code-tools';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { SubagentManager } from './subagentManager.js';

describe('session metadata reads without creation', () => {
  it('reads existing todo storage and absent subagents without creating directories', async () => {
    const root = await promises.mkdtemp(join(tmpdir(), 'metadata-read-only-'));
    const todoDirectory = join(root, 'todos');
    await promises.mkdir(todoDirectory);
    const manager = new SubagentManager(
      join(root, 'subagents'),
      new ProfileManager(join(root, 'profiles')),
    );
    const denied = (): never => {
      throw new Error('Metadata read attempted directory creation');
    };
    const sync = spyOn(fs, 'mkdirSync').mockImplementation(denied);
    const asyncMkdir = spyOn(promises, 'mkdir').mockImplementation(denied);
    try {
      const store = new LocalTodoStore('session', { dataDir: root });
      expect(await store.readTodos()).toStrictEqual([]);
      expect(await manager.listSubagents()).toStrictEqual([]);
      expect(await promises.readdir(root)).toStrictEqual(['todos']);
    } finally {
      sync.mockRestore();
      asyncMkdir.mockRestore();
      await promises.rm(root, { recursive: true, force: true });
    }
  });
});
