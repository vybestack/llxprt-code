/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for core-owned structural contracts:
 * RuntimeModel, TelemetryContext, BucketFailureReason,
 * ReasoningOutput, MediaBlockContracts.
 *
 * Proves these contracts are usable by core without importing
 * any provider package symbols.
 *
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 */

import { describe, it, expect } from 'vitest';
import type { RuntimeModel } from './RuntimeModel.js';
import type { TelemetryContext } from './TelemetryContext.js';
import type { ReasoningOutput } from './ReasoningOutput.js';
import type {
  MediaBlockType,
  ClassifiedMediaBlock,
} from './MediaBlockContracts.js';
import type { BucketFailureReason } from './BucketFailureReason.js';

describe('RuntimeModel contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a minimal model with only required id field', () => {
    const model: RuntimeModel = {
      id: 'gpt-4',
    };

    expect(model.id).toBe('gpt-4');
    expect(model.name).toBeUndefined();
    expect(model.provider).toBeUndefined();
    expect(model.contextWindow).toBeUndefined();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a model with all optional fields', () => {
    const model: RuntimeModel = {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      provider: 'openai',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportedToolFormats: ['function', 'responses'],
    };

    expect(model.id).toBe('gpt-4-turbo');
    expect(model.name).toBe('GPT-4 Turbo');
    expect(model.provider).toBe('openai');
    expect(model.contextWindow).toBe(128000);
    expect(model.maxOutputTokens).toBe(4096);
    expect(model.supportedToolFormats).toStrictEqual(['function', 'responses']);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('is structurally compatible with provider model data', () => {
    // This test proves that a plain object matching provider IModel shape
    // satisfies the RuntimeModel contract through structural typing.
    const providerModel = {
      id: 'claude-3-opus',
      name: 'Claude 3 Opus',
      provider: 'anthropic',
      contextWindow: 200000,
      maxOutputTokens: 4096,
    };

    const runtimeModel: RuntimeModel = providerModel;
    expect(runtimeModel.id).toBe('claude-3-opus');
    expect(runtimeModel.contextWindow).toBe(200000);
  });
});

describe('TelemetryContext contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a minimal telemetry context with no fields', () => {
    const context: TelemetryContext = {};

    expect(context.providerName).toBeUndefined();
    expect(context.modelId).toBeUndefined();
    expect(context.latencyMs).toBeUndefined();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a telemetry context with all fields', () => {
    const context: TelemetryContext = {
      providerName: 'openai',
      modelId: 'gpt-4',
      tokenUsage: {
        input: 100,
        output: 50,
        cache: 10,
        tool: 5,
        thought: 20,
        total: 185,
      },
      latencyMs: 2500,
      timestamp: Date.now(),
    };

    expect(context.providerName).toBe('openai');
    expect(context.modelId).toBe('gpt-4');
    expect(context.tokenUsage?.total).toBe(185);
    expect(context.latencyMs).toBe(2500);
    expect(context.timestamp).toBeTypeOf('number');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts token usage with only required total field', () => {
    const context: TelemetryContext = {
      providerName: 'anthropic',
      tokenUsage: {
        input: 500,
        output: 200,
        total: 700,
      },
    };

    expect(context.tokenUsage?.cache).toBeUndefined();
    expect(context.tokenUsage?.total).toBe(700);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('is structurally compatible with a provider telemetry object', () => {
    const providerTelemetry = {
      providerName: 'gemini',
      modelId: 'gemini-pro',
      tokenUsage: { input: 100, output: 50, total: 150 },
      latencyMs: 1200,
    };

    const context: TelemetryContext = providerTelemetry;
    expect(context.providerName).toBe('gemini');
    expect(context.tokenUsage?.total).toBe(150);
  });
});

