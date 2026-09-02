#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Executable fake container engine for the #3450 engine-owned dependency
 * volume behavior tests.
 *
 * The script is installed on PATH under the names `docker` and `podman`
 * (see fake-dependency-engine-harness.ts), so production `spawnSync(engine,
 * argv)` calls execute it for real. It keeps persistent state under the
 * directory named by FAKE_ENGINE_STATE:
 *
 *   state.json   volumes, containers, and the full invocation log
 *   volumes/<n>/ real directories backing each named volume, so the
 *                production init script genuinely runs `chmod 1777` and the
 *                emptiness check against them
 *
 * Engine semantics it preserves (the lifecycle depends on each one):
 *   - `volume create` of an existing name fails
 *   - `volume rm -f` of a missing volume succeeds (idempotent release)
 *   - `volume rm` fails while any recorded container holds the volume
 *   - `rm -f` of a missing container fails with "No such container"
 *   - `run --rm` removes the container record when the command finishes;
 *     without `--rm` the record persists (an attached container keeps its
 *     volumes in use)
 *   - a `run ... sh -c <script> <name> <dst-args...>` invocation maps each
 *     positional argument equal to a volume mount destination onto that
 *     volume's real directory and executes the script through the real `sh`
 *
 * Fault injection is file-based: creating a knob file makes the matching
 * operation fail once (fail-volume-create-once, fail-run-once,
 * fail-volume-rm-once).
 *
 * #3469 additions: `network inspect|create|connect`, value-consuming run
 * flags (-p/--publish, -v/--volume, --env/-e, --env-file, --authfile), and
 * `sh -lc` command scripts, so the proxy-sidecar launch path runs against
 * the same real engine semantics as the main container path.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const FAKE_ENGINE_STATE_ENV = 'FAKE_ENGINE_STATE';

export interface FakeEngineVolumeRecord {
  readonly labels: Record<string, string>;
}

export interface FakeEngineContainerRecord {
  readonly volumes: string[];
  readonly labels: Record<string, string>;
}

export interface FakeEngineNetworkRecord {
  readonly containers: string[];
}

export interface FakeEngineState {
  volumes: Record<string, FakeEngineVolumeRecord>;
  containers: Record<string, FakeEngineContainerRecord>;
  networks: Record<string, FakeEngineNetworkRecord>;
  invocations: string[][];
  counters: Record<string, number>;
}

/** Absolute path of this module; the harness symlinks it onto PATH. */
export const FAKE_ENGINE_SCRIPT_PATH = fileURLToPath(import.meta.url);

function stateRootOrDie(): string {
  const root = process.env.FAKE_ENGINE_STATE;
  if (root === undefined || root === '') {
    process.stderr.write('fake engine: FAKE_ENGINE_STATE is not set\n');
    process.exit(125);
  }
  return root;
}

function emptyState(): FakeEngineState {
  return {
    volumes: {},
    containers: {},
    networks: {},
    invocations: [],
    counters: {},
  };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodeLabels(value: unknown): Record<string, string> {
  if (!isUnknownRecord(value)) return {};
  const labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(value)) {
    if (typeof label === 'string') labels[key] = label;
  }
  return labels;
}

function decodeVolumes(value: unknown): Record<string, FakeEngineVolumeRecord> {
  if (!isUnknownRecord(value)) return {};
  const volumes: Record<string, FakeEngineVolumeRecord> = {};
  for (const [name, record] of Object.entries(value)) {
    if (isUnknownRecord(record)) {
      volumes[name] = { labels: decodeLabels(record.labels) };
    }
  }
  return volumes;
}

