/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  InlineMediaBlock,
  MediaBlock,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  AnthropicImageBlock,
  AnthropicDocumentBlock,
  AnthropicMessageBlock,
} from './AnthropicMessageNormalizer.js';

const MEDIA_MEASUREMENT = Symbol('anthropicMediaMeasurement');
class MediaMeasurement {
  constructor(
    readonly media: MediaBlock,
    readonly turnId?: string,
  ) {}
}

function measurementFor(block: object): MediaMeasurement | undefined {
  const source = 'source' in block ? block.source : block;
  if (typeof source !== 'object' || source === null) return undefined;
  const measurement =
    MEDIA_MEASUREMENT in source ? source[MEDIA_MEASUREMENT] : undefined;
  return measurement instanceof MediaMeasurement ? measurement : undefined;
}

function bindMeasurement(block: object, measurement: MediaMeasurement): void {
  const source = 'source' in block ? block.source : block;
  Object.defineProperty(source, MEDIA_MEASUREMENT, {
    value: measurement,
    enumerable: false,
    configurable: true,
  });
}

export function anthropicWireMediaTurn(block: object): string | undefined {
  return measurementFor(block)?.turnId;
}

export function anthropicWireMedia(block: object): MediaBlock | undefined {
  return measurementFor(block)?.media;
}

export function copyAnthropicWireMedia(
  source: AnthropicMessageBlock,
  target: AnthropicMessageBlock,
): void {
  const measurement = measurementFor(source);
  if (measurement !== undefined) bindMeasurement(target, measurement);
}

export function anthropicMediaReference(
  block: AnthropicImageBlock | AnthropicDocumentBlock,
): MediaReferenceBlock | undefined {
  const media = anthropicWireMedia(block);
  return media?.encoding === 'reference' ? media : undefined;
}

export function measurableAnthropicRow(row: IContent): IContent {
  return {
    ...row,
    blocks: row.blocks.map((block) => {
      if (block.type !== 'media') return block;
      const measurable: MediaBlock =
        block.encoding === 'reference'
          ? ({
              ...block,
              encoding: 'base64',
              data: '',
            } satisfies InlineMediaBlock)
          : { ...block };
      bindMeasurement(
        measurable,
        new MediaMeasurement(
          block,
          typeof row.metadata?.turnId === 'string'
            ? row.metadata.turnId
            : undefined,
        ),
      );
      return measurable;
    }),
  };
}

export function measuredAnthropicMedia<
  T extends
    | AnthropicImageBlock
    | AnthropicDocumentBlock
    | { type: 'text'; text: string },
>(media: MediaBlock, block: T): T {
  bindMeasurement(block, measurementFor(media) ?? new MediaMeasurement(media));
  return block;
}

export function anthropicBlockByteLength(block: AnthropicMessageBlock): number {
  const payload = (
    value: AnthropicImageBlock | AnthropicDocumentBlock,
  ): number => anthropicMediaReference(value)?.normalizedBase64Length ?? 0;
  const bytes = Buffer.byteLength(JSON.stringify(block));
  if (block.type === 'image' || block.type === 'document')
    return bytes + payload(block);
  if (block.type !== 'tool_result' || !Array.isArray(block.content))
    return bytes;
  return (
    bytes +
    block.content.reduce(
      (total, nested) => total + (nested.type === 'text' ? 0 : payload(nested)),
      0,
    )
  );
}
