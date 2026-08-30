/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  ProviderFileZeroDataRetentionError,
  resolveProviderFilePolicy,
} from './providerFilePolicy.js';

describe('provider Files policy', () => {
  it('requires an explicit session or workspace opt-in', () => {
    const defaultPolicy = resolveProviderFilePolicy({
      configuredMode: undefined,
      configuredRetentionMs: undefined,
      configuredDeletion: undefined,
      providerFileReferences: true,
      zeroDataRetention: 'incompatible-while-retained',
      zeroDataRetentionRequired: false,
    });
    const offPolicy = resolveProviderFilePolicy({
      configuredMode: 'off',
      configuredRetentionMs: 1,
      configuredDeletion: 'delete',
      providerFileReferences: true,
      zeroDataRetention: 'incompatible-while-retained',
      zeroDataRetentionRequired: false,
    });

    expect(defaultPolicy).toStrictEqual({ mode: 'off' });
    expect(offPolicy).toStrictEqual({ mode: 'off' });
  });

  it('requires provider support for explicit session and workspace scopes', () => {
    const session = resolveProviderFilePolicy({
      configuredMode: 'session',
      configuredRetentionMs: 30_000,
      configuredDeletion: 'delete',
      providerFileReferences: true,
      zeroDataRetention: 'incompatible-while-retained',
      zeroDataRetentionRequired: false,
    });
    const workspace = resolveProviderFilePolicy({
      configuredMode: 'workspace',
      configuredRetentionMs: 60_000,
      configuredDeletion: 'delete',
      providerFileReferences: true,
      zeroDataRetention: 'incompatible-while-retained',
      zeroDataRetentionRequired: false,
    });
    const unsupported = resolveProviderFilePolicy({
      configuredMode: 'workspace',
      configuredRetentionMs: 30_000,
      configuredDeletion: 'delete',
      providerFileReferences: false,
      zeroDataRetention: 'not-applicable',
      zeroDataRetentionRequired: false,
    });

    expect(session).toStrictEqual({
      mode: 'enabled',
      scope: 'session',
      retentionMs: 30_000,
      deletion: 'delete',
      zeroDataRetention: 'incompatible-while-retained',
    });
    expect(workspace).toStrictEqual({
      mode: 'enabled',
      scope: 'workspace',
      retentionMs: 60_000,
      deletion: 'delete',
      zeroDataRetention: 'incompatible-while-retained',
    });
    expect(unsupported).toStrictEqual({ mode: 'off' });
  });

  it('rejects retained provider files when zero-data-retention is required', () => {
    expect(() =>
      resolveProviderFilePolicy({
        configuredMode: 'session',
        configuredRetentionMs: 30_000,
        configuredDeletion: 'delete',
        providerFileReferences: true,
        zeroDataRetention: 'incompatible-while-retained',
        zeroDataRetentionRequired: true,
      }),
    ).toThrow(ProviderFileZeroDataRetentionError);
  });

  it('requires an explicit positive retention duration and deletion policy', () => {
    const missingDuration = () =>
      resolveProviderFilePolicy({
        configuredMode: 'workspace',
        configuredRetentionMs: undefined,
        configuredDeletion: 'delete',
        providerFileReferences: true,
        zeroDataRetention: 'incompatible-while-retained',
        zeroDataRetentionRequired: false,
      });
    const missingDeletion = () =>
      resolveProviderFilePolicy({
        configuredMode: 'workspace',
        configuredRetentionMs: 30_000,
        configuredDeletion: undefined,
        providerFileReferences: true,
        zeroDataRetention: 'incompatible-while-retained',
        zeroDataRetentionRequired: false,
      });

    expect(missingDuration).toThrow('retention duration');
    expect(missingDeletion).toThrow('deletion policy');
  });
});
