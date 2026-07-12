/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  isOpenAICanonicalBaseURL,
  OPENAI_TRANSPORT_SELECTOR_KEYS,
  parseOpenAIModelTransport,
  resolveExplicitTransportMode,
  resolveExplicitTransportModeFromSources,
  resolveOpenAITransport,
  toOpenAIResponsesWireEffort,
} from './openaiModelPolicy.js';

describe('OPENAI_TRANSPORT_SELECTOR_KEYS @issue:2483', () => {
  it('contains all four control-plane selector keys', () => {
    expect(OPENAI_TRANSPORT_SELECTOR_KEYS.has('apiMode')).toBe(true);
    expect(OPENAI_TRANSPORT_SELECTOR_KEYS.has('responsesMode')).toBe(true);
    expect(OPENAI_TRANSPORT_SELECTOR_KEYS.has('responses-mode')).toBe(true);
    expect(OPENAI_TRANSPORT_SELECTOR_KEYS.has('openaiResponsesEnabled')).toBe(
      true,
    );
  });
});

describe('parseOpenAIModelTransport', () => {
  describe('GPT-5.6+ bare aliases (require Responses)', () => {
    it.each([
      'gpt-5.6',
      'gpt-5.6-latest',
      'gpt-5.6-20260115',
      'gpt-5.6-2026-01-15',
      'gpt-5.7',
      'gpt-5.7-latest',
      'gpt-5.7-20270115',
      'gpt-5.7-2027-01-15',
      'gpt-6.0',
      'gpt-6.0-latest',
      'gpt-6.0-20260101',
      'gpt-6.0-2026-01-01',
      'gpt-10.1',
      'gpt-10.1-latest',
    ])('requires Responses for bare %s', (model) => {
      const result = parseOpenAIModelTransport(model);
      expect(result.requiresResponses).toBe(true);
      expect(result.supportsResponses).toBe(true);
    });

    it.each([
      'gpt-5.6-mini',
      'gpt-5.6-preview',
      'gpt-5.6-rc',
      'gpt-5.6-2026011',
      'gpt-5.6-202601155',
      'gpt-5.6-latest-rc',
      'gpt-5.6-2026-13-01',
      'gpt-5.6-2026-02-30',
      'gpt-5.6-2026-00-15',
      'gpt-5.6-20261-01-15',
      'gpt-5.6-2026-1-15',
    ])(
      'rejects bare lookalikes so they do not get minimal→none mapping: %s',
      (model) => {
        const result = parseOpenAIModelTransport(model);
        expect(result.requiresResponses).toBe(false);
        expect(result.supportsResponses).toBe(false);
      },
    );

    it('does NOT require Responses for gpt-5.5', () => {
      expect(parseOpenAIModelTransport('gpt-5.5').requiresResponses).toBe(
        false,
      );
    });
  });

  describe('durable tier IDs (sol/terra/luna) with qualifiers', () => {
    it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
      'requires Responses for current tier %s',
      (model) => {
        const result = parseOpenAIModelTransport(model);
        expect(result.requiresResponses).toBe(true);
      },
    );

    it.each(['gpt-5.7-sol', 'gpt-6.0-terra', 'gpt-7.2-luna', 'gpt-10.1-sol'])(
      'requires Responses for future generation tier %s',
      (model) => {
        const result = parseOpenAIModelTransport(model);
        expect(result.requiresResponses).toBe(true);
      },
    );

    it.each([
      'gpt-5.6-sol-latest',
      'gpt-5.6-terra-20260115',
      'gpt-5.6-terra-2026-01-15',
      'gpt-7.2-luna-20270115',
      'gpt-7.2-luna-2027-01-15',
    ])(
      'accepts documented latest/compact/hyphenated snapshot qualifiers: %s',
      (model) => {
        const result = parseOpenAIModelTransport(model);
        expect(result.requiresResponses).toBe(true);
      },
    );

    it.each([
      'gpt-5.6-solar',
      'gpt-5.6-terrestrial',
      'gpt-5.6-lunar',
      'gpt-5.6-sol-preview',
      'gpt-5.6-terra-rc',
      'gpt-5.6-luna-2026011',
      'gpt-5.6-sol-2026-13-01',
      'gpt-5.6-terra-2026-02-30',
      'gpt-5.6-sol-202601155',
    ])('rejects tier lookalikes: %s', (model) => {
      expect(parseOpenAIModelTransport(model).requiresResponses).toBe(false);
    });

    it('rejects pre-5.6 tier IDs like gpt-5.4-sol', () => {
      expect(parseOpenAIModelTransport('gpt-5.4-sol').requiresResponses).toBe(
        false,
      );
    });
  });

  describe('numeric generation comparison', () => {
    it('handles 5.10 correctly (greater than 5.6)', () => {
      expect(parseOpenAIModelTransport('gpt-5.10').requiresResponses).toBe(
        true,
      );
      expect(parseOpenAIModelTransport('gpt-5.10-sol').requiresResponses).toBe(
        true,
      );
    });

    it('handles 10.x correctly', () => {
      expect(parseOpenAIModelTransport('gpt-10.1').requiresResponses).toBe(
        true,
      );
      expect(parseOpenAIModelTransport('gpt-10.1-sol').requiresResponses).toBe(
        true,
      );
    });

    it('handles 99.1 correctly', () => {
      expect(parseOpenAIModelTransport('gpt-99.1').requiresResponses).toBe(
        true,
      );
    });
  });

  describe('supports vs requires (pre-5.6 Responses-capable models)', () => {
    it.each([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4-turbo-preview',
      'gpt-4.1',
      'o3-pro',
      'o3',
      'o3-mini',
      'o1',
      'o1-mini',
    ])('supports but does NOT require Responses for %s', (model) => {
      const result = parseOpenAIModelTransport(model);
      expect(result.supportsResponses).toBe(true);
      expect(result.requiresResponses).toBe(false);
    });
  });

  describe('rejected model IDs', () => {
    it.each([
      'gpt-5.6-solar',
      'vendor-gpt-5.6-sol',
      'gpt-5.6-sol-preview',
      'something-else',
      'claude-opus-4-8',
    ])('does not require Responses for %s', (model) => {
      expect(parseOpenAIModelTransport(model).requiresResponses).toBe(false);
    });
  });
});

