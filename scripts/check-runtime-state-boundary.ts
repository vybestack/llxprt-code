#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { verifyJavascriptModuleIdentities } from './tests/runtime-javascript-module-identity.js';
import {
  compilerConfiguration,
  absentCurrentAmbientExports,
  isTestSource,
  selectBoundarySources,
  sourceOwner,
  type EntryManifest,
  type SourceInventory,
} from './runtime-source-discovery.js';
export { discoverProductionSources } from './runtime-source-discovery.js';
import {
  productionEntryManifest,
  productionPlugins,
} from './runtime-entry-manifest.js';
import type {
  AsyncLocalStorageAllowance,
  ImmutableTableAllowance,
} from './tests/runtime-state-structure-guard.js';
import { loadImmutableTableAllowlist } from './runtime-immutable-table-allowlist.js';
import {
  scanRuntimeServiceProgram,
  type RuntimeDeclarationRoot,
  type RuntimeServiceShapeOptions,
} from './tests/runtime-service-shape-guard.js';
import { scanState, workspacePath } from './runtime-state-scan.js';
import {
  evaluateRatchet,
  parseRatchetBaseline,
} from './runtime-boundary-ratchet.js';
import {
  scanAmbientDelegation,
  type AmbientSource,
} from './tests/runtime-ambient-delegation-guard.js';

export interface AmbientPolicySource extends AmbientSource {
  readonly absentReason?: string;
}
export interface AuditPolicy {
  readonly compilerConfig: string;
  readonly compilerProjects?: readonly string[];
  readonly sourceRoots: readonly string[];
  readonly entryManifest?: EntryManifest;
  readonly mutableRoots: readonly string[];
  readonly alsRoots: readonly string[];
  readonly services: readonly RuntimeDeclarationRoot[];
  readonly configs: readonly RuntimeDeclarationRoot[];
  readonly runtimeObjects?: readonly RuntimeDeclarationRoot[];
  readonly assembly: NonNullable<RuntimeServiceShapeOptions['assembly']>;
  readonly ambientSources: readonly AmbientPolicySource[];
  readonly alsAllowances: readonly AsyncLocalStorageAllowance[];
  /**
   * Module-level object/array literals allowed inside `mutableRoots`; every
   * other such literal that is not a frozen primitive table is rejected.
   */
  readonly immutableTables?: readonly ImmutableTableAllowance[];
}

const runtimeAccessors = 'packages/providers/src/runtime/runtimeAccessors.ts';
const cliContext = 'packages/cli/src/ui/contexts/RuntimeContext.tsx';
const deletionReason =
  '#2616 migration removes ambient accessors; absence is recorded, present exports remain audited.';
