/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { droppedMediaModelText } from '@vybestack/llxprt-code-core/services/history/droppedMediaText.js';

/**
 * The text of each dropped image, keyed by the tool response it rode with: a
 * dropped block belongs to the nearest tool response before it (the first one
 * when none precedes it), so the reference sits where the image was.
 */
export function droppedTextByResponse(
  content: IContent,
): ReadonlyMap<ToolResponseBlock, string> {
  const texts = new Map<ToolResponseBlock, string>();
  let owner = content.blocks.find(
    (block): block is ToolResponseBlock => block.type === 'tool_response',
  );
  for (const block of content.blocks) {
    if (block.type === 'tool_response') owner = block;
    if (block.type !== 'media_dropped' || owner === undefined) continue;
    const previous = texts.get(owner);
    const text = droppedMediaModelText(block);
    texts.set(owner, previous === undefined ? text : `${previous}\n${text}`);
  }
  return texts;
}

/** A tool response's text with the references of the images dropped from it. */
export function withDroppedText(
  output: string,
  dropped: ReadonlyMap<ToolResponseBlock, string>,
  response: ToolResponseBlock,
): string {
  const text = dropped.get(response);
  return text === undefined ? output : `${output}\n${text}`;
}