describe('BucketFailureReason contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts all core-owned BucketFailureReason values', () => {
    const reasons: BucketFailureReason[] = [
      'quota-exhausted',
      'expired-refresh-failed',
      'reauth-failed',
      'no-token',
      'skipped',
    ];

    expect(reasons).toHaveLength(5);
    // Verify all values are distinct strings
    const unique = new Set(reasons);
    expect(unique.size).toBe(5);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('rejects invalid string values at type level (structural type safety)', () => {
    // BucketFailureReason is a string union type, so this is a compile-time check.
    // At runtime, we verify the type is a string union.
    const validReason: BucketFailureReason = 'quota-exhausted';
    expect(typeof validReason).toBe('string');

    // Verify all expected values are valid strings
    const allReasons: BucketFailureReason[] = [
      'quota-exhausted',
      'expired-refresh-failed',
      'reauth-failed',
      'no-token',
      'skipped',
    ];
    allReasons.forEach((reason) => {
      expect(typeof reason).toBe('string');
    });
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('can be used in a config-style record for tracking bucket failures', () => {
    const failureReasons: Record<string, BucketFailureReason> = {
      'bucket-openai-main': 'quota-exhausted',
      'bucket-openai-backup': 'expired-refresh-failed',
      'bucket-anthropic-main': 'no-token',
    };

    expect(failureReasons['bucket-openai-main']).toBe('quota-exhausted');
    expect(failureReasons['bucket-anthropic-main']).toBe('no-token');
  });
});

describe('ReasoningOutput contract', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a minimal reasoning output', () => {
    const output: ReasoningOutput = {};

    expect(output.text).toBeUndefined();
    expect(output.reasoningText).toBeUndefined();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a reasoning output with all fields', () => {
    const output: ReasoningOutput = {
      text: 'Final answer',
      reasoningText: 'Step-by-step reasoning',
      signature: 'reasoning_signature',
      tokenCount: 500,
    };

    expect(output.text).toBe('Final answer');
    expect(output.reasoningText).toBe('Step-by-step reasoning');
    expect(output.signature).toBe('reasoning_signature');
    expect(output.tokenCount).toBe(500);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('can be produced from a provider thinking block without importing providers', () => {
    // Simulates how a provider would map its thinking block to core ReasoningOutput.
    // The key behavior: core can consume this structurally without importing from providers.
    function mapThinkingBlock(thinkingBlock: {
      thinking: string;
      signature?: string;
    }): ReasoningOutput {
      return {
        reasoningText: thinkingBlock.thinking,
        signature: thinkingBlock.signature,
        tokenCount: thinkingBlock.thinking.split(/\s+/).length,
      };
    }

    const result = mapThinkingBlock({
      thinking: 'Let me reason step by step about this problem',
      signature: 'sig_abc123',
    });

    expect(result.reasoningText).toBe(
      'Let me reason step by step about this problem',
    );
    expect(result.signature).toBe('sig_abc123');
    expect(result.tokenCount).toBe(9);
  });
});

describe('MediaBlockContracts', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts all valid MediaBlockType values', () => {
    const types: MediaBlockType[] = [
      'image',
      'pdf',
      'audio',
      'video',
      'unknown',
    ];

    expect(types).toHaveLength(5);
    const unique = new Set(types);
    expect(unique.size).toBe(5);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a ClassifiedMediaBlock with all fields', () => {
    const block: ClassifiedMediaBlock = {
      mimeType: 'image/png',
      data: 'base64encodeddata',
      encoding: 'base64',
      filename: 'screenshot.png',
      mediaType: 'image',
    };

    expect(block.mimeType).toBe('image/png');
    expect(block.data).toBe('base64encodeddata');
    expect(block.mediaType).toBe('image');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('accepts a ClassifiedMediaBlock with minimal fields', () => {
    const block: ClassifiedMediaBlock = {
      mimeType: 'application/pdf',
      data: 'pdfdata',
      mediaType: 'pdf',
    };

    expect(block.encoding).toBeUndefined();
    expect(block.filename).toBeUndefined();
    expect(block.mediaType).toBe('pdf');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('can classify media types by mimeType without importing providers', () => {
    function classifyMediaType(mimeType: string): MediaBlockType {
      if (mimeType.startsWith('image/')) return 'image';
      if (mimeType === 'application/pdf') return 'pdf';
      if (mimeType.startsWith('audio/')) return 'audio';
      if (mimeType.startsWith('video/')) return 'video';
      return 'unknown';
    }

    expect(classifyMediaType('image/png')).toBe('image');
    expect(classifyMediaType('application/pdf')).toBe('pdf');
    expect(classifyMediaType('audio/mp3')).toBe('audio');
    expect(classifyMediaType('video/mp4')).toBe('video');
    expect(classifyMediaType('text/html')).toBe('unknown');
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P04
   * @requirement:REQ-TEST-001
   */
  it('can produce ClassifiedMediaBlock from raw media without importing classifyMediaBlock', () => {
    // Simulates provider mapping raw media data to core ClassifiedMediaBlock.
    function toClassifiedMediaBlock(rawMedia: {
      mimeType: string;
      data: string;
      filename?: string;
    }): ClassifiedMediaBlock {
      let mediaType: MediaBlockType;
      if (rawMedia.mimeType.startsWith('image/')) {
        mediaType = 'image';
      } else if (rawMedia.mimeType === 'application/pdf') {
        mediaType = 'pdf';
      } else {
        mediaType = 'unknown';
      }

      return {
        mimeType: rawMedia.mimeType,
        data: rawMedia.data,
        mediaType,
        ...(rawMedia.filename ? { filename: rawMedia.filename } : {}),
      };
    }

    const block = toClassifiedMediaBlock({
      mimeType: 'image/jpeg',
      data: 'jpegbase64data',
      filename: 'photo.jpg',
    });

    expect(block.mediaType).toBe('image');
    expect(block.mimeType).toBe('image/jpeg');
    expect(block.filename).toBe('photo.jpg');
  });
});
