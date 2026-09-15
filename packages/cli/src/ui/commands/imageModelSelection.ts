/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { buildProviderDerivedImageProfile } from '@vybestack/llxprt-code-providers';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { classifyLoadError } from './profileLoad.js';
import type { MessageActionReturn } from './types.js';

/**
 * Activate a saved image profile or a model ID on the effective image provider.
 * @param name Saved profile name or image model ID.
 * @param imageProvider Explicit image provider setting, if present.
 * @returns Selection confirmation or a typed load/validation error message.
 */
export async function selectImageModel(
  name: string,
  imageProvider?: string,
): Promise<MessageActionReturn> {
  const runtime = getRuntimeApi();
  try {
    const names = await runtime.listSavedProfiles('image');
    if (names.includes(name)) {
      await runtime.loadImageProfileByName(name);
      return {
        type: 'message',
        messageType: 'info',
        content: `Image profile '${name}' loaded`,
      };
    }
    const provider = imageProvider ?? runtime.getActiveProviderName();
    runtime.setActiveImageProfile({
      profile: { ...buildProviderDerivedImageProfile(provider), model: name },
    });
    return {
      type: 'message',
      messageType: 'info',
      content: `Image model '${name}' active on ${provider} (not saved).`,
    };
  } catch (error) {
    return classifyLoadError(error, name);
  }
}
