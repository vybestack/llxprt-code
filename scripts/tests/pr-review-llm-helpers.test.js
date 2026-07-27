/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the issue #2742 hardening: retry-on-parse-failure, raw-response
 * diagnostics capture, and graceful-degradation support helpers extracted
 * into scripts/pr-review-llm-helpers.mjs.
 */

import { describe, it, expect } from 'vitest';
import {
  isParseError,
  runLlxprtPromptWithParse,
  DEFAULT_MAX_TOKENS,
  DEFAULT_CONTEXT_LIMIT,
  saveParseFailureArtifact,
} from '../pr-review-llm-helpers.mjs';
import {
  parseMapResponse,
  mapWithConcurrency,
} from '../pr-review-walkthrough.mjs';

describe('isParseError', () => {
  it('recognizes the "Cannot parse JSON from response" error', () => {
    expect(isParseError(new Error('Cannot parse JSON from response'))).toBe(
      true,
    );
  });

  it('recognizes the "Empty response: cannot parse JSON" error', () => {
    expect(isParseError(new Error('Empty response: cannot parse JSON'))).toBe(
      true,
    );
  });

  it('recognizes map/group validation errors as parse errors', () => {
    expect(
      isParseError(
        new Error('Invalid map response: missing summary or triage'),
      ),
    ).toBe(true);
    expect(
      isParseError(new Error('Invalid group response: themes is not an array')),
    ).toBe(true);
  });

  it('does not classify a network error as a parse error', () => {
    expect(isParseError(new Error('HTTP 429 rate limit'))).toBe(false);
  });

  it('does not classify a generic error as a parse error', () => {
    expect(isParseError(new Error('something else went wrong'))).toBe(false);
  });

  it('handles non-Error values without throwing', () => {
    expect(isParseError(null)).toBe(false);
    expect(isParseError(undefined)).toBe(false);
    expect(isParseError('string error')).toBe(false);
    expect(isParseError(42)).toBe(false);
  });
});

