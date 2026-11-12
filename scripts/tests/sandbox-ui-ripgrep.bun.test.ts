/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const dockerfile = readFileSync(resolve(repoRoot, 'Dockerfile'), 'utf8');
const imageProbe = readFileSync(
  resolve(repoRoot, 'scripts/sandbox-image-probe.ts'),
  'utf8',
);

describe('issue #4018 sandbox UI ripgrep installation', () => {
  it('seeds the exact architecture archive cache from system ripgrep before installing the pinned UI', () => {
    const seedIndex = dockerfile.indexOf('vscode-ripgrep/ripgrep-v13.0.0-10-');
    const installIndex = dockerfile.indexOf(
      'npm install -g @vybestack/llxprt-ui@',
    );

    expect(seedIndex).toBeGreaterThan(-1);
    expect(seedIndex).toBeLessThan(installIndex);
    expect(dockerfile).toContain('XDG_CACHE_HOME=/home/node/.cache');
    expect(dockerfile).toContain('TARGETARCH');
    expect(dockerfile).toContain(
      "amd64) ripgrep_target='x86_64-unknown-linux-musl.tar.gz'",
    );
    expect(dockerfile).toContain(
      "arm64) ripgrep_target='aarch64-unknown-linux-gnu.tar.gz'",
    );
    expect(dockerfile).toContain('tar -czf');
    expect(dockerfile).toContain('-C /usr/bin rg');
    expect(dockerfile).toMatch(/@vybestack\/llxprt-ui@\d+\.\d+\.\d+/);
    expect(dockerfile).toContain('@lvce-editor/ripgrep');
    const installBlock = dockerfile.slice(installIndex);
    expect(installBlock).not.toMatch(
      /npm_config_fetch_retries|until npm install|sleep 15/,
    );
  });

  it('runs real search through the UI ripgrep module in the image smoke probe', () => {
    expect(imageProbe).toContain(
      'cd "$NPM_CONFIG_PREFIX/lib/node_modules/@vybestack/llxprt-ui"',
    );
    expect(imageProbe).toContain(
      'import { rgPath } from "@lvce-editor/ripgrep"',
    );
    expect(imageProbe).toContain('sandbox-ui-ripgrep-search=ok');
    expect(imageProbe).toContain('spawnSync(rgPath');
  });
});
