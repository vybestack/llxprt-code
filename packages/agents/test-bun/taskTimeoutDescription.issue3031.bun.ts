/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

/**
 * Issue #3031 — `task` tool `timeout_seconds` parameter description.
 *
 * Asserts the description names the resolution chain and the two tunable
 * settings, explains the corrected `-1` semantics, gives the model a cue to
 * set the parameter, and contains NO bare occurrence of the current numeric
 * constants (900 / 1800) — the guard against baking a false invariant into
 * the prose.
 */

import { describe, it, expect } from 'bun:test';
import { TaskTool } from '../src/tools/task.js';
import { installTaskSettingsFixtures } from './task-settings-fixture.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

const makeConfig = installTaskSettingsFixtures('session-desc');

function getTimeoutDescription(): string {
  const fixture = makeConfig();
  const tool = new TaskTool(fixture.config, {
    ...fixture.policies,
    workspacePaths: fixturePaths(),
    readMcpInstructions: () => undefined,
    instructions: emptyInstructionReads,
    messageBus: new MessageBus(),
  });
  const parameters = (
    tool.schema.parametersJsonSchema as { properties?: Record<string, unknown> }
  ).properties;
  const property = parameters?.['timeout_seconds'] as
    | { description?: unknown }
    | undefined;
  const description = property?.description;
  if (typeof description !== 'string') {
    throw new Error('timeout_seconds description is missing or not a string');
  }
  return description;
}

describe('Issue #3031 — task tool timeout_seconds description', () => {
  const description = getTimeoutDescription();

  it('names the configured default setting', () => {
    expect(description).toContain('task-default-timeout-seconds');
  });

  it('names the configured maximum setting', () => {
    expect(description).toContain('task-max-timeout-seconds');
  });

  it('documents the -1 semantics', () => {
    expect(description).toContain('-1');
    expect(description.toLowerCase()).toContain('maximum');
  });

  it('states the accepted domain: -1 or a finite number greater than zero', () => {
    expect(description.toLowerCase()).toContain('greater than zero');
    expect(description).toContain('-1');
  });

  it('states that 0 and other non-positive values are rejected', () => {
    expect(description.toLowerCase()).toContain('non-positive');
    expect(description.toLowerCase()).toContain('reject');
  });

  it('states that a short positive request is honoured exactly', () => {
    expect(description.toLowerCase()).toContain('honoured exactly');
  });

  it('states that a request above the maximum is clamped', () => {
    expect(description.toLowerCase()).toContain('clamp');
  });

  it('gives the model a cue to set an explicit timeout', () => {
    expect(description.toLowerCase()).toContain('explicit timeout');
  });

  it('does not bake in the current numeric default (900)', () => {
    expect(description).not.toContain('900');
  });

  it('does not bake in the current numeric maximum (1800)', () => {
    expect(description).not.toContain('1800');
  });
});