describe('runLlxprtPromptWithParse', () => {
  it('returns the parsed result when the LLM succeeds on the first try', async () => {
    const llm = async () =>
      '{"summary":"ok","signature":"foo()","triage":"fix"}';
    const result = await runLlxprtPromptWithParse(llm, parseMapResponse, {
      maxRetries: 2,
    });
    expect(result).toEqual({
      summary: 'ok',
      signature: 'foo()',
      triage: 'fix',
    });
  });

  it('retries when the first LLM response is unparseable and the second succeeds', async () => {
    let calls = 0;
    const llm = async () => {
      calls += 1;
      if (calls === 1) {
        return 'this is not json at all';
      }
      return '{"summary":"ok","signature":"foo()","triage":"fix"}';
    };
    const result = await runLlxprtPromptWithParse(llm, parseMapResponse, {
      maxRetries: 2,
      delayMs: () => 1,
    });
    expect(calls).toBe(2);
    expect(result.summary).toBe('ok');
  });

  it('throws after exhausting retries when all responses are unparseable', async () => {
    const llm = async () => 'garbage response';
    await expect(
      runLlxprtPromptWithParse(llm, parseMapResponse, {
        maxRetries: 1,
        delayMs: () => 1,
      }),
    ).rejects.toThrow('Cannot parse JSON from response');
  });

  it('does NOT retry on non-parse, non-retryable errors (e.g. auth)', async () => {
    let calls = 0;
    const llm = async () => {
      calls += 1;
      throw Object.assign(new Error('HTTP 401 unauthorized'), {
        code: 'HTTP_401',
      });
    };
    await expect(
      runLlxprtPromptWithParse(llm, parseMapResponse, {
        maxRetries: 2,
        delayMs: () => 1,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('retries on retryable network errors (e.g. 429) then succeeds', async () => {
    let calls = 0;
    const llm = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('HTTP 429 rate limit');
      }
      return '{"summary":"ok","signature":"foo()","triage":"fix"}';
    };
    const result = await runLlxprtPromptWithParse(llm, parseMapResponse, {
      maxRetries: 2,
      delayMs: () => 1,
    });
    expect(calls).toBe(2);
    expect(result.summary).toBe('ok');
  });

  it('passes the raw response to the parse-failure artifact saver on final failure', async () => {
    const llm = async () => 'totally not json';
    let savedRaw = null;
    let savedPhase = null;
    const saveFn = async (phase, raw) => {
      savedRaw = raw;
      savedPhase = phase;
    };
    await expect(
      runLlxprtPromptWithParse(llm, parseMapResponse, {
        maxRetries: 1,
        delayMs: () => 1,
        phase: 'map',
        saveParseFailure: saveFn,
      }),
    ).rejects.toThrow();
    expect(savedRaw).toBe('totally not json');
    expect(savedPhase).toBe('map');
  });

  it('does not call saveParseFailure when the LLM succeeds', async () => {
    const llm = async () =>
      '{"summary":"ok","signature":"foo()","triage":"fix"}';
    let saved = false;
    const saveFn = async () => {
      saved = true;
    };
    await runLlxprtPromptWithParse(llm, parseMapResponse, {
      maxRetries: 1,
      delayMs: () => 1,
      phase: 'map',
      saveParseFailure: saveFn,
    });
    expect(saved).toBe(false);
  });

  it('respects maxRetries=0 (no retries, single attempt)', async () => {
    let calls = 0;
    const llm = async () => {
      calls += 1;
      return 'garbage';
    };
    await expect(
      runLlxprtPromptWithParse(llm, parseMapResponse, {
        maxRetries: 0,
        delayMs: () => 1,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('DEFAULT_MAX_TOKENS and DEFAULT_CONTEXT_LIMIT', () => {
  it('exports a DEFAULT_MAX_TOKENS constant greater than 4000', () => {
    expect(typeof DEFAULT_MAX_TOKENS).toBe('number');
    expect(DEFAULT_MAX_TOKENS).toBeGreaterThan(4000);
  });

  it('exports a DEFAULT_CONTEXT_LIMIT constant that is a positive number', () => {
    expect(typeof DEFAULT_CONTEXT_LIMIT).toBe('number');
    expect(DEFAULT_CONTEXT_LIMIT).toBeGreaterThan(0);
  });

  it('DEFAULT_MAX_TOKENS is 16384 (16k — large enough for JSON walkthrough output without being wasteful)', () => {
    expect(DEFAULT_MAX_TOKENS).toBe(16384);
  });
});

describe('saveParseFailureArtifact', () => {
  it('writes raw response and phase to a file in the review directory', async () => {
    const os = await import('node:os');
    const nodeFs = await import('node:fs');
    const pathMod = (await import('node:path')).default;
    const reviewDir = pathMod.join(
      os.tmpdir(),
      `test-parse-failure-${Date.now()}`,
    );
    await nodeFs.promises.mkdir(reviewDir, { recursive: true });
    try {
      await saveParseFailureArtifact(reviewDir, 'map', 'not valid json', {
        promptLength: 500,
      });
      // Filename now includes a unique suffix to avoid concurrent overwrites.
      const files = await nodeFs.promises.readdir(reviewDir);
      const rawFile = files.find((f) => f.startsWith('parse-failure-raw-map-'));
      const infoFile = files.find((f) => f.startsWith('parse-failure-info-'));
      expect(rawFile, 'raw artifact should exist').toBeTruthy();
      expect(infoFile, 'info artifact should exist').toBeTruthy();
      const rawContent = await nodeFs.promises.readFile(
        pathMod.join(reviewDir, rawFile),
        'utf8',
      );
      const infoContent = JSON.parse(
        await nodeFs.promises.readFile(
          pathMod.join(reviewDir, infoFile),
          'utf8',
        ),
      );
      expect(rawContent).toBe('not valid json');
      expect(infoContent.phase).toBe('map');
      expect(infoContent.promptLength).toBe(500);
    } finally {
      await nodeFs.promises
        .rm(reviewDir, { recursive: true })
        .catch((e) => console.error('test cleanup failed', e));
    }
  });
});

describe('graceful degradation (issue #2742)', () => {
  it('mapWithConcurrency returns error objects when the mapper throws', async () => {
    const items = [
      { filePath: 'a.ts', diff: 'diff content' },
      { filePath: 'b.ts', diff: 'diff content' },
    ];
    const results = await mapWithConcurrency(items, 3, async (_item) => {
      throw new Error('Cannot parse JSON from response');
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty('error');
    expect(results[1]).toHaveProperty('error');
    const summaries = results.map((r) =>
      'error' in r
        ? {
            filePath: r.filePath,
            summary: `(failed: ${r.error})`,
            signature: '',
            triage: 'chore',
          }
        : r,
    );
    expect(summaries).toHaveLength(2);
    expect(summaries[0].triage).toBe('chore');
    expect(summaries[0].summary).toContain('Cannot parse JSON');
  });
});
