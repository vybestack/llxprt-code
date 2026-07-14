/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { applyTemplateToInitialMessages } from '../executor-prompt-builder.js';
import { templateString } from '../utils.js';
import { getRecoveryWarningMessage } from '../recovery.js';
import { AgentTerminateMode } from '../types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * @plan PLAN-20260707-AGENTNEUTRAL.P24
 * @requirement REQ-005.5b
 *
 * Characterization tests for executor behavior.
 * These pin OBSERVABLE behavior (templated text content, recovery message
 * content, system prompt structure) so the neutral retype preserves it.
 */

// ─── Helpers ───────────────────────────────────────────────

/** Extract all text from a neutral IContent. */
function extractTextFromContent(content: IContent): string {
  return content.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('');
}

/** Extract text from any result shape. */
function extractAllText(results: IContent[]): string[] {
  return results.map(extractTextFromContent);
}

const UNSAFE_TEMPLATE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isSafeTemplateKey(value: string): boolean {
  return (
    /^\w+$/.test(value) && value.length > 0 && !UNSAFE_TEMPLATE_KEYS.has(value)
  );
}

// ─── Tests ─────────────────────────────────────────────────

describe('executorRun.characterization — template application', () => {
  it('substitutes single placeholder in initial message text', () => {
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello ${name}!' }],
      },
    ];
    const result = applyTemplateToInitialMessages(messages, { name: 'World' });
    expect(extractAllText(result)).toStrictEqual(['Hello World!']);
  });

  it('substitutes multiple placeholders in a single part', () => {
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: '${greeting}, ${name}. You have ${count} tasks.',
          },
        ],
      },
    ];
    const result = applyTemplateToInitialMessages(messages, {
      greeting: 'Hi',
      name: 'Agent',
      count: 3,
    });
    expect(extractAllText(result)).toStrictEqual([
      'Hi, Agent. You have 3 tasks.',
    ]);
  });

  it('preserves message count and speaker', () => {
    const messages: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: '${a}' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: '${b}' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: '${c}' }] },
    ];
    const result = applyTemplateToInitialMessages(messages, {
      a: '1',
      b: '2',
      c: '3',
    });
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.speaker)).toStrictEqual([
      'human',
      'ai',
      'human',
    ]);
  });

  it('handles multiple text blocks within a single message', () => {
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: '${first} ' },
          { type: 'text', text: '${second}' },
        ],
      },
    ];
    const result = applyTemplateToInitialMessages(messages, {
      first: 'Hello',
      second: 'World',
    });
    expect(extractAllText(result)).toStrictEqual(['Hello World']);
  });

  it('passes through non-text blocks unchanged', () => {
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: '${msg}' },
          {
            type: 'media',
            mediaType: 'image/png',
            data: 'base64data',
          },
        ],
      },
    ];
    const result = applyTemplateToInitialMessages(messages, { msg: 'analyze' });
    const nonTextBlock = result[0]?.blocks.find((b) => b.type !== 'text');
    expect(nonTextBlock).toBeDefined();
    expect(nonTextBlock?.type).toBe('media');
  });

  it('handles empty initial messages array', () => {
    const result = applyTemplateToInitialMessages([], { key: 'val' });
    expect(result).toStrictEqual([]);
  });

  it('handles message with no blocks', () => {
    const messages: IContent[] = [{ speaker: 'human', blocks: [] }];
    const result = applyTemplateToInitialMessages(messages, {});
    expect(result).toHaveLength(1);
    expect(result[0]?.blocks).toStrictEqual([]);
  });
});

// ─── Property-based tests ──────────────────────────────────

describe('executorRun.characterization — property-based template', () => {
  it('P: for any placeholder→value mapping, substitution yields correct text', () => {
    fc.assert(
      fc.property(
        fc.record({
          key: fc.string().filter(isSafeTemplateKey),
          value: fc.string(),
        }),
        ({ key, value }) => {
          const messages: IContent[] = [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: `\${${key}}` }],
            },
          ];
          const result = applyTemplateToInitialMessages(messages, {
            [key]: value,
          });
          return extractTextFromContent(result[0]) === value;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('P: substitution is deterministic — same inputs always yield same output', () => {
    fc.assert(
      fc.property(
        fc.record({
          template: fc.string(),
          inputs: fc.dictionary(
            fc.string().filter((s) => /^\w+$/.test(s) && s.length > 0),
            fc.string(),
          ),
        }),
        ({ template, inputs }) => {
          const placeholderKeys = Array.from(
            template.matchAll(/\$\{(\w+)\}/g),
            (m) => m[1],
          );
          const allKeysPresent = placeholderKeys.every((k) =>
            Object.keys(inputs).includes(k),
          );
          if (!allKeysPresent) return true;

          const r1 = templateString(template, inputs);
          const r2 = templateString(template, inputs);
          return r1 === r2;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('P: template with N distinct placeholders substitutes all of them', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.string().filter((s) => isSafeTemplateKey(s) && s.length <= 10),
          { minLength: 1, maxLength: 5 },
        ),
        fc.uniqueArray(fc.string(), { minLength: 1, maxLength: 5 }),
        (keys, values) => {
          const inputs: Record<string, string> = {};
          const templateParts: string[] = [];
          keys.forEach((k, i) => {
            inputs[k] = values[i] ?? 'default';
            templateParts.push(`\${${k}}`);
          });
          const template = templateParts.join('|');

          const messages: IContent[] = [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: template }],
            },
          ];
          const result = applyTemplateToInitialMessages(messages, inputs);
          const text = extractTextFromContent(result[0]);

          return keys.every((k) => text.includes(inputs[k]));
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ─── Recovery warning message ──────────────────────────────

describe('executorRun.characterization — recovery warning', () => {
  it('produces human-speaker message with text block for protocol violation', () => {
    const msg = getRecoveryWarningMessage(
      AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
    );
    expect(msg.speaker).toBe('human');
    expect(msg.blocks).toHaveLength(1);
    expect(msg.blocks[0]?.type).toBe('text');
  });

  it('protocol violation message mentions complete_task', () => {
    const msg = getRecoveryWarningMessage(
      AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
    );
    const text = (msg.blocks[0] as { text: string }).text;
    expect(text).toContain('complete_task');
    expect(text).toContain('WARNING');
    expect(text).toContain('final turn');
  });

  it('limit-reached message mentions the limit reason', () => {
    const msg = getRecoveryWarningMessage(AgentTerminateMode.TIMEOUT);
    const text = (msg.blocks[0] as { text: string }).text;
    expect(text).toContain('TIMEOUT');
    expect(text).toContain('WARNING');
    expect(text).toContain('complete_task');
  });

  it('recovery message always contains both prefix and suffix', () => {
    const reasons = [
      AgentTerminateMode.TIMEOUT,
      AgentTerminateMode.MAX_TURNS,
      AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      AgentTerminateMode.ERROR,
    ];
    for (const reason of reasons) {
      const msg = getRecoveryWarningMessage(reason);
      const text = (msg.blocks[0] as { text: string }).text;
      expect(text).toMatch(/^WARNING/);
      expect(text).toContain('complete_task');
      expect(text).toContain('final turn');
    }
  });
});

// ─── System prompt builder (deferred to integration test — requires real Config) ───
