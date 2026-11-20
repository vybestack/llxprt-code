/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { chatIdCases } from './support/frozenWire/explicit/chatCases.js';
import { defineExplicitCases } from './support/frozenWire/explicit/explicitTestKit.js';

defineExplicitCases('chat', chatIdCases());
