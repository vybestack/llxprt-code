/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the #3221 A2A conversion: `createTaskAgent` builds a
 * real Agent through the public Agent API from the typed
 * env/settings/extensions host input, with NO runtime assembly in A2A.
 *
 * No mocks of the seams under test. Under the LLXPRT_FAKE_RESPONSES
 * production seam only FakeProvider is registered and set active, so every
 * observable assertion goes through the PUBLIC Agent facade (getProvider /
 * getProviderStatus / getApprovalMode / mcp.listServers / stream events /
 * getRuntimeId) — never through Config, and never through mock call counts.
 */

import { describe, it, expect, afterEach, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApprovalMode } from '@vybestack/llxprt-code-agents';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
import { createTaskAgent } from './config.js';

const AUTH_ENV_KEYS = [
  'USE_CCPA',
  'GEMINI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_API_KEY',
  'LLXPRT_DEFAULT_PROVIDER',
  'LLXPRT_YOLO_MODE',
] as const;

const ENV_KEYS_TO_RESTORE = [
  ...AUTH_ENV_KEYS,
  'LLXPRT_FAKE_RESPONSES',
  'LLXPRT_FAKE_MCP',
];

function clearAuthSignalEnv(): void {
  for (const key of AUTH_ENV_KEYS) delete process.env[key];
}

/**
 * Runs `run` under a fully controlled environment: auth-matrix signals
 * cleared, then `mutate` applied, with the FakeProvider seam pointed at a
 * self-contained fixture so no real network path can execute.
 */
async function runWithEnv<T>(
  mutate: () => void,
  run: () => Promise<T>,
): Promise<T> {
  const before = Object.fromEntries(
    ENV_KEYS_TO_RESTORE.map((k) => [k, process.env[k]]),
  );
  clearAuthSignalEnv();
  mutate();
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * Per-process singleton workspace + FakeProvider responses fixture. The
 * fixture lives inside the workspace so createAgent's includeProcessCwd
 * workspace registration operates on an isolated directory.
 */
const WORKSPACE = mkdtempSync(join(tmpdir(), 'a2a-taskagent-'));
const FIXTURE = join(WORKSPACE, 'fake-responses.jsonl');
writeFileSync(
  FIXTURE,
  JSON.stringify({
    chunks: [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'a plain text reply' }] },
    ],
  }) + '\n',
);
/**
 * Shipped fake-MCP seam fixture (#3221 test): both servers connect without
 * spawning processes, so the public mcp surface observes real discovery.
 */
const MCP_FIXTURE = join(WORKSPACE, 'fake-mcp.json');
writeFileSync(
  MCP_FIXTURE,
  JSON.stringify({
    servers: {
      'cfg-server': { tools: [{ name: 'cfg_tool' }] },
      'ext-server': { tools: [{ name: 'ext_tool' }] },
    },
  }),
);

/** The FakeProvider seam activation shared by every stream-driving test. */
function activateFakeProvider(): void {
  process.env.LLXPRT_FAKE_RESPONSES = FIXTURE;
  process.env.LLXPRT_FAKE_MCP = MCP_FIXTURE;
}

async function buildAgent(
  settings: Parameters<typeof createTaskAgent>[0] = {},
  extensions: LlxprtExtension[] = [],
  taskId = 'task-agent-test',
): Promise<Agent> {
  const previousCwd = process.cwd();
  process.chdir(WORKSPACE);
  try {
    return await createTaskAgent(settings, extensions, taskId);
  } finally {
    process.chdir(previousCwd);
  }
}

function drainTypes(agent: Agent): Promise<string[]> {
  const types: string[] = [];
  return (async () => {
    for await (const event of agent.stream('hello')) {
      types.push(event.type);
    }
    return types;
  })();
}

async function disposeAgent(agent: Agent): Promise<void> {
  // Disposal failures are real signal (a live provider/subscription leak);
  // they must fail the test instead of being swallowed.
  await agent.dispose();
}

/** A minimal real LlxprtExtension carrying one MCP stdio server. */
function makeExtensionWithMcp(name: string): LlxprtExtension {
  return {
    name,
    version: '1.0.0',
    isActive: true,
    path: join(WORKSPACE, 'ext', name),
    contextFiles: [],
    mcpServers: {
      'ext-server': { command: 'node', args: ['server.js'] },
    },
  };
}

