/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ValidationResult } from './types.js';

function expandTilde(filePath: string): string {
  // Handle ~/ for home directory
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  // Handle bare ~ for home directory
  if (filePath === '~') {
    return os.homedir();
  }
  // Handle ./ for current directory (resolve to absolute path)
  if (filePath.startsWith('./')) {
    return path.resolve(filePath);
  }
  // Handle / for absolute path (already absolute)
  if (filePath.startsWith('/')) {
    return filePath;
  }
  // Relative path - resolve to absolute
  return path.resolve(filePath);
}

export function validateBaseUrl(url: string): ValidationResult {
  if (!url.trim()) {
    return { valid: false, error: 'Base URL is required' };
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'URL must use http:// or https://' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

export async function validateKeyFile(path: string): Promise<ValidationResult> {
  const expandedPath = expandTilde(path);

  try {
    await fs.access(expandedPath, fs.constants.R_OK);
    return { valid: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { valid: false, error: `File not found: ${path}` };
    }
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      return { valid: false, error: `Permission denied: ${path}` };
    }
    return { valid: false, error: `Cannot read file: ${path}` };
  }
}

export async function validateProfileName(
  name: string,
  existingProfiles: string[],
): Promise<ValidationResult> {
  if (!name.trim()) {
    return { valid: false, error: 'Profile name cannot be empty' };
  }

  if (name.includes('/') || name.includes('\\')) {
    return {
      valid: false,
      error: 'Profile name cannot contain path separators',
    };
  }

  if (existingProfiles.includes(name)) {
    return { valid: false, error: 'Profile name already exists' };
  }

  return { valid: true };
}

export const PARAM_VALIDATORS = {
  temperature: (val: number): ValidationResult => {
    if (val < 0 || val > 2.0) {
      return { valid: false, error: 'Must be between 0.0 and 2.0' };
    }
    return { valid: true };
  },

  maxTokens: (val: number): ValidationResult => {
    if (!Number.isInteger(val) || val <= 0) {
      return { valid: false, error: 'Must be a positive integer' };
    }
    if (val > 1000000) {
      return { valid: false, error: 'Maximum value is 1,000,000' };
    }
    return { valid: true };
  },

  contextLimit: (val: number): ValidationResult => {
    if (!Number.isInteger(val) || val <= 0) {
      return { valid: false, error: 'Must be a positive integer' };
    }
    return { valid: true };
  },
};
