/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The script API a caller sees (issue #4084): which tools a script may call,
 * the TypeScript declarations `discover_tool_api` describes them with, and
 * the API revision a script can pin with `api_revision`.
 */

import { createHash } from 'node:crypto';
import type { CodeModeSettingLimits } from './code-mode-settings.js';
import {
  SchemaProjection,
  docText,
  typeIdentifier,
} from './schema-to-typescript.js';
import type { NestedExecutionComposition } from '../scheduler/nested-execution.js';
import { admittedScriptTools } from './script-tool-surface.js';

/** How a tool's result reaches the guest (its `value` type). */
export type ScriptResultAdapter = 'text' | 'shell';

export interface ScriptApiTool {
  readonly name: string;
  readonly description: string;
  readonly schema: unknown;
  readonly adapter: ScriptResultAdapter;
}

/** Declarations bound for the model; larger requests must ask for fewer tools. */
export const MAX_DECLARATION_BYTES = 48 * 1024;

const RESULT_TYPES: Readonly<Record<ScriptResultAdapter, string>> = {
  text: 'TextResult',
  shell: 'ShellResult',
};

export const SCRIPT_RESULT_PRELUDE = `type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type Completeness = 'complete' | 'partial' | 'unknown';

/** What every tools["name"](args) call resolves to; check ok first. */
type ScriptToolResult<T> =
  | { readonly ok: true; readonly value: T; readonly completeness: Completeness }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/** Value of text tools: the text the tool produced. */
interface TextResult {
  readonly text: string;
}

/** Value of run_shell_command. A PTY merges both streams into stdout. */
interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly streamsMerged: boolean;
}`;

/** The script-callable tools this caller admits, with their registered schemas. */
export function readScriptApi(
  composition: Pick<NestedExecutionComposition, 'selection' | 'readGovernance'>,
  hookRestrictedAllowedTools: readonly string[] | undefined,
): ScriptApiTool[] {
  return admittedScriptTools(composition, hookRestrictedAllowedTools).map(
    (name) => {
      const tool = composition.selection.getTool(name);
      if (tool === undefined)
        throw new Error(`Admitted script tool ${name} has no registration.`);
      return {
        name,
        description: tool.description,
        schema: tool.schema.parametersJsonSchema,
        adapter: name === 'run_shell_command' ? 'shell' : 'text',
      };
    },
  );
}

/**
 * Hash over the names, registered schemas and result adapters of every
 * script-callable tool the caller admits, plus the limits a script runs
 * under. Any change to them changes the revision.
 */
export function computeApiRevision(
  tools: readonly ScriptApiTool[],
  limits: CodeModeSettingLimits,
): string {
  const canonical = JSON.stringify({
    tools: [...tools]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, schema, adapter }) => [name, schema, adapter]),
    limits: [limits.maxCalls, limits.maxResultBytes, limits.wallTimeoutMs],
  });
  return `cm1-${createHash('sha256').update(canonical).digest('hex').slice(0, 24)}`;
}

export interface GeneratedDeclarations {
  readonly source: string;
  readonly diagnostics: readonly string[];
}

function uniqueBase(name: string, used: Set<string>): string {
  const candidate = `${typeIdentifier(name)}Args`;
  let base = candidate;
  for (let suffix = 2; used.has(base); suffix++) base = `${candidate}${suffix}`;
  used.add(base);
  return base;
}

/**
 * Declarations for the given tools: the result envelope types, one argument
 * type per tool (plus named types for its local references), and the
 * `ScriptTools` interface that `tools` implements. Tool names are only ever
 * string-literal keys.
 */
export function generateDeclarations(
  tools: readonly ScriptApiTool[],
): GeneratedDeclarations {
  const used = new Set<string>();
  const diagnostics: string[] = [];
  const typeBlocks: string[] = [];
  const members: string[] = [];
  for (const tool of tools) {
    const base = uniqueBase(tool.name, used);
    const projection = new SchemaProjection(tool.schema, base);
    const args = projection.project();
    for (const [name, body] of projection.namedTypes)
      typeBlocks.push(`type ${name} = ${body};`);
    typeBlocks.push(
      `/** Arguments of ${JSON.stringify(tool.name)}. */\ntype ${base} = ${args};`,
    );
    diagnostics.push(
      ...projection.diagnostics.map((entry) => `${tool.name} ${entry}`),
    );
    const doc = docText(tool.description);
    members.push(
      `  /** ${doc.length > 0 ? doc : tool.name} */\n  readonly ${JSON.stringify(tool.name)}: (args: ${base}) => Promise<ScriptToolResult<${RESULT_TYPES[tool.adapter]}>>;`,
    );
  }
  const source = [
    SCRIPT_RESULT_PRELUDE,
    ...typeBlocks,
    `interface ScriptTools {\n${members.join('\n')}\n}`,
    'declare const tools: ScriptTools;',
  ].join('\n\n');
  return { source: `${source}\n`, diagnostics };
}
