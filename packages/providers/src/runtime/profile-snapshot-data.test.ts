/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { buildRuntimeProfileSnapshot } from './profileSnapshot.js';

describe('declarative profile snapshots', () => {
  it('captures independent owners outside runtime scope without retaining mutable input', () => {
    const ephemerals = {
      'reasoning.effortMap': { low: 1024, high: 8192 },
      'auth-key-name': 'owner-a-key',
      'auth-key': 'resolved-secret',
    };
    const first = buildRuntimeProfileSnapshot({
      providerName: 'openai',
      modelName: 'owner-a-model',
      providerSettings: { temperature: 0.2, 'auth-key': 'provider-secret' },
      ephemeralSettings: ephemerals,
    });
    const second = buildRuntimeProfileSnapshot({
      providerName: 'anthropic',
      modelName: 'owner-b-model',
      providerSettings: { temperature: 0.8 },
      ephemeralSettings: { 'auth-key-name': 'owner-b-key' },
    });
    ephemerals['reasoning.effortMap'].low = 999;
    expect(first).toMatchObject({
      provider: 'openai',
      model: 'owner-a-model',
      modelParams: { temperature: 0.2 },
      ephemeralSettings: {
        'auth-key-name': 'owner-a-key',
        'reasoning.effortMap': { low: 1024, high: 8192 },
      },
    });
    expect(JSON.stringify(first)).not.toContain('secret');
    expect(second).toMatchObject({
      provider: 'anthropic',
      model: 'owner-b-model',
      modelParams: { temperature: 0.8 },
      ephemeralSettings: { 'auth-key-name': 'owner-b-key' },
    });
  });
});
