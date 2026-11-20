/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: over the frozen OpenAI chat corpus (5,000 seeds, raw and
 * normalized rows), the length the transducer predicts from per-unit facts
 * equals the byte length of the `messages` array that today's builders wrote.
 * Composition is associative at every split point, and the model without the
 * pending-media counter is wrong.
 */

import { defineChatFrozenTests } from './support/lengthModel/chatFrozenTestKit.js';

defineChatFrozenTests('openai-chat-plain');
