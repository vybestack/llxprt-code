/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import type { ImageProfile } from '@vybestack/llxprt-code-settings';
import { runtimeRegistry, upsertRuntimeEntry } from './runtimeRegistry.js';

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

describe('runtime registry image-profile state', () => {
  afterEach(() => {
    runtimeRegistry.clear();
  });

  it('binds one isolated image-profile state service per runtime', () => {
    const first = upsertRuntimeEntry('image-runtime-a', {});
    const second = upsertRuntimeEntry('image-runtime-b', {});

    first.imageProfileState.select({
      name: 'illustration',
      profile: imageProfile('flare'),
    });
    second.imageProfileState.select({
      name: 'photo',
      profile: imageProfile('sunburst'),
    });

    expect(first.imageProfileState.getActive()?.name).toBe('illustration');
    expect(second.imageProfileState.getActive()?.name).toBe('photo');
  });

  it('retains image-profile state when a runtime entry is updated', () => {
    const initial = upsertRuntimeEntry('image-runtime', {});
    initial.imageProfileState.select({
      name: 'illustration',
      profile: imageProfile('flare'),
    });

    const updated = upsertRuntimeEntry('image-runtime', {
      metadata: { phase: 'configured' },
    });

    expect(updated.imageProfileState.getActive()?.name).toBe('illustration');
  });
});
