/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { asRecord, asString } from './typed-test-helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PACKAGE_PATH = path.join(
  ROOT,
  'packages/vscode-ide-companion/package.json',
);

function prepareCommand(): string {
  const packageJson = asRecord(
    JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8')),
  );
  return asString(asRecord(packageJson.scripts).prepare);
}

describe('VS Code notices prepare lifecycle', () => {
  it('uses Bun directly without resolving the unprepared local Bun shim', () => {
    const command = prepareCommand();

    expect(command).toContain('npm_config_user_agent');
    expect(command).toContain("startsWith('bun/')");
    expect(command).toContain('process.env.npm_execpath');
    expect(command).toContain(
      "command = isBun ? process.env.npm_execpath : 'bun'",
    );
    expect(command).toContain("['./scripts/generate-notices.ts']");
    expect(command).toContain("stdio: 'inherit'");
    expect(command).not.toContain('bun ./scripts/generate-notices.ts');
  });

  it('fails when Bun is unavailable or the generator exits without success', () => {
    const command = prepareCommand();

    expect(command).toContain(
      "throw new Error('Bun executable is unavailable')",
    );
    expect(command).toContain('process.exit(result.status ?? 1)');
  });
});
