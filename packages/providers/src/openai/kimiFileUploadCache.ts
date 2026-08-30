/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createBoundedCache } from '../kimi/kimiFileUpload.js';

const KIMI_FILE_UPLOAD_CACHE_CAPACITY = 100;

export const kimiFileUploadCache = createBoundedCache<string>(
  KIMI_FILE_UPLOAD_CACHE_CAPACITY,
);
