/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { ImageProfile } from '@vybestack/llxprt-code-settings';
import { createImageProfileRuntimeState } from './ImageProfileRuntimeState.js';

function imageProfile(model: string): ImageProfile {
  return {
    version: 1,
    type: 'image',
    backend: 'codex',
    model,
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    auth: { type: 'oauth', provider: 'codex' },
  };
}

describe('ImageProfileRuntimeState', () => {
  it('isolates active image profile selection between runtimes', () => {
    const firstRuntime = createImageProfileRuntimeState();
    const secondRuntime = createImageProfileRuntimeState();

    firstRuntime.select({
      name: 'illustration',
      profile: imageProfile('flare'),
    });
    secondRuntime.select({ name: 'photo', profile: imageProfile('sunburst') });

    expect(firstRuntime.getActive()?.name).toBe('illustration');
    expect(secondRuntime.getActive()?.name).toBe('photo');
  });

  it('resets selection to the no-reference state', () => {
    const runtime = createImageProfileRuntimeState();
    runtime.select({ name: 'illustration', profile: imageProfile('flare') });

    runtime.reset();

    expect(runtime.getActive()).toBeUndefined();
  });
});
