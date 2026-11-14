/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { anthropicCases } from './support/frozenWire/explicit/anthropicCases.js';
import { defineExplicitCases } from './support/frozenWire/explicit/explicitTestKit.js';

defineExplicitCases('anthropic', anthropicCases());