describe('isOpenAICanonicalBaseURL', () => {
  it.each([
    'https://api.openai.com/v1',
    'https://api.openai.com/v1/',
    'https://api.openai.com',
    'https://api.openai.com/',
  ])('returns true for canonical URL %s', (url) => {
    expect(isOpenAICanonicalBaseURL(url)).toBe(true);
  });

  it.each([
    'https://custom.openai-compatible.com/v1',
    'https://my-proxy.com/v1',
    'http://localhost:1234/v1',
    'https://chatgpt.com/backend-api/codex',
  ])('returns false for non-canonical URL %s', (url) => {
    expect(isOpenAICanonicalBaseURL(url)).toBe(false);
  });

  it.each([
    'http://api.openai.com/v1',
    'http://api.openai.com',
    'ftp://api.openai.com/v1',
  ])('returns false for non-https scheme lookalike %s', (url) => {
    expect(isOpenAICanonicalBaseURL(url)).toBe(false);
  });

  it('returns false for an explicit non-443 port on api.openai.com', () => {
    expect(isOpenAICanonicalBaseURL('https://api.openai.com:8443/v1')).toBe(
      false,
    );
  });

  it('returns true for explicit port 443 on api.openai.com', () => {
    expect(isOpenAICanonicalBaseURL('https://api.openai.com:443/v1')).toBe(
      true,
    );
  });

  it('returns false for undefined', () => {
    expect(isOpenAICanonicalBaseURL(undefined)).toBe(false);
  });
});