function decodeContainers(
  value: unknown,
): Record<string, FakeEngineContainerRecord> {
  if (!isUnknownRecord(value)) return {};
  const containers: Record<string, FakeEngineContainerRecord> = {};
  for (const [name, record] of Object.entries(value)) {
    if (!isUnknownRecord(record) || !Array.isArray(record.volumes)) continue;
    const volumeNames = record.volumes.filter(
      (volume): volume is string => typeof volume === 'string',
    );
    containers[name] = {
      volumes: volumeNames,
      labels: decodeLabels(record.labels),
    };
  }
  return containers;
}

function decodeNetworks(
  value: unknown,
): Record<string, FakeEngineNetworkRecord> {
  if (!isUnknownRecord(value)) return {};
  const networks: Record<string, FakeEngineNetworkRecord> = {};
  for (const [name, record] of Object.entries(value)) {
    if (!isUnknownRecord(record) || !Array.isArray(record.containers)) continue;
    const members = record.containers.filter(
      (member): member is string => typeof member === 'string',
    );
    networks[name] = { containers: members };
  }
  return networks;
}

function decodeInvocations(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((invocation) => {
    if (!Array.isArray(invocation)) return [];
    if (!invocation.every((argument) => typeof argument === 'string'))
      return [];
    return [
      invocation.filter(
        (argument): argument is string => typeof argument === 'string',
      ),
    ];
  });
}

function decodeCounters(value: unknown): Record<string, number> {
  if (!isUnknownRecord(value)) return {};
  const counters: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === 'number' && Number.isInteger(count) && count >= 0) {
      counters[key] = count;
    }
  }
  return counters;
}

export function decodeFakeEngineState(value: unknown): FakeEngineState {
  if (!isUnknownRecord(value)) return emptyState();
  return {
    volumes: decodeVolumes(value.volumes),
    containers: decodeContainers(value.containers),
    networks: decodeNetworks(value.networks),
    invocations: decodeInvocations(value.invocations),
    counters: decodeCounters(value.counters),
  };
}

function loadState(root: string): FakeEngineState {
  try {
    const loaded: unknown = JSON.parse(
      fs.readFileSync(path.join(root, 'state.json'), 'utf8'),
    );
    return decodeFakeEngineState(loaded);
  } catch {
    return emptyState();
  }
}

function saveState(root: string, state: FakeEngineState): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'state.json'),
    JSON.stringify(state, null, 2),
  );
}

function volumeDir(root: string, name: string): string {
  return path.join(root, 'volumes', name);
}

function takeKnob(root: string, knob: string): boolean {
  const knobPath = path.join(root, knob);
  if (!fs.existsSync(knobPath)) return false;
  fs.rmSync(knobPath);
  return true;
}

/**
 * Ordinal knob: its file content names the 1-based invocation that must
 * fail (for example `2` fails the second matching operation).
 */
function knobOrdinal(root: string, knob: string): number | undefined {
  const knobPath = path.join(root, knob);
  if (!fs.existsSync(knobPath)) return undefined;
  const ordinal = Number.parseInt(fs.readFileSync(knobPath, 'utf8'), 10);
  return Number.isInteger(ordinal) && ordinal >= 1 ? ordinal : 1;
}

function takeOrdinalKnob(
  root: string,
  knob: string,
  invocation: number,
): boolean {
  const ordinal = knobOrdinal(root, knob);
  if (ordinal !== invocation) return false;
  fs.rmSync(path.join(root, knob));
  return true;
}

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function parseLabel(spec: string): readonly [string, string] {
  const separator = spec.indexOf('=');
  if (separator <= 0) fail(`fake engine: invalid label '${spec}'`);
  return [spec.slice(0, separator), spec.slice(separator + 1)];
}

function parseFilter(spec: string): readonly [string, string] {
  const separator = spec.indexOf('=');
  if (separator <= 0) fail(`fake engine: invalid filter '${spec}'`);
  return [spec.slice(0, separator), spec.slice(separator + 1)];
}

interface ParsedRun {
  readonly mounts: ReadonlyMap<string, string>;
  readonly labels: Record<string, string>;
  readonly containerName: string;
  readonly removeOnExit: boolean;
  readonly image: string;
  readonly command: string[];
}

