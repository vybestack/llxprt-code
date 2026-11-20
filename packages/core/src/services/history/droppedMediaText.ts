/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { MediaDroppedBlock, MediaOrigin } from './IContent.js';

const KIB = 1024;

function sourceLabel(origin: MediaOrigin): string {
  switch (origin.kind) {
    case 'file':
      return origin.path;
    case 'pasted':
      return 'pasted image';
    case 'tool':
      return `image from ${origin.toolName} (${origin.callId})`;
    case 'model-output':
      return 'image from the model';
    default: {
      const exhaustive: never = origin;
      return exhaustive;
    }
  }
}

function sizeLabel(byteLength: number): string {
  return `${Math.max(1, Math.round(byteLength / KIB))} KB`;
}

/** The transcript line for a dropped image: `[image dropped: <source>, <mime>, <N> KB]`. */
export function describeDroppedMedia(block: MediaDroppedBlock): string {
  return `[image dropped: ${sourceLabel(block.origin)}, ${block.mimeType}, ${sizeLabel(block.byteLength)}]`;
}

/**
 * The text a provider receives in place of a dropped image. A file origin
 * names the absolute path so the model can read the image again.
 */
export function droppedMediaModelText(block: MediaDroppedBlock): string {
  const line = describeDroppedMedia(block);
  return block.origin.kind === 'file'
    ? `${line} The image bytes were removed from the conversation; read ${block.origin.path} again to see it.`
    : `${line} The image bytes were removed from the conversation.`;
}
