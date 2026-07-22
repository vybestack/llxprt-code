'use strict';

/**
 * Behavioral checks for the Windows installed-command smoke. Each function
 * corresponds to one check group; all 23 behavioral checks live here. They
 * share the installed-package fixture and report failures via the assert
 * helper so a single summary is produced at the end.
 */

const { spawnSync, spawn } = require('node:child_process');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');

const { assert, runStep } = require('./assert.cjs');
const {
  CONSTRAINED_PATH,
  OWNERSHIP_SENTINEL,
  VERSION_RE,
  LAUNCH_ERROR_EXIT,
  EXPECTED_BUN_VERSION,
  VERSION_TIMEOUT_MS,
  NPM_EXEC_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
} = require('./constants.cjs');
const {
  probeArg,
  parseProbeOutput,
  invokeCmd,
  invokePwsh,
  spawnCmdLongRunning,
} = require('./launcher-invocation.cjs');
const { findBundledBun, samePath, copyTree } = require('./package-layout.cjs');
const {
  waitForReady,
  killProcessTree,
  walkProcessLineage,
  validateProcessLineage,
} = require('./process-helpers.cjs');
const { resolvePwsh } = require('./pwsh-resolver.cjs');
const { assertBundledBunHealthy } = require('./bun-validation.cjs');
const { npmInvocation } = require('../lib/npm-command.cjs');
const { SPAWN_MAX_BUFFER } = require('./install-helpers.cjs');

function buildProbeFixture(installedPackageRoot, tempBase, label, repoRoot) {
  const fixtureDir = join(tempBase, `probe-fixture-${label}`);
  mkdirSync(fixtureDir, { recursive: true });
  const fixturePkgRoot = join(fixtureDir, 'pkg');
  copyTree(installedPackageRoot, fixturePkgRoot);
  const probePath = join(
    repoRoot,
    'scripts',
    'tests',
    'issue-2603-windows-probe.ts',
  );
  writeFileSync(
    join(fixturePkgRoot, 'index.ts'),
    readFileSync(probePath, 'utf8'),
  );

  const installer = require(
    join(
      repoRoot,
      'packages',
      'cli',
      'scripts',
      'install-native-launchers.cjs',
    ),
  );
  const result = installer.installNativeLaunchers({
    platform: 'win32',
    packageRoot: fixturePkgRoot,
    env: { npm_config_global: 'true', npm_config_prefix: fixtureDir },
    log: () => {},
  });
  if (!result.written || result.written.length < 2) {
    throw new Error(
      `installer did not write both launchers for fixture ${label} (got ${JSON.stringify(result)})`,
    );
  }
  // Verify the COPIED bundled bun.exe is a real Windows PE binary reporting
  // the expected version BEFORE using the fixture. A timed-out install can
  // leave a partial/non-PE binary (run 29850614559); this gate fails fast with
  // an actionable diagnostic instead of cascading "exit 216 not compatible".
  const fixtureBun = findBundledBun(fixturePkgRoot);
  assertBundledBunHealthy(fixtureBun, EXPECTED_BUN_VERSION);
  return { fixtureDir, fixturePkgRoot };
}

// --- Check groups ---

function checkLauncherSentinels(prefix) {
  runStep('cmd-launcher-sentinel', () => {
    const cmdPath = join(prefix, 'llxprt.cmd');
    assert(existsSync(cmdPath), `cmd launcher not found: ${cmdPath}`);
    const content = readFileSync(cmdPath, 'utf8');
    assert(
      content.includes(OWNERSHIP_SENTINEL),
      'cmd launcher missing ownership sentinel',
    );
    assert(
      /"%~dp0.*bun\.exe" "%~dp0.*index\.ts" %\*/.test(content),
      'cmd launcher does not directly invoke bun.exe with %*',
    );
    assert(
      !content.includes('LLXPRT_LAUNCH_FAIL'),
      'cmd launcher must not remap exit codes (no LLXPRT_LAUNCH_FAIL)',
    );
  });

  runStep('ps1-launcher-sentinel', () => {
    const ps1Path = join(prefix, 'llxprt.ps1');
    assert(existsSync(ps1Path), `ps1 launcher not found: ${ps1Path}`);
    const content = readFileSync(ps1Path, 'utf8');
    assert(
      content.includes(OWNERSHIP_SENTINEL),
      'ps1 launcher missing ownership sentinel',
    );
    assert(
      content.includes('$allArgs = @($entry) + $args'),
      'ps1 launcher does not use argument array',
    );
    assert(
      content.includes('try {') && content.includes('} catch {'),
      'ps1 launcher missing try/catch for launch failures',
    );
  });
}

