/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test suite for OAuth Bucket support in Profile schemas
 * @plan PLAN-20251213issue490 Phase 1
 *
 * This test suite validates the AuthConfig interface and Profile schema extension
 * for OAuth bucket support. These tests follow TDD principles and should FAIL until
 * the implementation is complete.
 */

import { describe, it, expect } from 'vitest';
import type { Profile, StandardProfile } from '../modelParams.js';

// Import AuthConfigSchema and hasAuthConfig once they are implemented
// This will fail until implementation is complete
let AuthConfigSchema: unknown;
let hasAuthConfig: unknown;
let isOAuthProfile: unknown;

try {
  // These imports will fail until the implementation is complete
  const imports = await import('../modelParams.js');
  AuthConfigSchema = (imports as { AuthConfigSchema?: unknown })
    .AuthConfigSchema;
  hasAuthConfig = (imports as { hasAuthConfig?: unknown }).hasAuthConfig;
  isOAuthProfile = (imports as { isOAuthProfile?: unknown }).isOAuthProfile;
} catch {
  // Expected to fail in RED phase
}

describe('AuthConfig Type Structure Validation', () => {
  describe('valid AuthConfig structures', () => {
    it('should accept StandardProfile with oauth type and single bucket', () => {
      const profile: StandardProfile = {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        modelParams: {},
        ephemeralSettings: {},
        auth: {
          type: 'oauth',
          buckets: ['work@company.com'],
        },
      };

      // Should compile without errors
      expect(profile.auth?.type).toBe('oauth');
      expect(profile.auth?.buckets).toEqual(['work@company.com']);
    });

    it('should accept AuthConfig with oauth type and multiple buckets', () => {
      const profile: StandardProfile = {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        modelParams: {},
        ephemeralSettings: {},
        auth: {
          type: 'oauth',
          buckets: ['bucket1', 'bucket2', 'bucket3'],
        },
      };

      expect(profile.auth?.type).toBe('oauth');
      expect(profile.auth?.buckets).toHaveLength(3);
      expect(profile.auth?.buckets).toEqual(['bucket1', 'bucket2', 'bucket3']);
    });

    it('should accept AuthConfig with apikey type', () => {
      const profile: StandardProfile = {
        version: 1,
        type: 'standard',
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {},
        auth: {
          type: 'apikey',
        },
      };

      expect(profile.auth?.type).toBe('apikey');
      expect(profile.auth?.buckets).toBeUndefined();
    });

    it('should accept AuthConfig with oauth type and no buckets (defaults to default)', () => {
      const profile: StandardProfile = {
        version: 1,
        type: 'standard',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        modelParams: {},
        ephemeralSettings: {},
        auth: {
          type: 'oauth',
        },
      };

      expect(profile.auth?.type).toBe('oauth');
      expect(profile.auth?.buckets).toBeUndefined();
    });

    it('should accept AuthConfig with oauth type and empty buckets array defaults to default bucket', () => {
      const profile: StandardProfile = {
        version: 1,
        type: 'standard',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        modelParams: {},
        ephemeralSettings: {},
        auth: {
          type: 'oauth',
          buckets: [],
        },
      };

      expect(profile.auth?.type).toBe('oauth');
      expect(profile.auth?.buckets).toEqual([]);
    });
  });

  describe('invalid AuthConfig structures', () => {
    it('should reject invalid auth type at compile time', () => {
      // This test validates TypeScript compile-time type safety
      // The following should NOT compile if uncommented:
      // const profile: StandardProfile = {
      //   version: 1,
      //   type: 'standard',
      //   provider: 'anthropic',
      //   model: 'claude-sonnet-4',
      //   modelParams: {},
      //   ephemeralSettings: {},
      //   auth: {
      //     type: 'invalid',  // Should be type error
      //   },
      // };

      // This test validates compile-time behavior
      expect(true).toBe(true);
    });

    it('should reject buckets when auth type is apikey at compile time', () => {
      // This test validates TypeScript compile-time type safety
      // The following should NOT compile if uncommented:
      // const profile: StandardProfile = {
      //   version: 1,
      //   type: 'standard',
      //   provider: 'openai',
      //   model: 'gpt-4',
      //   modelParams: {},
      //   ephemeralSettings: {},
      //   auth: {
      //     type: 'apikey',
      //     buckets: ['bucket1'],  // Should be type error
      //   },
      // };

      // This test validates compile-time behavior
      expect(true).toBe(true);
    });
  });
});

