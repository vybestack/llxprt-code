/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import packageJson from '../package.json' with { type: 'json' };

process.env.CLI_VERSION = packageJson.version;
process.env.DEV = 'true';
process.env.NODE_ENV = 'development';
