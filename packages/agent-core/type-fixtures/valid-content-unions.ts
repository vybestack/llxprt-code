/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ContentPart, ToolCall, ToolPattern } from '../index.js';

type ImagePart = Extract<ContentPart, { readonly kind: 'image' }>;
type AudioPart = Extract<ContentPart, { readonly kind: 'audio' }>;

const image: ImagePart = { kind: 'image', mediaType: 'image/png', data: new Uint8Array() };
const audio: AudioPart = { kind: 'audio', mediaType: 'audio/wav', data: { ref: 'blob-1' } };
const pattern: ToolPattern = 'builtin/*';
const call: ToolCall = { id: 'call-1', tool: 'builtin/read', args: {} };

export { audio, call, image, pattern };