describe('toOpenAIResponsesWireEffort', () => {
  it.each([
    ['gpt-5.6', 'none'],
    ['gpt-5.6-sol', 'none'],
    ['gpt-5.7-terra', 'none'],
    ['gpt-6.0-luna', 'none'],
    ['gpt-5.10', 'none'],
    ['gpt-5.6-latest', 'none'],
    ['gpt-5.6-20260115', 'none'],
    ['gpt-5.6-2026-01-15', 'none'],
    ['gpt-6.0-latest', 'none'],
  ])('maps minimal to none for GPT-5.6+ model %s', (model, expected) => {
    expect(toOpenAIResponsesWireEffort('minimal', model)).toBe(expected);
  });

  it.each([
    'gpt-5.6-mini',
    'gpt-5.6-preview',
    'gpt-5.6-solar',
    'gpt-5.6-sol-preview',
    'gpt-5.6-2026011',
    'gpt-5.6-latest-rc',
    'gpt-5.6-2026-13-01',
    'gpt-5.6-2026-02-30',
  ])(
    'preserves minimal (does NOT map to none) for rejected lookalike %s',
    (model) => {
      expect(toOpenAIResponsesWireEffort('minimal', model)).toBe('minimal');
    },
  );

  it.each(['o3', 'o3-mini', 'gpt-5.5', 'gpt-5.4'])(
    'preserves minimal for pre-5.6 Responses model %s',
    (model) => {
      expect(toOpenAIResponsesWireEffort('minimal', model)).toBe('minimal');
    },
  );

  it.each(['low', 'medium', 'high', 'xhigh', 'max'])(
    'passes through non-minimal effort %s unchanged',
    (effort) => {
      expect(toOpenAIResponsesWireEffort(effort, 'gpt-5.6-sol')).toBe(effort);
    },
  );
});

const CANONICAL = 'https://api.openai.com/v1';
const CUSTOM = 'https://custom.proxy.com/v1';

describe('resolveExplicitTransportMode', () => {
  it('returns "responses" when apiMode is "responses"', () => {
    expect(
      resolveExplicitTransportMode('responses', undefined, undefined),
    ).toBe('responses');
  });

  it('is case-insensitive', () => {
    expect(
      resolveExplicitTransportMode('Responses', undefined, undefined),
    ).toBe('responses');
    expect(resolveExplicitTransportMode('CHAT', undefined, undefined)).toBe(
      'chat',
    );
  });

  it('falls back to responsesMode when apiMode is absent', () => {
    expect(
      resolveExplicitTransportMode(undefined, 'responses', undefined),
    ).toBe('responses');
  });

  it('falls back to global responses-mode when provider modes are absent', () => {
    expect(resolveExplicitTransportMode(undefined, undefined, 'chat')).toBe(
      'chat',
    );
  });

  it('apiMode takes precedence over responsesMode', () => {
    expect(resolveExplicitTransportMode('responses', 'chat', undefined)).toBe(
      'responses',
    );
  });

  it('returns undefined for unrecognized values', () => {
    expect(
      resolveExplicitTransportMode('auto', undefined, undefined),
    ).toBeUndefined();
  });

  it('returns undefined when all sources are absent', () => {
    expect(
      resolveExplicitTransportMode(undefined, undefined, undefined),
    ).toBeUndefined();
  });

  it('resolveExplicitTransportModeFromSources extracts from provider settings record', () => {
    expect(
      resolveExplicitTransportModeFromSources(
        { apiMode: 'responses' },
        () => undefined,
      ),
    ).toBe('responses');
    expect(resolveExplicitTransportModeFromSources({}, () => 'chat')).toBe(
      'chat',
    );
    expect(
      resolveExplicitTransportModeFromSources({}, () => undefined),
    ).toBeUndefined();
  });

  it('skips an invalid high-priority source and falls through to a valid lower-priority source', () => {
    // apiMode is unrecognized ('auto') — should NOT block responsesMode
    expect(resolveExplicitTransportMode('auto', 'responses', 'chat')).toBe(
      'responses',
    );
    // apiMode is whitespace-only — should NOT block responsesMode
    expect(resolveExplicitTransportMode('   ', 'chat', undefined)).toBe('chat');
  });

  it('skips invalid high-priority and falls to global responses-mode', () => {
    expect(resolveExplicitTransportMode('bogus', 'nope', 'chat')).toBe('chat');
  });

  it('chooses the first recognized mode when earlier sources are invalid', () => {
    expect(resolveExplicitTransportMode('xyz', 'responses', 'chat')).toBe(
      'responses',
    );
  });

  it('returns undefined when all sources are invalid/unrecognized', () => {
    expect(
      resolveExplicitTransportMode('auto', 'maybe', 'force'),
    ).toBeUndefined();
  });
});