const RUN_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-p',
  '--publish',
  '-v',
  '--volume',
  '--env',
  '-e',
  '--env-file',
  '--authfile',
  '--mount',
  '--label',
  '--name',
  '--user',
  '--network',
  '--security-opt',
  '--pull',
  '--workdir',
  '--hostname',
]);

const RUN_INLINE_VALUE_FLAGS: readonly string[] = [
  '--pull=',
  '--user=',
  '--cap-add=',
  '--cap-drop',
  '--pids-limit=',
  '--memory=',
  '--cpus=',
];

function parseMountSpec(spec: string, mounts: Map<string, string>): void {
  const fields = spec.split(',');
  let source: string | undefined;
  let destination: string | undefined;
  for (const field of fields) {
    if (field.startsWith('type=') && field !== 'type=volume') {
      fail(`fake engine: unsupported mount '${spec}'`);
    }
    if (field.startsWith('src=')) source = field.slice(4);
    if (field.startsWith('dst=')) destination = field.slice(4);
  }
  if (source === undefined || destination === undefined) {
    fail(`fake engine: unsupported mount '${spec}'`);
  }
  mounts.set(destination, source);
}

function applyRunValueFlag(
  flag: string,
  value: string,
  mounts: Map<string, string>,
  labels: Record<string, string>,
  naming: { name?: string },
): void {
  switch (flag) {
    case '--mount':
      parseMountSpec(value, mounts);
      return;
    case '--label': {
      const [key, labelValue] = parseLabel(value);
      labels[key] = labelValue;
      return;
    }
    case '--name':
      naming.name = value;
      return;
    default:
      return;
  }
}

function parseRunArgv(argv: string[]): ParsedRun {
  const mounts = new Map<string, string>();
  const labels: Record<string, string> = {};
  const naming: { name?: string } = {};
  let removeOnExit = false;
  let index = 1;
  for (; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--rm') {
      removeOnExit = true;
      continue;
    }
    if (
      token === '--init' ||
      token === '-i' ||
      token === '-t' ||
      token.startsWith('--cap-drop')
    ) {
      continue;
    }
    if (RUN_VALUE_FLAGS.has(token)) {
      const value = argv[index + 1];
      if (value === undefined) fail(`fake engine: missing value for ${token}`);
      applyRunValueFlag(token, value, mounts, labels, naming);
      index++;
      continue;
    }
    if (
      RUN_INLINE_VALUE_FLAGS.some((prefix) => token.startsWith(prefix)) ||
      token === '--cap-add'
    ) {
      const inline = token.indexOf('=');
      if (inline > 0) {
        applyRunValueFlag(
          token.slice(0, inline),
          token.slice(inline + 1),
          mounts,
          labels,
          naming,
        );
      }
      continue;
    }
    if (token.startsWith('-')) {
      fail(`fake engine: unsupported run flag '${token}'`);
    }
    break;
  }
  const image = argv[index];
  if (image === undefined) fail('fake engine: run requires an image');
  const containerName = naming.name ?? `fake-engine-${randomUUID()}`;
  return {
    mounts,
    labels,
    containerName,
    removeOnExit,
    image,
    command: argv.slice(index + 1),
  };
}

function volumeIsAttached(state: FakeEngineState, volume: string): boolean {
  return Object.values(state.containers).some((container) =>
    container.volumes.includes(volume),
  );
}

