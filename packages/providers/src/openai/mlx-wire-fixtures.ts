/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Probe envelopes from tmp/mlximg-verify/, mlx-openai-server 4b7d4b61.
// Only image payloads are replaced with this complete 1x1 PNG.
export const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

// resp-size-256.json (txt2img config).
export const generationSuccess = {
  created: 1789087855,
  data: [{ url: null, b64_json: tinyPngBase64 }],
} as const;

// ev-edit-a.json (multipart image, true edit config).
export const editSuccess = {
  created: 1789089739,
  data: [{ url: null, b64_json: tinyPngBase64 }],
} as const;

// resp-size-auto.json.
export const validationFailure = {
  detail: [
    {
      type: 'enum',
      loc: ['body', 'size'],
      msg: "Input should be '256x256', '512x512' or '1024x1024'",
      input: 'auto',
      ctx: { expected: "'256x256', '512x512' or '1024x1024'" },
    },
  ],
} as const;

// ev-gen-1024.json (generation on the edit config).
export const handlerFailure = {
  detail: {
    error: {
      message:
        'Failed to generate image: Error generating image: concatenate(): incompatible function arguments. The following argument types are supported:\n    1. concatenate(arrays: list[array], axis: Optional[int] = 0, *, stream: Union[None, Stream, Device] = None) -> array\n\nInvoked with types: list, kwargs = { axis: int }',
      type: 'server_error',
      param: null,
      code: '500',
    },
  },
} as const;

// ev-edit-pngjpg.json (multi-image edit worker timeout).
export const timeoutFailure = {
  error: { message: '', type: 'internal_error', param: null, code: '500' },
} as const;

// resp-bad-model.json.
export const modelNotFound = {
  detail: {
    error: {
      message:
        "Model 'nonexistent/model' not found. Available models: black-forest-labs/FLUX.2-klein-4B",
      type: 'model_not_found',
      code: 404,
    },
  },
} as const;
