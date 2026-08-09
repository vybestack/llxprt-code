/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Byte-for-byte compatibility characterization for the main-agent
 * buildSystemInstruction (issue #3173). Centralizing memory derivation into
 * resolvePromptMemory must not change the main-agent prompt bytes for any
 * valid Config behavior.
 *
 * Unlike invocation-level tests, this file does NOT mock the core prompt
 * assembler: buildSystemInstruction's complete returned string is compared
 * against a test-local legacy copy of the pre-change main builder that uses
 * the SAME real getCoreSystemPromptAsync. Infrastructure substitution is
 * limited to clientToolGovernance (shouldIncludeSubagentDelegationForConfig)
 * so the production memory policy, the production main builder, and the real
 * core prompt assembler all remain under test.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'bun:test';
import process from 'node:process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Only clientToolGovernance is substituted: it is infrastructure that is
// identical for both the production builder and the legacy reference, so it
// cannot mask a memory-derivation divergence.
void vi.mock('./clientToolGovernance.js', () => ({
  getToolGovernanceEphemerals: vi.fn().mockReturnValue(undefined),
  getEnabledToolNamesForPrompt: vi.fn().mockReturnValue([]),
  shouldIncludeSubagentDelegationForConfig: vi.fn().mockResolvedValue(false),
  buildToolDeclarationsFromView: vi.fn().mockReturnValue([]),
}));

import { buildSystemInstruction } from './ChatSessionFactory.js';
import {
  getCoreSystemPromptAsync,
  initializePromptSystem,
} from '@vybestack/llxprt-code-core/core/prompts.js';
import { shouldIncludeSubagentDelegationForConfig } from './clientToolGovernance.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

const MODEL = 'gemini-2.5-flash';
const MCP_TOKEN = 'MCP_TOKEN_3173';
const ENV_TOKEN = 'ENV_PREFIX_TOKEN_3173';

/**
 * Faithful copy of the PRE-CHANGE main-agent buildSystemInstruction. It
 * derives memory inline (the original code) and uses the same real
 * getCoreSystemPromptAsync, so any byte divergence isolates the effect of the
 * resolvePromptMemory centralization.
 */
async function legacyBuildSystemInstruction(
  config: Config,
  enabledToolNames: string[],
  envParts: Array<{ text?: string }>,
  model: string,
): Promise<string> {
  let userMemory = config.isJitContextEnabled()
    ? config.getGlobalMemory()
    : config.getUserMemory();
  const coreMemory = config.getCoreMemory();

  const jitMemory = await config.getJitMemoryForPath(config.getWorkingDir());
  if (jitMemory) {
    userMemory = userMemory ? `${userMemory}\n\n${jitMemory}` : jitMemory;
  }

  const mcpInstructions = config.getMcpInstructions();
  const includeSubagentDelegation =
    await shouldIncludeSubagentDelegationForConfig(config, enabledToolNames);
  const interactionMode = config.isInteractive()
    ? 'interactive'
    : 'non-interactive';

  let systemInstruction = await getCoreSystemPromptAsync({
    userMemory,
    coreMemory,
    mcpInstructions,
    model,
    tools: enabledToolNames,
    includeSubagentDelegation,
    interactionMode,
  });

  const envContextText = envParts
    .map((part) => ('text' in part && part.text ? part.text : ''))
    .join('\n');
  if (envContextText) {
    systemInstruction = envContextText + '\n\n' + systemInstruction;
  }

  return systemInstruction;
}

interface Row {
  readonly name: string;
  readonly jitEnabled: boolean;
  readonly global: string;
  readonly user: string;
  readonly jit: string;
  readonly core: string | undefined;
  readonly mcp: string | undefined;
  readonly envParts: Array<{ text?: string }>;
  /** Each token must occur exactly once in the assembled instruction. */
  readonly mcpOnceTokens?: readonly string[];
  /** Each token must prefix the assembled instruction. */
  readonly envPrefixTokens?: readonly string[];
  /** Tokens that must be present in the assembled instruction. */
  readonly presentTokens?: readonly string[];
  /** Tokens that must be absent from the assembled instruction. */
  readonly absentTokens?: readonly string[];
}

function makeConfig(row: Row): Config {
  return {
    isJitContextEnabled: () => row.jitEnabled,
    getGlobalMemory: () => row.global,
    getUserMemory: () => row.user,
    getJitMemoryForPath: async () => row.jit,
    getCoreMemory: () => row.core,
    getMcpInstructions: () => row.mcp,
    getWorkingDir: () => '/proj/workspace',
    isInteractive: () => true,
  } as unknown as Config;
}

const ROWS: Row[] = [
  {
    name: 'JIT enabled: global+JIT+core+MCP all non-empty',
    jitEnabled: true,
    global: 'GLOBAL_TOKEN_3173',
    user: 'SHOULD_NOT_APPEAR',
    jit: 'JIT_TOKEN_3173',
    core: 'CORE_TOKEN_3173',
    mcp: MCP_TOKEN,
    envParts: [],
    mcpOnceTokens: [MCP_TOKEN],
    presentTokens: ['GLOBAL_TOKEN_3173', 'JIT_TOKEN_3173'],
    absentTokens: ['SHOULD_NOT_APPEAR'],
  },
  {
    name: 'JIT enabled: global and JIT both empty (separator boundary)',
    jitEnabled: true,
    global: '',
    user: '',
    jit: '',
    core: 'CORE_TOKEN_3173',
    mcp: undefined,
    envParts: [],
  },
  {
    name: 'JIT enabled: global empty, JIT present, MCP present',
    jitEnabled: true,
    global: '',
    user: '',
    jit: 'JIT_TOKEN_3173',
    core: '',
    mcp: MCP_TOKEN,
    envParts: [],
    mcpOnceTokens: [MCP_TOKEN],
  },
  {
    name: 'JIT enabled: global present, JIT empty',
    jitEnabled: true,
    global: 'GLOBAL_TOKEN_3173',
    user: '',
    jit: '',
    core: 'CORE_TOKEN_3173',
    mcp: undefined,
    envParts: [],
  },
  {
    name: 'JIT disabled: user+core+MCP non-empty',
    jitEnabled: false,
    global: 'SHOULD_NOT_APPEAR',
    user: 'USER_TOKEN_3173',
    jit: '',
    core: 'CORE_TOKEN_3173',
    mcp: MCP_TOKEN,
    envParts: [],
    mcpOnceTokens: [MCP_TOKEN],
    presentTokens: ['USER_TOKEN_3173'],
    absentTokens: ['SHOULD_NOT_APPEAR'],
  },
  {
    name: 'JIT disabled: all memory empty',
    jitEnabled: false,
    global: '',
    user: '',
    jit: '',
    core: '',
    mcp: undefined,
    envParts: [],
  },
  {
    name: 'JIT enabled with environment prefix: env precedes core prompt',
    jitEnabled: true,
    global: 'GLOBAL_TOKEN_3173',
    user: '',
    jit: 'JIT_TOKEN_3173',
    core: 'CORE_TOKEN_3173',
    mcp: MCP_TOKEN,
    envParts: [{ text: ENV_TOKEN }],
    mcpOnceTokens: [MCP_TOKEN],
    envPrefixTokens: [ENV_TOKEN],
  },
  {
    name: 'JIT disabled with environment prefix: env precedes core prompt',
    jitEnabled: false,
    global: '',
    user: 'USER_TOKEN_3173',
    jit: '',
    core: '',
    mcp: undefined,
    envParts: [{ text: ENV_TOKEN }],
    envPrefixTokens: [ENV_TOKEN],
  },
];

describe('buildSystemInstruction byte-for-byte compatibility with pre-change main builder (issue #3173)', () => {
  let originalPromptsDir: string | undefined;
  let tempDir: string;

  beforeAll(async () => {
    originalPromptsDir = process.env.LLXPRT_PROMPTS_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-bytecompat-'));
    process.env.LLXPRT_PROMPTS_DIR = tempDir;
    await initializePromptSystem();
  });

  afterAll(() => {
    if (originalPromptsDir === undefined) {
      delete process.env.LLXPRT_PROMPTS_DIR;
    } else {
      process.env.LLXPRT_PROMPTS_DIR = originalPromptsDir;
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.each(ROWS)('$name', async (row) => {
    const production = await buildSystemInstruction(
      makeConfig(row),
      [],
      row.envParts,
      MODEL,
    );
    const legacy = await legacyBuildSystemInstruction(
      makeConfig(row),
      [],
      row.envParts,
      MODEL,
    );

    // Strong byte-for-byte compatibility evidence: the centralized builder
    // must produce an identical string to the pre-change inline derivation.
    expect(production).toBe(legacy);

    // MCP instructions must appear exactly once — they flow through the
    // dedicated channel, never duplicated via environment memory.
    for (const token of row.mcpOnceTokens ?? []) {
      const occurrences = production.split(token).length - 1;
      expect(occurrences).toBe(1);
    }

    // Environment context, when present, must prefix the core prompt.
    for (const token of row.envPrefixTokens ?? []) {
      expect(production.startsWith(token)).toBe(true);
    }

    // Preserve builder-level sourcing assertions: under JIT the global (not
    // user/environment) memory channel is used; under JIT-disabled the user
    // memory channel is used unchanged.
    for (const token of row.presentTokens ?? []) {
      expect(production).toContain(token);
    }
    for (const token of row.absentTokens ?? []) {
      expect(production).not.toContain(token);
    }
  });
});
