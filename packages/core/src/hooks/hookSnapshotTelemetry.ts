/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HookModelRowsInput } from './hookModelInputStream.js';
import type { HookDiskText, HookSnapshotResult } from './hookOutputSnapshot.js';
import type { HookExecutionResult } from './types.js';

/** Matches the default telemetry API body cap so hook_call stays bounded. */
export const HOOK_TELEMETRY_TEXT_MAX_CHARS = 4000;

const TRUNCATION_MARKER = '…[truncated]';

function boundedText(text: HookDiskText): string {
  let kept = '';
  for (const chunk of text.chunks()) {
    kept += chunk;
    if (kept.length > HOOK_TELEMETRY_TEXT_MAX_CHARS) {
      let end = HOOK_TELEMETRY_TEXT_MAX_CHARS;
      const last = kept.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
      return `${kept.slice(0, end)}${TRUNCATION_MARKER}`;
    }
  }
  return kept;
}

/**
 * The hook_call input for a snapshot model event. Request rows live on disk and
 * must not be materialized for telemetry, so they are reported by count.
 */
export function snapshotHookCallInput(
  input: HookModelRowsInput,
): Record<string, unknown> {
  const { contents, ...request } = input.llm_request;
  return {
    ...input,
    llm_request: { ...request, contents_row_count: contents.count },
  };
}

/**
 * The hook_call result for a disk-backed snapshot result. stdout and stderr are
 * read through their bounded chunk reader and the parsed output is summarized
 * by its decision and replacement row count, never materialized whole.
 */
export function snapshotHookCallResult(
  result: HookSnapshotResult,
): HookExecutionResult {
  const output: Record<string, unknown> = {};
  if (result.output !== undefined) {
    const decision = result.output.readValue(['decision']);
    if (typeof decision === 'string') output['decision'] = decision;
    const rows = result.output.replacement;
    if (rows !== undefined) output['contents_row_count'] = rows.count;
  }
  return {
    hookConfig: result.hookConfig,
    eventName: result.eventName,
    success: result.success,
    output: output as HookExecutionResult['output'],
    stdout: boundedText(result.stdout),
    stderr: boundedText(result.stderr),
    exitCode: result.exitCode,
    duration: result.duration,
    error: result.error,
  };
}
