/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  formatModelIdentity,
  resolveModelIdentity,
  LB_PENDING_PLACEHOLDER,
  type ModelIdentityRuntime,
} from './modelIdentity.js';

describe('formatModelIdentity', () => {
  describe('standard profile sessions', () => {
    it('renders profileName:modelName when a profile and model are active', () => {
      expect(
        formatModelIdentity({
          profileName: 'work',
          providerName: 'openai',
          modelName: 'gpt-4',
        }),
      ).toBe('work:gpt-4');
    });

    it('renders just the profile name when no model is available', () => {
      expect(
        formatModelIdentity({
          profileName: 'work',
          providerName: 'openai',
          modelName: null,
        }),
      ).toBe('work');
    });

    it('treats a whitespace-only model as absent', () => {
      expect(
        formatModelIdentity({
          profileName: 'work',
          providerName: 'openai',
          modelName: '   ',
        }),
      ).toBe('work');
    });
  });

  describe('direct (non-profile) sessions', () => {
    it('renders provider:model when both are present and no profile is active', () => {
      expect(
        formatModelIdentity({
          profileName: null,
          providerName: 'gemini',
          modelName: 'gemini-2.5-pro',
        }),
      ).toBe('gemini:gemini-2.5-pro');
    });

    it('renders the provider name when only the provider is known', () => {
      expect(
        formatModelIdentity({
          profileName: null,
          providerName: 'gemini',
          modelName: null,
        }),
      ).toBe('gemini');
    });

    it('renders the model name when only the model is known', () => {
      expect(
        formatModelIdentity({
          profileName: null,
          providerName: null,
          modelName: 'llama3',
        }),
      ).toBe('llama3');
    });

    it('uses the provided fallback when nothing else is available', () => {
      expect(
        formatModelIdentity({
          profileName: null,
          providerName: null,
          modelName: null,
          fallback: 'previous-label',
        }),
      ).toBe('previous-label');
    });

    it('renders "unknown" when no identity and no fallback are available', () => {
      expect(
        formatModelIdentity({
          profileName: null,
          providerName: null,
          modelName: null,
        }),
      ).toBe('unknown');
    });
  });

  describe('load-balancer sessions', () => {
    it('renders lb:profile:subProfile:model after a sub-profile is selected', () => {
      expect(
        formatModelIdentity({
          profileName: 'my-lb',
          providerName: 'load-balancer',
          modelName: 'my-lb',
          loadBalancer: {
            profileName: 'my-lb',
            activeSubProfile: 'fast-sub',
            activeModel: 'gpt-4o-mini',
          },
        }),
      ).toBe('lb:my-lb:fast-sub:gpt-4o-mini');
    });

    it('uses the pending placeholder for both sub-profile and model before first selection', () => {
      expect(
        formatModelIdentity({
          profileName: 'my-lb',
          providerName: 'load-balancer',
          modelName: 'my-lb',
          loadBalancer: {
            profileName: 'my-lb',
            activeSubProfile: null,
            activeModel: null,
          },
        }),
      ).toBe(`lb:my-lb:${LB_PENDING_PLACEHOLDER}:${LB_PENDING_PLACEHOLDER}`);
    });

    it('uses the pending placeholder for the model when the sub-profile is known but model is not', () => {
      expect(
        formatModelIdentity({
          profileName: 'my-lb',
          providerName: 'load-balancer',
          modelName: 'my-lb',
          loadBalancer: {
            profileName: 'my-lb',
            activeSubProfile: 'fast-sub',
            activeModel: null,
          },
        }),
      ).toBe(`lb:my-lb:fast-sub:${LB_PENDING_PLACEHOLDER}`);
    });

    it('falls back to "load-balancer" when the load-balancer profile name is missing', () => {
      expect(
        formatModelIdentity({
          profileName: null,
          providerName: 'load-balancer',
          modelName: 'load-balancer',
          loadBalancer: {
            profileName: '',
            activeSubProfile: 'sub-a',
            activeModel: 'claude-3',
          },
        }),
      ).toBe('lb:load-balancer:sub-a:claude-3');
    });

    it('prefers the load-balancer identity over the standard profile identity', () => {
      const result = formatModelIdentity({
        profileName: 'my-lb',
        providerName: 'load-balancer',
        modelName: 'my-lb',
        loadBalancer: {
          profileName: 'my-lb',
          activeSubProfile: 'sub-a',
          activeModel: 'claude-3',
        },
      });
      expect(result.startsWith('lb:')).toBe(true);
      expect(result).not.toBe('my-lb:my-lb');
    });
  });
});

