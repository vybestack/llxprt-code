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
 * Pure wiring helpers connecting the scrollback journal to the turn store's
 * commit points. The journal is derived from the active session recording
 * (sidecars sit next to session-*.jsonl) and gated by
 * `ui.scrollbackJournalEnabled`; when the gate is off no journal is created
 * and the commands are returned untouched, byte-identical behavior.
 */

import { ScrollbackJournal } from './ScrollbackJournal.js';
import type {
  TurnCommands,
  TurnStore,
} from '../../ui/stores/turn/turnStore.js';

/** Minimal structural surface of the session recording service we need. */
export interface SessionFilePathSource {
  getFilePath(): string | null;
}

/**
 * Builds the journal for the active recording, or null when the flag is off
 * or no session recording is active (nothing to sit beside).
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-005
 */
export function createScrollbackJournalForSession(
  recordingService: SessionFilePathSource | null | undefined,
  enabled: boolean,
): ScrollbackJournal | null {
  if (!enabled || recordingService === null || recordingService === undefined) {
    return null;
  }
  const sessionFilePath = recordingService.getFilePath();
  if (sessionFilePath === null) {
    return null;
  }
  const separatorAt = sessionFilePath.lastIndexOf('/');
  const chatsDir =
    separatorAt === -1 ? '.' : sessionFilePath.slice(0, separatorAt);
  const fileName =
    separatorAt === -1
      ? sessionFilePath
      : sessionFilePath.slice(separatorAt + 1);
  const sessionFileBase = fileName.startsWith('session-')
    ? fileName.slice('session-'.length, fileName.length - '.jsonl'.length)
    : fileName.slice(0, fileName.length - '.jsonl'.length);
  return ScrollbackJournal.open({ chatsDir, sessionFileBase, enabled: true });
}

/**
 * Wraps the turn store's addItem/updateItem so every committed item (and
 * committed revision) is journaled at its commit point. Commands are wrapped
 * around the originals; the originals' return values and behavior are
 * unchanged.
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-005
 */
export function wrapTurnCommandsWithJournal(
  turnStore: TurnStore,
  journal: ScrollbackJournal,
): TurnCommands {
  const { commands, store } = turnStore;
  const findCommitted = (id: number) =>
    store.getState().history.find((item) => item.id === id);
  return {
    ...commands,
    addItem: (itemData, baseTimestamp, isResuming) => {
      const id = commands.addItem(itemData, baseTimestamp, isResuming);
      const committed = findCommitted(id);
      if (committed !== undefined) {
        journal.append(committed, {
          ...(committed.chronologySeq !== undefined
            ? { chronologySeq: committed.chronologySeq }
            : {}),
          ...(committed.seqSpan !== undefined
            ? { seqSpan: committed.seqSpan }
            : {}),
        });
        journal.flush();
      }
      return id;
    },
    updateItem: (id, updates) => {
      commands.updateItem(id, updates);
      const committed = findCommitted(id);
      if (committed !== undefined) {
        journal.appendRevision(id, committed);
        journal.flush();
      }
    },
  };
}
