/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { setProviderRuntimeStateFactory } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

setProviderRuntimeStateFactory(() => new SettingsService());