function checkVersionRuns(prefix) {
  runStep('cmd-version', () => {
    const cmdPath = join(prefix, 'llxprt.cmd');
    // Use the shared invokeCmd helper for consistent spawn-error diagnostics,
    // quoting, and constrained-PATH configuration across all cmd invocations.
    const r = invokeCmd(cmdPath, ['--version'], {
      timeout: VERSION_TIMEOUT_MS,
    });
    if (r.status !== 0) {
      throw new Error(`cmd --version exited ${r.status}: ${r.stderr}`);
    }
    assert(
      VERSION_RE.test(r.stdout.trim()),
      `cmd --version unexpected output: ${r.stdout}`,
    );
  });

  runStep('ps1-version', () => {
    const ps1Path = join(prefix, 'llxprt.ps1');
    // Use the shared invokePwsh helper for consistent PowerShell invocation,
    // encoding, and spawn-error diagnostics.
    const r = invokePwsh(ps1Path, ['--version'], {
      timeout: VERSION_TIMEOUT_MS,
    });
    if (r.status !== 0) {
      throw new Error(`ps1 --version exited ${r.status}: ${r.stderr}`);
    }
    assert(
      VERSION_RE.test(r.stdout.trim()),
      `ps1 --version unexpected output: ${r.stdout}`,
    );
  });
}

const ARG_FIDELITY_MARKERS = [
  'plain-ascii',
  'with spaces',
  'Unicode: ✓ 日本語 ñ émoji 🎉',
  'quotes: "double" \'single\' `back`',
  'safe-metachars: ; | & < > ( ) % ! ^',
  'back\\slash and for$ward',
];

function checkCmdArgFidelity(fixture) {
  runStep('cmd-arg-fidelity', () => {
    const cmdPath = join(fixture.fixtureDir, 'llxprt.cmd');
    assert(existsSync(cmdPath), `cmd launcher missing in fixture`);
    for (const marker of ARG_FIDELITY_MARKERS) {
      const r = invokeCmd(cmdPath, [probeArg({ marker })], {
        timeout: PROBE_TIMEOUT_MS,
      });
      if (r.status !== 0) {
        throw new Error(
          `cmd probe exited ${r.status} for marker ${JSON.stringify(marker)}: ${r.stderr}`,
        );
      }
      const payload = parseProbeOutput(r.stdout);
      const forwardedArg = payload.argv.find((a) =>
        a.startsWith('LLXPRT_PROBE_B64='),
      );
      assert(
        forwardedArg !== undefined,
        `marker ${JSON.stringify(marker)}: LLXPRT_PROBE_B64= not present in argv`,
      );
      if (forwardedArg === undefined) {
        continue;
      }
      const parsed = JSON.parse(
        Buffer.from(
          forwardedArg.slice('LLXPRT_PROBE_B64='.length),
          'base64url',
        ).toString('utf8'),
      );
      assert(
        parsed.marker === marker,
        `marker ${JSON.stringify(marker)} round-trip mismatch: got ${JSON.stringify(parsed.marker)}`,
      );
      assert(
        typeof payload.bunVersion === 'string' && payload.bunVersion.length > 0,
        `marker ${JSON.stringify(marker)}: did not run under Bun (bunVersion missing)`,
      );
    }
  });
}

function checkPwshArgFidelity(fixture) {
  runStep('pwsh-arg-fidelity', () => {
    const ps1Path = join(fixture.fixtureDir, 'llxprt.ps1');
    assert(existsSync(ps1Path), `ps1 launcher missing in fixture`);
    for (const marker of ARG_FIDELITY_MARKERS) {
      const r = invokePwsh(ps1Path, [probeArg({ marker })], {
        timeout: PROBE_TIMEOUT_MS,
      });
      if (r.status !== 0) {
        throw new Error(
          `ps1 probe exited ${r.status} for marker ${JSON.stringify(marker)}: ${r.stderr}`,
        );
      }
      const payload = parseProbeOutput(r.stdout);
      const forwardedArg = payload.argv.find((a) =>
        a.startsWith('LLXPRT_PROBE_B64='),
      );
      assert(
        forwardedArg !== undefined,
        `marker ${JSON.stringify(marker)}: LLXPRT_PROBE_B64= not present in argv`,
      );
      if (forwardedArg === undefined) {
        continue;
      }
      const parsed = JSON.parse(
        Buffer.from(
          forwardedArg.slice('LLXPRT_PROBE_B64='.length),
          'base64url',
        ).toString('utf8'),
      );
      assert(
        parsed.marker === marker,
        `marker ${JSON.stringify(marker)} round-trip mismatch: got ${JSON.stringify(parsed.marker)}`,
      );
      assert(
        typeof payload.bunVersion === 'string' && payload.bunVersion.length > 0,
        `marker ${JSON.stringify(marker)}: did not run under Bun (bunVersion missing)`,
      );
    }
  });
}

