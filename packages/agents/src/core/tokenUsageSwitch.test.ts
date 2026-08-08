/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3130 slice 5 (AC-7): provider and model switches appear as typed
 * lifecycle records in the same JSONL stream.
 *
 * A switch is detected by observing which provider/model actually served each
 * send, so the record describes the change that affected billing rather than
 * the settings mutation that requested it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import { recordProviderOrModelSwitch } from './tokenUsageEstimateLogger.js';
import { parseTokenUsageLogRecord } from './tokenUsageRecords.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';

const SESSION_ID = 'switch-session';

function makeTempLogPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-switch-')),
    'usage.jsonl',
  );
}

function readRecords(filePath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) return [];
  return raw.split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
}

function stateFor(provider: string, model: string): AgentRuntimeState {
  return createAgentRuntimeState({
    runtimeId: 'runtime-switch',
    provider,
    model,
    sessionId: SESSION_ID,
  });
}

describe('token-usage provider/model switch records (issue #3130)', () => {
  let logFile: string;
  let history: HistoryService;

  beforeEach(() => {
    logFile = makeTempLogPath();
    history = new HistoryService();
  });

  afterEach(() => {
    fs.rmSync(path.dirname(logFile), { recursive: true, force: true });
  });

  it('writes nothing for the first send of a session', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    await recordProviderOrModelSwitch(
      logger,
      stateFor('anthropic', 'claude-opus-5'),
      history,
    );
    expect(readRecords(logFile)).toHaveLength(0);
  });

  it('writes nothing when the same provider and model serve again', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    const state = stateFor('anthropic', 'claude-opus-5');
    await recordProviderOrModelSwitch(logger, state, history);
    await recordProviderOrModelSwitch(logger, state, history);
    expect(readRecords(logFile)).toHaveLength(0);
  });

  it('records a model_switch when the model changes under one provider', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    await recordProviderOrModelSwitch(
      logger,
      stateFor('anthropic', 'claude-opus-5'),
      history,
    );
    await recordProviderOrModelSwitch(
      logger,
      stateFor('anthropic', 'claude-fable-5'),
      history,
    );

    const records = readRecords(logFile);
    expect(records).toHaveLength(1);
    const parsed = parseTokenUsageLogRecord(records[0]);
    expect(parsed?.record_type).toBe('model_switch');
    if (parsed?.record_type === 'model_switch') {
      expect(parsed.from_model).toBe('claude-opus-5');
      expect(parsed.to_model).toBe('claude-fable-5');
      expect(parsed.provider).toBe('anthropic');
      expect(parsed.session_id).toBe(SESSION_ID);
    }
  });

  it('records a provider_switch when the provider changes', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    await recordProviderOrModelSwitch(
      logger,
      stateFor('anthropic', 'claude-opus-5'),
      history,
    );
    await recordProviderOrModelSwitch(
      logger,
      stateFor('codex', 'gpt-5.6-sol'),
      history,
    );

    const records = readRecords(logFile);
    expect(records).toHaveLength(1);
    const parsed = parseTokenUsageLogRecord(records[0]);
    expect(parsed?.record_type).toBe('provider_switch');
    if (parsed?.record_type === 'provider_switch') {
      expect(parsed.from_provider).toBe('anthropic');
      expect(parsed.to_provider).toBe('codex');
      expect(parsed.from_model).toBe('claude-opus-5');
      expect(parsed.to_model).toBe('gpt-5.6-sol');
    }
  });

  it('records each switch once, not once per subsequent send', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    const anthropic = stateFor('anthropic', 'claude-opus-5');
    const codex = stateFor('codex', 'gpt-5.6-sol');
    await recordProviderOrModelSwitch(logger, anthropic, history);
    await recordProviderOrModelSwitch(logger, codex, history);
    await recordProviderOrModelSwitch(logger, codex, history);
    await recordProviderOrModelSwitch(logger, codex, history);

    expect(readRecords(logFile)).toHaveLength(1);
  });

  it('writes nothing when the logger is disabled', async () => {
    const logger = new TokenUsageLogger(false, logFile);
    await recordProviderOrModelSwitch(
      logger,
      stateFor('anthropic', 'claude-opus-5'),
      history,
    );
    await recordProviderOrModelSwitch(
      logger,
      stateFor('codex', 'gpt-5.6-sol'),
      history,
    );
    expect(readRecords(logFile)).toHaveLength(0);
  });
});
