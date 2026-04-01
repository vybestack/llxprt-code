/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface FileFilteringOptions {
  respectGitIgnore: boolean;
  respectLlxprtIgnore: boolean;
  maxFileCount?: number;
  searchTimeout?: number;
}

// For memory files
export const DEFAULT_MEMORY_FILE_FILTERING_OPTIONS: FileFilteringOptions = {
  respectGitIgnore: false,
  respectLlxprtIgnore: true,
  maxFileCount: 20000,
  searchTimeout: 5000,
};

// For all other files
export const DEFAULT_FILE_FILTERING_OPTIONS: FileFilteringOptions = {
  respectGitIgnore: true,
  respectLlxprtIgnore: true,
  maxFileCount: 20000,
  searchTimeout: 5000,
};
