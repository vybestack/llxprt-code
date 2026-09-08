/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the #3221 provider-neutral Task facade default.
 *
 * A Task built over the FakeProvider production seam stays provider-neutral
 * (UNCONFIGURED_PROVIDER, PLACEHOLDER_MODEL) unless LLXPRT_DEFAULT_PROVIDER
 * selects a provider — the A2A server never defaults to 'gemini'. These tests
 * drive the REAL Agent via createTaskAgent (LLXPRT_FAKE_RESPONSES) and
 * assert the public accessors, exactly as config.createTaskAgent.test.ts does.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  UNCONFIGURED_PROVIDER,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { Task } from './task.js';

const WORKSPACE = mkdtempSync(join(tmpdir(), 'a2a-taskneutral-'));
const FIXTURE = join(WORKSPACE, 'fake-responses.jsonl');
writeFileSync(
  FIXTURE,
  JSON.stringify({
    chunks: [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'a plain text reply' }] },
    ],
  }) + '\n',
);

const SAVED_ENV = { ...process.env };

async function buildAgent(): Promise<Agent> {
  const { createTaskAgent } = await import('../config/config.js');
  return createTaskAgent({}, [], 'neutral-task');
}

async function disposeAgent(agent: Agent): Promise<void> {
  await agent.dispose();
}

describe('Task: provider-neutral default (not gemini)', () => {
  afterEach(() => {
    // Two-way restore: drop anything this file added, then reinstate anything
    // it removed or changed, so later files in the same process see the env
    // exactly as this file found it.
    for (const key of Object.keys(process.env)) {
      if (SAVED_ENV[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = SAVED_ENV[key];
      }
    }
    for (const key of Object.keys(SAVED_ENV)) {
      process.env[key] = SAVED_ENV[key];
    }
  });

  // CI runs with provider env set (LLXPRT_AUTH_TYPE=provider,
  // OPENAI_API_KEY, ...); these tests pin the DEFAULT, so the
  // provider-selecting vars must be absent for the duration.
  // afterEach restores the original env two-way.
  function neutralizeProviderEnv(): void {
    const PROVIDER_ENV =
      /^(GEMINI|GOOGLE|OPENAI|VERTEX|LLXPRT_AUTH|LLXPRT_DEFAULT_PROVIDER|GOOGLE_CLOUD)/;
    for (const key of Object.keys(process.env)) {
      if (PROVIDER_ENV.test(key) && key !== 'LLXPRT_FAKE_RESPONSES') {
        delete process.env[key];
      }
    }
  }

  it('streams a plain-text turn through the Agent facade with a done event', async () => {
    neutralizeProviderEnv();
    process.env.LLXPRT_FAKE_RESPONSES = FIXTURE;
    const agent = await buildAgent();
    try {
      const task = await Task.create('t1', 'c1', agent);
      const types: string[] = [];
      for await (const event of task.acceptUserMessage(
        { userMessage: { parts: [{ kind: 'text', text: 'hello' }] } } as never,
        new AbortController().signal,
      )) {
        types.push(event.type);
      }
      expect(types).toContain('text');
      expect(types).toContain('done');
    } finally {
      await disposeAgent(agent);
    }
  }, 30_000);

  it('getMetadata reports the provider-neutral model (PLACEHOLDER_MODEL)', async () => {
    neutralizeProviderEnv();
    process.env.LLXPRT_FAKE_RESPONSES = FIXTURE;
    const agent = await buildAgent();
    try {
      const task = await Task.create('t2', 'c2', agent);
      const metadata = task.getMetadata();
      expect(metadata.id).toBe('t2');
      expect(metadata.contextId).toBe('c2');
      expect(metadata.model).toBe(PLACEHOLDER_MODEL);
      expect(metadata.model).not.toBe('gemini-pro');
      expect(agent.getProvider()).toBe(UNCONFIGURED_PROVIDER);
    } finally {
      await disposeAgent(agent);
    }
  }, 30_000);

  it('keeps the provider neutral (UNCONFIGURED_PROVIDER) when GEMINI_API_KEY is set', async () => {
    neutralizeProviderEnv();
    process.env.LLXPRT_FAKE_RESPONSES = FIXTURE;
    process.env.GEMINI_API_KEY = 'test-key';
    const agent = await buildAgent();
    try {
      const task = await Task.create('t3', 'c3', agent);
      const metadata = task.getMetadata();
      expect(metadata.model).toBe(PLACEHOLDER_MODEL);
      expect(agent.getProvider()).toBe(UNCONFIGURED_PROVIDER);
    } finally {
      await disposeAgent(agent);
    }
  }, 30_000);
});

process.on('exit', () => {
  try {
    rmSync(WORKSPACE, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});
