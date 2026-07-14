/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * raw-genai-import.ts — P02 NEGATIVE fixture triggering checkA.
 *
 * Contains a raw `import { Content } from '@google/genai'`.
 * `--enforce-imports` MUST exit non-zero on this file.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P02
 * @requirement:REQ-012.1
 */

import { Content } from '@google/genai';

export function useGenai(content: Content): void {
  void content;
}
