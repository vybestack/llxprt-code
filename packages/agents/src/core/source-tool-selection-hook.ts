/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HookSystem } from '@vybestack/llxprt-code-core/hooks/hookSystem.js';
import {
  HookEventName,
  BeforeToolSelectionHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { decodeHookToolChoice } from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidOutput(): never {
  throw new Error(
    'Disk source tool-selection hook output is malformed or requests unsupported replacement',
  );
}

function validateOutput(output: unknown): void {
  if (!isRecord(output)) invalidOutput();
  const specific = output.hookSpecificOutput;
  if (specific === undefined) return;
  if (!isRecord(specific)) invalidOutput();
  if ('llm_request' in specific) invalidOutput();
  if (
    'toolChoice' in specific &&
    decodeHookToolChoice(specific.toolChoice) === undefined
  )
    invalidOutput();
}

export async function fireSourceToolSelectionHook(
  system: HookSystem,
  model: string,
  tools: ToolDeclaration[],
): Promise<BeforeToolSelectionHookOutput | undefined> {
  if (
    system.getRegistry().getHooksForEvent(HookEventName.BeforeToolSelection)
      .length === 0
  )
    return undefined;
  const result = await system
    .getEventHandler()
    .fireBeforeToolSelectionEvent({ model, contents: [], tools });
  if (!result.success) {
    const details = [
      ...result.errors.map((error) => error.message),
      ...result.allOutputs.flatMap((output) =>
        typeof output.systemMessage === 'string' ? [output.systemMessage] : [],
      ),
    ].join('; ');
    throw new Error(
      `Disk source tool-selection hook execution failed; required hook input/output cannot be honored${details ? `: ${details}` : ''}`,
      { cause: new AggregateError(result.errors) },
    );
  }
  for (const output of result.allOutputs) validateOutput(output);
  return result.finalOutput === undefined
    ? undefined
    : new BeforeToolSelectionHookOutput(result.finalOutput);
}