export const productionPolicy: AuditPolicy = {
  compilerConfig: 'packages/cli/tsconfig.noemit.json',
  entryManifest: productionEntryManifest,
  compilerProjects: [
    ...[
      'a2a-server/tsconfig.json',
      'agents/tsconfig.noemit.json',
      'auth/tsconfig.json',
      'cli/tsconfig.noemit.json',
      'core/tsconfig.noemit.json',
      'ide-integration/tsconfig.json',
      'lsp/tsconfig.json',
      'mcp/tsconfig.noemit.json',
      'policy/tsconfig.json',
      'providers/tsconfig.noemit.json',
      'settings/tsconfig.json',
      'storage/tsconfig.json',
      'telemetry/tsconfig.noemit.json',
      'tools/tsconfig.json',
      'vscode-ide-companion/tsconfig.json',
      'zed-acp/tsconfig.json',
    ].map((config) => `packages/${config}`),
    ...productionPlugins.map((pkg) => `${pkg}/tsconfig.json`),
    'tsconfig.scripts.json',
  ],
  sourceRoots: [
    ...[
      'a2a-server',
      'agents',
      'auth',
      'cli',
      'core',
      'ide-integration',
      'lsp',
      'mcp',
      'policy',
      'providers',
      'settings',
      'storage',
      'telemetry',
      'tools',
      'vscode-ide-companion',
      'zed-acp',
    ].map((name) => `packages/${name}/src`),
    ...productionPlugins.map((pkg) => `${pkg}/src`),
  ],
  mutableRoots: [
    'packages/providers/src/runtime',
    'packages/core/src/runtime',
    cliContext,
  ],
  alsRoots: ['packages/providers/src', 'packages/core/src'],
  services: [
    {
      file: 'packages/settings/src/settings/SettingsService.ts',
      exportName: 'SettingsService',
    },
    {
      file: 'packages/core/src/runtime/providerRuntimeContext.ts',
      exportName: 'RuntimeSettingsState',
    },
    {
      file: 'packages/providers/src/ProviderManager.ts',
      exportName: 'ProviderManager',
    },
    {
      file: 'packages/providers/src/IProviderManager.ts',
      exportName: 'IProviderManager',
    },
    {
      file: 'packages/providers/src/auth/oauth-manager.ts',
      exportName: 'OAuthManager',
    },
    {
      file: 'packages/settings/src/profiles/ProfileManager.ts',
      exportName: 'ProfileManager',
    },
    {
      file: 'packages/policy/src/confirmation-bus/message-bus.ts',
      exportName: 'MessageBus',
    },
    {
      file: 'packages/core/src/core/clientContract.ts',
      exportName: 'AgentClientContract',
    },
    {
      file: 'packages/tools/src/tools/tool-registry.ts',
      exportName: 'ToolRegistry',
    },
    {
      file: 'packages/core/src/services/history/HistoryService.ts',
      exportName: 'HistoryService',
    },
  ],
  runtimeObjects: Object.entries({
    'core/src/hooks/hookSystem.ts': 'HookSystem',
    'core/src/services/contextManager.ts': 'ContextManager',
    'core/src/core/toolSchedulerContract.ts': 'ToolSchedulerContract',
    'core/src/core/contentGenerator.ts': 'ContentGenerator',
    'core/src/runtime/contracts/RuntimeProviderManager.ts':
      'RuntimeProviderManager',
    'core/src/runtime/contracts/RuntimeTokenizerFactory.ts':
      'RuntimeTokenizerFactory',
    'core/src/config/subagentManager.ts': 'SubagentManager',
    'core/src/recording/SessionRecordingService.ts': 'SessionRecordingService',
    'core/src/services/asyncTaskManager.ts': 'AsyncTaskManager',
    'core/src/services/shellJobManager.ts': 'ShellJobManager',
    'core/src/services/asyncTaskReminderService.ts': 'AsyncTaskReminderService',
    'core/src/services/gitService.ts': 'GitService',
    'core/src/prompts/prompt-registry.ts': 'PromptRegistry',
    'core/src/resources/resource-registry.ts': 'ResourceRegistry',
    'core/src/skills/skillManager.ts': 'SkillManager',
    'core/src/utils/workspaceContext.ts': 'WorkspaceContext',
    'core/src/utils/extensionLoader.ts': 'ExtensionLoader',
    'core/src/storage/local-media-store.ts': 'LocalMediaStore',
    'core/src/storage/SessionPersistenceService.ts':
      'SessionPersistenceService',
    'storage/src/services/fileDiscoveryService.ts': 'FileDiscoveryService',
    'storage/src/services/fileSystemService.ts': 'FileSystemService',
    'policy/src/policy-engine.ts': 'PolicyEngine',
    'tools/src/tools/github.ts': 'GitHubBrokerClient',
    'mcp/src/client/mcp-client-manager.ts': 'McpClientManager',
    'ide-integration/src/ide/ide-client.ts': 'IdeClient',
    'ide-integration/src/lsp/lsp-service-client.ts': 'LspServiceClient',
  }).map(([file, exportName]) => ({ file: `packages/${file}`, exportName })),
  configs: [
    { file: 'packages/core/src/config/config.ts', exportName: 'Config' },
    {
      file: 'packages/core/src/config/configBase.ts',
      exportName: 'ConfigBase',
    },
    {
      file: 'packages/core/src/config/configBaseCore.ts',
      exportName: 'ConfigBaseCore',
    },
  ],
  assembly: [
    {
      file: 'packages/agents/src/api/createAgent.ts',
      functionName: 'createAgent',
    },
    {
      file: 'packages/agents/src/api/createAgent.ts',
      functionName: 'assembleFacade',
    },
  ],
  ambientSources: [
    ...[
      'getCliRuntimeContext',
      'getCliRuntimeServices',
      'getCliProviderManager',
      'getCliOAuthManager',
      'maybeGetCliOAuthManager',
      'getCliRuntimeConfig',
    ].map((exportName) => ({
      file: runtimeAccessors,
      exportName,
      absentReason: deletionReason,
    })),
    ...['getRuntimeBridge', 'getRuntimeApi'].map((exportName) => ({
      file: cliContext,
      exportName,
      absentReason: deletionReason,
    })),
    ...['getProviderManager', 'getOAuthManager'].map((exportName) => ({
      file: 'packages/providers/src/composition/providerManagerInstance.ts',
      exportName,
      absentReason: deletionReason,
    })),
    {
      file: 'packages/providers/src/runtime/oauth-runtime-accessors.ts',
      exportName: 'buildOAuthRuntimeAccessors',
      absentReason: deletionReason,
    },
    {
      file: 'packages/providers/src/auth/runtime-accessor-bridge.ts',
      exportName: 'oauthRuntimeBridge',
      members: ['getProviderManager'],
      absentReason: deletionReason,
    },
    {
      file: 'packages/providers/src/runtime/browser-profile-association-store-instance.ts',
      exportName: 'getBrowserProfileAssociationStore',
      absentReason: deletionReason,
    },
  ],
  immutableTables: loadImmutableTableAllowlist(),
  alsAllowances: [
    {
      file: 'packages/providers/src/BaseProvider.ts',
      declaration: 'BaseProvider.activeCallContext',
      reason:
        'Per-provider call-option scope carries NormalizedGenerateChatOptions during generation; it does not select an active runtime identity. No other ALS declaration is exempt.',
    },
  ],
};