function cmdVolumeCreate(
  root: string,
  state: FakeEngineState,
  argv: string[],
): void {
  state.counters.volumeCreate = (state.counters.volumeCreate ?? 0) + 1;
  if (
    takeOrdinalKnob(root, 'fail-volume-create-on', state.counters.volumeCreate)
  ) {
    saveState(root, state);
    fail('fake engine: volume create failed by request');
  }
  const labels: Record<string, string> = {};
  let name = '';
  for (let index = 2; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--label') {
      const value = argv[index + 1];
      if (value === undefined) fail('fake engine: --label requires a value');
      const [key, labelValue] = parseLabel(value);
      labels[key] = labelValue;
      index++;
      continue;
    }
    if (token.startsWith('-')) continue;
    name = token;
  }
  if (name === '') fail('fake engine: volume create requires a name');
  if (state.volumes[name] !== undefined) {
    fail(`fake engine: volume '${name}' already exists`);
  }
  fs.mkdirSync(volumeDir(root, name), { recursive: true });
  state.volumes[name] = { labels };
  saveState(root, state);
  process.stdout.write(`${name}\n`);
}

function cmdVolumeRm(
  root: string,
  state: FakeEngineState,
  argv: string[],
): void {
  const force = argv.includes('-f') || argv.includes('--force');
  if (takeKnob(root, 'fail-volume-rm-once')) {
    fail('fake engine: volume rm failed by request');
  }
  const names = argv.slice(2).filter((token) => !token.startsWith('-'));
  let failure = '';
  for (const name of names) {
    if (volumeIsAttached(state, name)) {
      failure = `volume '${name}' is in use`;
      continue;
    }
    if (state.volumes[name] === undefined) {
      if (!force) failure = `no such volume '${name}'`;
      continue;
    }
    fs.rmSync(volumeDir(root, name), { recursive: true, force: true });
    delete state.volumes[name];
  }
  saveState(root, state);
  if (failure !== '') fail(failure);
}

function cmdVolumeLs(state: FakeEngineState, argv: string[]): void {
  let labelKey = '';
  let labelValue = '';
  for (let index = 2; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--filter') {
      const value = argv[index + 1];
      if (value === undefined || !value.startsWith('label=')) {
        fail('fake engine: volume ls supports only --filter label=k[=v]');
      }
      const [key, filterValue] = parseFilter(value.slice('label='.length));
      labelKey = key;
      labelValue = filterValue;
      index++;
      continue;
    }
    if (token === '--format') {
      index++;
      continue;
    }
    if (token.startsWith('-')) continue;
  }
  const names = Object.keys(state.volumes)
    .filter((name) => {
      if (labelKey === '') return true;
      const labels = state.volumes[name]?.labels ?? {};
      return labelValue === ''
        ? labels[labelKey] !== undefined
        : labels[labelKey] === labelValue;
    })
    .sort();
  if (names.length > 0) process.stdout.write(`${names.join('\n')}\n`);
}

function cmdPs(state: FakeEngineState, argv: string[]): void {
  let labelKey = '';
  let labelValue = '';
  for (let index = 1; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--filter') {
      const value = argv[index + 1];
      if (value === undefined || !value.startsWith('label=')) {
        fail('fake engine: ps supports only --filter label=k[=v]');
      }
      const [key, filterValue] = parseFilter(value.slice('label='.length));
      labelKey = key;
      labelValue = filterValue;
      index++;
      continue;
    }
    if (token === '--format') {
      index++;
      continue;
    }
    if (token.startsWith('-')) continue;
  }
  const names = Object.keys(state.containers)
    .filter((name) => {
      if (labelKey === '') return true;
      const labels = state.containers[name]?.labels ?? {};
      return labelValue === ''
        ? labels[labelKey] !== undefined
        : labels[labelKey] === labelValue;
    })
    .sort();
  if (names.length > 0) process.stdout.write(`${names.join('\n')}\n`);
}

function cmdRm(root: string, state: FakeEngineState, argv: string[]): void {
  const names = argv.slice(1).filter((token) => !token.startsWith('-'));
  let missing = '';
  for (const name of names) {
    if (state.containers[name] === undefined) {
      missing = name;
      continue;
    }
    delete state.containers[name];
  }
  saveState(root, state);
  if (missing !== '') {
    fail(`No such container: ${missing}`);
  }
}

