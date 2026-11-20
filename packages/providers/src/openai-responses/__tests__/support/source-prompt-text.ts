/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { GenerateChatOptions, IProvider } from '../../../IProvider.js';
import { Gpt56SourceProjection } from '../../../tokenizers/gpt56-source-projection.js';
import { promptTextPieces } from '../../../tokenizers/source-family-input.js';
import { NativeResponsesPrompt } from '../../native-responses-body.js';
import { projectOpenAIResponsesPromptEnvelope } from '../../../runtime/promptEnvelopeProjections.js';
import type { ResponsesInputItem } from '../../OpenAIResponsesTypes.js';

const nativePrompts = new WeakMap<object, NativeResponsesPrompt>();

export async function projectSourcePrompt(
  provider: IProvider,
  options: GenerateChatOptions,
): Promise<PromptEnvelopeProjection> {
  const project = provider.projectPromptEnvelope;
  if (project === undefined) throw new Error('Expected prompt projection');
  const original = NativeResponsesPrompt.prototype.toEstimatorProjection;
  const observer = spyOn(
    NativeResponsesPrompt.prototype,
    'toEstimatorProjection',
  ).mockImplementation(function (this: NativeResponsesPrompt) {
    const finalized = original.call(this);
    nativePrompts.set(finalized, this);
    return finalized;
  });
  try {
    const projection = await project.call(provider, options);
    if (projection === undefined) throw new Error('Expected prompt projection');
    return projection;
  } finally {
    observer.mockRestore();
  }
}

export async function sourcePromptText(
  projection: PromptEnvelopeProjection,
): Promise<string> {
  const finalized = projection.finalizedProjection;
  if (finalized instanceof Gpt56SourceProjection) {
    let text = '';
    for await (const piece of promptTextPieces(finalized)) text += piece;
    return text;
  }
  if (typeof finalized !== 'object' || finalized === null)
    throw new Error('Expected a finalized prompt projection');
  const prompt = nativePrompts.get(finalized);
  if (prompt === undefined)
    throw new Error('Observe native projection with projectSourcePrompt');
  const input: ResponsesInputItem[] = [];
  for await (const item of prompt.items(undefined, true)) input.push(item);
  const reference = projectOpenAIResponsesPromptEnvelope({
    ...prompt.envelope(),
    input,
  }).finalizedProjection;
  if (
    typeof reference !== 'object' ||
    reference === null ||
    !('promptText' in reference) ||
    typeof reference.promptText !== 'string'
  )
    throw new Error('Expected finalized prompt text');
  return reference.promptText;
}
