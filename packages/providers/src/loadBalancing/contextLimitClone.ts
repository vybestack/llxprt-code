/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { cloneContentsForCompression } from './contentClone.js';
import { LoadBalancerContextLimitError } from './contextLimitError.js';

export function cloneForContextLimit(
  contents: IContent[],
  profileName: string,
  subProfileName: string,
  tokens: number,
  contextLimit: number,
): IContent[] {
  try {
    return cloneContentsForCompression(contents);
  } catch (error) {
    throw new LoadBalancerContextLimitError({
      profileName,
      subProfileName,
      tokens,
      contextLimit,
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  }
}