function checkInjectionGuard(fixture, tempDir) {
  runStep('cmd-injection-guard', () => {
    const cmdPath = join(fixture.fixtureDir, 'llxprt.cmd');
    const injectionFile = join(tempDir, 'injected-sentinel.txt');
    const hostileArg = `& echo INJECTED > "${injectionFile}"`;
    const r = invokeCmd(cmdPath, [probeArg({}), hostileArg]);
    if (r.status !== 0) {
      throw new Error(`cmd injection probe exited ${r.status}: ${r.stderr}`);
    }
    const payload = parseProbeOutput(r.stdout);
    assert(
      payload.argv.includes(hostileArg),
      'cmd hostile argument was not preserved',
    );
    assert(
      !existsSync(injectionFile),
      `cmd injection sentinel file exists at ${injectionFile}`,
    );
  });

  runStep('pwsh-injection-guard', () => {
    const ps1Path = join(fixture.fixtureDir, 'llxprt.ps1');
    const injectionFile = join(tempDir, 'injected-sentinel-ps1.txt');
    const hostileArg = `& echo INJECTED > "${injectionFile}"`;
    const r = invokePwsh(ps1Path, [probeArg({}), hostileArg]);
    if (r.status !== 0) {
      throw new Error(`ps1 injection probe exited ${r.status}: ${r.stderr}`);
    }
    const payload = parseProbeOutput(r.stdout);
    assert(
      payload.argv.includes(hostileArg),
      'ps1 hostile argument was not preserved',
    );
    assert(
      !existsSync(injectionFile),
      `ps1 injection sentinel file exists at ${injectionFile}`,
    );
  });
}

function checkStdioForwarding(fixture) {
  runStep('cmd-stdio', () => {
    const cmdPath = join(fixture.fixtureDir, 'llxprt.cmd');
    const stderrValue = 'KNOWN_STDERR_VALUE_31337';
    const stdinValue = 'KNOWN_STDIN_PAYLOAD_5150';
    const r = invokeCmd(
      cmdPath,
      [probeArg({ stdin: true, stderr: stderrValue })],
      { input: stdinValue },
    );
    if (r.status !== 0) {
      throw new Error(`cmd stdio probe exited ${r.status}: ${r.stderr}`);
    }
    const payload = parseProbeOutput(r.stdout);
    assert(
      payload.stdin === stdinValue,
      `stdin not forwarded: expected ${JSON.stringify(stdinValue)}, got ${JSON.stringify(payload.stdin)}`,
    );
    assert(
      r.stderr.includes(stderrValue),
      `stderr not forwarded: expected ${JSON.stringify(stderrValue)} in ${JSON.stringify(r.stderr)}`,
    );
  });

  runStep('pwsh-stdio', () => {
    const ps1Path = join(fixture.fixtureDir, 'llxprt.ps1');
    const stderrValue = 'KNOWN_STDERR_VALUE_31337';
    const stdinValue = 'KNOWN_STDIN_PAYLOAD_5150';
    const r = invokePwsh(
      ps1Path,
      [probeArg({ stdin: true, stderr: stderrValue })],
      { input: stdinValue },
    );
    if (r.status !== 0) {
      throw new Error(`ps1 stdio probe exited ${r.status}: ${r.stderr}`);
    }
    const payload = parseProbeOutput(r.stdout);
    assert(payload.stdin === stdinValue, `ps1 stdin not forwarded`);
    assert(r.stderr.includes(stderrValue), `ps1 stderr not forwarded`);
  });
}

