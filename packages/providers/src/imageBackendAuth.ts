/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type ImageBackendAuth =
  | { readonly type: 'none' }
  | { readonly type: 'api-key'; readonly apiKey: string }
  | { readonly type: 'named-key'; readonly keyName: string }
  | { readonly type: 'keyfile'; readonly path: string }
  | { readonly type: 'oauth'; readonly provider: 'codex' };
