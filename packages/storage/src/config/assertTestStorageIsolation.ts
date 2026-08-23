/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { LLXPRT_PLATFORM_PATHS } from './path-resolver.js';

/**
 * Set to `'1'` by `isolateStorageRoots()` at preload time, in the same
 * assignment pass that redirects the four storage roots.
 *
 * This, rather than `LLXPRT_RUNNING_TESTS`, is what scopes the guard, and the
 * reason is a Bun behaviour worth stating plainly: `spawnSync` with an
 * inherited environment snapshots the process's ORIGINAL environment and does
 * not carry `process.env` mutations made after startup. `LLXPRT_RUNNING_TESTS`
 * is exported before the test process execs, so it reaches such children;
 * `LLXPRT_CONFIG_HOME` is assigned by the preload afterwards, so it does not.
 * Gating on the test marker therefore fired inside the real CLI whenever a
 * suite spawned it as a product smoke check, over a config root that child was
 * entitled to read. Gating on this marker keeps the guard inside the test
 * process that set it.
 */
const ISOLATION_MARKER_ENV = 'LLXPRT_TEST_STORAGE_ISOLATED';

/**
 * Escape hatch for the few tests whose subject IS the platform default path.
 * Must be the exact string `'true'`.
 */
export const REAL_STORAGE_OPT_IN_ENV = 'LLXPRT_ALLOW_REAL_STORAGE_IN_TESTS';

const CONFIG_OVERRIDE_ENV = 'LLXPRT_CONFIG_HOME';

/**
 * The temp root, both as reported and as resolved through symlinks: macOS
 * reports `/var/folders/...`, a link to `/private/var/folders/...`.
 */
const TEMP_ROOTS: readonly string[] = (() => {
  const reported = path.resolve(os.tmpdir());
  try {
    const real = path.resolve(fs.realpathSync(os.tmpdir()));
    return real === reported ? [reported] : [reported, real];
  } catch {
    return [reported];
  }
})();

/**
 * True when a resolved platform default lives under the temp root.
 *
 * The platform defaults come from `env-paths`, which reads `os.homedir()` and
 * therefore honours `$HOME`. Rewriting `$HOME` to a temp directory is a
 * legitimate way to sandbox a child process, and such a child resolves a
 * platform default that is already isolated. Nobody's real configuration lives
 * under the temp root, so exempting it cannot weaken the guard.
 */
function isTempSandboxed(target: string): boolean {
  return TEMP_ROOTS.some(
    (root) => target === root || target.startsWith(`${root}${path.sep}`),
  );
}

/**
 * Fails closed when an isolated test process resolves the unredirected user
 * config directory anyway.
 *
 * Tests run with the storage roots redirected to a per-process temp directory
 * (`isolateStorageRoots()`, wired through each workspace's Bun test preload).
 * A test that clears `LLXPRT_CONFIG_HOME` afterwards drops back to the
 * developer's live configuration, where saving a profile named `glm` overwrites
 * the profile the developer uses. CI never notices, because a fresh runner's
 * config directory is empty and nothing there is worth destroying.
 *
 * Reaching the real directory is therefore treated as a defect in the test
 * setup rather than something to tolerate: the call throws instead of returning
 * a path that would be written to.
 *
 * A test ROOT that never isolates at all is a different failure, and one this
 * guard cannot see: with no marker there is nothing to key on. That case is
 * covered by `scripts/tests/storage-isolation-workspace-config.test.ts`, which
 * spawns a probe in every workspace and against every root's declared preloads
 * and fails the suite if any of them can run unisolated.
 *
 * Scope: the config root only, which is where the user-editable state at risk
 * lives — profiles, `settings.json`, commands, skills, policies. The data,
 * cache, and log roots are deliberately excluded. Test suites routinely spawn
 * the real CLI as a product smoke check, and that process opens a debug log at
 * import time; guarding the log root would turn every such smoke into a hard
 * failure over a file nobody minds losing. The home-anchored roots are excluded
 * for a different reason: they have no environment override to redirect, so
 * tests isolate them by rewriting `$HOME`, and guarding them would reject reads
 * that legitimately find nothing.
 *
 * @param resolved the config directory the resolver produced
 * @returns `resolved`, when it is safe to use
 */
export function assertTestConfigIsolation(resolved: string): string {
  if (
    process.env[ISOLATION_MARKER_ENV] !== '1' ||
    process.env[REAL_STORAGE_OPT_IN_ENV] === 'true'
  ) {
    return resolved;
  }

  const resolvedPath = path.resolve(resolved);
  // Descendants count: pointing LLXPRT_CONFIG_HOME at, say,
  // `<platformConfig>/profiles` is still the developer's live tree.
  const platformConfig = path.resolve(LLXPRT_PLATFORM_PATHS.config);
  const insidePlatformConfig =
    resolvedPath === platformConfig ||
    resolvedPath.startsWith(`${platformConfig}${path.sep}`);
  if (!insidePlatformConfig || isTempSandboxed(resolvedPath)) {
    return resolved;
  }

  throw new Error(
    `Refusing to resolve the unredirected user config directory during ` +
      `tests: ${resolvedPath}. Isolate the test process by preloading ` +
      `isolateStorageRoots() from @vybestack/llxprt-code-storage/testing, or ` +
      `set ${CONFIG_OVERRIDE_ENV} to a temp directory. Set ` +
      `${REAL_STORAGE_OPT_IN_ENV}=true only in a test whose subject is the ` +
      `real platform path.`,
  );
}
