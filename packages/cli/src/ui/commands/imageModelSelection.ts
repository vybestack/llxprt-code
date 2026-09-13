/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ImageProfileNotFoundError } from '@vybestack/llxprt-code-settings';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { classifyLoadError } from './profileLoad.js';
import type { MessageActionReturn } from './types.js';

/** Activate a saved image profile without changing the conversation model. */
export async function selectImageModel(
  name: string,
): Promise<MessageActionReturn> {
  const runtime = getRuntimeApi();
  try {
    await runtime.loadImageProfileByName(name);
    return {
      type: 'message',
      messageType: 'info',
      content: `Image profile '${name}' loaded`,
    };
  } catch (error) {
    const result = classifyLoadError(error, name);
    if (error instanceof ImageProfileNotFoundError) {
      const names = await runtime.listSavedProfiles('image');
      return {
        ...result,
        content: `${result.content}. Available image profiles: ${names.join(', ') || '(none)'}`,
      };
    }
    return result;
  }
}
