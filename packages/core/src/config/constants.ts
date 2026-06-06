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

export const DEFAULT_AUTOCOMPLETE_IGNORE_DIRS: string[] = [
  'target/',
  'dist/',
  'build/',
  'out/',
  '.cache/',
  'coverage/',
  '__pycache__/',
  '.next/',
  '.nuxt/',
  '.output/',
  '.gradle/',
  '.mvn/',
  '.idea/',
  'Debug/',
  'Release/',
  'cmake-build-*/',
  '.eggs/',
  '*.egg-info/',
];

export const DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS: string[] = [
  '*.o',
  '*.so',
  '*.dll',
  '*.exe',
  '*.dylib',
  '*.a',
  '*.lib',
  '*.obj',
  '*.pdb',
  '*.class',
  '*.pyc',
  '*.pyo',
  '*.wasm',
  '*.rlib',
  '*.rmeta',
  '*.dSYM/',
];

export const DEFAULT_AUTOCOMPLETE_MAX_DEPTH = 20;