export interface AuditFinding {
  readonly owner: string;
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly declaration?: string;
  readonly kind?: string;
}
export interface CompilerProblem {
  readonly code: number;
  readonly category: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}
export interface ProgramAudit {
  readonly javascriptAnalysis?: {
    readonly files: readonly string[];
    readonly certifiesRuntimePurity: false;
    readonly limitations: readonly string[];
  };
  readonly compilerConfig: string;
  readonly files: readonly string[];
  readonly compilerDiagnostics: readonly CompilerProblem[];
  readonly scanners: AuditResult['scanners'];
  readonly unavailableRoots: ReadonlyArray<
    RuntimeDeclarationRoot & { reason: 'not-in-program' }
  >;
  readonly resolvedRoots: ReadonlyArray<
    RuntimeDeclarationRoot & { resolvedFile: string }
  >;
}
export interface AuditResult {
  readonly discovery: readonly SourceInventory[];
  readonly programs: readonly ProgramAudit[];
  readonly exitCode: number;
  readonly files: readonly string[];
  readonly findings: readonly AuditFinding[];
  readonly compilerDiagnostics: readonly CompilerProblem[];
  readonly absentAmbientSources: readonly AmbientPolicySource[];
  readonly scanners: {
    readonly state: 'complete';
    readonly serviceShape:
      | 'complete'
      | 'blocked-by-compiler'
      | 'resource-limit';
    readonly ambientDelegation: 'complete' | 'provisional-compiler-errors';
  };
  readonly countsByOwner: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
}

