/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from '../createAgent.js';
import type { Agent } from '../agent.js';

const roots: string[] = [];
const agents: Agent[] = [];
let previousResponses: string | undefined;

async function root(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'memory-owner-'));
  roots.push(directory);
  await mkdir(join(directory, '.git'));
  return directory;
}

async function agentAt(directory: string): Promise<Agent> {
  const agent = await createAgent({
    provider: 'fake',
    model: 'fake-model',
    workingDir: directory,
    sessionId: 'same-memory-label',
    folderTrust: true,
    mcpEnabled: false,
    skillsSupport: false,
    recording: { enabled: false },
    telemetry: { enabled: false },
    settings: { jitContextEnabled: false },
    harness: { includeProcessCwd: false },
  });
  agents.push(agent);
  return agent;
}

describe('workspace memory publication through public Agent controls', () => {
  beforeEach(() => {
    previousResponses = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/plain-text.jsonl', import.meta.url),
    );
  });
  afterEach(async () => {
    if (previousResponses === undefined)
      delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousResponses;
    await Promise.all(agents.splice(0).map((agent) => agent.dispose()));
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('restores the previous file-backed snapshot when a subscriber rejects publication after mutation', async () => {
    const directory = await root();
    await writeFile(
      join(directory, 'LLXPRT.md'),
      'Keep project exports explicit.',
    );
    const agent = await agentAt(directory);
    await agent.memory.refresh();
    await mkdir(join(directory, 'nested'));
    await writeFile(
      join(directory, 'nested', 'LLXPRT.md'),
      'Admit new nested instructions.',
    );
    let observed = '';
    const release = agent.memory.onMemoryChanged(() => {
      const current = agent.memory.getMemory();
      if (current.includes('Admit new nested instructions.')) {
        observed = current;
        throw new Error('Rejected instruction publication');
      }
    });
    try {
      await expect(agent.memory.refresh()).rejects.toThrow(
        'Rejected instruction publication',
      );
      expect(observed).toContain('Admit new nested instructions.');
      expect(agent.memory.getMemory()).toContain(
        'Keep project exports explicit.',
      );
      expect(agent.memory.getMemory()).not.toContain(
        'Admit new nested instructions.',
      );
      expect(agent.memory.getFilePaths()).toContain(
        join(directory, 'LLXPRT.md'),
      );
      expect(agent.memory.getFilePaths()).not.toContain(
        join(directory, 'nested', 'LLXPRT.md'),
      );
    } finally {
      release();
    }
  });

  it('keeps same-label session edits independent while reloading shared physical files', async () => {
    const directory = await root();
    await writeFile(
      join(directory, 'LLXPRT.md'),
      'Shared physical project instructions.',
    );
    const first = await agentAt(directory);
    const second = await agentAt(directory);
    await first.memory.refresh();
    await second.memory.refresh();
    first.memory.setMemory('First session custom instructions.');
    expect(second.memory.getMemory()).not.toContain(
      'First session custom instructions.',
    );
    await first.dispose();
    await writeFile(
      join(directory, 'LLXPRT.md'),
      'Reloaded physical project instructions.',
    );
    await second.memory.refresh();
    expect(second.memory.getMemory()).toContain(
      'Reloaded physical project instructions.',
    );
    expect(second.memory.getFilePaths()).toContain(
      join(directory, 'LLXPRT.md'),
    );
  });
});