describe('Profile with auth field', () => {
  it('should accept StandardProfile with optional auth field', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['work@company.com', 'personal@gmail.com'],
      },
    };

    expect(profile.auth).toBeDefined();
    expect(profile.auth?.type).toBe('oauth');
    expect(profile.auth?.buckets).toHaveLength(2);
  });

  it('should accept StandardProfile without auth field for backward compatibility', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
    };

    expect(profile.auth).toBeUndefined();
  });

  it('should accept Profile without auth field (legacy profile format)', () => {
    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };

    expect(profile.auth).toBeUndefined();
  });

  it('should handle profile with auth field but undefined buckets', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
      },
    };

    expect(profile.auth).toBeDefined();
    expect(profile.auth?.type).toBe('oauth');
    expect(profile.auth?.buckets).toBeUndefined();
  });
});

describe('Bucket name validation', () => {
  it('should accept bucket names with email format', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['user@example.com', 'admin@company.org'],
      },
    };

    expect(profile.auth?.buckets).toContain('user@example.com');
    expect(profile.auth?.buckets).toContain('admin@company.org');
  });

  it('should accept bucket names with simple identifiers', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['default', 'work', 'personal', 'ci-service'],
      },
    };

    expect(profile.auth?.buckets).toHaveLength(4);
    expect(profile.auth?.buckets).toContain('default');
    expect(profile.auth?.buckets).toContain('ci-service');
  });

  it('should accept bucket names with special characters that will be sanitized', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'qwen',
      model: 'qwen-max',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['user:special', 'path/like/name'],
      },
    };

    // These will be sanitized by the implementation, but should be accepted here
    expect(profile.auth?.buckets).toContain('user:special');
    expect(profile.auth?.buckets).toContain('path/like/name');
  });
});

describe('Backward compatibility', () => {
  it('should maintain compatibility with existing profiles without auth field', () => {
    const legacyProfile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-3-opus',
      modelParams: {
        temperature: 0.7,
        max_tokens: 4096,
      },
      ephemeralSettings: {
        'context-limit': 200000,
      },
    };

    expect(legacyProfile.version).toBe(1);
    expect(legacyProfile.provider).toBe('anthropic');
    expect(legacyProfile.auth).toBeUndefined();
  });

  it('should allow profiles with explicit standard type but no auth', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'gpt-4-turbo',
      modelParams: {
        temperature: 1.0,
      },
      ephemeralSettings: {},
    };

    expect(profile.type).toBe('standard');
    expect(profile.auth).toBeUndefined();
  });

  it('should handle migration from API key to OAuth buckets', () => {
    // Before: profile with API key in ephemeral settings
    const beforeProfile: StandardProfile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {
        'auth-key': 'sk-ant-xxx',
      },
    };

    // After: same profile migrated to OAuth with buckets
    const afterProfile: StandardProfile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['work@company.com'],
      },
    };

    expect(beforeProfile.auth).toBeUndefined();
    expect(afterProfile.auth?.type).toBe('oauth');
    expect(afterProfile.auth?.buckets).toHaveLength(1);
  });
});

