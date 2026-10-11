/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { WorkspaceToolCatalogOwner } from '@vybestack/llxprt-code-core';
import { fromConfig } from '../fromConfig.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { engineGate } from './helpers/session-client-engine-fixture.js';

function messages(error: unknown): readonly string[] {
  if (error instanceof AggregateError)
    return error.errors.flatMap((entry: unknown) => messages(entry));
  return error instanceof Error ? [error.message] : [String(error)];
}

async function failure(operation: Promise<void>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

async function publicationClose(): Promise<void> {
  const built = await buildCliStyleConfig('plain-text.jsonl');
  const agent = await fromConfig({
    settingsOwner: built.settingsOwner,
    settingsService: built.settingsService,
    config: built.config,
    providerManager: built.providerManager,
    mcpRuntime: built.mcpRuntime,
  });
  await agent.agentClient.startChat();
  const entered = engineGate();
  const release = engineGate();
  const original = agent.agentClient.setTools.bind(agent.agentClient);
  const publication = spyOn(agent.agentClient, 'setTools').mockImplementation(
    async (...args) => {
      entered.release();
      await release.promise;
      await original(...args);
    },
  );
  const pending = agent.sessionClient.publishTools();
  await entered.promise;
  let finished = false;
  const closing = agent.dispose().then(() => {
    finished = true;
  });
  const outcomes = Promise.allSettled([pending, closing]);
  try {
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    release.release();
    const settled = await outcomes;
    expect(settled.map((result) => result.status)).toStrictEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect(() => agent.tools.get('read_file')).toThrow('closed');
  } finally {
    release.release();
    publication.mockRestore();
    await outcomes;
    await built.cleanup();
  }
}

describe('tool catalog publication and cleanup ownership', () => {
  it('joins an admitted workspace context publication before clearing and withdrawing its physical roots', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      config: built.config,
      providerManager: built.providerManager,
      mcpRuntime: built.mcpRuntime,
    });
    await agent.agentClient.startChat();
    const entered = engineGate();
    const release = engineGate();
    const original = agent.agentClient.setTools.bind(agent.agentClient);
    const publication = spyOn(agent.agentClient, 'setTools').mockImplementation(
      async (...args) => {
        entered.release();
        await release.promise;
        await original(...args);
      },
    );
    const pending = built.mcpRuntime.refreshContext();
    await entered.promise;
    let completed = false;
    const closing = built.mcpRuntime.dispose().then(() => {
      completed = true;
    });
    const outcomes = Promise.allSettled([pending, closing]);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(completed).toBe(false);
      release.release();
      expect((await outcomes).map((result) => result.status)).toStrictEqual([
        'fulfilled',
        'fulfilled',
      ]);
      expect(() => built.mcpRuntime.toolSelection.getAllTools()).toThrow(
        'closed',
      );
    } finally {
      release.release();
      publication.mockRestore();
      await outcomes;
      await agent.dispose();
      await built.cleanup();
    }
  });
  it('joins its own admitted publication before withdrawing the selection root', async () => {
    await expect(publicationClose()).resolves.toBeUndefined();
  });
  for (const name of ['task', 'run_shell_command']) {
    it(`rejects reserved workspace publication for ${name} before any lookup or declaration can shadow a session`, async () => {
      const built = await buildCliStyleConfig('plain-text.jsonl');
      const workspace = new WorkspaceToolCatalogOwner(
        built.config,
        built.messageBus,
        built.mcpRuntime.trust,
      );
      try {
        const tool = built.agentClient.tools.getTool(name);
        if (tool === undefined)
          throw new Error(`Missing actual session tool ${name}`);
        expect(() => workspace.publication.registerTool(tool)).toThrow(
          'session',
        );
        const lease = workspace.acceptSkillPublication();
        try {
          expect(() => lease.registry.registerTool(tool)).toThrow('session');
        } finally {
          lease.release();
        }

        expect(workspace.selection.getTool(name)).toBeUndefined();
        expect(workspace.selection.getAllToolNames()).not.toContain(name);
        expect(
          workspace.selection
            .getFunctionDeclarations()
            .map((entry) => entry.name),
        ).not.toContain(name);
        expect(
          workspace.selection.getFunctionDeclarationsFiltered([name]),
        ).toHaveLength(0);
        expect(
          workspace.selection
            .getAllTools()
            .filter((entry) => entry.name === name),
        ).toHaveLength(0);
        expect(
          workspace.selection
            .getEnabledTools()
            .filter((entry) => entry.name === name),
        ).toHaveLength(0);
        expect(built.agentClient.tools.getTool(name)).toBeDefined();
      } finally {
        await workspace.dispose();
        await built.cleanup();
      }
    });
  }

  it('denies new catalog registration while an admitted skill lease can finish', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const workspace = new WorkspaceToolCatalogOwner(
      built.config,
      built.messageBus,
      built.mcpRuntime.trust,
    );
    const tool = built.agentClient.tools.getTool('read_file');
    if (tool === undefined) throw new Error('Missing physical read tool');
    const lease = workspace.acceptSkillPublication();
    try {
      await workspace.closeAdmission();
      expect(() => workspace.publication.registerTool(tool)).toThrow('closed');
      expect(() => workspace.acceptSkillPublication()).toThrow('closed');
      lease.registry.registerTool(tool);
      expect(lease.declarations().map((entry) => entry.name)).toContain(
        'read_file',
      );
      lease.release();
      expect(() => lease.registry.registerTool(tool)).toThrow('released');
    } finally {
      lease.release();
      await workspace.dispose();
      await built.cleanup();
    }
  });

  it('withdraws every retained workspace publication operation after final disposal', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const workspace = new WorkspaceToolCatalogOwner(
      built.config,
      built.messageBus,
      built.mcpRuntime.trust,
    );
    const tool = built.agentClient.tools.getTool('read_file');
    if (tool === undefined) throw new Error('Missing actual read tool');
    workspace.publication.registerTool(tool);
    try {
      await workspace.dispose();
      expect(() => workspace.publication.getTool('read_file')).toThrow(
        'closed',
      );
      expect(() => workspace.publication.registerTool(tool)).toThrow('closed');
      expect(() => workspace.publication.unregisterTool('read_file')).toThrow(
        'closed',
      );
      expect(() => workspace.publication.sortTools()).toThrow('closed');
      expect(() =>
        workspace.publication.removeMcpToolsByServer('physical'),
      ).toThrow('closed');
    } finally {
      await workspace.dispose();
      await built.cleanup();
    }
  });

  it('aggregates a binding read failure and a different client clear failure while closing the real workspace', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const readError = new Error('physical binding read rejected');
    const clearError = new Error('physical client clearing rejected');
    let closing = false;
    built.mcpRuntime.bindSessionClient(
      built.config,
      Symbol('faulting read binding'),
      () => {
        if (closing) throw readError;
        return built.agentClient;
      },
      async () => {},
      async () => {},
      () => {},
      () => async () => {},
    );
    const clear = spyOn(built.agentClient, 'clearTools').mockImplementation(
      () => {
        throw clearError;
      },
    );
    try {
      closing = true;
      const error = await failure(built.mcpRuntime.dispose());
      expect(error).toBeInstanceOf(AggregateError);
      expect(new Set(messages(error))).toStrictEqual(
        new Set([readError.message, clearError.message]),
      );
      expect(() => built.mcpRuntime.toolSelection.getAllTools()).toThrow(
        'closed',
      );
      expect(() => built.mcpRuntime.readInstructions()).toThrow('stopped');
    } finally {
      clear.mockRestore();
      const cleanupError = await failure(built.cleanup());
      expect(new Set(messages(cleanupError))).toStrictEqual(
        new Set([readError.message, clearError.message]),
      );
    }
  });

  it('joins admitted publication and does not read a peer that closed while the first publication awaited', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const first = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      config: built.config,
      providerManager: built.providerManager,
      mcpRuntime: built.mcpRuntime,
    });
    const second = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      config: built.config,
      providerManager: built.providerManager,
      mcpRuntime: built.mcpRuntime,
    });
    await first.agentClient.startChat();
    await second.agentClient.startChat();
    const entered = engineGate();
    const release = engineGate();
    const setTools = first.agentClient.setTools.bind(first.agentClient);
    const publish = spyOn(first.agentClient, 'setTools').mockImplementation(
      async () => {
        entered.release();
        await release.promise;
        await setTools();
      },
    );
    let publication: Promise<void> | undefined;
    try {
      publication = built.mcpRuntime.refreshContext();
      await entered.promise;
      await second.dispose();
      release.release();
      await publication;
      expect(first.tools.get('read_file')).toBeDefined();
      expect(() => second.tools.get('read_file')).toThrow('closed');
    } finally {
      release.release();
      publish.mockRestore();
      await publication;
      await first.dispose();
      await second.dispose();
      await built.cleanup();
    }
  });
});
