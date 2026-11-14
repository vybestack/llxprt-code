/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { responsesCases } from './support/frozenWire/explicit/responsesCases.js';
import { defineExplicitCases } from './support/frozenWire/explicit/explicitTestKit.js';

defineExplicitCases('responses', responsesCases());
