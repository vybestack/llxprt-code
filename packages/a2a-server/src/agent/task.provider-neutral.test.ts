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

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (SAVED_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = SAVED_ENV[key];
    }
  }
  delete process.env.LLXPRT_FAKE_RESPONSES;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_YOLO_MODE;
  delete process.env.LLXPRT_DEFAULT_PROVIDER;
  delete process.env.LLXPRT_YOLO_MODE;
  delete process.env.USE_CCPA;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_LOCATION;
  delete process.env.GOOGLE_API_KEY;
});

describe('Task: provider-neutral default (not gemini)', () => {
  it('streams a plain-text turn through the Agent facade with a done event', async () => {
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
    delete process.env.LLXPRT_DEFAULT_PROVIDER;
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
