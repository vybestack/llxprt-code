/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue:2329 — CLI-side access to the shared safety-classifier refusal
 * notice. Re-exported from core so there is a single source of truth for the
 * notice text across the CLI, the headless CLI, and the a2a-server.
 */
import { REFUSAL_NOTICE_MESSAGE } from '@vybestack/llxprt-code-core';

export { REFUSAL_NOTICE_MESSAGE };

export function formatRefusalNotice(details?: {
  readonly category: string | null;
  readonly explanation: string | null;
}): string {
  const suffix: string[] = [];
  if (details?.category !== undefined && details.category !== null) {
    suffix.push(`Category: ${sanitize(details.category)}.`);
  }
  if (details?.explanation !== undefined && details.explanation !== null) {
    suffix.push(sanitize(details.explanation));
  }
  return suffix.length === 0
    ? REFUSAL_NOTICE_MESSAGE
    : `${REFUSAL_NOTICE_MESSAGE} ${suffix.join(' ')}`;
}

function sanitize(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? ' ' : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
}