function diagnostic(
  workspace: string,
  problem: ts.Diagnostic,
): CompilerProblem {
  const position =
    problem.file && problem.start !== undefined
      ? problem.file.getLineAndCharacterOfPosition(problem.start)
      : undefined;
  return {
    code: problem.code,
    category: ts.DiagnosticCategory[problem.category],
    message: ts.flattenDiagnosticMessageText(problem.messageText, '\n'),
    ...(problem.file
      ? { file: relative(workspace, problem.file.fileName) }
      : {}),
    ...(position
      ? { line: position.line + 1, column: position.character + 1 }
      : {}),
  };
}
function exportedSymbol(
  program: ts.Program,
  root: RuntimeDeclarationRoot,
): ts.Symbol | undefined {
  const source = program.getSourceFile(root.file);
  const checker = program.getTypeChecker();
  const module = source && checker.getSymbolAtLocation(source);
  const symbol =
    module &&
    checker
      .getExportsOfModule(module)
      .find((entry) => entry.name === root.exportName);
  return (
    symbol &&
    (symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol)
  );
}

function auditProgram(
  workspace: string,
  compilerConfig: string,
  files: readonly string[],
  entries: readonly string[],
): { program: ts.Program; compilerDiagnostics: readonly CompilerProblem[] } {
  const configuration = compilerConfiguration(workspace, compilerConfig);
  const program = ts.createProgram({
    rootNames: [
      ...new Set([
        ...configuration.fileNames.filter(
          (file) =>
            files.includes(file) ||
            file.endsWith('.json') ||
            (!isTestSource(file) && /\.d\.(?:ts|mts|cts)$/.test(file)),
        ),
        ...entries,
      ]),
    ],
    options: { ...configuration.options, allowJs: true, noEmit: true },
    projectReferences: configuration.projectReferences,
  });
  const compilerDiagnostics = [
    ...configuration.errors,
    ...ts.getPreEmitDiagnostics(program),
  ].map((problem) => diagnostic(workspace, problem));
  if (!compilerDiagnostics.length) verifyJavascriptModuleIdentities(program);
  return { program, compilerDiagnostics };
}

function declarationCandidates(
  workspace: string,
  root: RuntimeDeclarationRoot,
): readonly string[] {
  const source = workspacePath(workspace, root.file);
  const packagePath = root.file.split('/').slice(0, 2).join('/');
  const buildConfig = `${packagePath}/tsconfig.build.json`;
  const defaultConfig = `${packagePath}/tsconfig.json`;
  const config = existsSync(workspacePath(workspace, buildConfig))
    ? buildConfig
    : defaultConfig;
  if (!existsSync(workspacePath(workspace, config))) return [source];
  const parsed = compilerConfiguration(workspace, config);
  if (!parsed.fileNames.includes(source)) return [source];
  return [
    source,
    ...ts
      .getOutputFileNames(parsed, source, !ts.sys.useCaseSensitiveFileNames)
      .filter((file) => /\.d\.(?:ts|mts|cts)$/.test(file)),
  ];
}

