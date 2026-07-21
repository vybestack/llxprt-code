'use strict';

/**
 * Behavioral checks for the Windows installed-command smoke. Each function
 * corresponds to one check group; all 23 behavioral checks live here. They
 * share the installed-package fixture and report failures via the assert
 * helper so a single summary is produced at the end.
 */

const { spawnSync } = require('node:child_process');
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
} = require('./constants.cjs');
const {
  probeArg,
  parseProbeOutput,
  invokeCmd,
  invokePwsh,
} = require('./launcher-invocation.cjs');
const { findBundledBun, samePath, copyTree } = require('./package-layout.cjs');
const {
  sleepMs,
  inspectProcessTreeSync,
  spawn,
} = require('./process-helpers.cjs');

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
    const r = spawnSync('cmd', ['/c', cmdPath, '--version'], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PATH: CONSTRAINED_PATH },
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
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `& '${ps1Path}' --version`],
      {
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, PATH: CONSTRAINED_PATH },
      },
    );
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
      const r = invokeCmd(cmdPath, [probeArg({ marker })]);
      if (r.status !== 0) {
        throw new Error(
          `cmd probe exited ${r.status} for marker ${JSON.stringify(marker)}: ${r.stderr}`,
        );
      }
      const payload = parseProbeOutput(r.stdout);
      const forwardedArg = payload.argv.find((a) =>
        a.startsWith('LLXPRT_PROBE='),
      );
      assert(
        forwardedArg !== undefined,
        `marker ${JSON.stringify(marker)}: LLXPRT_PROBE= not present in argv`,
      );
      const parsed = JSON.parse(forwardedArg.slice('LLXPRT_PROBE='.length));
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
      const r = invokePwsh(ps1Path, [probeArg({ marker })]);
      if (r.status !== 0) {
        throw new Error(
          `ps1 probe exited ${r.status} for marker ${JSON.stringify(marker)}: ${r.stderr}`,
        );
      }
      const payload = parseProbeOutput(r.stdout);
      const forwardedArg = payload.argv.find((a) =>
        a.startsWith('LLXPRT_PROBE='),
      );
      assert(
        forwardedArg !== undefined,
        `marker ${JSON.stringify(marker)}: LLXPRT_PROBE= not present in argv`,
      );
      const parsed = JSON.parse(forwardedArg.slice('LLXPRT_PROBE='.length));
      assert(
        parsed.marker === marker,
        `marker ${JSON.stringify(marker)} round-trip mismatch: got ${JSON.stringify(parsed.marker)}`,
      );
    }
  });
}

function checkInjectionGuard(fixture, tempDir) {
  runStep('injection-guard', () => {
    const cmdPath = join(fixture.fixtureDir, 'llxprt.cmd');
    const injectionFile = join(tempDir, 'injected-sentinel.txt');
    const r = invokeCmd(cmdPath, [probeArg({ injectionPath: injectionFile })]);
    if (r.status !== 0) {
      throw new Error(`injection probe exited ${r.status}: ${r.stderr}`);
    }
    const payload = parseProbeOutput(r.stdout);
    assert(
      payload.injectionCreated === false,
      `injection sentinel was created at ${injectionFile} — launcher leaked shell metacharacters`,
    );
    assert(
      !existsSync(injectionFile),
      `injection sentinel file exists at ${injectionFile}`,
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
    for (const code of [0, 1, 5, 7, 42, 193, 9009]) {
      const r = invokeCmd(cmdPath, [probeArg({ exit: code })]);
      assert(
        r.status === code,
        `cmd did not preserve exit ${code}: got ${r.status} (stderr=${JSON.stringify(r.stderr)})`,
      );
    }
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
  runStep('execpath-is-bundled-bun', () => {
    const cmdPath = join(fixture.fixtureDir, 'llxprt.cmd');
    const r = invokeCmd(cmdPath, [probeArg({})]);
    if (r.status !== 0) {
      throw new Error(`execpath probe exited ${r.status}: ${r.stderr}`);
    }
    const payload = parseProbeOutput(r.stdout);
    const expectedBun = findBundledBun(fixture.fixturePkgRoot);
    assert(
      samePath(payload.execPath, expectedBun),
      `execPath ${payload.execPath} is not the package-local bundled bun.exe (${expectedBun})`,
    );
  });
}

function checkProcessTreeNoNode(fixture) {
  runStep('process-tree-bun-present-node-absent', () => {
    const cmdPath = join(fixture.fixtureDir, 'llxprt.cmd');
    const child = spawn('cmd', ['/c', cmdPath, probeArg({ long: true })], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: CONSTRAINED_PATH },
      windowsHide: true,
    });
    let stdout = '';
    let exitedEarly = false;
    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    child.on('exit', () => {
      exitedEarly = true;
    });

    const readyDeadline = Date.now() + 12_000;
    while (
      Date.now() < readyDeadline &&
      !stdout.includes('__LLXPRT_PROBE_LONG_RUNNING__') &&
      !exitedEarly
    ) {
      sleepMs(100);
    }
    if (exitedEarly) {
      throw new Error(
        `launcher child exited before tree inspection (stdout=${JSON.stringify(stdout)})`,
      );
    }
    if (!stdout.includes('__LLXPRT_PROBE_LONG_RUNNING__')) {
      throw new Error(
        `probe did not report long-running within timeout (stdout=${JSON.stringify(stdout)})`,
      );
    }

    const treeInfo = inspectProcessTreeSync(child.pid);
    try {
      child.kill();
    } catch {
      // best effort
    }

    assert(
      treeInfo.bunPresent,
      `bun.exe not found in launcher child tree. descendants=${JSON.stringify(treeInfo.descendants)}`,
    );
    assert(
      !treeInfo.nodePresent,
      `node.exe found in launcher child tree (must be absent). descendants=${JSON.stringify(treeInfo.descendants)}`,
    );
  });
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
    const npmCache = join(tempDir, 'npm-exec-cache');
    const r = spawnSync(
      'npm',
      ['exec', '--package', replicaTarball, '--', 'llxprt', '--version'],
      {
        cwd: cleanDir,
        encoding: 'utf8',
        timeout: 300_000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, npm_config_cache: npmCache },
      },
    );
    if (r.status !== 0) {
      throw new Error(
        `npm exec --version exited ${r.status}: ${r.stderr || r.stdout}`,
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
