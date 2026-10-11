/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

export function prefixedMediaHistory(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'stable prefix' },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: PNG_BASE64,
        },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'url',
          data: 'https://example.test/image.png',
        },
      ],
    },
  ];
}

export function mediaHistory(data = PNG_BASE64): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data,
        },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'url',
          data: 'https://example.test/image.png',
        },
      ],
    },
  ];
}

export function mediaHistoryShape(
  history: readonly IContent[],
): readonly string[] {
  return history.flatMap((content) =>
    content.blocks.map((block) =>
      block.type === 'media' ? block.encoding : block.type,
    ),
  );
}
