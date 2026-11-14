/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: chat histories whose tool results carry a video. The
 * frozen corpus draws no tool video, so these reach the media state of the
 * chat transducer that says a video is pending (the flush text changes).
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  ai,
  callBlock,
  human,
  imageBlock,
  responseBlock,
  textBlock,
  tool,
} from '../../../../__tests__/support/frozenWire/explicit/rowBuilders.js';

const videoBlock = (url: string): IContent['blocks'][number] => ({
  type: 'media',
  mimeType: 'video/mp4',
  encoding: 'url',
  data: url,
});

const PNG = 'iVBORw0KGgo=';

export interface ToolVideoHistory {
  readonly name: string;
  readonly rows: readonly IContent[];
}

export function toolVideoHistories(): ToolVideoHistory[] {
  return [
    {
      name: 'an image and a video, then text, then an image',
      rows: [
        human(textBlock('q')),
        ai(callBlock('v1', 'shoot')),
        tool(responseBlock('v1', 'ok'), imageBlock(PNG), videoBlock('ms://1')),
        ai(textBlock('done')),
        ai(callBlock('v2', 'shoot')),
        tool(responseBlock('v2', 'ok'), imageBlock(PNG)),
        human(textBlock('end')),
      ],
    },
    {
      name: 'a video in a tool row before any other row',
      rows: [
        tool(responseBlock('v0', 'ok'), videoBlock('ms://0')),
        human(textBlock('q')),
      ],
    },
    {
      name: 'a video that is still pending at the end of the stream',
      rows: [
        human(textBlock('q')),
        ai(callBlock('v3', 'shoot')),
        tool(responseBlock('v3', 'ok'), videoBlock('ms://3')),
      ],
    },
  ];
}
