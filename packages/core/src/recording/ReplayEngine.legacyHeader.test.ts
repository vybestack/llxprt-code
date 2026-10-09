/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: recordings whose session_start carries provider "unknown" and
 * model "" must replay, while genuinely corrupt headers stay invalid.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { replaySession } from './ReplayEngine.js';
import {
  writeLegacyUnknownProviderSession,
  writeCorruptHeaderSession,
} from './__tests__/recording-file-fixtures.js';

const PROJECT_HASH = 'legacy-header-project';
const HEADER_ERROR =
  'Invalid session_start: missing or malformed required fields';

type HeaderPayload = Record<string, unknown>;

function validHeader(): HeaderPayload {
  return {
    sessionId: 'header-contract-session',
    projectHash: PROJECT_HASH,
    workspaceDirs: ['/x'],
    provider: 'anthropic',
    model: 'claude-4',
    startTime: '2026-10-08T21:18:08.000Z',
  };
}

describe('ReplayEngine session_start header contract (issue #3732)', () => {
  let chatsDir: string;

  beforeEach(async () => {
    chatsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-legacy-'));
  });

  afterEach(async () => {
    await fs.rm(chatsDir, { recursive: true, force: true });
  });

  async function replayHeader(header: HeaderPayload): Promise<string> {
    const filePath = path.join(chatsDir, 'session-header-contract.jsonl');
    const line = JSON.stringify({
      v: 1,
      seq: 1,
      ts: '2026-10-08T21:18:08.000Z',
      type: 'session_start',
      payload: header,
    });
    await fs.writeFile(filePath, `${line}\n`, 'utf-8');
    const result = await replaySession(filePath, PROJECT_HASH);
    return result.ok ? 'ok' : result.error;
  }

  it('replays a legacy unknown-provider file with history and the switched provider/model', async () => {
    const { filePath } = await writeLegacyUnknownProviderSession(chatsDir, {
      sessionId: 'legacy-unknown-session',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const result = await replaySession(filePath, PROJECT_HASH);

    expect(
      result.ok
        ? {
            ok: true,
            provider: result.metadata.provider,
            model: result.metadata.model,
            texts: result.history.map((content) => content.blocks),
          }
        : { ok: false, error: result.error },
    ).toStrictEqual({
      ok: true,
      provider: 'claudecode',
      model: 'claude-opus-5-5',
      texts: [
        [{ type: 'text', text: 'legacy question' }],
        [{ type: 'text', text: 'legacy answer' }],
      ],
    });
  });

  it('accepts empty provider and model strings in the header', async () => {
    expect(
      await replayHeader({ ...validHeader(), provider: '', model: '' }),
    ).toBe('ok');
  });

  it.each([
    ['missing provider', { provider: undefined }],
    ['missing model', { model: undefined }],
    ['non-string provider', { provider: 7 }],
    ['non-string model', { model: 42 }],
    ['null model', { model: null }],
    ['empty sessionId', { sessionId: '' }],
    ['empty projectHash', { projectHash: '' }],
    ['empty startTime', { startTime: '' }],
  ])('rejects a header with %s', async (_label, override) => {
    expect(await replayHeader({ ...validHeader(), ...override })).toBe(
      HEADER_ERROR,
    );
  });

  it('rejects a recording whose header model is not a string', async () => {
    const { filePath } = await writeCorruptHeaderSession(chatsDir, {
      sessionId: 'corrupt-header-session',
      projectHash: PROJECT_HASH,
      timestamp: '2026-10-08T21:18:08.000Z',
    });

    const result = await replaySession(filePath, PROJECT_HASH);

    expect(result.ok ? 'ok' : result.error).toBe(HEADER_ERROR);
  });
});
