/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-005
 * Wiring behavior: journal derives its sidecar base from the session
 * recording path, wrap journalling onto turn store commit points, and the
 * flag-off path yields no journal and untouched commands.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import { useTempChatsDir } from '../__testhelpers__/scrollbackTestHelpers.js';
import { createTurnStore } from '../../ui/stores/turn/turnStore.js';
import {
  createScrollbackJournalForSession,
  wrapTurnCommandsWithJournal,
} from './journalWiring.js';
import { ScrollbackJournal } from './ScrollbackJournal.js';

describe('journalWiring', () => {
  const tempDir = useTempChatsDir();

  it('derives chatsDir and session base from the recording file path', () => {
    const chatsDir = tempDir.chatsDir();
    const journal = createScrollbackJournalForSession(
      { getFilePath: () => `${chatsDir}/session-t9-id42.jsonl` },
      true,
    );
    expect(journal).not.toBeNull();
    journal?.append({ id: 1, type: 'info', text: 'hello' });
    journal?.close();
    const files = fs.readdirSync(chatsDir);
    expect(files).toContain('sb-t9-id42.jsonl');
    expect(files).toContain('sb-t9-id42.idx.jsonl');
  });

  it('returns null when the flag is off or no recording is active', () => {
    expect(createScrollbackJournalForSession(null, true)).toBeNull();
    expect(
      createScrollbackJournalForSession({ getFilePath: () => null }, true),
    ).toBeNull();
    expect(
      createScrollbackJournalForSession(
        { getFilePath: () => '/x/session-a-b.jsonl' },
        false,
      ),
    ).toBeNull();
  });

  it('journals items committed through wrapped addItem/updateItem', () => {
    const chatsDir = tempDir.chatsDir();
    const journal = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 'w1',
      enabled: true,
    });
    const turnStore = createTurnStore();
    const wrapped = wrapTurnCommandsWithJournal(turnStore, journal);
    const id = wrapped.addItem({ type: 'info', text: 'first' });
    wrapped.updateItem(id, { text: 'first revised' });
    journal.close();

    const page = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 'w1',
      enabled: true,
    });
    const meta = page.getRangeMeta();
    expect(meta.count).toBe(2);
    page.close();
    const committed = turnStore.store.getState().history;
    expect(committed[0]?.text).toBe('first revised');
  });
});