function checkCmdExitCodePreservation(fixture) {
  runStep('cmd-exit-codes-preserved', () => {
    const cmdPath = join(fixture.fixtureDir, 'llxprt.cmd');
    // Codes in [0,255] are expressible through Bun's process.exit() and
    // exercise the ordinary launcher/OS path. 9009 exceeds the 8-bit range:
    // Bun's process.exit() truncates modulo 256, so 9009 is routed through
    // nativeExit (Windows ExitProcess via FFI) to test the genuine 32-bit
    // Windows process exit status the host observes. Both paths assert the
    // exact code via the same r.status === code contract.
    for (const code of [0, 1, 5, 7, 42, 193]) {
      const r = invokeCmd(cmdPath, [probeArg({ exit: code })]);
      assert(
        r.status === code,
        `cmd did not preserve exit ${code}: got ${r.status} (stderr=${JSON.stringify(r.stderr)})`,
      );
    }
    const native = invokeCmd(cmdPath, [probeArg({ nativeExit: 9009 })]);
    assert(
      native.status === 9009,
      `cmd did not preserve native exit 9009: got ${native.status} (stderr=${JSON.stringify(native.stderr)})`,
    );
  });
}

function checkPwshExitPropagation(fixture) {
  runStep('pwsh-legitimate-exit-propagation', () => {
    const ps1Path = join(fixture.fixtureDir, 'llxprt.ps1');
    for (const code of [0, 1, 5, 7, 42]) {
      const r = invokePwsh(ps1Path, [probeArg({ exit: code })]);
      assert(
        r.status === code,
        `ps1 did not propagate legitimate exit ${code}: got ${r.status}`,
      );
    }
  });
}

function checkExecPathIsBundledBun(fixture) {
  runStep('cmd-execpath-is-bundled-bun', () => {
    const cmdPath = join(fixture.fixtureDir, 'llxprt.cmd');
    const r = invokeCmd(cmdPath, [probeArg({})], {
      timeout: PROBE_TIMEOUT_MS,
    });
    if (r.status !== 0) {
      throw new Error(`cmd execpath probe exited ${r.status}: ${r.stderr}`);
    }
    const payload = parseProbeOutput(r.stdout);
    const expectedBun = findBundledBun(fixture.fixturePkgRoot);
    assert(
      samePath(payload.execPath, expectedBun),
      `cmd execPath ${payload.execPath} is not the package-local bundled bun.exe (${expectedBun})`,
    );
  });

  runStep('pwsh-execpath-is-bundled-bun', () => {
    const ps1Path = join(fixture.fixtureDir, 'llxprt.ps1');
    const r = invokePwsh(ps1Path, [probeArg({})], {
      timeout: PROBE_TIMEOUT_MS,
    });
    if (r.status !== 0) {
      throw new Error(`ps1 execpath probe exited ${r.status}: ${r.stderr}`);
    }
    const payload = parseProbeOutput(r.stdout);
    const expectedBun = findBundledBun(fixture.fixturePkgRoot);
    assert(
      samePath(payload.execPath, expectedBun),
      `ps1 execPath ${payload.execPath} is not the package-local bundled bun.exe (${expectedBun})`,
    );
  });
}

async function checkProcessTreeNoNode(fixture) {
  // CMD variant
  const cmdPromise = runStep(
    'cmd-process-tree-bun-present-node-absent',
    async () => {
      const cmdPath = join(fixture.fixtureDir, 'llxprt.cmd');
      // Reuse the same cmd.exe /d /s /c direct invocation as invokeCmd so the
      // long-running probe exercises the identical direct cmd spawn path
      // (windowsVerbatimArguments + cmdInvocationArgs).
      const child = spawnCmdLongRunning(cmdPath, [probeArg({ long: true })], {
        env: { PATH: CONSTRAINED_PATH },
      });
      // Attach an immediate 'error' handler so a spawn failure (ENOENT,
      // EACCES) surfaces as an assertion failure rather than crashing the
      // process with an unhandled 'error' event.
      child.on('error', (err) => {
        throw new Error(`cmd long-running spawn failed: ${err.message}`);
      });
      try {
        // Async readiness polling yields to the event loop so stdout event
        // handlers fire between checks.
        const readyOut = await waitForReady(
          child,
          '__LLXPRT_PROBE_LONG_RUNNING__',
          12_000,
        );
        // The probe payload precedes the readiness marker. Parse it to obtain
        // the Bun process's own pid/ppid so we can walk a deterministic
        // ancestry chain rather than racing a descendants snapshot.
        const payload = parseProbeOutput(readyOut);
        const probePid = payload.pid;
        assert(
          Number.isInteger(probePid),
          `cmd probe payload missing integer pid: ${JSON.stringify(payload)}`,
        );
        const chain = walkProcessLineage(probePid, child.pid);
        const result = validateProcessLineage(chain, child.pid);
        assert(result.ok, `cmd lineage validation failed unexpectedly`);
      } finally {
        // Terminate the entire process tree (taskkill /T /F on Windows), not
        // just the direct child, so bun.exe descendants are reaped.
        killProcessTree(child);
      }
    },
  );

  // PowerShell variant
  const pwshPromise = runStep(
    'pwsh-process-tree-bun-present-node-absent',
    async () => {
      const ps1Path = join(fixture.fixtureDir, 'llxprt.ps1');
      // Resolve PowerShell robustly (PWSH_PATH -> pwsh.exe -> powershell.exe).
      const pwshExe = resolvePwsh();
      const child = spawn(
        pwshExe,
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          ps1Path,
          probeArg({ long: true }),
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PATH: CONSTRAINED_PATH },
          windowsHide: true,
        },
      );
      // Attach an immediate 'error' handler so a spawn failure (ENOENT,
      // EACCES) surfaces as an assertion failure rather than crashing the
      // process with an unhandled 'error' event.
      child.on('error', (err) => {
        throw new Error(`pwsh long-running spawn failed: ${err.message}`);
      });
      try {
        const readyOut = await waitForReady(
          child,
          '__LLXPRT_PROBE_LONG_RUNNING__',
          12_000,
        );
        const payload = parseProbeOutput(readyOut);
        const probePid = payload.pid;
        assert(
          Number.isInteger(probePid),
          `ps1 probe payload missing integer pid: ${JSON.stringify(payload)}`,
        );
        const chain = walkProcessLineage(probePid, child.pid);
        const result = validateProcessLineage(chain, child.pid);
        assert(result.ok, `ps1 lineage validation failed unexpectedly`);
      } finally {
        killProcessTree(child);
      }
    },
  );

  return Promise.all([cmdPromise, pwshPromise]);
}

