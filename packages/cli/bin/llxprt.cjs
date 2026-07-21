#!/usr/bin/env node
"use strict";

// cli-bin.cts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_path2 = require("node:path");

// bun-candidate-policy.ts
var import_node_path = require("node:path");
var WINDOWS_BUN_CANDIDATE_PRIORITY = {
  "bin-native": 0,
  "direct-native": 1,
  "path-native": 2,
  wrapper: 3,
};
function orderWindowsBunCandidates(candidates) {
  return [...candidates].sort(
    (left, right) =>
      WINDOWS_BUN_CANDIDATE_PRIORITY[left.kind] -
      WINDOWS_BUN_CANDIDATE_PRIORITY[right.kind],
  );
}
function isWindowsBunWrapper(candidate) {
  return candidate.kind === "wrapper";
}
function classifyWindowsPathCandidate(path) {
  switch (import_node_path.win32.basename(path).toLowerCase()) {
    case "bun.exe":
      return { path, kind: "path-native" };
    case "bun.cmd":
      return { path, kind: "wrapper" };
    default:
      return null;
  }
}
function classifyWindowsPathCandidates(paths) {
  return paths.flatMap((path) => {
    const candidate = classifyWindowsPathCandidate(path);
    return candidate === null ? [] : [candidate];
  });
}

