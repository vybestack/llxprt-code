/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

export type AgentInput =
  | string
  | readonly ContentBlock[]
  | Readonly<{ readonly text: string; readonly role?: 'user' | 'system' }>
  | IContent
  | readonly IContent[];

/** Request-local overrides for detached, single-shot text generation. */
export interface GenerateOptions {
  readonly model?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  readonly promptId?: string;
  /** Include the admitted conversation snapshot. Defaults to false. */
  readonly readHistory?: boolean;
  /** Append only the supplied input and final response on success. Defaults to false. */
  readonly writeHistory?: boolean;
}