function checkMissingBun(fixtureBase, tempDir, repoRoot) {
  runStep('cmd-missing-bun-43', () => {
    const fixture = buildProbeFixture(
      fixtureBase.installedPackageRoot,
      tempDir,
      'missing-bun-cmd',
      repoRoot,
    );
    const bunExe = findBundledBun(fixture.fixturePkgRoot);
    rmSync(bunExe, { force: true });
    assert(
      !existsSync(bunExe),
      'failed to remove bun.exe for missing-bun test',
    );
    const cmdPath = join(fixture.fixtureDir, 'llxprt.cmd');
    const r = invokeCmd(cmdPath, [probeArg({})], { timeout: 15_000 });
    assert(
      r.status === LAUNCH_ERROR_EXIT,
      `cmd missing-bun exited ${r.status}, expected ${LAUNCH_ERROR_EXIT}`,
    );
    assert(
      /bundled Bun runtime was not found|npm install|bun\.sh/i.test(r.stderr),
      `cmd missing-bun diagnostic missing: ${JSON.stringify(r.stderr)}`,
    );
  });

  runStep('ps1-missing-bun-43', () => {
    const fixture = buildProbeFixture(
      fixtureBase.installedPackageRoot,
      tempDir,
      'missing-bun-ps1',
      repoRoot,
    );
    const bunExe = findBundledBun(fixture.fixturePkgRoot);
    rmSync(bunExe, { force: true });
    const ps1Path = join(fixture.fixtureDir, 'llxprt.ps1');
    const r = invokePwsh(ps1Path, [probeArg({})], { timeout: 15_000 });
    assert(
      r.status === LAUNCH_ERROR_EXIT,
      `ps1 missing-bun exited ${r.status}, expected ${LAUNCH_ERROR_EXIT}`,
    );
    assert(
      /bundled Bun runtime was not found|npm install|bun\.sh/i.test(r.stderr),
      `ps1 missing-bun diagnostic missing: ${JSON.stringify(r.stderr)}`,
    );
  });
}