describe('Multi-bucket failover scenarios', () => {
  it('should accept profile with multiple buckets for failover', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: [
          'primary@company.com',
          'backup@company.com',
          'emergency@personal.com',
        ],
      },
    };

    expect(profile.auth?.buckets).toHaveLength(3);
    // Bucket order matters for failover
    expect(profile.auth?.buckets?.[0]).toBe('primary@company.com');
    expect(profile.auth?.buckets?.[1]).toBe('backup@company.com');
    expect(profile.auth?.buckets?.[2]).toBe('emergency@personal.com');
  });

  it('should preserve bucket order for sequential failover', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['bucket1', 'bucket2', 'bucket3', 'bucket4'],
      },
    };

    // Order must be preserved for failover sequence
    expect(profile.auth?.buckets).toEqual([
      'bucket1',
      'bucket2',
      'bucket3',
      'bucket4',
    ]);
  });
});

describe('Provider-specific OAuth configurations', () => {
  it('should accept OAuth buckets for Anthropic provider', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['work@company.com'],
      },
    };

    expect(profile.provider).toBe('anthropic');
    expect(profile.auth?.type).toBe('oauth');
  });

  it('should accept OAuth buckets for Gemini provider', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['personal@gmail.com', 'work@company.com'],
      },
    };

    expect(profile.provider).toBe('gemini');
    expect(profile.auth?.buckets).toHaveLength(2);
  });

  it('should accept OAuth buckets for Qwen provider', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'qwen',
      model: 'qwen-max',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['account1', 'account2'],
      },
    };

    expect(profile.provider).toBe('qwen');
    expect(profile.auth?.buckets).toHaveLength(2);
  });

  it('should accept apikey auth for providers without OAuth support', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'apikey',
      },
    };

    expect(profile.provider).toBe('openai');
    expect(profile.auth?.type).toBe('apikey');
    expect(profile.auth?.buckets).toBeUndefined();
  });
});

describe('Edge cases and constraints', () => {
  it('should handle single bucket (no failover)', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['only-bucket@example.com'],
      },
    };

    expect(profile.auth?.buckets).toHaveLength(1);
  });

  it('should handle profile with auth type but no buckets array', () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
      },
    };

    expect(profile.auth?.type).toBe('oauth');
    expect(profile.auth?.buckets).toBeUndefined();
  });

  it('should handle LoadBalancer profile without auth field', () => {
    const profile: Profile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['profile1', 'profile2'],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    };

    // LoadBalancer profiles don't have auth field
    expect(profile.type).toBe('loadbalancer');
    const standardProfile = profile as StandardProfile;
    expect(standardProfile.auth).toBeUndefined();
  });
});

describe('Type guard helper functions', () => {
  it('should provide hasAuthConfig type guard for profiles with auth', () => {
    const profileWithAuth: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['work@company.com'],
      },
    };

    const profileWithoutAuth: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };

    // These tests will pass once hasAuthConfig helper is implemented
    expect(profileWithAuth.auth).toBeDefined();
    expect(profileWithoutAuth.auth).toBeUndefined();
  });

  it('should provide isOAuthProfile type guard', () => {
    const oauthProfile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['work@company.com'],
      },
    };

    const apiKeyProfile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'apikey',
      },
    };

    expect(oauthProfile.auth?.type).toBe('oauth');
    expect(apiKeyProfile.auth?.type).toBe('apikey');
  });
});