function resolvePolicy(
  workspace: string,
  policy: AuditPolicy,
  program: ts.Program,
  candidates: ReadonlyMap<string, readonly string[]>,
  absentAmbientSources: readonly AmbientPolicySource[],
): {
  services: readonly RuntimeDeclarationRoot[];
  configs: readonly RuntimeDeclarationRoot[];
  runtimeObjects: readonly RuntimeDeclarationRoot[];
  ambientSources: readonly AmbientSource[];
  unavailableRoots: ProgramAudit['unavailableRoots'];
  resolvedRoots: ProgramAudit['resolvedRoots'];
} {
  const unavailableRoots: Array<
    RuntimeDeclarationRoot & { reason: 'not-in-program' }
  > = [];
  const resolvedRoots: Array<
    RuntimeDeclarationRoot & { resolvedFile: string }
  > = [];
  const resolveRoot = <T extends RuntimeDeclarationRoot>(root: T): T[] => {
    const files = candidates.get(root.file) ?? [
      workspacePath(workspace, root.file),
    ];
    const present = files.filter((file) => program.getSourceFile(file));
    if (!present.length) {
      unavailableRoots.push({ ...root, reason: 'not-in-program' });
      return [];
    }
    return present.map((file) => {
      const mapped = { ...root, file };
      if (!exportedSymbol(program, mapped))
        throw new Error(
          `Unresolved ${policy.ambientSources.includes(root) ? 'ambient source' : 'class/interface declaration root'}: ${root.file}#${root.exportName}`,
        );
      resolvedRoots.push({ ...root, resolvedFile: relative(workspace, file) });
      return mapped;
    });
  };
  const services = policy.services.flatMap(resolveRoot);
  const configs = policy.configs.flatMap(resolveRoot);
  const runtimeObjects = (policy.runtimeObjects ?? []).flatMap(resolveRoot);
  for (const root of [...services, ...configs, ...runtimeObjects]) {
    if (
      !exportedSymbol(program, root)?.declarations?.some(
        (node) =>
          ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node),
      )
    )
      throw new Error(
        `Unresolved class/interface declaration root: ${root.file}#${root.exportName}`,
      );
  }
  const ambientSources = policy.ambientSources
    .filter((root) => !absentAmbientSources.includes(root))
    .flatMap(resolveRoot);
  return {
    services,
    configs,
    runtimeObjects,
    ambientSources,
    unavailableRoots,
    resolvedRoots,
  };
}

function groupFindings(
  findings: readonly AuditFinding[],
): AuditResult['countsByOwner'] {
  const owners = [...new Set(findings.map((finding) => finding.owner))];
  return Object.fromEntries(
    owners.map((owner) => {
      const owned = findings.filter((finding) => finding.owner === owner);
      return [
        owner,
        Object.fromEntries(
          [...new Set(owned.map((finding) => finding.rule))].map((rule) => [
            rule,
            owned.filter((finding) => finding.rule === rule).length,
          ]),
        ),
      ];
    }),
  );
}

function unique<T>(items: readonly T[]): T[] {
  return [
    ...new Map(items.map((item) => [JSON.stringify(item), item])).values(),
  ];
}
const resourceLimitRule = 'runtime-service-analysis-resource-limit';
function scannerStatus(
  blocked: boolean,
  resourceLimited: boolean,
): AuditResult['scanners'] {
  let serviceShape: AuditResult['scanners']['serviceShape'] = 'complete';
  if (resourceLimited) serviceShape = 'resource-limit';
  if (blocked) serviceShape = 'blocked-by-compiler';
  return {
    state: 'complete',
    serviceShape,
    ambientDelegation: blocked ? 'provisional-compiler-errors' : 'complete',
  };
}

export interface AuditProgress {
  readonly compilerConfig: string;
  readonly phase: 'compiler-complete' | 'scanners-complete';
  readonly files: readonly string[];
  readonly compilerDiagnostics: readonly CompilerProblem[];
}

function javascriptAnalysis(
  workspace: string,
  selected: readonly string[],
): ProgramAudit['javascriptAnalysis'] {
  const files = selected
    .filter((file) => /\.[cm]?js$/.test(file))
    .map((file) => relative(workspace, file));
  if (!files.length) return undefined;
  return {
    files,
    certifiesRuntimePurity: false,
    limitations: [
      'Analysis-only allowJs preserves project checkJs policy; unannotated opaque values are not runtime-purity evidence.',
      'Checker identities and actual producers are checked; positional local return substitution does not model heap writes, reflective dispatch, destructured/default/rest parameters or arbitrary captures.',
      'Discovery follows literal imports/reexports/require; computed loaders and subprocess entry strings require declared entries.',
      'Mutable-state and ALS enforcement uses only the separately configured policy roots.',
    ],
  };
}

