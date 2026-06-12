#!/usr/bin/env node

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * @requirement REQ-DEP-001
 *
 * Settings package boundary verification script.
 * Consolidated boundary enforcement for the settings package extraction.
 *
 * Usage:
 *   node scripts/check-settings-boundary.js                          # run all checks
 *   node scripts/check-settings-boundary.js --check source-imports  # run specific checks
 *   node scripts/check-settings-boundary.js --check source-imports,metadata,lockfile
 *   node scripts/check-settings-boundary.js --phase pre-p08         # report-only for P08+ checks
 *   node scripts/check-settings-boundary.js --phase pre-p09         # report-only for P09+ checks
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SETTINGS_PKG = join(ROOT, 'packages', 'settings');
const FORBIDDEN_DEPS = [
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-providers',
  '@vybestack/llxprt-code',
  '@vybestack/llxprt-code-tools',
  '@vybestack/llxprt-code-a2a-server',
];

const MOVED_SYMBOLS = [
  'ISettingsService',
  'GlobalSettings',
  'SettingsChangeEvent',
  'ProviderSettings',
  'UISettings',
  'AdvancedSettings',
  'EventListener',
  'EventUnsubscribe',
  'SettingsTelemetrySettings',
  'DiagnosticsInfo',
  'SettingsService',
  'ProfileManager',
  'Storage',
  'ModelParams',
  'Profile',
  'StandardProfile',
  'LoadBalancerProfile',
  'EphemeralSettings',
  'getSettingsService',
  'registerSettingsService',
  'resetSettingsService',
  'SETTINGS_REGISTRY',
  'AuthConfig',
  'AuthConfigSchema',
  'hasAuthConfig',
  'isOAuthProfile',
  'isLoadBalancerProfile',
  'isStandardProfile',
  'LoadBalancerConfig',
  'LoadBalancerSubProfileConfig',
  'getProfilePersistableKeys',
  'resolveAlias',
  'getSettingHelp',
  'validateSetting',
  'parseSetting',
  'getProviderConfigKeys',
  'getProtectedSettingKeys',
  'getDirectSettingSpecs',
  'getCompletionOptions',
  'getAllSettingKeys',
  'getValidationHelp',
  'getAutocompleteSuggestions',
  'getSettingSpec',
  'normalizeSetting',
  'separateSettings',
];

const DEFAULT_CHECKS = [
  'source-imports',
  'all-files-imports',
  'metadata',
  'tsconfig-references',
  'vitest-aliases',
  'export-style',
  'old-paths',
  'root-barrel',
  'anti-shim',
  'core-re-exports',
  'modelParams-subpath',
  'relative-settings-imports',
  'relative-storage-imports',
  'vi-mock-paths',
  'dynamic-import-paths',
  'provider-runtime-context',
  'no-storage-package',
  'core-barrel-shim',
  'adapter-single-owner',
  'lockfile',
];

const CHECK_NAMES = {
  'source-imports': 1,
  'all-files-imports': 2,
  metadata: 3,
  'tsconfig-references': 4,
  'vitest-aliases': 5,
  'export-style': 6,
  'old-paths': 7,
  'root-barrel': 8,
  'anti-shim': 9,
  'core-re-exports': 10,
  modelParams: 11,
  'modelParams-subpath': 11,
  'relative-settings-imports': 12,
  'relative-storage-imports': 13,
  'vi-mock-paths': 14,
  'dynamic-import-paths': 15,
  'provider-runtime-context': 16,
  'no-storage-package': 17,
  'core-barrel-shim': 18,
  'adapter-single-owner': 19,
  lockfile: 20,
};

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Run ripgrep with the given pattern and paths using spawnSync
 * to avoid shell quoting issues. Uses argument arrays directly.
 */
