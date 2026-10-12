/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { isBuiltin } from 'node:module';

export interface EntryManifest {
  readonly packages?: readonly string[];
  readonly packageDirectories?: readonly string[];
  readonly testPackages?: readonly string[];
  readonly files?: readonly string[];
  readonly generated?: Readonly<Record<string, string>>;
  readonly requiredClosure?: readonly string[];
  readonly identities?: ReadonlyArray<{
    readonly compilerConfig: string;
    readonly from: string;
    readonly specifier: string;
    readonly source: string;
  }>;
  readonly verify?: (workspace: string) => void;
}
export interface SourceInventory {
  readonly file: string;
  readonly classification:
    | 'production'
    | 'public-testing-export'
    | 'excluded-test';
  readonly publicTestingExport: boolean;
  readonly compilerConfig?: string;
  readonly reason: string;
}
export interface SourceSelection {
  readonly gaps: readonly string[];
  readonly files: readonly string[];
  readonly entries: readonly string[];
  readonly inventory: readonly SourceInventory[];
}
export function workspaceSourcePath(workspace: string, file: string): string {
  const path = resolve(workspace, file);
  const local = relative(workspace, path);
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error(`Path outside audit workspace: ${file}`);
  return path;
}
export function isTestSource(file: string): boolean {
  return (
    /\.(?:test|spec|fixture|bun)\./.test(file) ||
    /(?:^|[/\\])(?:__tests__|__fixtures__|fixtures|__mocks__|test|tests|test-utils|test-bun|integration-tests)(?:[/\\]|$)/.test(
      file,
    ) ||
    /(?:^|[/\\]|[.-])(?:test-helpers?|test-utils)\./.test(file) ||
    /(?:^|[/\\])[^/\\]*TestSetup\.[cm]?[jt]sx?$/.test(file)
  );
}
function sourceFile(file: string): boolean {
  return (
    /\.(?:tsx?|mts|cts|[cm]?js)$/.test(file) &&
    !/\.d\.(?:ts|mts|cts)$/.test(file)
  );
}
function emittedSiblingSource(file: string): string | undefined {
  if (!file.endsWith('.js')) return undefined;
  const stem = file.slice(0, -3);
  const source = [`${stem}.ts`, `${stem}.tsx`].find(existsSync);
  if (!source) return undefined;
  if (existsSync(`${stem}.d.ts`)) return source;
  const map = `${file}.map`;
  if (!existsSync(map)) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(map, 'utf8'));
  } catch {
    return undefined;
  }
  if (
    record(data) &&
    Array.isArray(data.sources) &&
    data.sources.some(
      (entry: unknown) =>
        typeof entry === 'string' && resolve(dirname(map), entry) === source,
    )
  )
    return source;
  return undefined;
}
function candidates(workspace: string, roots: readonly string[]): string[] {
  const walk = (path: string): string[] => {
    const stat = statSync(path);
    if (stat.isFile()) return sourceFile(path) ? [path] : [];
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      ['node_modules', 'dist', '.git'].includes(entry.name) ||
      entry.isSymbolicLink()
        ? []
        : walk(resolve(path, entry.name)),
    );
  };
  return [
    ...new Set(
      roots.flatMap((root) => {
        const files = walk(workspaceSourcePath(workspace, root));
        if (!files.some((file) => !isTestSource(file)))
          throw new Error(`Empty production source root: ${root}`);
        return files;
      }),
    ),
  ].sort();
}
export function discoverProductionSources(
  workspace: string,
  roots: readonly string[],
): string[] {
  return candidates(workspace, roots).filter(
    (file) => !isTestSource(file) && !emittedSiblingSource(file),
  );
}
export function compilerConfiguration(
  workspace: string,
  config: string,
): ts.ParsedCommandLine {
  const path = workspaceSourcePath(workspace, config);
  const loaded = ts.readConfigFile(path, ts.sys.readFile);
  if (loaded.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'),
    );
  return ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    dirname(path),
    undefined,
    path,
  );
}
export function absentCurrentAmbientExports<
  T extends {
    readonly file: string;
    readonly exportName: string;
    readonly absentReason?: string;
  },
