/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the same check over the frozen Mistral corpus. Mistral
 * remaps every call id to nine alphanumeric characters, so message lengths do
 * not depend on the mapping; the test also shows that no id on the wire has
 * any other length.
 */

import { defineChatFrozenTests } from './support/lengthModel/chatFrozenTestKit.js';

defineChatFrozenTests('openai-chat-mistral');