interface PackageScan {
  readonly shapeFindings: ReadonlyArray<Omit<AuditFinding, 'owner'>>;
  readonly ambientFindings: ReadonlyArray<Omit<AuditFinding, 'owner'>>;
  readonly status: ProgramAudit;
}
function scanPackage(
  workspace: string,
  policy: AuditPolicy,
  files: readonly string[],
  compilerConfig: string,
  candidates: ReadonlyMap<string, readonly string[]>,
  absent: readonly AmbientPolicySource[],
  entries: readonly string[],
  onProgress?: (event: AuditProgress) => void,
): PackageScan {
  const shapeFindings: Array<Omit<AuditFinding, 'owner'>> = [];
  const owns = (file: string): boolean =>
    sourceOwner(
      workspace,
      file,
      policy.compilerProjects ?? [policy.compilerConfig],
    ) === compilerConfig;
  const { program, compilerDiagnostics: problems } = auditProgram(
    workspace,
    compilerConfig,
    files,
    [
      ...new Set([
        ...entries,
        ...files.filter((file) => /\.[cm]?js$/.test(file)),
      ]),
    ].filter(owns),
  );
  const selected = files.filter(
    (file) => owns(file) && program.getSourceFile(file),
  );
  const progress = {
    compilerConfig,
    files: selected.map((file) => relative(workspace, file)),
    compilerDiagnostics: problems,
  };
  onProgress?.({ ...progress, phase: 'compiler-complete' });
  const roots = resolvePolicy(workspace, policy, program, candidates, absent);
  if (!problems.length)
    shapeFindings.push(
      ...scanRuntimeServiceProgram(
        program,
        {
          services: roots.services,
          configs: roots.configs,
          runtimeObjects: roots.runtimeObjects,
          assembly: policy.assembly.map((entry) => ({
            ...entry,
            file: workspacePath(workspace, entry.file),
          })),
        },
        selected,
      ),
    );
  const sources = selected.map((file) => {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`Missing production source: ${file}`);
    return source;
  });
  const ambient = roots.ambientSources;
  const ambientFindings = scanAmbientDelegation(program, sources, ambient);
  onProgress?.({ ...progress, phase: 'scanners-complete' });
  return {
    shapeFindings,
    ambientFindings,
    status: {
      compilerConfig,
      files: selected.map((file) => relative(workspace, file)),
      javascriptAnalysis: javascriptAnalysis(workspace, selected),
      compilerDiagnostics: problems,
      scanners: scannerStatus(
        problems.length > 0,
        shapeFindings.some((finding) => finding.rule === resourceLimitRule),
      ),
      unavailableRoots: roots.unavailableRoots,
      resolvedRoots: roots.resolvedRoots,
    },
  };
}

function assertCoverage(
  workspace: string,
  policy: AuditPolicy,
  files: readonly string[],
  programs: readonly ProgramAudit[],
  absentAmbientSources: readonly AmbientPolicySource[],
): void {
  const covered = new Set(
    programs
      .flatMap((program) => program.files)
      .map((file) => workspacePath(workspace, file)),
  );
  const uncovered = files.filter((file) => !covered.has(file));
  if (uncovered.length)
    throw new Error(
      `Uncovered production sources: ${uncovered.map((file) => relative(workspace, file)).join(', ')}`,
    );
  for (const root of [
    ...policy.services,
    ...policy.configs,
    ...(policy.runtimeObjects ?? []),
    ...policy.ambientSources,
  ]) {
    if (
      programs.some((program) =>
        program.resolvedRoots.some(
          (resolved) =>
            resolved.file === root.file &&
            resolved.exportName === root.exportName,
        ),
      ) ||
      absentAmbientSources.includes(root)
    )
      continue;
    throw new Error(
      `Unresolved ${policy.ambientSources.includes(root) ? 'ambient source' : 'class/interface declaration root'}: ${root.file}#${root.exportName}`,
    );
  }
}