/** Last non-flag argument from `start` onward (engine names are positional). */
function trailingName(argv: string[], start: number): string {
  let name = '';
  for (let index = start; index < argv.length; index++) {
    if (!argv[index].startsWith('-')) name = argv[index];
  }
  return name;
}

function cmdNetwork(
  root: string,
  state: FakeEngineState,
  argv: string[],
): void {
  const verb = argv[1];
  if (verb === 'inspect') {
    // The production launch only probes with `inspect X || create X`; every
    // probe answering "exists" keeps `create` on its real (unprobed) path.
    process.exit(0);
  }
  if (verb === 'create') {
    const name = trailingName(argv, 2);
    if (name === '') fail('fake engine: network create requires a name');
    if (state.networks[name] === undefined) {
      state.networks[name] = { containers: [] };
    }
    saveState(root, state);
    return;
  }
  if (verb === 'connect') {
    const names = argv.slice(2).filter((token) => !token.startsWith('-'));
    const [network, container] = names;
    if (network === undefined || container === undefined) {
      fail('fake engine: network connect requires a network and a container');
    }
    if (state.containers[container] === undefined) {
      fail(`No such container: ${container}`);
    }
    const members = state.networks[network]?.containers ?? [];
    state.networks[network] = { containers: [...members, container] };
    saveState(root, state);
    return;
  }
  fail(`fake engine: unsupported network verb '${verb ?? ''}'`);
}

function cmdRun(root: string, state: FakeEngineState, argv: string[]): void {
  const run = parseRunArgv(argv);
  const volumeNames = [...run.mounts.values()];
  state.containers[run.containerName] = {
    volumes: volumeNames,
    labels: run.labels,
  };
  saveState(root, state);
  if (takeKnob(root, 'fail-run-once')) {
    fail('fake engine: run failed by request');
  }
  const finish = (): void => {
    if (run.removeOnExit) {
      delete state.containers[run.containerName];
      saveState(root, state);
    }
  };
  if (
    run.command[0] === 'sh' &&
    (run.command[1] === '-c' || run.command[1] === '-lc')
  ) {
    const script = run.command[2];
    if (script === undefined) fail('fake engine: sh -c requires a script');
    const positional = run.command.slice(3).map((argument) => {
      const source = run.mounts.get(argument);
      return source === undefined ? argument : volumeDir(root, source);
    });
    // The login flag is emulated away: host /bin/sh (dash) rejects -l, and
    // the fake only needs the script semantics, not a login environment.
    const child = spawnSync('sh', ['-c', script, ...positional], {
      stdio: 'inherit',
    });
    finish();
    process.exit(child.status ?? 1);
  }
  finish();
}

function main(): void {
  const root = stateRootOrDie();
  const argv = process.argv.slice(2);
  const state = loadState(root);
  state.invocations.push(argv);
  saveState(root, state);
  const subcommand = argv[0];
  const verb = argv[1];
  if (subcommand === 'volume' && verb === 'create') {
    cmdVolumeCreate(root, state, argv);
    return;
  }
  if (subcommand === 'volume' && verb === 'rm') {
    cmdVolumeRm(root, state, argv);
    return;
  }
  if (subcommand === 'volume' && verb === 'ls') {
    cmdVolumeLs(state, argv);
    return;
  }
  if (subcommand === 'ps') {
    cmdPs(state, argv);
    return;
  }
  if (subcommand === 'rm') {
    cmdRm(root, state, argv);
    return;
  }
  if (subcommand === 'network') {
    cmdNetwork(root, state, argv);
    return;
  }
  if (subcommand === 'run') {
    cmdRun(root, state, argv);
    return;
  }
  fail(`fake engine: unsupported command '${subcommand ?? ''}'`);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  fs.realpathSync(invokedPath) === fs.realpathSync(FAKE_ENGINE_SCRIPT_PATH)
) {
  main();
}
