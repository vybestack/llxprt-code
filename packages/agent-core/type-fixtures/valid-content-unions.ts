/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ContentPart, ToolCall, ToolPattern } from '../index.js';

type ImagePart = Extract<ContentPart, { readonly kind: 'image' }>;
type AudioPart = Extract<ContentPart, { readonly kind: 'audio' }>;

const image: ImagePart = {
  kind: 'image',
  mediaType: 'image/png',
  data: new Uint8Array(),
};
const audio: AudioPart = {
  kind: 'audio',
  mediaType: 'audio/wav',
  data: { ref: 'blob-1' },
};
const pattern: ToolPattern = 'builtin/*';
const call: ToolCall = { id: 'call-1', tool: 'builtin/read', args: {} };

export { audio, call, image, pattern };

import type {
  HookEventResult,
  ImportNotice,
  ModelToolChoice,
  PolicyDocument,
  PolicyRegex,
  PreparedShell,
  ToolDescriptor,
} from '../index.js';

const policy: PolicyDocument = {
  authority: [],
  preferences: [],
  sourceStacks: [],
  approvalMode: 'autoEdit',
  fallback: 'deny',
};
const regex: PolicyRegex = {
  flavor: 'ecmascript',
  source: '.*',
  flags: '',
  input: { path: 'direct', source: '.*', flags: '' },
};
const selection: ModelToolChoice = {
  mode: 'required',
  allowedToolIds: ['tool/read'],
};
const descriptor: ToolDescriptor = {
  id: 'tool/read',
  description: 'Read',
  inputSchema: {},
  policyIdentity: { name: 'read', server: 'local' },
  effects: ['read'],
  concurrency: 'parallel',
};
const shell: PreparedShell = {
  parsed: true,
  rawCommand: 'echo ready',
  hasRedirection: false,
  policySplit: [{ text: 'echo ready', hasRedirection: false }],
  segments: [
    { command: 'echo ready', argv: ['echo', 'ready'], hasRedirection: false },
  ],
};
const importedNotice: ImportNotice = {
  code: 'grants-dropped',
  message: 'Historical grants were not imported.',
};
const hookResult: HookEventResult<{
  readonly request?: { readonly toolIds?: readonly string[] };
}> = {
  effective: {
    control: { action: 'continue' },
    value: { request: { toolIds: ['tool/read'] } },
    producers: [
      {
        path: 'request.toolIds',
        provenance: {
          id: 'hook-1',
          event: 'before-model',
          source: 'user',
          order: 0,
        },
      },
    ],
  },
  audit: [],
};

export {
  descriptor,
  hookResult,
  importedNotice,
  policy,
  regex,
  selection,
  shell,
};

import type {
  HookRequestPatch,
  HookResponsePart,
  ModelAttemptSource,
  ModelRequest,
} from '../index.js';

const requestPatch: HookRequestPatch = {
  model: { provider: 'provider', model: 'selected' },
  toolIds: ['tool/read'],
  toolChoice: selection,
  boundary: { status: 'absent' },
};
const responsePart: HookResponsePart = {
  value: { id: 'part-2', thinking: 'cumulative snapshot' },
  accumulation: 'replace',
  stream: { id: 'stream-1', status: 'complete' },
  hookFields: { format: 'provider/v1', data: { signature: 'audit-only' } },
};
const modelRequest: ModelRequest = {
  instructions: [],
  messages: [],
  tools: [],
  parameters: { topP: 0.5, reasoning: { includeInOutput: true } },
  toolChoice: selection,
};
const hookAttempt: ModelAttemptSource = {
  source: 'hook',
  hook: {
    id: 'hook-1',
    event: 'before-model',
    source: 'configuration',
    order: 0,
  },
};
const providerAttempt: ModelAttemptSource = { source: 'provider' };

export {
  hookAttempt,
  modelRequest,
  providerAttempt,
  requestPatch,
  responsePart,
};