function runRg(pattern, paths, globs, extraArgs = []) {
  const args = ['-n', '--no-heading'];
  args.push(...extraArgs);
  if (globs) {
    for (const g of globs) {
      args.push('--glob', g);
    }
  }
  args.push(pattern);
  if (Array.isArray(paths)) {
    args.push(...paths);
  } else {
    args.push(paths);
  }
  try {
    const result = spawnSync('rg', args, {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) {
      return '';
    }
    // rg exits 1 when no matches found; treat that as empty result
    if (result.status === 1) {
      return '';
    }
    if (result.status !== 0) {
      return '';
    }
    return (result.stdout || '').trim();
  } catch {
    return '';
  }
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 1: Settings source files have no forbidden imports/references.
 */
function check1_sourceImports() {
  const output = runRg(
    '@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code[\'"]',
    'packages/settings/src',
    ['*.ts', '*.tsx'],
  );
  if (output) {
    console.error(
      `FAIL: source-imports: forbidden imports in settings src:\n${output}`,
    );
    return false;
  }
  console.log('OK: source-imports');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 2: All settings package files have no forbidden imports.
 */
function check2_allFilesImports() {
  const output = runRg(
    '@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code[\'"]',
    'packages/settings',
    ['*.ts', '*.tsx'],
  );
  if (output) {
    console.error(
      `FAIL: all-files-imports: forbidden imports in settings package:\n${output}`,
    );
    return false;
  }
  console.log('OK: all-files-imports');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 3: Settings package.json has no forbidden dependencies.
 */
function check3_metadata() {
  const pkgPath = join(SETTINGS_PKG, 'package.json');
  if (!existsSync(pkgPath)) {
    console.error('FAIL: metadata: packages/settings/package.json not found');
    return false;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  const found = FORBIDDEN_DEPS.filter((name) => allDeps[name]);
  if (found.length > 0) {
    console.error(`FAIL: metadata: forbidden deps: ${found.join(', ')}`);
    return false;
  }
  // Verify @types/node is present in devDependencies
  if (!(pkg.devDependencies && pkg.devDependencies['@types/node'])) {
    console.error('FAIL: metadata: @types/node missing from devDependencies');
    return false;
  }
  const corePkgPath = join(ROOT, 'packages/core/package.json');
  if (existsSync(corePkgPath)) {
    const corePkg = JSON.parse(readFileSync(corePkgPath, 'utf-8'));
    if (!corePkg.exports?.['./runtime/settingsRuntimeAdapter.js']) {
      console.error(
        'FAIL: metadata: core package.json missing ./runtime/settingsRuntimeAdapter.js export',
      );
      return false;
    }
  }
  console.log('OK: metadata');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 4: tsconfig.json has no forbidden references.
 */
function check4_tsconfigReferences() {
  const tsconfigPath = join(SETTINGS_PKG, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    console.error(
      'FAIL: tsconfig-references: packages/settings/tsconfig.json not found',
    );
    return false;
  }
  const content = readFileSync(tsconfigPath, 'utf-8');
  // Check for references to core/providers/cli (not just in strings like "paths")
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comment lines
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*')
    )
      continue;
    // Check for path references to other workspace packages
    if (/packages\/(core|providers|cli)\//.test(trimmed)) {
      console.error(
        `FAIL: tsconfig-references: core/providers/cli path reference found: ${trimmed}`,
      );
      return false;
    }
  }
  console.log('OK: tsconfig-references');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 5: vitest.config.ts has no forbidden aliases (warn only).
 */
function check5_vitestAliases() {
  const vitestPath = join(SETTINGS_PKG, 'vitest.config.ts');
  if (!existsSync(vitestPath)) {
    console.error(
      'FAIL: vitest-aliases: packages/settings/vitest.config.ts not found',
    );
    return false;
  }
  const content = readFileSync(vitestPath, 'utf-8');
  const pattern =
    /@vybestack\/llxprt-code-core|@vybestack\/llxprt-code-providers/;
  if (pattern.test(content)) {
    console.warn(
      'WARN: vitest-aliases: vitest config has forbidden workspace alias references (not a hard failure)',
    );
  }
  console.log('OK: vitest-aliases');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 6: Export map uses {types, import} objects, not bare strings.
 */
function check6_exportStyle() {
  const pkgPath = join(SETTINGS_PKG, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  for (const [key, value] of Object.entries(pkg.exports || {})) {
    if (typeof value === 'string') {
      console.error(`FAIL: export-style: bare string export for ${key}`);
      return false;
    }
  }
  console.log('OK: export-style');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 7: Old-path import scan (pre-P08 report-only).
 */
function check7_oldPaths(reportOnly) {
  const output = runRg(
    '@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)',
    'packages',
    ['*.ts'],
  );
  if (output) {
    const msg = `FAIL: old-paths: old path imports found:\n${output}`;
    if (reportOnly) {
      console.warn(`WARN: ${msg}`);
      console.log('OK: old-paths (report-only, not enforced yet)');
      return true;
    }
    console.error(msg);
    return false;
  }
  console.log('OK: old-paths');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 8: Root-barrel moved-symbol import scan.
 * Filters out settings package imports (legitimate new-path).
 */
function check8_rootBarrel() {
  const symbolPattern = MOVED_SYMBOLS.map((s) => `\\b${s}\\b`).join('|');

  const output = runRg(
    `import\\s*\\{[^}]*(?:${symbolPattern})[^}]*\\}\\s*from ['"]@vybestack/llxprt-code-core['"]`,
    'packages',
    ['*.ts', '*.tsx'],
    ['-U'],
  );
  // Filter out settings package imports (legitimate new-path)
  const filtered = output
    .split('\n')
    .filter((line) => line && !line.startsWith('packages/settings/'))
    .join('\n')
    .trim();
  if (filtered) {
    console.error(
      `FAIL: root-barrel: moved-symbol imports from core barrel found:\n${filtered}`,
    );
    return false;
  }
  console.log('OK: root-barrel');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 9: Anti-shim/compatibility file scan.
 * Scans ONLY within packages/settings for compatibility-named extraction
 * files (e.g., SettingsServiceV2, ProfileManagerCompat). Pre-existing
 * wrapper files in other packages (googleGenAIWrapper, LoggingProviderWrapper,
 * spawnWrapper) are NOT settings-extraction shims and are excluded.
 */
function check9_antiShim() {
  const output = runRg(
    '(SettingsService|ProfileManager|Storage)(V2|New|Compat|Wrapper|Copy)\\.(ts|tsx)',
    'packages/settings',
    ['*.ts', '*.tsx'],
  );
  if (output) {
    console.error(
      `FAIL: anti-shim: compatibility-named files found in settings package:\n${output}`,
    );
    return false;
  }
  console.log('OK: anti-shim');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 10: Core re-export scan (post-P09 enforced, report-only before).
 */
function check10_coreReExports(reportOnly) {
  const coreBarrelPaths = [
    join(ROOT, 'packages/core/src/index.ts'),
    join(ROOT, 'packages/core/index.ts'),
  ];
  let violations = '';
  for (const barrelPath of coreBarrelPaths) {
    if (!existsSync(barrelPath)) continue;
    const content = readFileSync(barrelPath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (!/^export/.test(line.trim())) continue;
      for (const sym of MOVED_SYMBOLS) {
        // Use word boundary matching to avoid false positives like "MCPOAuthTokenStorage" matching "Storage"
        const regex = new RegExp(`\\b${sym}\\b`);
        if (regex.test(line)) {
          violations += `${barrelPath}: ${line.trim()}\n`;
          break;
        }
      }
    }
  }
  if (violations) {
    const msg = `FAIL: core-re-exports: core re-exports moved symbols:\n${violations}`;
    if (reportOnly) {
      console.warn(`WARN: ${msg}`);
      console.log('OK: core-re-exports (report-only, not enforced yet)');
      return true;
    }
    console.error(msg);
    return false;
  }
  console.log('OK: core-re-exports');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 11: Core modelParams subpath export (post-P09 enforced, report-only before).
 */
function check11_modelParamsSubpath(reportOnly) {
  const corePkgPath = join(ROOT, 'packages/core/package.json');
  if (!existsSync(corePkgPath)) {
    console.error('FAIL: modelParams-subpath: core package.json not found');
    return false;
  }
  const pkg = JSON.parse(readFileSync(corePkgPath, 'utf-8'));
  const exports = pkg.exports || {};
  if (
    exports['./modelParams'] ||
    exports['./modelParams.js'] ||
    exports['./types/modelParams.js']
  ) {
    const msg =
      'FAIL: modelParams-subpath: modelParams subpath export found in core';
    if (reportOnly) {
      console.warn(`WARN: ${msg}`);
      console.log('OK: modelParams-subpath (report-only, not enforced yet)');
      return true;
    }
    console.error(msg);
    return false;
  }

  const scanPaths = [
    'packages/agents/src',
    'packages/core/src/core',
    'packages/core/src/runtime',
    'packages/core/src/services',
    'packages/core/src/tools',
    'packages/cli/src',
    'packages/cli/test',
    'packages/providers/src',
  ];
  const sourceImports = runRg(
    'from [\'"].*(types/modelParams|core/src/types/modelParams)\\.js[\'"]',
    scanPaths,
    ['*.ts'],
  );
  if (sourceImports) {
    const msg = `FAIL: modelParams-subpath: moved modelParams/profile source imports found:\n${sourceImports}`;
    if (reportOnly) {
      console.warn(`WARN: ${msg}`);
      console.log('OK: modelParams-subpath (report-only, not enforced yet)');
      return true;
    }
    console.error(msg);
    return false;
  }

  console.log('OK: modelParams-subpath');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 12: Core relative settings import scan (post-P09 enforced, report-only before).
 */
function check12_relativeSettingsImports(reportOnly) {
  const scanPaths = [
    'packages/agents/src',
    'packages/core/src',
    'packages/cli/test',
    'packages/providers/src',
  ];
  const output = runRg(
    'from [\'"].*settings/(SettingsService|settingsServiceInstance|settingsRegistry)',
    scanPaths,
    ['*.ts'],
  );
  const relativeOutput = runRg('from [\'"].*\\.\\./settings/', scanPaths, [
    '*.ts',
  ]);
  const coreSourceOutput = runRg(
    'core/src/settings/(SettingsService|settingsServiceInstance|settingsRegistry)',
    scanPaths,
    ['*.ts'],
  );
  const combined = [output, relativeOutput, coreSourceOutput]
    .filter(Boolean)
    .join('\n')
    .trim();
  if (combined) {
    const msg = `FAIL: relative-settings-imports: core has relative settings imports:\n${combined}`;
    if (reportOnly) {
      console.warn(`WARN: ${msg}`);
      console.log(
        'OK: relative-settings-imports (report-only, not enforced yet)',
      );
      return true;
    }
    console.error(msg);
    return false;
  }
  console.log('OK: relative-settings-imports');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 13: Core relative config/storage import scan (post-P09 enforced, report-only before).
 */
function check13_relativeStorageImports(reportOnly) {
  const output1 = runRg(
    'from [\'"].*config/storage[\'"]',
    'packages/core/src',
    ['*.ts'],
  );
  const output2 = runRg(
    'from [\'"].*config/profileManager[\'"]',
    'packages/core/src',
    ['*.ts'],
  );
  const output3 = runRg('vi\\.mock.*config/storage', 'packages/core/src', [
    '*.ts',
  ]);
  const output4 = runRg(
    'vi\\.mock.*config/profileManager',
    'packages/core/src',
    ['*.ts'],
  );
  const combined = [output1, output2, output3, output4]
    .filter(Boolean)
    .join('\n')
    .trim();
  if (combined) {
    const msg = `FAIL: relative-storage-imports: core has relative config/storage imports:\n${combined}`;
    if (reportOnly) {
      console.warn(`WARN: ${msg}`);
      console.log(
        'OK: relative-storage-imports (report-only, not enforced yet)',
      );
      return true;
    }
    console.error(msg);
    return false;
  }
  console.log('OK: relative-storage-imports');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 14: vi.mock path scan for old settings/storage deep-path imports
 * from @vybestack/llxprt-code-core (P08 enforcing).
 * Relative vi.mock paths within core (e.g., ../settings/) are acceptable
 * until P09 removes the core files. Only deep-package-path vi.mocks
 * referencing the old core package are flagged.
 */
function check14_viMockPaths(reportOnly) {
  const output1 = runRg(
    'vi\\.mock.*@vybestack/llxprt-code-core/settings/',
    'packages',
    ['*.ts'],
  );
  const output2 = runRg(
    'vi\\.mock.*@vybestack/llxprt-code-core/config/storage',
    'packages',
    ['*.ts'],
  );
  const output3 = runRg(
    'vi\\.mock.*@vybestack/llxprt-code-core/config/profileManager',
    'packages',
    ['*.ts'],
  );
  const combined = [output1, output2, output3]
    .filter(Boolean)
    .join('\n')
    .trim();
  if (combined) {
    const msg = `FAIL: vi-mock-paths: old vi.mock paths found:\n${combined}`;
    if (reportOnly) {
      console.warn(`WARN: ${msg}`);
      console.log('OK: vi-mock-paths (report-only, not enforced yet)');
      return true;
    }
    console.error(msg);
    return false;
  }
  console.log('OK: vi-mock-paths');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 15: Dynamic import path scan (post-P09 enforced, report-only before).
 */
function check15_dynamicImportPaths(reportOnly) {
  const output = runRg(
    'import\\([\'"].*@vybestack/llxprt-code-core/settings/',
    'packages',
    ['*.ts'],
  );
  const output2 = runRg(
    'import\\([\'"].*@vybestack/llxprt-code-core/config/(storage|profileManager)',
    'packages',
    ['*.ts'],
  );
  const combined = [output, output2].filter(Boolean).join('\n').trim();
  if (combined) {
    const msg = `FAIL: dynamic-import-paths: old dynamic import paths found:\n${combined}`;
    if (reportOnly) {
      console.warn(`WARN: ${msg}`);
      console.log('OK: dynamic-import-paths (report-only, not enforced yet)');
      return true;
    }
    console.error(msg);
    return false;
  }
  console.log('OK: dynamic-import-paths');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 16: providerRuntimeContext must be settings-agnostic.
 */
function check16_providerRuntimeContext() {
  const ctxPath = join(
    ROOT,
    'packages/core/src/runtime/providerRuntimeContext.ts',
  );
  if (!existsSync(ctxPath)) {
    console.log('OK: provider-runtime-context (file does not exist yet)');
    return true;
  }
  const output = runRg(
    'SettingsService|registerSettingsService|resetSettingsService|getSettingsService|@vybestack/llxprt-code-settings',
    'packages/core/src/runtime/providerRuntimeContext.ts',
    ['*.ts'],
  );
  if (output) {
    console.error(
      `FAIL: provider-runtime-context: providerRuntimeContext references settings:\n${output}`,
    );
    return false;
  }
  console.log('OK: provider-runtime-context');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 17: No packages/storage directory or workspace entry.
 */
function check17_noStoragePackage() {
  const storageDir = join(ROOT, 'packages/storage');
  if (existsSync(storageDir)) {
    console.error(
      'FAIL: no-storage-package: packages/storage directory exists',
    );
    return false;
  }
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  if (rootPkg.workspaces && rootPkg.workspaces.includes('packages/storage')) {
    console.error('FAIL: no-storage-package: packages/storage in workspaces');
    return false;
  }
  console.log('OK: no-storage-package');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 18: Core barrel shim export scan (post-P09 enforced, report-only before).
 */
function check18_coreBarrelShim(reportOnly) {
  const barrelPaths = [
    join(ROOT, 'packages/core/src/index.ts'),
    join(ROOT, 'packages/core/index.ts'),
  ];
  let violations = '';
  for (const bp of barrelPaths) {
    if (!existsSync(bp)) continue;
    const content = readFileSync(bp, 'utf-8');
    for (const sym of MOVED_SYMBOLS) {
      const regex = new RegExp(`export.*\\b${sym}\\b`);
      if (regex.test(content)) {
        // Find the matching lines
        const lines = content.split('\n');
        for (const line of lines) {
          const lineRegex = new RegExp(`\\b${sym}\\b`);
          if (/^export/.test(line.trim()) && lineRegex.test(line)) {
            violations += `${bp}:${line.trim()}\n`;
          }
        }
        break;
      }
    }
  }
  if (violations.trim()) {
    const msg = `FAIL: core-barrel-shim: core re-exports moved symbols:\n${violations}`;
    if (reportOnly) {
      console.warn(`WARN: ${msg}`);
      console.log('OK: core-barrel-shim (report-only, not enforced yet)');
      return true;
    }
    console.error(msg);
    return false;
  }
  console.log('OK: core-barrel-shim');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 19: settingsRuntimeAdapter single-owner bridge scan.
 */
function check19_adapterSingleOwner() {
  const productionPaths = [
    'packages/agents/src',
    'packages/core/src',
    'packages/cli/src',
    'packages/providers/src',
  ];
  const isAllowed = (line) => {
    const file = line.split(':')[0] || '';
    if (file.includes('settingsRuntimeAdapter.ts')) return true;
    if (file.includes('providerRuntimeContext.ts')) return true;
    if (file.includes('/test-utils/')) return true;
    if (file.includes('.test.') || file.includes('.spec.')) return true;
    if (file.includes('.d.ts')) return true;
    return false;
  };

  const directSettingsOutput = runRg(
    '(import.*\\b(getSettingsService|registerSettingsService|resetSettingsService)\\b.*@vybestack/llxprt-code-settings|new SettingsService\\()',
    productionPaths,
    ['*.ts'],
  );
  const directContextOutput = runRg(
    'import.*\\b(createProviderRuntimeContext|setActiveProviderRuntimeContext|clearActiveProviderRuntimeContext)\\b',
    productionPaths,
    ['*.ts'],
  );

  const violations = [directSettingsOutput, directContextOutput]
    .join('\n')
    .split('\n')
    .filter((line) => line && !isAllowed(line));

  if (violations.length > 0) {
    console.error(
      `FAIL: adapter-single-owner: direct settings singleton/default construction or provider runtime context imports outside adapter:\n${violations.join('\n')}`,
    );
    return false;
  }
  console.log('OK: adapter-single-owner');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Check 20: Lockfile verification.
 */
function check20_lockfile() {
  const lockPath = join(ROOT, 'package-lock.json');
  const pnpmPath = join(ROOT, 'pnpm-lock.yaml');

  if (!existsSync(lockPath)) {
    console.error('FAIL: lockfile: package-lock.json not found');
    return false;
  }
  if (existsSync(pnpmPath)) {
    console.error('FAIL: lockfile: pnpm-lock.yaml exists');
    return false;
  }
  console.log('OK: lockfile');
  return true;
}

/**
 * @plan PLAN-20260608-ISSUE1588.P03
 * Main entry point.
 */
function main() {
  const args = process.argv.slice(2);

  let checksToRun = DEFAULT_CHECKS;
  let phase = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check' && args[i + 1]) {
      checksToRun = args[i + 1].split(',');
      i++;
    } else if (args[i] === '--phase' && args[i + 1]) {
      phase = args[i + 1].toLowerCase();
      i++;
    }
  }

  // Determine report-only behavior based on phase
  const isPreP08 = phase === 'pre-p08' || phase === 'pre-p09';
  const isPreP09 = phase === 'pre-p09';

  let allPassed = true;

  for (const checkName of checksToRun) {
    if (!(checkName in CHECK_NAMES)) {
      console.error(`Unknown check: ${checkName}`);
      console.error(`Available checks: ${Object.keys(CHECK_NAMES).join(', ')}`);
      process.exit(1);
    }

    let reportOnly = false;

    // P08+ checks (7, 14, 15) are report-only before P08
    if (
      isPreP08 &&
      ['old-paths', 'vi-mock-paths', 'dynamic-import-paths'].includes(checkName)
    ) {
      reportOnly = true;
    }
    // P09+ checks (10, 11, 12, 13, 18) are report-only before P09
    if (
      isPreP09 &&
      [
        'core-re-exports',
        'modelParams',
        'modelParams-subpath',
        'relative-settings-imports',
        'relative-storage-imports',
        'core-barrel-shim',
      ].includes(checkName)
    ) {
      reportOnly = true;
    }

    let passed;
    switch (checkName) {
      case 'source-imports':
        passed = check1_sourceImports();
        break;
      case 'all-files-imports':
        passed = check2_allFilesImports();
        break;
      case 'metadata':
        passed = check3_metadata();
        break;
      case 'tsconfig-references':
        passed = check4_tsconfigReferences();
        break;
      case 'vitest-aliases':
        passed = check5_vitestAliases();
        break;
      case 'export-style':
        passed = check6_exportStyle();
        break;
      case 'old-paths':
        passed = check7_oldPaths(reportOnly);
        break;
      case 'root-barrel':
        passed = check8_rootBarrel();
        break;
      case 'anti-shim':
        passed = check9_antiShim();
        break;
      case 'core-re-exports':
        passed = check10_coreReExports(reportOnly);
        break;
      case 'modelParams':
        passed = check11_modelParamsSubpath(reportOnly);
        break;
      case 'modelParams-subpath':
        passed = check11_modelParamsSubpath(reportOnly);
        break;
      case 'relative-settings-imports':
        passed = check12_relativeSettingsImports(reportOnly);
        break;
      case 'relative-storage-imports':
        passed = check13_relativeStorageImports(reportOnly);
        break;
      case 'vi-mock-paths':
        passed = check14_viMockPaths(reportOnly);
        break;
      case 'dynamic-import-paths':
        passed = check15_dynamicImportPaths(reportOnly);
        break;
      case 'provider-runtime-context':
        passed = check16_providerRuntimeContext();
        break;
      case 'no-storage-package':
        passed = check17_noStoragePackage();
        break;
      case 'core-barrel-shim':
        passed = check18_coreBarrelShim(reportOnly);
        break;
      case 'adapter-single-owner':
        passed = check19_adapterSingleOwner();
        break;
      case 'lockfile':
        passed = check20_lockfile();
        break;
      default:
        console.error(`Unknown check: ${checkName}`);
        process.exit(1);
    }

    if (!passed && !reportOnly) {
      allPassed = false;
    }
  }

  // Additional verification: settings/src/index.ts exists as canonical barrel
  const barrelPath = join(SETTINGS_PKG, 'src/index.ts');
  if (!existsSync(barrelPath)) {
    console.error(
      'FAIL: packages/settings/src/index.ts (public API barrel) does not exist',
    );
    allPassed = false;
  } else {
    console.log('OK: settings/src/index.ts exists');
  }

  if (!allPassed) {
    process.exit(1);
  }

  console.log('\nAll requested checks passed.');
}

main();