>(
  workspace: string,
  policy: {
    readonly compilerConfig: string;
    readonly ambientSources: readonly T[];
  },
): readonly T[] {
  const roots = policy.ambientSources;
  const names = [
    ...new Set(
      roots
        .map((root) => workspaceSourcePath(workspace, root.file))
        .filter(existsSync),
    ),
  ];
  const configuration = compilerConfiguration(workspace, policy.compilerConfig);
  const program = ts.createProgram({
    rootNames: names,
    options: { ...configuration.options, allowJs: true, noEmit: true },
  });
  const checker = program.getTypeChecker();
  return roots.filter((root) => {
    if (!root.absentReason?.trim()) return false;
    const file = workspaceSourcePath(workspace, root.file);
    if (!existsSync(file)) return true;
    const source = program.getSourceFile(file);
    if (!source)
      throw new Error(`Missing current ambient source: ${root.file}`);
    const module = checker.getSymbolAtLocation(source);
    return (
      !module ||
      !checker
        .getExportsOfModule(module)
        .some((symbol) => symbol.name === root.exportName)
    );
  });
}

export function sourceOwner(
  workspace: string,
  file: string,
  configs: readonly string[],
): string | undefined {
  return [...configs]
    .sort((a, b) => dirname(b).length - dirname(a).length || a.localeCompare(b))
    .find((config) => {
      const root = dirname(workspaceSourcePath(workspace, config));
      return file.startsWith(`${root}${sep}`);
    });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return record(value) ? Object.values(value).flatMap(strings) : [];
}
function emittedSources(
  workspace: string,
  configs: readonly string[],
): Map<string, string> {
  const outputs = new Map<string, string>();
  for (const config of configs) {
    const build = resolve(
      dirname(workspaceSourcePath(workspace, config)),
      'tsconfig.build.json',
    );
    const parsed = compilerConfiguration(
      workspace,
      existsSync(build) ? build : config,
    );
    if (!parsed.options.outDir) continue;
    for (const file of parsed.fileNames.filter(sourceFile)) {
      for (const output of ts.getOutputFileNames(
        parsed,
        file,
        !ts.sys.useCaseSensitiveFileNames,
      ))
        outputs.set(output, file);
    }
  }
  return outputs;
}
function verifyPackageEnrollment(
  workspace: string,
  manifest: EntryManifest,
): void {
  for (const directory of manifest.packageDirectories ?? []) {
    for (const entry of readdirSync(workspaceSourcePath(workspace, directory), {
      withFileTypes: true,
    })) {
      const pkg = `${directory}/${entry.name}`;
      if (
        !entry.isDirectory() ||
        !existsSync(workspaceSourcePath(workspace, `${pkg}/package.json`))
      )
        continue;
      if (
        !(manifest.packages ?? []).includes(pkg) &&
        !(manifest.testPackages ?? []).includes(pkg)
      )
        throw new Error(`Undeclared shipped package: ${pkg}`);
    }
  }
}
function mapExportConditions(
  workspace: string,
  pkg: string,
  outputs: Map<string, string>,
  value: unknown,
): void {
  if (!record(value)) return;
  if (typeof value.bun === 'string' && sourceFile(value.bun)) {
    const source = workspaceSourcePath(workspace, `${pkg}/${value.bun}`);
    for (const target of strings(value).filter(
      (target) => !sourceFile(target) || /\.[cm]?js$/.test(target),
    )) {
      const emitted = workspaceSourcePath(workspace, `${pkg}/${target}`);
      if (sourceFile(target) && existsSync(emitted)) continue;
      if (!outputs.has(emitted)) outputs.set(emitted, source);
    }
  } else
    Object.values(value).forEach((child) =>
      mapExportConditions(workspace, pkg, outputs, child),
    );
}
function manifestEntries(
  workspace: string,
  manifest: EntryManifest,
  outputs: Map<string, string>,
  gaps: string[],
): Map<string, boolean> {
  manifest.verify?.(workspace);
  for (const [output, source] of Object.entries(manifest.generated ?? {})) {
    outputs.set(
      workspaceSourcePath(workspace, output),
      workspaceSourcePath(workspace, source),
    );
  }
  verifyPackageEnrollment(workspace, manifest);
  const entries = new Map<string, boolean>();
  const add = (target: string): void => {
    const absolute = workspaceSourcePath(workspace, target);
    const source = outputs.get(absolute) ?? absolute;
    if (!existsSync(source)) {
      gaps.push(`Missing entry source: ${target}`);
      return;
    }
    if (!sourceFile(source))
      throw new Error(`Unsupported entry coverage: ${target}`);
    entries.set(source, isTestSource(source));
  };
  for (const pkg of manifest.packages ?? []) {
    const data: unknown = JSON.parse(
      readFileSync(
        workspaceSourcePath(workspace, `${pkg}/package.json`),
        'utf8',
      ),
    );
    if (!record(data)) throw new Error(`Invalid package manifest: ${pkg}`);
    mapExportConditions(workspace, pkg, outputs, data.exports);
    for (const target of strings([
      data.exports,
      data.main,
      data.types,
      data.bin,
      strings(data.files).filter(
        (file) =>
          !file.startsWith('!') && /\.(?:[cm]?[jt]s|tsx|jsx)$/.test(file),
      ),
    ])) {
      if (target.endsWith('.json')) continue;
      if (target.includes('*'))
        throw new Error(
          `Unsupported wildcard entry coverage: ${pkg}/${target}`,
        );
      add(`${pkg}/${target}`);
    }
  }
  for (const file of manifest.files ?? []) add(file);
  return entries;
}
function isModuleCall(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(expression) && expression.text === 'require')
  );
}
function moduleSpecifiers(source: ts.SourceFile): string[] {
  const result: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    )
      result.push(node.argument.literal.text);
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    )
      result.push(node.moduleReference.expression.text);
    if (ts.isCallExpression(node) && isModuleCall(node.expression)) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument))
        result.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(result)];
}
function verifySourceIdentities(
  workspace: string,
  manifest: EntryManifest,
  options: ReadonlyMap<string, ts.CompilerOptions>,
): void {
  for (const identity of manifest.identities ?? []) {
    const compilerOptions = options.get(identity.compilerConfig);
    if (!compilerOptions)
      throw new Error(
        `Undeclared compiler identity project: ${identity.compilerConfig}`,
      );
    const resolved = ts.resolveModuleName(
      identity.specifier,
      workspaceSourcePath(workspace, identity.from),
      compilerOptions,
      ts.sys,
    ).resolvedModule;
    if (
      resolved?.resolvedFileName !==
      workspaceSourcePath(workspace, identity.source)
    )
      throw new Error(
        `Compiler source identity mismatch: ${identity.compilerConfig}: ${identity.specifier} -> ${resolved?.resolvedFileName ?? 'unresolved'}, expected ${identity.source}`,
      );
  }
}
interface ClosureItem {
  readonly file: string;
  readonly production: boolean;
  readonly reason: string;
}
class SourceClosure {
  constructor(
    private readonly workspace: string,
    private readonly configs: readonly string[],
    private readonly options: ReadonlyMap<string, ts.CompilerOptions>,
    private readonly outputs: ReadonlyMap<string, string>,
    private readonly entries: ReadonlyMap<string, boolean>,
    private readonly inventory: Map<string, SourceInventory>,
  ) {}
  visit(item: ClosureItem): ClosureItem[] {
    const previous = this.inventory.get(item.file);
    if (
      previous &&
      (previous.classification === 'production' ||
        (!item.production &&
          previous.classification === 'public-testing-export'))
    )
      return [];
    const config = sourceOwner(this.workspace, item.file, this.configs);
    if (!config)
      throw new Error(
        `Uncovered production sources: ${relative(this.workspace, item.file)} (no owning compiler project)`,
      );
    this.inventory.set(item.file, {
      file: relative(this.workspace, item.file),
      classification: item.production ? 'production' : 'public-testing-export',
      publicTestingExport: this.entries.get(item.file) === true,
      compilerConfig: config,
      reason: item.reason,
    });
    const source = ts.createSourceFile(
      item.file,
      readFileSync(item.file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    return moduleSpecifiers(source).flatMap((specifier) => {
      const target = this.resolveDependency(item.file, specifier, config);
      return target
        ? [
            {
              file: target,
              production: item.production,
              reason: `${relative(this.workspace, item.file)} -> ${specifier}`,
            },
          ]
        : [];
    });
  }
  private resolveDependency(
    file: string,
    specifier: string,
    config: string,
  ): string | undefined {
    const options = this.options.get(config);
    if (!options) throw new Error(`Missing compiler options: ${config}`);
    const resolved = ts.resolveModuleName(
      specifier,
      file,
      options,
      ts.sys,
    ).resolvedModule;
    if (!resolved) {
      if (specifier.startsWith('.'))
        throw new Error(
          `Unresolved local dependency: ${relative(this.workspace, file)} -> ${specifier}`,
        );
      if (/\.[cm]?js$/.test(file) && !isBuiltin(specifier))
        throw new Error(
          `Unresolved dependency: ${relative(this.workspace, file)} -> ${specifier}`,
        );
      return undefined;
    }
    const resolvedTarget =
      this.outputs.get(resolved.resolvedFileName) ?? resolved.resolvedFileName;
    const target =
      (!this.entries.has(resolvedTarget) &&
        emittedSiblingSource(resolvedTarget)) ||
      resolvedTarget;
    if (
      target.includes(`${sep}node_modules${sep}`) ||
      !target.startsWith(`${this.workspace}${sep}`) ||
      target.endsWith('.json')
    )
      return undefined;
    if (target.includes(`${sep}dist${sep}`))
      throw new Error(
        `Unmapped emitted dependency: ${relative(this.workspace, file)} -> ${specifier} (${relative(this.workspace, target)})`,
      );
    return target;
  }
}
export function selectBoundarySources(
  workspace: string,
  roots: readonly string[],
  configs: readonly string[],
  manifest: EntryManifest = {},
): SourceSelection {
  const all = candidates(workspace, roots);
  const options = new Map(
    configs.map((config) => [
      config,
      compilerConfiguration(workspace, config).options,
    ]),
  );
  verifySourceIdentities(workspace, manifest, options);
  const outputs = emittedSources(workspace, configs);
  const gaps: string[] = [];
  const entries = manifestEntries(workspace, manifest, outputs, gaps);
  const inventory = new Map<string, SourceInventory>();
  for (const file of all.filter(isTestSource))
    inventory.set(file, {
      file: relative(workspace, file),
      classification: 'excluded-test',
      publicTestingExport: entries.get(file) === true,
      compilerConfig: sourceOwner(workspace, file, configs),
      reason:
        'test convention; not reached from a production or public testing entry',
    });
  const queue = [
    ...all
      .filter(
        (file) =>
          !isTestSource(file) &&
          (!emittedSiblingSource(file) || entries.has(file)),
      )
      .map((file) => ({
        file,
        production: true,
        reason: 'ordinary production source',
      })),
    ...[...entries].map(([file, testing]) => ({
      file,
      production: !testing,
      reason: testing ? 'public testing export' : 'declared shipped entry',
    })),
  ];
  const closure = new SourceClosure(
    workspace,
    configs,
    options,
    outputs,
    entries,
    inventory,
  );
  for (let index = 0; index < queue.length; index++)
    queue.push(...closure.visit(queue[index]));
  const selected = [...inventory.entries()]
    .filter(
      ([, entry]) =>
        entry.classification === 'production' ||
        entry.classification === 'public-testing-export',
    )
    .map(([file]) => file)
    .sort();
  for (const required of manifest.requiredClosure ?? []) {
    if (
      !inventory.has(workspaceSourcePath(workspace, required)) ||
      inventory.get(workspaceSourcePath(workspace, required))
        ?.classification === 'excluded-test'
    )
      throw new Error(`Omitted shipped entry/closure: ${required}`);
  }
  return {
    gaps: [...new Set(gaps)],
    files: selected,
    entries: [...entries.keys()].filter(sourceFile),
    inventory: [...inventory.values()].sort((a, b) =>
      a.file.localeCompare(b.file),
    ),
  };
}
