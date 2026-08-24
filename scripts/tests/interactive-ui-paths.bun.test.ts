/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Interactive UI workflow path-contract tests (issue #2693).
 *
 * These read the REAL .github/workflows/interactive-ui.yml through existing
 * typed test helpers and assert:
 *   - direct tmux harness modules, the preload, the test file, its three
 *     executed scenario JSON files, and their referenced fixtures are
 *     included in the path filter
 *   - unrelated broad script test/fixture/scenario globs are removed
 *   - conservative package/build/runtime inputs remain
 *   - PR and push path filters are symmetric
 *
 * Per REQ-2693-006: an unrelated script test, fixture, or tmux scenario
 * must not trigger the workflow solely through a broad scripts glob.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseWorkflowYaml,
  workflowOn,
  type WorkflowDocument,
} from './typed-test-helpers.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const WORKFLOW_PATH = resolve(
  repoRoot,
  '.github',
  'workflows',
  'interactive-ui.yml',
);

function loadWorkflow(): WorkflowDocument {
  return parseWorkflowYaml(readFileSync(WORKFLOW_PATH, 'utf8'));
}

/** Collects all path strings from a pull_request or push trigger. */
function triggerPaths(on: Record<string, unknown>, key: string): string[] {
  const trigger = on[key];
  if (trigger === undefined || trigger === null) return [];
  if (typeof trigger === 'object' && !Array.isArray(trigger)) {
    const rec = trigger as Record<string, unknown>;
    const paths = rec['paths'];
    if (Array.isArray(paths)) {
      return paths.filter((p): p is string => typeof p === 'string');
    }
  }
  return [];
}

describe('interactive-ui.yml: direct harness inputs are included', () => {
  let prPaths: string[];

  beforeAll(() => {
    const on = workflowOn(loadWorkflow());
    prPaths = triggerPaths(on, 'pull_request');
  });

  it('includes the tmux harness entry module', () => {
    expect(prPaths).toContain('scripts/tmux-harness.ts');
  });

  it('includes the tmux harness split helper modules', () => {
    expect(prPaths).toContain('scripts/tmux-harness-helpers.ts');
    expect(prPaths).toContain('scripts/tmux-harness-io.ts');
    expect(prPaths).toContain('scripts/tmux-harness-scenarios.ts');
    expect(prPaths).toContain('scripts/tmux-harness-steps.ts');
  });

  it('includes the Bun test preload', () => {
    expect(prPaths).toContain('scripts/tests/test-setup.ts');
  });

  it('includes the interactive-ui test file', () => {
    expect(prPaths).toContain('scripts/tests/interactive-ui.test.ts');
  });

  it('includes every executed scenario JSON file', () => {
    expect(prPaths).toContain('scripts/tmux-script.slash-autocomplete.json');
    expect(prPaths).toContain('scripts/tmux-script.approval-ui.json');
    expect(prPaths).toContain(
      'scripts/tmux-script.issue2208-newlines.fake.json',
    );
    expect(prPaths).toContain('scripts/tmux-script.session-browser.json');
  });

  it('includes the scenario config fixtures referenced by the scenarios', () => {
    // Every executed scenario sets LLXPRT_CODE_WELCOME_CONFIG_PATH and
    // LLXPRT_SYSTEM_SETTINGS_PATH to these direct inputs.
    expect(prPaths).toContain('scripts/fixtures/welcome-completed.json');
    expect(prPaths).toContain('scripts/system-settings.interactive-ui.json');
  });

  it('includes the referenced response fixture files', () => {
    expect(prPaths).toContain('scripts/fixtures/approval-ui.responses.jsonl');
    expect(prPaths).toContain(
      'scripts/fixtures/issue2208-newlines.responses.jsonl',
    );
    expect(prPaths).toContain(
      'scripts/fixtures/session-browser.responses.jsonl',
    );
  });

  it('includes the isolated user settings fixture the session browser scenario seeds', () => {
    // tmux-script.session-browser.json copies this into its private
    // LLXPRT_CONFIG_HOME so the browser lists exactly the session it seeds.
    expect(prPaths).toContain('scripts/fixtures/session-browser-settings.json');
  });
});

describe('interactive-ui.yml: broad script globs are removed', () => {
  let prPaths: string[];

  beforeAll(() => {
    const on = workflowOn(loadWorkflow());
    prPaths = triggerPaths(on, 'pull_request');
  });

  it('does NOT use scripts/tests/** broad glob', () => {
    expect(prPaths).not.toContain('scripts/tests/**');
  });

  it('does NOT use scripts/fixtures/** broad glob', () => {
    expect(prPaths).not.toContain('scripts/fixtures/**');
  });

  it('does NOT use scripts/tmux-script*.json broad glob', () => {
    expect(prPaths).not.toContain('scripts/tmux-script*.json');
  });
});

describe('interactive-ui.yml: conservative package/build/runtime inputs remain', () => {
  let prPaths: string[];

  beforeAll(() => {
    const on = workflowOn(loadWorkflow());
    prPaths = triggerPaths(on, 'pull_request');
  });

  it('includes package.json', () => {
    expect(prPaths).toContain('package.json');
  });

  it('includes package-lock.json', () => {
    expect(prPaths).toContain('package-lock.json');
  });

  it('includes the workflow file itself', () => {
    expect(prPaths).toContain('.github/workflows/interactive-ui.yml');
  });

  it('includes CLI UI layer paths', () => {
    expect(prPaths).toContain('packages/cli/src/ui/**');
  });

  it('does NOT include stale packages/ui/** (no such tracked package)', () => {
    expect(prPaths).not.toContain('packages/ui/**');
  });

  it('includes .nvmrc (consumed by setup-node node-version-file)', () => {
    expect(prPaths).toContain('.nvmrc');
  });

  it('includes .bun-version (consumed by setup-bun bun-version-file)', () => {
    expect(prPaths).toContain('.bun-version');
  });

  it('includes .npmrc (consumed by npm ci install config)', () => {
    expect(prPaths).toContain('.npmrc');
  });
});

describe('interactive-ui.yml: PR and push filters are symmetric', () => {
  it('PR and push path filters match exactly', () => {
    const on = workflowOn(loadWorkflow());
    const prPaths = triggerPaths(on, 'pull_request').sort();
    const pushPaths = triggerPaths(on, 'push').sort();
    expect(prPaths).toEqual(pushPaths);
  });
});