export function auditRuntimeStateBoundary(
  workspaceDirectory: string,
  policy: AuditPolicy = productionPolicy,
  onProgress?: (event: AuditProgress) => void,
): AuditResult {
  const workspace = resolve(workspaceDirectory);
  const selection = selectBoundarySources(
    workspace,
    policy.sourceRoots,
    policy.compilerProjects ?? [policy.compilerConfig],
    policy.entryManifest,
  );
  if (selection.gaps.length) throw new Error(selection.gaps.join('\n'));
  const files = selection.files;
  if (!files.length) throw new Error('No production sources discovered');
  const absentAmbientSources = absentCurrentAmbientExports(workspace, policy);
  const candidates = new Map(
    [
      ...policy.services,
      ...policy.configs,
      ...(policy.runtimeObjects ?? []),
      ...policy.ambientSources,
    ].map((root) => [root.file, declarationCandidates(workspace, root)]),
  );
  const scans = [...new Set(policy.compilerProjects ?? [policy.compilerConfig])]
    .sort()
    .map((config) => {
      const result = scanPackage(
        workspace,
        policy,
        files,
        config,
        candidates,
        absentAmbientSources,
        selection.entries,
        onProgress,
      );
      Bun.gc(true);
      return result;
    });
  const programs = scans.map((scan) => scan.status);
  const compilerDiagnostics = programs.flatMap(
    (program) => program.compilerDiagnostics,
  );
  const shapeFindings = scans.flatMap((scan) => scan.shapeFindings);
  const ambientFindings = scans.flatMap((scan) => scan.ambientFindings);
  assertCoverage(workspace, policy, files, programs, absentAmbientSources);
  const stateFindings = scanState(workspace, policy, files);
  const findings: AuditFinding[] = unique([
    ...stateFindings,
    ...shapeFindings,
    ...ambientFindings,
  ])
    .map((finding) => {
      const file = relative(workspace, finding.file).split(sep).join('/');
      return { ...finding, file, owner: file.split('/')[1] ?? 'workspace' };
    })
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.column - b.column ||
        a.rule.localeCompare(b.rule),
    );
  const countsByOwner = groupFindings(findings);
  return {
    discovery: selection.inventory,
    programs,
    exitCode: findings.length || compilerDiagnostics.length ? 1 : 0,
    files: files.map((file) => relative(workspace, file)),
    findings,
    compilerDiagnostics: unique(compilerDiagnostics),
    absentAmbientSources: unique(absentAmbientSources),
    countsByOwner,
    scanners: scannerStatus(
      compilerDiagnostics.length > 0,
      shapeFindings.some((finding) => finding.rule === resourceLimitRule),
    ),
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string', default: process.cwd() },
      output: { type: 'string' },
      baseline: { type: 'string' },
    },
    strict: true,
  });
  try {
    const result = auditRuntimeStateBoundary(
      values.workspace,
      productionPolicy,
      (event) => {
        process.stderr.write(`${JSON.stringify(event)}\n`);
      },
    );
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (values.output) {
      const output = workspacePath(resolve(values.workspace), values.output);
      mkdirSync(dirname(output), { recursive: true });
      await Bun.write(output, json);
    }
    if (values.baseline) {
      const baseline = parseRatchetBaseline(
        readFileSync(
          workspacePath(resolve(values.workspace), values.baseline),
          'utf8',
        ),
      );
      const verdict = evaluateRatchet(result, baseline);
      process.stdout.write(
        `${JSON.stringify({ ...verdict, scanners: result.scanners }, null, 2)}\n`,
      );
      process.exitCode = verdict.exitCode;
    } else {
      process.stdout.write(json);
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ fatal: error instanceof Error ? error.message : String(error), exitCode: 2 })}\n`,
    );
    process.exitCode = 2;
  }
}