function checkCorruptBun(fixtureBase, tempDir, repoRoot) {
  runStep('ps1-corrupt-bun-43', () => {
    const fixture = buildProbeFixture(
      fixtureBase.installedPackageRoot,
      tempDir,
      'corrupt-bun-ps1',
      repoRoot,
    );
    const bunExe = findBundledBun(fixture.fixturePkgRoot);
    writeFileSync(
      bunExe,
      Buffer.from([
        0x74, 0x68, 0x69, 0x73, 0x20, 0x69, 0x73, 0x20, 0x6e, 0x6f, 0x74, 0x20,
        0x61, 0x20, 0x70, 0x65,
      ]),
    );
    const ps1Path = join(fixture.fixtureDir, 'llxprt.ps1');
    const r = invokePwsh(ps1Path, [probeArg({})], { timeout: 15_000 });
    assert(
      r.status === LAUNCH_ERROR_EXIT,
      `ps1 corrupt-bun exited ${r.status}, expected ${LAUNCH_ERROR_EXIT} (catch must detect launch failure)`,
    );
    assert(
      /could not be launched|corrupt|npm install|bun\.sh/i.test(r.stderr),
      `ps1 corrupt-bun diagnostic missing: ${JSON.stringify(r.stderr)}`,
    );
    // Symmetric with the cmd corrupt-bun honest contract: the ps1 launcher
    // must NOT misdiagnose a corrupt binary as a missing Bun. The corrupt-bun
    // catch block emits its own diagnostic (could not be launched), not the
    // missing-bun diagnostic (bundled Bun runtime was not found).
    assert(
      !/LLxprt Code: bundled Bun runtime was not found/i.test(r.stderr),
      `ps1 corrupt-bun must NOT emit the missing-bun diagnostic from its catch block (honest contract: corrupt binary must not be misdiagnosed as missing)`,
    );
  });

  runStep('cmd-corrupt-bun-honest-contract', () => {
    const fixture = buildProbeFixture(
      fixtureBase.installedPackageRoot,
      tempDir,
      'corrupt-bun-cmd',
      repoRoot,
    );
    const bunExe = findBundledBun(fixture.fixturePkgRoot);
    writeFileSync(bunExe, '#!/bin/sh\necho this is not a native binary\n');
    const cmdPath = join(fixture.fixtureDir, 'llxprt.cmd');
    const r = invokeCmd(cmdPath, [probeArg({})], { timeout: 15_000 });
    assert(
      r.status !== 0,
      `cmd corrupt-bun exited 0 — expected nonzero (honest contract: corrupt binary is not silently treated as success)`,
    );
    assert(
      !/LLxprt Code: bundled Bun runtime was not found/i.test(r.stderr),
      `cmd corrupt-bun must NOT emit the missing-bun diagnostic from its own code path (cmd cannot distinguish corrupt from a real nonzero exit); the honest contract is no remapping`,
    );
  });
}

function checkNpmExecEphemeral(tempDir, replicaTarball) {
  runStep('npm-exec-ephemeral', () => {
    const cleanDir = join(tempDir, 'npm-exec-clean');
    mkdirSync(cleanDir, { recursive: true });
    writeFileSync(
      join(cleanDir, 'package.json'),
      JSON.stringify({ name: 'clean-consumer', version: '0.0.0' }, null, 2),
    );
    // No per-fixture --cache: inherit the warmed default npm cache (populated
    // by `npm ci`). An isolated empty cache forced re-fetches and caused the
    // ETIMEDOUT seen in CI run 29850614559.
    const { command, args } = npmInvocation([
      'exec',
      '--package',
      replicaTarball,
      '--',
      'llxprt',
      '--version',
    ]);
    const r = spawnSync(command, args, {
      cwd: cleanDir,
      encoding: 'utf8',
      timeout: NPM_EXEC_TIMEOUT_MS,
      maxBuffer: SPAWN_MAX_BUFFER,
    });
    if (r.error) {
      throw new Error(`npm exec spawn failed: ${r.error.message}`);
    }
    if (r.signal) {
      throw new Error(`npm exec terminated by signal ${r.signal}`);
    }
    if (r.status !== 0) {
      throw new Error(
        `npm exec --version failed (exit ${r.status}): ${r.stderr || r.stdout}`,
      );
    }
    assert(
      VERSION_RE.test(r.stdout.trim()),
      `npm exec --version unexpected output: ${r.stdout}`,
    );
    assert(
      !existsSync(join(cleanDir, 'node_modules')),
      `npm exec polluted the clean dir with node_modules — must be ephemeral (npx cache only)`,
    );
    assert(
      !existsSync(join(cleanDir, 'node_modules', '.bin', 'llxprt.cmd')),
      `npm exec polluted clean dir with a local bin`,
    );
  });
}

module.exports = {
  buildProbeFixture,
  checkLauncherSentinels,
  checkVersionRuns,
  checkCmdArgFidelity,
  checkPwshArgFidelity,
  checkInjectionGuard,
  checkStdioForwarding,
  checkCmdExitCodePreservation,
  checkPwshExitPropagation,
  checkExecPathIsBundledBun,
  checkProcessTreeNoNode,
  checkMissingBun,
  checkCorruptBun,
  checkNpmExecEphemeral,
};
