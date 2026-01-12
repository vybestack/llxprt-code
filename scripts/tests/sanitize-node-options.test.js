/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, '..', 'sanitize-node-options.sh');

function runWithNodeOptions(nodeOptions, command = 'echo "$NODE_OPTIONS"') {
  const env = { ...process.env };
  if (nodeOptions !== undefined) {
    env.NODE_OPTIONS = nodeOptions;
  } else {
    delete env.NODE_OPTIONS;
  }
  
  try {
    return execSync(`${scriptPath} bash -c '${command}'`, { 
      env,
      encoding: 'utf-8'
    }).trim();
  } catch (error) {
    throw new Error(`Script failed: ${error.message}`);
  }
}

describe('sanitize-node-options.sh', () => {
  it('should remove --localstorage-file without value', () => {
    const result = runWithNodeOptions('--localstorage-file');
    expect(result).toBe('');
  });

  it('should remove --localstorage-file with equals value', () => {
    const result = runWithNodeOptions('--localstorage-file=/some/path');
    expect(result).toBe('');
  });

  it('should remove --localstorage-file with space-separated value', () => {
    const result = runWithNodeOptions('--localstorage-file /some/path');
    expect(result).toBe('');
  });

  it('should preserve other options before --localstorage-file', () => {
    const result = runWithNodeOptions('--max-old-space-size=4096 --localstorage-file');
    expect(result).toBe('--max-old-space-size=4096');
  });

  it('should preserve other options after --localstorage-file', () => {
    const result = runWithNodeOptions('--localstorage-file --enable-source-maps');
    expect(result).toBe('--enable-source-maps');
  });

  it('should preserve options on both sides', () => {
    const result = runWithNodeOptions('--max-old-space-size=4096 --localstorage-file --enable-source-maps');
    expect(result).toBe('--max-old-space-size=4096 --enable-source-maps');
  });

  it('should not modify NODE_OPTIONS when not set', () => {
    const result = runWithNodeOptions(undefined);
    expect(result).toBe('');
  });

  it('should handle empty NODE_OPTIONS', () => {
    const result = runWithNodeOptions('');
    expect(result).toBe('');
  });

  it('should pass through to child command', () => {
    const result = runWithNodeOptions('--localstorage-file', 'echo "hello world"');
    expect(result).toBe('hello world');
  });

  it('should allow node to run without warning when NODE_OPTIONS has --localstorage-file', () => {
    // This test verifies that node runs successfully without the warning
    const result = runWithNodeOptions(
      '--localstorage-file',
      'node -e "console.log(\\"success\\")"'
    );
    expect(result).toBe('success');
  });
});
