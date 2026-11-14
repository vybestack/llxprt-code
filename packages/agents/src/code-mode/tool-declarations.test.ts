/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4084: `discover_tool_api` lists and describes the script API of the
 * calling session, its declarations compile under the repository's
 * TypeScript compiler, and `execute_tool_script` refuses a stale
 * `api_revision` with API_CHANGED.
 */

import { afterEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDirectAgent,
  runTurn,
  scratchDir,
  toolResponses,
  type ScriptAgent,
  type ToolCallSpec,
} from './__tests__/script-agent.js';
import { assertNoLiveWrappers } from './__tests__/runtime-test-helpers.js';
import { SCRIPT_CALLABLE_TOOLS } from './script-tool-surface.js';
import {
  computeApiRevision,
  generateDeclarations,
  type ScriptApiTool,
} from './tool-declarations.js';

setDefaultTimeout(120_000);

const require = createRequire(import.meta.url);
const TSC = require.resolve('typescript/bin/tsc');

interface CompileResult {
  readonly ok: boolean;
  readonly output: string;
}

/** `tsc --noEmit --strict` over the declarations plus a usage snippet. */
function compile(declarations: string, usage: string): CompileResult {
  const dir = mkdtempSync(join(tmpdir(), 'code-mode-decl-'));
  try {
    const file = join(dir, 'script-api.ts');
    writeFileSync(file, `${declarations}\nexport {};\n${usage}\n`);
    const run = spawnSync(
      process.execPath,
      [
        TSC,
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--lib',
        'ES2022',
        file,
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let built: ScriptAgent | undefined;

async function cleanUp(): Promise<void> {
  await built?.cleanup();
  built = undefined;
  assertNoLiveWrappers();
}

async function runCalls(
  calls: readonly ToolCallSpec[],
  disabled: readonly string[] = [],
): Promise<ScriptAgent> {
  const workspace = scratchDir('code-mode-discover-');
  built = await buildDirectAgent(calls, { workspace });
  if (disabled.length > 0)
    built.agent.setEphemeralSetting('tools.disabled', [...disabled]);
  await runTurn(built.agent);
  return built;
}

/** The JSON a tool returned for `callId`. */
async function responseJson(
  session: ScriptAgent,
  callId: string,
): Promise<Record<string, unknown>> {
  const responses = toolResponses(await session.agent.getHistory()).filter(
    (block) => block.callId === callId,
  );
  expect(responses).toHaveLength(1);
  const [response] = responses;
  const result = response.result as { output?: unknown } | string | undefined;
  const output = typeof result === 'object' ? result.output : result;
  const text = response.error ?? (typeof output === 'string' ? output : '');
  return JSON.parse(text.slice(text.indexOf('{"ok"'))) as Record<
    string,
    unknown
  >;
}

function discover(
  id: string,
  parameters: Readonly<Record<string, unknown>>,
): ToolCallSpec {
  return { id, name: 'discover_tool_api', parameters };
}

describe('discover_tool_api (issue #4084)', () => {
  afterEach(cleanUp);

  it('declares every script-callable tool from its registered schema, and the declarations compile', async () => {
    const session = await runCalls([
      discover('describe-all', {
        operation: 'describe',
        tools: [...SCRIPT_CALLABLE_TOOLS],
      }),
    ]);
    const described = await responseJson(session, 'describe-all');

    expect(described['ok']).toBe(true);
    const declarations = String(described['declarations']);
    for (const name of SCRIPT_CALLABLE_TOOLS)
      expect(declarations).toContain(`readonly ${JSON.stringify(name)}: (`);
    const usage = `
async function use(): Promise<number> {
  const read = await tools["read_file"]({ absolute_path: "/tmp/a.txt" });
  const shell = await tools["run_shell_command"]({ command: "ls" });
  const text: string = read.ok ? read.value.text : read.error.code;
  const code: number | null = shell.ok ? shell.value.exitCode : null;
  const merged: boolean = shell.ok ? shell.value.streamsMerged : false;
  const found = await tools["glob"]({ pattern: "**/*.ts" });
  return text.length + (code ?? 0) + (merged ? 1 : 0) + (found.ok ? 1 : 0);
}
void use;`;
    const result = compile(declarations, usage);
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
  });

  it('lists the callable tools with the revision, leaving out a disabled tool and refusing to describe it', async () => {
    const session = await runCalls(
      [
        discover('list', { operation: 'list' }),
        discover('describe-disabled', {
          operation: 'describe',
          tools: ['glob'],
        }),
        discover('describe-write', {
          operation: 'describe',
          tools: ['write_file'],
        }),
      ],
      ['glob'],
    );
    const listed = await responseJson(session, 'list');
    const names = (listed['tools'] as Array<{ name: string }>).map(
      (tool) => tool.name,
    );

    expect(names).toStrictEqual(
      SCRIPT_CALLABLE_TOOLS.filter((name) => name !== 'glob'),
    );
    expect(String(listed['api_revision'])).toMatch(/^cm1-[0-9a-f]{24}$/);
    expect(await responseJson(session, 'describe-disabled')).toMatchObject({
      ok: false,
      error: { code: 'TOOL_NOT_ADMITTED' },
    });
    expect(await responseJson(session, 'describe-write')).toMatchObject({
      ok: false,
      error: { code: 'TOOL_NOT_SCRIPTABLE' },
    });
  });

  it('runs a script pinned to the current revision and refuses a stale one with API_CHANGED', async () => {
    const first = await runCalls([discover('list', { operation: 'list' })]);
    const revision = String(
      (await responseJson(first, 'list'))['api_revision'],
    );
    await first.cleanup();
    built = undefined;

    const script = (id: string, apiRevision: string): ToolCallSpec => ({
      id,
      name: 'execute_tool_script',
      parameters: {
        source: 'return 7;',
        tools: ['glob'],
        purpose: 'revision check',
        api_revision: apiRevision,
      },
    });
    const second = await runCalls([
      script('pinned', revision),
      script('stale', 'cm1-000000000000000000000000'),
    ]);

    expect(await responseJson(second, 'pinned')).toMatchObject({
      ok: true,
      value: 7,
    });
    expect(await responseJson(second, 'stale')).toMatchObject({
      ok: false,
      error: { code: 'API_CHANGED' },
      callCount: 0,
    });
  });
});

const RECURSIVE_SCHEMA = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: ['fast', 'deep'],
      description: 'How hard to look. */ not a comment end',
    },
    kind: { const: 'node' },
    target: {
      anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    },
    limit: { type: ['integer', 'null'] },
    tree: { $ref: '#/definitions/Node' },
    labels: { type: 'object', additionalProperties: { type: 'number' } },
    remote: { $ref: 'https://example.com/schema.json' },
  },
  required: ['mode', 'tree'],
  definitions: {
    Node: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        children: { type: 'array', items: { $ref: '#/definitions/Node' } },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
};

const FIXTURE_TOOLS: readonly ScriptApiTool[] = [
  {
    name: 'mcp.server-tool',
    description: 'Fixture with every supported construct.\nSecond line.',
    schema: RECURSIVE_SCHEMA,
    adapter: 'text',
  },
  {
    name: 'mcp.server_tool',
    description: 'A second name that maps to the same identifier.',
    schema: { type: 'object', properties: { flag: { type: 'boolean' } } },
    adapter: 'shell',
  },
];

describe('declaration generation (issue #4084)', () => {
  afterEach(cleanUp);

  it('compiles enums, consts, unions, optional fields, arrays and recursive local references for dotted and dashed names', () => {
    const { source, diagnostics } = generateDeclarations(FIXTURE_TOOLS);
    const usage = `
async function use(): Promise<void> {
  const result = await tools["mcp.server-tool"]({
    mode: "deep",
    kind: "node",
    target: ["a", "b"],
    limit: null,
    tree: { name: "root", children: [{ name: "leaf", children: [] }] },
    labels: { a: 1 },
  });
  if (result.ok) {
    const text: string = result.value.text;
    void text;
  }
  const other = await tools["mcp.server_tool"]({});
  if (other.ok) void other.value.stdout;
}
void use;`;
    const result = compile(source, usage);

    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
    expect(diagnostics).toStrictEqual([
      'mcp.server-tool args.remote: unsupported $ref https://example.com/schema.json; typed as unknown',
    ]);
    expect(source).toContain('readonly "mcp.server-tool": (');
    expect(source).toContain('McpServerToolArgs_Node');
    expect(source).not.toContain('*/ not a comment end');
  });

  it('rejects arguments the schema does not allow, so the types are not any', () => {
    const { source } = generateDeclarations(FIXTURE_TOOLS);
    const wrongEnum = compile(
      source,
      'void tools["mcp.server-tool"]({ mode: "slow", tree: { name: "x" } });',
    );
    const missingRequired = compile(
      source,
      'void tools["mcp.server-tool"]({ mode: "fast" });',
    );
    const extraNodeKey = compile(
      source,
      'void tools["mcp.server-tool"]({ mode: "fast", tree: { name: "x", size: 1 } });',
    );

    expect(wrongEnum.ok).toBe(false);
    expect(missingRequired.ok).toBe(false);
    expect(extraNodeKey.ok).toBe(false);
  });

  it('changes the revision when a schema, adapter or limit changes, and only then', () => {
    const limits = {
      maxCalls: 64,
      wallTimeoutMs: 300000,
      maxResultBytes: 16384,
    };
    const base = computeApiRevision(FIXTURE_TOOLS, limits);
    const reordered = computeApiRevision([...FIXTURE_TOOLS].reverse(), limits);
    const schemaChanged = computeApiRevision(
      [{ ...FIXTURE_TOOLS[0], schema: { type: 'object' } }, FIXTURE_TOOLS[1]],
      limits,
    );
    const adapterChanged = computeApiRevision(
      [FIXTURE_TOOLS[0], { ...FIXTURE_TOOLS[1], adapter: 'text' }],
      limits,
    );
    const limitChanged = computeApiRevision(FIXTURE_TOOLS, {
      ...limits,
      maxCalls: 8,
    });

    expect(reordered).toBe(base);
    expect(
      new Set([base, schemaChanged, adapterChanged, limitChanged]).size,
    ).toBe(4);
  });
});