// cli-bin.cts
function runtimeModuleFilename(currentModule) {
  return currentModule.filename;
}
var launcherDir = import_node_path2.dirname(runtimeModuleFilename(module));
var BUN_RELAUNCH_ENV = "LLXPRT_BUN_RELAUNCHED";
var FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];
var SIGHUP_SELF_EXIT_DELAY_MS = 5000;
var ORPHAN_CHECK_INTERVAL_MS = 1e4;
var SIGHUP_EXIT_CODE = 129;
var SIGNAL_EXIT_CODES = {
  SIGHUP: SIGHUP_EXIT_CODE,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGILL: 132,
  SIGTRAP: 133,
  SIGABRT: 134,
  SIGBUS: 135,
  SIGFPE: 136,
  SIGKILL: 137,
  SIGUSR1: 138,
  SIGSEGV: 139,
  SIGUSR2: 140,
  SIGPIPE: 141,
  SIGALRM: 142,
  SIGTERM: 143,
  SIGBREAK: 149,
};
function ancestors(startDir) {
  const dirs = [];
  let dir = startDir;
  while (dir !== import_node_path2.dirname(dir)) {
    dirs.push(dir);
    dir = import_node_path2.dirname(dir);
  }
  dirs.push(dir);
  return dirs;
}
function isFile(path) {
  try {
    return import_node_fs.statSync(path).isFile();
  } catch {
    return false;
  }
}
function isExecutable(path) {
  try {
    import_node_fs.accessSync(path, import_node_fs.constants.X_OK);
    return isSpawnableUnixCandidate(path);
  } catch {
    return false;
  }
}
function isSpawnableUnixCandidate(path) {
  if (process.platform === "win32") {
    return true;
  }
  try {
    const firstBytes = import_node_fs.readFileSync(path).subarray(0, 4);
    const magic = firstBytes.toString("hex");
    return (
      firstBytes.toString("utf8").startsWith("#!") ||
      magic === "7f454c46" ||
      magic === "cffaedfe" ||
      magic === "feedfacf"
    );
  } catch {
    return false;
  }
}
function resolveEntry() {
  const packageRootEntry = import_node_path2.join(
    import_node_path2.dirname(launcherDir),
    "index.ts",
  );
  if (isFile(packageRootEntry)) {
    return packageRootEntry;
  }
  for (const dir of ancestors(launcherDir)) {
    const packageEntry = import_node_path2.join(dir, "index.ts");
    if (isFile(packageEntry) && import_node_path2.basename(dir) === "cli") {
      return packageEntry;
    }
    const repositoryEntry = import_node_path2.join(
      dir,
      "packages",
      "cli",
      "index.ts",
    );
    if (isFile(repositoryEntry)) {
      return repositoryEntry;
    }
  }
  return null;
}
function bunNames() {
  return ["bun"];
}
function directBunNames() {
  return ["bun.exe", "bun"];
}
function resolveBunFromNodeModules() {
  for (const dir of ancestors(launcherDir)) {
    for (const name of bunNames()) {
      const candidate = import_node_path2.join(
        dir,
        "node_modules",
        ".bin",
        name,
      );
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
    for (const name of directBunNames()) {
      const candidate = import_node_path2.join(
        dir,
        "node_modules",
        "bun",
        "bin",
        name,
      );
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}
function pathLookupTool() {
  if (process.platform !== "win32") {
    return "which";
  }
  const systemRoot = process.env["SystemRoot"];
  return systemRoot !== undefined &&
    import_node_path2.win32.isAbsolute(systemRoot)
    ? import_node_path2.win32.join(systemRoot, "System32", "where.exe")
    : "where.exe";
}
function pathCandidates() {
  const result = import_node_child_process.spawnSync(
    pathLookupTool(),
    ["bun"],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(["'])(.+?)\1$/, "$2"))
    .filter((candidate) => candidate.length > 0);
}
function resolveBunFromPath() {
  for (const candidate of pathCandidates()) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}
function windowsNodeModuleCandidates() {
  return ancestors(launcherDir).flatMap((dir) => [
    {
      path: import_node_path2.join(dir, "node_modules", ".bin", "bun.exe"),
      kind: "bin-native",
    },
    {
      path: import_node_path2.join(dir, "node_modules", ".bin", "bun.cmd"),
      kind: "wrapper",
    },
    {
      path: import_node_path2.join(
        dir,
        "node_modules",
        "bun",
        "bin",
        "bun.exe",
      ),
      kind: "direct-native",
    },
    {
      path: import_node_path2.join(
        dir,
        "node_modules",
        "bun",
        "bin",
        "bun.cmd",
      ),
      kind: "wrapper",
    },
  ]);
}
function windowsPathCandidates() {
  return classifyWindowsPathCandidates(pathCandidates());
}
function firstUsableCandidate(candidates) {
  for (const candidate of candidates) {
    if (isExecutable(candidate.path)) {
      return candidate.path;
    }
  }
  return null;
}
function resolveWindowsBun() {
  const localCandidates = orderWindowsBunCandidates(
    windowsNodeModuleCandidates(),
  );
  const localNative = firstUsableCandidate(
    localCandidates.filter((candidate) => !isWindowsBunWrapper(candidate)),
  );
  if (localNative !== null) {
    return localNative;
  }
  return firstUsableCandidate(
    orderWindowsBunCandidates([
      ...localCandidates.filter(isWindowsBunWrapper),
      ...windowsPathCandidates(),
    ]),
  );
}
function resolveBun() {
  return process.platform === "win32"
    ? resolveWindowsBun()
    : (resolveBunFromNodeModules() ?? resolveBunFromPath());
}
function hasWindowsCmdMetaCharacter(arg) {
  return /[&|<>^()%!"\r\n]/.test(arg);
}
function isWindowsCmdShim(path) {
  return (
    process.platform === "win32" &&
    import_node_path2.basename(path).toLowerCase() === "bun.cmd"
  );
}
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
function bunLaunchErrorMessage(bunPath, error) {
  return `Failed to launch Bun at "${bunPath}" (${describeError(error)}). Reinstall dependencies with "npm install" to restore the bundled Bun, or ensure a working Bun is executable and on your PATH (see https://bun.sh).`;
}
function fatalExit(exit, message) {
  process.stderr.write(`${message}
`);
  exit(43);
}
function resolveBunOrFail(exit, resolveBunFn) {
  const bunPath = resolveBunFn === undefined ? resolveBun() : resolveBunFn();
  if (bunPath === null) {
    fatalExit(
      exit,
      'Bun runtime was not found. Install it with "npm install" (it is bundled as the "bun" dependency) or install Bun directly from https://bun.sh and ensure it is on your PATH.',
    );
    return null;
  }
  return bunPath;
}
function resolveEntryOrFail(exit, resolveEntryFn) {
  const entry =
    resolveEntryFn === undefined ? resolveEntry() : resolveEntryFn();
  if (entry === null) {
    fatalExit(
      exit,
      "Could not locate the LLxprt Code TypeScript entry point (packages/cli/index.ts). Your installation may be corrupt; reinstall @vybestack/llxprt-code.",
    );
    return null;
  }
  return entry;
}
function windowsCommandProcessor() {
  const systemRoot = process.env["SystemRoot"];
  return systemRoot !== undefined &&
    import_node_path2.win32.isAbsolute(systemRoot)
    ? import_node_path2.win32.join(systemRoot, "System32", "cmd.exe")
    : "cmd.exe";
}
function quoteWindowsCommandArgument(arg) {
  const escapedTrailingBackslashes = arg.replace(/\\+$/, (backslashes) =>
    backslashes.repeat(2),
  );
  return `"${escapedTrailingBackslashes}"`;
}
function buildSpawnInvocation(bunPath, entry) {
  const args = [entry, ...process.argv.slice(2)];
  if (!isWindowsCmdShim(bunPath)) {
    return { command: bunPath, args };
  }
  if (hasWindowsCmdMetaCharacter(bunPath)) {
    return {
      error:
        "Cannot safely launch the bundled bun.cmd shim from a path containing Windows command-shell metacharacters. Install Bun directly so bun.exe is on PATH, or move the installation to a path without shell metacharacters.",
    };
  }
  if (args.some(hasWindowsCmdMetaCharacter)) {
    return {
      error:
        "Cannot safely forward arguments containing Windows command-shell metacharacters through the bundled bun.cmd shim. Install Bun directly so bun.exe is on PATH, or remove shell metacharacters from the CLI arguments.",
    };
  }
  const commandLine = [bunPath, ...args]
    .map(quoteWindowsCommandArgument)
    .join(" ");
  return {
    command: windowsCommandProcessor(),
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}
function createChildEnv() {
  return { ...process.env, [BUN_RELAUNCH_ENV]: "true" };
}
async function runCliBin(options = {}) {
  const exit = options.exit ?? process.exit;
  const spawnFn = options.spawn ?? import_node_child_process.spawn;
  const bunPath = resolveBunOrFail(exit, options.resolveBun);
  if (bunPath === null) {
    return;
  }
  const entry = resolveEntryOrFail(exit, options.resolveEntry);
  if (entry === null) {
    return;
  }
  const built = buildSpawnInvocation(bunPath, entry);
  if ("error" in built) {
    fatalExit(exit, built.error);
    return;
  }
  let child;
  try {
    child = spawnFn(built.command, built.args, {
      stdio: "inherit",
      env: createChildEnv(),
      windowsVerbatimArguments: built.windowsVerbatimArguments,
    });
  } catch (error) {
    fatalExit(exit, bunLaunchErrorMessage(bunPath, error));
    return;
  }
  attachChildHandlers(child, bunPath, exit, {
    getPpid: options.getPpid,
    selfExitDelayMs: options.selfExitDelayMs,
    orphanCheckIntervalMs: options.orphanCheckIntervalMs,
  });
}
function attachChildHandlers(child, bunPath, exit, options = {}) {
  let settled = false;
  let childExitInfo = null;
  let hangupExitTimer = null;
  let orphanCheckTimer = null;
  const getPpid = options.getPpid ?? (() => process.ppid);
  const selfExitDelayMs = options.selfExitDelayMs ?? SIGHUP_SELF_EXIT_DELAY_MS;
  const orphanCheckIntervalMs =
    options.orphanCheckIntervalMs ?? ORPHAN_CHECK_INTERVAL_MS;
  const cleanupListeners = () => {
    child.off("close", onClose);
    child.off("error", onError);
    child.off("exit", onChildExit);
    for (const signal of FORWARDED_SIGNALS) {
      process.off(signal, forwardSignal);
    }
    process.off("beforeExit", onBeforeExit);
    if (hangupExitTimer !== null) {
      clearTimeout(hangupExitTimer);
      hangupExitTimer = null;
    }
    if (orphanCheckTimer !== null) {
      clearInterval(orphanCheckTimer);
      orphanCheckTimer = null;
    }
  };
  const prepareSettle = () => {
    if (settled) {
      return false;
    }
    settled = true;
    cleanupListeners();
    child.on("error", () => {});
    return true;
  };
  const settle = (exitCode) => {
    if (!prepareSettle()) {
      return;
    }
    exit(exitCode);
  };
  const exitCodeFromChild = (code, signal) => {
    if (code !== null) {
      return code;
    }
    if (signal !== null) {
      return SIGNAL_EXIT_CODES[signal] ?? 1;
    }
    return 1;
  };
  const forwardSignal = (signal) => {
    if (settled) {
      return;
    }
    try {
      child.kill(signal);
    } catch {
      if (signal !== "SIGHUP") {
        return;
      }
    }
    if (signal === "SIGHUP" && hangupExitTimer === null) {
      hangupExitTimer = setTimeout(() => {
        settle(SIGHUP_EXIT_CODE);
      }, selfExitDelayMs);
      hangupExitTimer.unref();
    }
  };
  const onClose = (code, signal) => {
    settle(exitCodeFromChild(code, signal));
  };
  const onError = (error) => {
    if (!prepareSettle()) {
      return;
    }
    try {
      child.kill("SIGTERM");
    } catch (killError) {
      process.stderr
        .write(`Failed to stop Bun after its spawn error (${describeError(killError)}).
`);
    }
    process.stderr.write(`${bunLaunchErrorMessage(bunPath, error)}
`);
    exit(43);
  };
  const onChildExit = (code, signal) => {
    childExitInfo = { code, signal };
  };
  const onBeforeExit = () => {
    if (settled || childExitInfo === null) {
      return;
    }
    settle(exitCodeFromChild(childExitInfo.code, childExitInfo.signal));
  };
  const checkOrphaned = () => {
    if (settled || childExitInfo === null) {
      return;
    }
    let orphaned;
    try {
      orphaned = getPpid() === 1;
    } catch {
      return;
    }
    if (orphaned) {
      settle(exitCodeFromChild(childExitInfo.code, childExitInfo.signal));
    }
  };
  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, forwardSignal);
  }
  child.on("error", onError);
  child.on("close", onClose);
  child.on("exit", onChildExit);
  process.on("beforeExit", onBeforeExit);
  orphanCheckTimer = setInterval(checkOrphaned, orphanCheckIntervalMs);
  orphanCheckTimer.unref();
}
module.exports = { runCliBin };
if (Object.is(module, require.main)) {
  runCliBin().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}
`);
    process.exit(1);
  });
}
