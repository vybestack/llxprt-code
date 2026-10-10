/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HookOutputDocument } from './hookOutputSnapshot.js';

function reject(field: string): never {
  throw new Error(`Unsupported source BeforeModel hook output: ${field}`);
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

/**
 * Rejects only shapes the snapshot reader cannot interpret. Model, settings,
 * tools and legacy fields are read-and-ignored exactly as the eager caller
 * ignores them; only the contents replacement and decisions take effect.
 */
export function assertSnapshotTextRequest(output: HookOutputDocument): void {
  if (output.valueKind([]) !== 'object') reject('malformed JSON/object');
  assertControls(output);
  const specific = ['hookSpecificOutput'];
  const kind = output.valueKind(specific);
  if (kind === undefined) return;
  if (kind !== 'object') reject('hookSpecificOutput');
  const request = [...specific, 'llm_request'];
  const requestKind = output.valueKind(request);
  if (requestKind === undefined) return;
  if (requestKind !== 'object') reject('llm_request');
  const contentsKind = output.valueKind([...request, 'contents']);
  if (contentsKind !== undefined && contentsKind !== 'array')
    reject('contents');
  const version = output.readValue([...request, 'version']);
  if (version !== undefined && version !== 2) reject('request version');
}