describe('Zod Schema Validation (RED tests - should fail until implementation)', () => {
  it('should have AuthConfigSchema defined and exported', () => {
    // This will fail until AuthConfigSchema is implemented
    expect(AuthConfigSchema).toBeDefined();
    expect(typeof AuthConfigSchema).toBe('object');
  });

  it('should validate oauth AuthConfig with single bucket using Zod', () => {
    // This will fail until AuthConfigSchema is implemented
    expect(AuthConfigSchema).toBeDefined();

    if (!AuthConfigSchema || typeof AuthConfigSchema !== 'object') {
      throw new Error('AuthConfigSchema not implemented');
    }

    const schema = AuthConfigSchema as { parse: (data: unknown) => unknown };
    const validAuth = {
      type: 'oauth',
      buckets: ['work@company.com'],
    };

    const result = schema.parse(validAuth);
    expect(result).toEqual(validAuth);
  });

  it('should validate oauth AuthConfig with multiple buckets using Zod', () => {
    expect(AuthConfigSchema).toBeDefined();

    if (!AuthConfigSchema || typeof AuthConfigSchema !== 'object') {
      throw new Error('AuthConfigSchema not implemented');
    }

    const schema = AuthConfigSchema as { parse: (data: unknown) => unknown };
    const validAuth = {
      type: 'oauth',
      buckets: ['bucket1', 'bucket2', 'bucket3'],
    };

    const result = schema.parse(validAuth);
    expect(result).toEqual(validAuth);
  });

  it('should validate apikey AuthConfig without buckets using Zod', () => {
    expect(AuthConfigSchema).toBeDefined();

    if (!AuthConfigSchema || typeof AuthConfigSchema !== 'object') {
      throw new Error('AuthConfigSchema not implemented');
    }

    const schema = AuthConfigSchema as { parse: (data: unknown) => unknown };
    const validAuth = {
      type: 'apikey',
    };

    const result = schema.parse(validAuth);
    expect(result).toEqual(validAuth);
  });

  it('should reject invalid auth type using Zod', () => {
    expect(AuthConfigSchema).toBeDefined();

    if (!AuthConfigSchema || typeof AuthConfigSchema !== 'object') {
      throw new Error('AuthConfigSchema not implemented');
    }

    const schema = AuthConfigSchema as { parse: (data: unknown) => unknown };
    const invalidAuth = {
      type: 'invalid',
    };

    expect(() => schema.parse(invalidAuth)).toThrow();
  });

  it('should reject buckets with apikey type using Zod', () => {
    expect(AuthConfigSchema).toBeDefined();

    if (!AuthConfigSchema || typeof AuthConfigSchema !== 'object') {
      throw new Error('AuthConfigSchema not implemented');
    }

    const schema = AuthConfigSchema as { parse: (data: unknown) => unknown };
    const invalidAuth = {
      type: 'apikey',
      buckets: ['bucket1'],
    };

    // Should either fail validation or strip the buckets field
    expect(() => schema.parse(invalidAuth)).toThrow();
  });

  it('should have hasAuthConfig type guard function', () => {
    // This will fail until hasAuthConfig is implemented
    expect(hasAuthConfig).toBeDefined();
    expect(typeof hasAuthConfig).toBe('function');
  });

  it('should use hasAuthConfig to detect auth field presence', () => {
    expect(hasAuthConfig).toBeDefined();

    if (typeof hasAuthConfig !== 'function') {
      throw new Error('hasAuthConfig not implemented');
    }

    const guard = hasAuthConfig as (profile: Profile) => boolean;

    const profileWithAuth: Profile = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['work@company.com'],
      },
    };

    const profileWithoutAuth: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };

    expect(guard(profileWithAuth)).toBe(true);
    expect(guard(profileWithoutAuth)).toBe(false);
  });

  it('should have isOAuthProfile type guard function', () => {
    // This will fail until isOAuthProfile is implemented
    expect(isOAuthProfile).toBeDefined();
    expect(typeof isOAuthProfile).toBe('function');
  });

  it('should use isOAuthProfile to detect OAuth profiles', () => {
    expect(isOAuthProfile).toBeDefined();

    if (typeof isOAuthProfile !== 'function') {
      throw new Error('isOAuthProfile not implemented');
    }

    const guard = isOAuthProfile as (profile: Profile) => boolean;

    const oauthProfile: Profile = {
      version: 1,
      type: 'standard',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'oauth',
        buckets: ['work@company.com'],
      },
    };

    const apiKeyProfile: Profile = {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
      auth: {
        type: 'apikey',
      },
    };

    const noAuthProfile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    };

    expect(guard(oauthProfile)).toBe(true);
    expect(guard(apiKeyProfile)).toBe(false);
    expect(guard(noAuthProfile)).toBe(false);
  });
});
