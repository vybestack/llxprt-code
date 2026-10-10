/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createRuntimeInvocationContext } from './RuntimeInvocationContext.js';

describe('invocation model parameter data', () => {
  it('rejects owner-shaped objects instead of turning their enumerable state into request policy', () => {
    class PolicyOwner {
      model = 'mutable';
      replaceModel(model: string): void {
        this.model = model;
      }
    }
    expect(() =>
      createRuntimeInvocationContext({
        runtimeId: 'owner-shaped-policy',
        providerName: 'openai',
        ephemeralsSnapshot: { openai: new PolicyOwner() },
      }),
    ).toThrow(
      'Invocation policy at ephemerals.openai must contain only plain data',
    );
  });

  it('rejects accessor-backed owner values without executing the getter', () => {
    const policy = Object.defineProperty({}, 'endpoint', {
      enumerable: true,
      get() {
        throw new Error('owner getter executed');
      },
    });
    expect(() =>
      createRuntimeInvocationContext({
        runtimeId: 'accessor-policy',
        providerName: 'openai',
        ephemeralsSnapshot: { openai: policy },
      }),
    ).toThrow(
      'Invocation policy at ephemerals.openai.endpoint contains an accessor',
    );
  });

  it('rejects cyclic policy instead of recursing into an owner graph', () => {
    const policy: Record<string, unknown> = {};
    policy['self'] = policy;
    expect(() =>
      createRuntimeInvocationContext({
        runtimeId: 'cyclic-policy',
        providerName: 'openai',
        ephemeralsSnapshot: { openai: policy },
      }),
    ).toThrow('Cyclic invocation policy at ephemerals.openai.self');
  });

  it('owns admitted parameter data without accepting a provider route or owner', () => {
    const parameters = {
      temperature: 0.7,
      response_format: { type: 'json_object' },
    };
    const invocation = createRuntimeInvocationContext({
      runtimeId: 'parameter-data',
      providerName: 'openai',
      modelParamsProviderName: 'openai',
      modelParams: parameters,
      ephemeralsSnapshot: { temperature: 0.2 },
    });
    parameters.temperature = 0.9;
    parameters.response_format.type = 'text';
    expect(invocation.modelParams).toStrictEqual({
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });
    expect(Object.isFrozen(parameters.response_format)).toBe(false);
  });

  it('rejects parameter data admitted for another provider', () => {
    expect(() =>
      createRuntimeInvocationContext({
        runtimeId: 'parameter-data',
        providerName: 'anthropic',
        modelParamsProviderName: 'openai',
        modelParams: { temperature: 0.7 },
        ephemeralsSnapshot: {},
      }),
    ).toThrow('Admitted model parameters belong to openai, not anthropic');
  });
  it('reads nested dotted policy without inherited prototype values and flat keys take precedence', () => {
    const invocation = createRuntimeInvocationContext({
      runtimeId: 'nested-read',
      providerName: 'openai',
      ephemeralsSnapshot: {
        reasoning: { enabled: true },
        'reasoning.enabled': false,
      },
    });
    expect(invocation.getEphemeral<boolean>('reasoning.enabled')).toBe(false);
    expect(invocation.getEphemeral('reasoning.toString')).toBeUndefined();
    const nested = createRuntimeInvocationContext({
      runtimeId: 'nested-read',
      providerName: 'openai',
      ephemeralsSnapshot: { reasoning: { enabled: true } },
    });
    expect(nested.getEphemeral<boolean>('reasoning.enabled')).toBe(true);
  });
  for (const forbidden of [() => 'owner', Symbol('owner'), BigInt(1)]) {
    it(`rejects ${typeof forbidden} policy capabilities before snapshotting`, () => {
      expect(() =>
        createRuntimeInvocationContext({
          runtimeId: 'invalid-capability',
          providerName: 'openai',
          ephemeralsSnapshot: { openai: { invalid: forbidden } },
        }),
      ).toThrow('only data values');
    });
  }
});
