/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { AgentConfigSchema } from './config-schema.js';

describe('AgentConfigSchema telemetry', () => {
  it.each(['target', 'otlpEndpoint'])(
    'rejects removed destination property %s',
    (property) => {
      const result = AgentConfigSchema.safeParse({
        provider: 'openai',
        model: 'test-model',
        telemetry: { [property]: 'remote' },
      });

      expect(result.success).toBe(false);
    },
  );

  it('accepts supported local telemetry settings', () => {
    const result = AgentConfigSchema.safeParse({
      provider: 'openai',
      model: 'test-model',
      telemetry: {
        enabled: true,
        logPrompts: false,
        outfile: '/tmp/telemetry.jsonl',
        redactSensitiveData: true,
      },
    });

    expect(result.success).toBe(true);
  });
});