interface FakeLbStats {
  profileName: string;
  lastSelected: string | null;
  lastSelectedModel: string | null;
}

function makeRuntime(options: {
  providerName: string | null;
  modelName: string | null;
  profileName: string | null;
  lbStats?: FakeLbStats | null;
  providerManagerNull?: boolean;
}): ModelIdentityRuntime {
  const {
    providerName,
    modelName,
    profileName,
    lbStats = null,
    providerManagerNull = false,
  } = options;

  return {
    getActiveProviderStatus: () => ({ providerName, modelName }),
    getActiveProfileName: () => profileName,
    getCliProviderManager: () => {
      if (providerManagerNull) {
        return null;
      }
      return {
        getProviderByName: (name: string) => {
          if (name !== 'load-balancer' || lbStats === null) {
            return null;
          }
          return {
            getStats: () => lbStats,
          };
        },
      };
    },
  };
}

describe('resolveModelIdentity', () => {
  it('formats a standard profile session as profileName:modelName', () => {
    const runtime = makeRuntime({
      providerName: 'openai',
      modelName: 'gpt-4',
      profileName: 'work',
    });
    expect(resolveModelIdentity(runtime)).toBe('work:gpt-4');
  });

  it('formats a direct provider session as provider:model', () => {
    const runtime = makeRuntime({
      providerName: 'gemini',
      modelName: 'gemini-2.5-pro',
      profileName: null,
    });
    expect(resolveModelIdentity(runtime)).toBe('gemini:gemini-2.5-pro');
  });

  it('formats a load-balancer session after selection with the real sub-profile model', () => {
    const runtime = makeRuntime({
      providerName: 'load-balancer',
      modelName: 'my-lb',
      profileName: 'my-lb',
      lbStats: {
        profileName: 'my-lb',
        lastSelected: 'fast-sub',
        lastSelectedModel: 'gpt-4o-mini',
      },
    });
    expect(resolveModelIdentity(runtime)).toBe('lb:my-lb:fast-sub:gpt-4o-mini');
  });

  it('formats a load-balancer session before selection with pending placeholders', () => {
    const runtime = makeRuntime({
      providerName: 'load-balancer',
      modelName: 'my-lb',
      profileName: 'my-lb',
      lbStats: {
        profileName: 'my-lb',
        lastSelected: null,
        lastSelectedModel: null,
      },
    });
    expect(resolveModelIdentity(runtime)).toBe(
      `lb:my-lb:${LB_PENDING_PLACEHOLDER}:${LB_PENDING_PLACEHOLDER}`,
    );
  });

  it('still renders the load-balancer context when stats cannot be retrieved', () => {
    const runtime = makeRuntime({
      providerName: 'load-balancer',
      modelName: 'my-lb',
      profileName: 'my-lb',
      lbStats: null,
    });
    expect(resolveModelIdentity(runtime)).toBe(
      `lb:my-lb:${LB_PENDING_PLACEHOLDER}:${LB_PENDING_PLACEHOLDER}`,
    );
  });

  it('renders the load-balancer context even when the provider manager is unavailable', () => {
    const runtime = makeRuntime({
      providerName: 'load-balancer',
      modelName: 'my-lb',
      profileName: 'my-lb',
      providerManagerNull: true,
    });
    expect(resolveModelIdentity(runtime)).toBe(
      `lb:my-lb:${LB_PENDING_PLACEHOLDER}:${LB_PENDING_PLACEHOLDER}`,
    );
  });

  it('uses the fallback when the runtime exposes no identity at all', () => {
    const runtime = makeRuntime({
      providerName: null,
      modelName: null,
      profileName: null,
    });
    expect(resolveModelIdentity(runtime, 'prev-label')).toBe('prev-label');
  });
});