describe('createTaskAgent (#3221): Agent built via public API, no runtime assembly', () => {
  // Snapshot once at module scope: afterEach RESTORES the pre-suite values
  // instead of unconditionally deleting them, so a runWithEnv restore (or a
  // sibling test file in this bun process) cannot have its auth env wiped by
  // this file's teardown.
  const SAVED_AUTH_ENV = Object.fromEntries(
    ENV_KEYS_TO_RESTORE.map((k) => [k, process.env[k]]),
  );
  afterEach(() => {
    for (const [k, v] of Object.entries(SAVED_AUTH_ENV)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('no env signals -> provider-neutral agent, working FakeProvider stream turn, clean disposal', async () => {
    await runWithEnv(activateFakeProvider, async () => {
      const agent = await buildAgent({}, []);
      try {
        // Provider-neutral start: the sentinel must not leak as a real
        // provider, and no auth interaction has occurred.
        expect(agent.getProvider()).toBe('unconfigured');
        const status = agent.getProviderStatus();
        expect(status.provider).toBe('');
        expect(status.authStatus).toBe('unauthenticated');

        // A full FakeProvider turn streams through the public facade.
        const types = await drainTypes(agent);
        expect(types).toContain('text');
        expect(types).toContain('done');
      } finally {
        await disposeAgent(agent);
      }
    });
  }, 30_000);

  it('GEMINI_API_KEY set -> provider stays neutral (legacy refreshAuth parity), stream works', async () => {
    await runWithEnv(
      () => {
        activateFakeProvider();
        process.env.GEMINI_API_KEY = 'test-key';
      },
      async () => {
        const agent = await buildAgent({}, []);
        try {
          // Legacy behavior: the env key primed auth state but never
          // activated a provider; the agent stays neutral and functional.
          expect(agent.getProvider()).toBe('unconfigured');
          expect(agent.getProviderStatus().provider).toBe('');
          const types = await drainTypes(agent);
          expect(types).toContain('done');
        } finally {
          await disposeAgent(agent);
        }
      },
    );
  }, 30_000);

  it('LLXPRT_DEFAULT_PROVIDER=gemini -> provider selected, auth not assumed, stream works', async () => {
    await runWithEnv(
      () => {
        activateFakeProvider();
        process.env.LLXPRT_DEFAULT_PROVIDER = 'gemini';
      },
      async () => {
        const agent = await buildAgent({}, []);
        try {
          expect(agent.getProvider()).toBe('gemini');
          // No credentials in the environment: auth must not be reported
          // authenticated (the legacy oauth attempt failed soft).
          expect(agent.getProviderStatus().authStatus).toBe('unauthenticated');
          const types = await drainTypes(agent);
          expect(types).toContain('done');
        } finally {
          await disposeAgent(agent);
        }
      },
    );
  }, 30_000);

  it('LLXPRT_YOLO_MODE=true -> approval mode is YOLO on the facade', async () => {
    await runWithEnv(
      () => {
        activateFakeProvider();
        process.env.LLXPRT_YOLO_MODE = 'true';
      },
      async () => {
        const agent = await buildAgent({}, []);
        try {
          expect(agent.getApprovalMode()).toBe(ApprovalMode.YOLO);
        } finally {
          await disposeAgent(agent);
        }
      },
    );
  }, 30_000);

  it('mcpServers from settings and extensions are visible via the public mcp surface', async () => {
    await runWithEnv(activateFakeProvider, async () => {
      const agent = await buildAgent(
        {
          folderTrust: true,
          mcpServers: { 'cfg-server': { command: 'node', args: ['a.js'] } },
        },
        [makeExtensionWithMcp('ext')],
      );
      try {
        // MCP discovery runs in the background during agent creation
        // (#2325); poll the public status until it settles.
        const deadline = Date.now() + 10_000;
        let names: string[] = [];
        for (;;) {
          const status = agent.mcp.status();
          names = status.servers.map((s) => s.name);
          const settled =
            names.includes('cfg-server') && names.includes('ext-server');
          if (settled || Date.now() > deadline) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(names).toContain('cfg-server');
        expect(names).toContain('ext-server');
      } finally {
        await disposeAgent(agent);
      }
    });
  }, 30_000);

  it('sessionId is observable -> agent runtime id equals the taskId', async () => {
    await runWithEnv(activateFakeProvider, async () => {
      const agent = await buildAgent({}, [], 'task-agent-session-42');
      try {
        expect(agent.getRuntimeId()).toBe('task-agent-session-42');
      } finally {
        await disposeAgent(agent);
      }
    });
  }, 30_000);

  it('per-task isolation: two agents coexist and dispose independently', async () => {
    await runWithEnv(activateFakeProvider, async () => {
      const first = await buildAgent({}, [], 'isolation-a');
      const second = await buildAgent({}, [], 'isolation-b');
      try {
        expect(first.getRuntimeId()).not.toBe(second.getRuntimeId());
        const [a, b] = await Promise.all([
          drainTypes(first),
          drainTypes(second),
        ]);
        expect(a).toContain('done');
        expect(b).toContain('done');
      } finally {
        await disposeAgent(second);
        await disposeAgent(first);
      }
    });
  }, 30_000);
});

// Lifecycle cleanup runs even when individual tests fail mid-suite; the
// process 'exit' hook stays as a belt-and-braces fallback for abnormal exits.
afterAll(() => {
  try {
    rmSync(WORKSPACE, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

process.on('exit', () => {
  try {
    rmSync(WORKSPACE, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});