describe('resolveOpenAITransport (unified decision)', () => {
  describe('auto-routing (no explicit mode)', () => {
    it('routes GPT-5.6 to Responses on canonical OpenAI', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.6',
        baseURL: CANONICAL,
        explicitMode: undefined,
        openaiResponsesEnabled: undefined,
      });
      expect(d.useResponses).toBe(true);
      expect(d.transport.requiresResponses).toBe(true);
    });

    it('keeps GPT-5.6 on Chat for custom endpoint by default', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.6',
        baseURL: CUSTOM,
        explicitMode: undefined,
        openaiResponsesEnabled: undefined,
      });
      expect(d.useResponses).toBe(false);
    });

    it('keeps GPT-5.5 on Chat by default', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.5',
        baseURL: CANONICAL,
        explicitMode: undefined,
        openaiResponsesEnabled: undefined,
      });
      expect(d.useResponses).toBe(false);
    });
  });

  describe('explicit "responses" mode', () => {
    it('forces Responses even on custom endpoint', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.6',
        baseURL: CUSTOM,
        explicitMode: 'responses',
        openaiResponsesEnabled: undefined,
      });
      expect(d.useResponses).toBe(true);
    });

    it('forces Responses for supports-only model on canonical', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.5',
        baseURL: CANONICAL,
        explicitMode: 'responses',
        openaiResponsesEnabled: undefined,
      });
      expect(d.useResponses).toBe(true);
    });
  });

  describe('explicit "chat" mode', () => {
    it('keeps GPT-5.5 on Chat', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.5',
        baseURL: CANONICAL,
        explicitMode: 'chat',
        openaiResponsesEnabled: undefined,
      });
      expect(d.useResponses).toBe(false);
    });

    it('cannot force GPT-5.6 to Chat on canonical (impossible override ignored)', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.6',
        baseURL: CANONICAL,
        explicitMode: 'chat',
        openaiResponsesEnabled: undefined,
      });
      expect(d.useResponses).toBe(true);
    });

    it('forces GPT-5.6 to Chat on custom endpoint (Chat available there)', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.6',
        baseURL: CUSTOM,
        explicitMode: 'chat',
        openaiResponsesEnabled: undefined,
      });
      expect(d.useResponses).toBe(false);
    });
  });

  describe('openaiResponsesEnabled on custom endpoint', () => {
    it('enables Responses for GPT-5.6 on custom endpoint', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.6',
        baseURL: CUSTOM,
        explicitMode: undefined,
        openaiResponsesEnabled: true,
      });
      expect(d.useResponses).toBe(true);
    });

    it('enables Responses for supports-only model on custom endpoint', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.5',
        baseURL: CUSTOM,
        explicitMode: undefined,
        openaiResponsesEnabled: true,
      });
      expect(d.useResponses).toBe(true);
    });

    it('does NOT enable Responses for unknown models', () => {
      const d = resolveOpenAITransport({
        model: 'some-random-model',
        baseURL: CUSTOM,
        explicitMode: undefined,
        openaiResponsesEnabled: true,
      });
      expect(d.useResponses).toBe(false);
    });
  });

  describe('precedence', () => {
    it('explicit "responses" beats openaiResponsesEnabled=false', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.5',
        baseURL: CUSTOM,
        explicitMode: 'responses',
        openaiResponsesEnabled: false,
      });
      expect(d.useResponses).toBe(true);
    });

    it('explicit "chat" beats openaiResponsesEnabled=true on custom endpoint', () => {
      const d = resolveOpenAITransport({
        model: 'gpt-5.5',
        baseURL: CUSTOM,
        explicitMode: 'chat',
        openaiResponsesEnabled: true,
      });
      expect(d.useResponses).toBe(false);
    });
  });
});
