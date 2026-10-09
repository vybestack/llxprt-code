/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HookOutputDocument } from './hookOutputSnapshot.js';
import type { HookModelRowsInput } from './hookModelInputStream.js';

function reject(field: string): never {
  throw new Error(`Unsupported source BeforeModel hook output: ${field}`);
}

function validateTools(
  output: HookOutputDocument,
  target: HookModelRowsInput['llm_request'],
): void {
  const path = ['hookSpecificOutput', 'llm_request', 'tools'];
  const kind = output.valueKind(path);
  if (kind === undefined) return;
  if (kind !== 'array') reject('tools');
  const tools = target.tools ?? [];
  for (let index = 0; index < tools.length; index++) {
    if (
      JSON.stringify(output.readValue([...path, index])) !==
      JSON.stringify(tools[index])
    )
      reject('tool mutation violates selected tool restrictions');
  }
  if (output.valueKind([...path, tools.length]) !== undefined)
    reject('tool mutation violates selected tool restrictions');
}

function assertFields(
  output: HookOutputDocument,
  path: string[],
  fields: string[],
): void {
  const count = fields.filter(
    (field) => output.valueKind([...path, field]) !== undefined,
  ).length;
  if (count !== output.valueMemberCount(path))
    reject(`unknown or duplicate ${path.join('.') || 'output'} field`);
}

function assertControls(output: HookOutputDocument): void {
  for (const [field, expected] of [
    ['continue', 'boolean'],
    ['decision', 'string'],
    ['reason', 'string'],
    ['stopReason', 'string'],
  ]) {
    const kind = output.valueKind([field]);
    if (kind !== undefined && kind !== expected) reject(field);
  }
  const decision = output.readValue(['decision']);
  if (
    decision !== undefined &&
    !['ask', 'block', 'deny', 'approve', 'allow'].includes(String(decision))
  )
    reject('decision');
}

export function assertSnapshotTextRequest(
  output: HookOutputDocument,
  target: HookModelRowsInput['llm_request'],
): void {
  if (output.valueKind([]) !== 'object') reject('malformed JSON/object');
  assertControls(output);
  assertFields(
    output,
    [],
    ['continue', 'decision', 'reason', 'stopReason', 'hookSpecificOutput'],
  );
  const specific = ['hookSpecificOutput'];
  const kind = output.valueKind(specific);
  if (kind === undefined) return;
  if (kind !== 'object') reject('hookSpecificOutput');
  assertFields(output, specific, ['llm_request', 'llm_request_boundary']);
  for (const field of ['llm_response', 'toolChoice']) {
    if (output.valueKind([...specific, field]) !== undefined) reject(field);
  }
  const request = [...specific, 'llm_request'];
  const requestKind = output.valueKind(request);
  if (requestKind === undefined) return;
  if (requestKind !== 'object') reject('llm_request');
  assertFields(output, request, [
    'contents',
    'version',
    'model',
    'tools',
    'settings',
  ]);
  const contentsKind = output.valueKind([...request, 'contents']);
  if (contentsKind !== undefined && contentsKind !== 'array')
    reject('contents');
  const model = output.readValue([...request, 'model']);
  if (model !== undefined && model !== target.model) reject('model mutation');
  const version = output.readValue([...request, 'version']);
  if (version !== undefined && version !== 2) reject('request version');
  if (output.valueKind([...request, 'settings']) !== undefined)
    reject('settings mutation');
  validateTools(output, target);
}
