/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { normalizerCases } from './support/frozenWire/explicit/normalizerCases.js';
import { defineExplicitCases } from './support/frozenWire/explicit/explicitTestKit.js';

defineExplicitCases('normalizer', normalizerCases());
