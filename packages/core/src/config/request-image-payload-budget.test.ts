/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config } from './config.js';
import { DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES } from './configTypes.js';

interface BudgetDeclaration {
  readonly imagePayloadBudgetBytes?: number;
  readonly initialSettings?: Readonly<Record<string, unknown>>;
}

function configWith(declaration: BudgetDeclaration): Config {
  return new Config({
    sessionId: 'request-image-payload-budget',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'declared-model',
    provider: 'anthropic',
    debugMode: false,
    ...declaration,
  });
}

describe('request image payload budget override', () => {
  it('is absent when no budget was declared while tool batches keep the 15 MiB default', () => {
    const config = configWith({});
    expect([
      config.getRequestImagePayloadBudgetOverrideBytes(),
      config.getImagePayloadBudgetBytes(),
    ]).toStrictEqual([undefined, DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES]);
  });

  it('reports an explicit 15 MiB setting as an override', () => {
    const config = configWith({
      initialSettings: {
        'image-payload-budget-bytes': DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
      },
    });
    expect(config.getRequestImagePayloadBudgetOverrideBytes()).toBe(
      DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
    );
  });

  it('reports an explicit zero setting as an override', () => {
    const config = configWith({
      initialSettings: { 'image-payload-budget-bytes': 0 },
    });
    expect(config.getRequestImagePayloadBudgetOverrideBytes()).toBe(0);
  });

  it('reports a constructor budget as an override', () => {
    const config = configWith({ imagePayloadBudgetBytes: 12_000_000 });
    expect(config.getRequestImagePayloadBudgetOverrideBytes()).toBe(12_000_000);
  });

  it('reports a constructor explicit 15 MiB as an override', () => {
    const config = configWith({
      imagePayloadBudgetBytes: DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
    });
    expect(config.getRequestImagePayloadBudgetOverrideBytes()).toBe(
      DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
    );
  });

  it('prefers the settings value over the constructor value like the tool-batch getter', () => {
    const config = configWith({
      imagePayloadBudgetBytes: 12_000_000,
      initialSettings: { 'image-payload-budget-bytes': 20_000_000 },
    });
    expect(config.getRequestImagePayloadBudgetOverrideBytes()).toBe(20_000_000);
  });

  it('treats an invalid constructor budget as absent', () => {
    const config = configWith({ imagePayloadBudgetBytes: -1 });
    expect(config.getRequestImagePayloadBudgetOverrideBytes()).toBeUndefined();
  });
});
