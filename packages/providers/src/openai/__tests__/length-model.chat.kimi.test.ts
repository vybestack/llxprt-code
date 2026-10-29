/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the same check over the frozen Kimi corpus. A Kimi id is
 * `functions.<name>:<index>`; the name is that of the id's last eligible call
 * occurrence, and the digits of the index are added from per-id facts. The
 * wrong rules of the reviews (no exception list, the call's own name, the last
 * raw name) are run against the corpus and must be wrong.
 */

import { defineChatFrozenTests } from './support/lengthModel/chatFrozenTestKit.js';

defineChatFrozenTests('openai-chat-kimi');
