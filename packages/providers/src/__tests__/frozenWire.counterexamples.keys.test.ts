/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { keyInputCases } from './support/frozenWire/explicit/keyCases.js';
import { defineExplicitCases } from './support/frozenWire/explicit/explicitTestKit.js';

defineExplicitCases('keys', keyInputCases());
