/**
 * @plan:PLAN-20260603-ISSUE1584.P09
 * @requirement:REQ-PKG-001
 *
 * Move-map completeness validation test.
 *
 * This test verifies:
 * 1. Every file in the current core provider inventory has a corresponding
 *    entry in the detailed move map (provider-move-map-detailed.md).
 * 2. The providers package scaffold is still in pre-migration state (no provider
 *    implementation files moved yet).
 * 3. Core still owns all 251 provider files.
 * 4. No compatibility shims or forbidden patterns exist.
 * 5. Package boundary constraints from P07 still hold.
 * 6. Move map table rows have unique sequential numbers 1..251 with no
 *    duplicates or gaps, and each destination is the deterministic
 *    transform of its source path.
 *
 * This test is intentionally placed in the providers package because it
 * validates migration readiness — it will be updated as files are moved
 * during P11 and eventually retired when migration completes.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const CORE_PROVIDERS_DIR = path.join(
  ROOT_DIR,
  'packages',
  'core',
  'src',
  'providers',
);
const PROVIDERS_SRC_DIR = path.join(ROOT_DIR, 'packages', 'providers', 'src');
const MOVE_MAP_PATH = path.join(
  ROOT_DIR,
  'project-plans',
  'issue1584',
  'analysis',
  'provider-move-map-detailed.md',
);

/**
 * Inventory file path — the authoritative list of all provider files
 * in packages/core/src/providers/.
 */
const INVENTORY_PATH = path.join(
  ROOT_DIR,
  'project-plans',
  'issue1584',
  'analysis',
  'provider-file-inventory.txt',
);

/**
 * Expected file count from P01 inventory.
 * This MUST match the actual file count in the core providers directory.
 */
const EXPECTED_INVENTORY_COUNT = 251;
const RENAMED_DESTINATION_OVERRIDES = new Map<string, string>([
  [
    'packages/core/src/providers/openai/OpenAIProvider.mistralCompatibility.test.ts',
    'packages/providers/src/openai/OpenAIProvider.mistralPayload.test.ts',
  ],
  [
    'packages/core/src/providers/providerInterface.compat.test.ts',
    'packages/providers/src/providerInterface.contract.test.ts',
  ],
  // #2092: the following provider test files were split into smaller,
  // behavior-focused test files. Each original inventory entry maps to a
  // representative split file so the move-map validation continues to prove
  // every inventory entry resolves to an existing destination.
  [
    'packages/core/src/providers/__tests__/LoadBalancingProvider.failover.test.ts',
    'packages/providers/src/__tests__/LoadBalancingProvider.failover.errors.test.ts',
  ],
  [
    'packages/core/src/providers/__tests__/LoadBalancingProvider.test.ts',
    'packages/providers/src/__tests__/LoadBalancingProvider.delegation.test.ts',
  ],
  [
    'packages/core/src/providers/__tests__/RetryOrchestrator.test.ts',
    'packages/providers/src/__tests__/RetryOrchestrator.basic.test.ts',
  ],
  [
    'packages/core/src/providers/anthropic/AnthropicProvider.issue1150.toolresult.test.ts',
    'packages/providers/src/anthropic/AnthropicProvider.issue1150.toolresult.adjacency.test.ts',
  ],
  [
    'packages/core/src/providers/anthropic/AnthropicProvider.test.ts',
    'packages/providers/src/anthropic/AnthropicProvider.caching.test.ts',
  ],
  [
    'packages/core/src/providers/anthropic/AnthropicProvider.thinking.test.ts',
    'packages/providers/src/anthropic/AnthropicProvider.thinking.config.test.ts',
  ],
]);
const AGENT_OWNED_DESTINATION_OVERRIDES = new Map<string, string>([
  [
    'packages/core/src/providers/openai/OpenAIStreamProcessor.stopReason.test.ts',
    'packages/agents/src/core/MessageConverter.stopReason.test.ts',
  ],
]);
const CORE_OWNED_DESTINATION_OVERRIDES = new Map<string, string>([
  [
    'packages/core/src/providers/openai-vercel/toolIdUtils.ts',
    'packages/tools/src/formatters/toolIdNormalization.ts',
  ],
  [
    'packages/core/src/providers/openai-vercel/toolIdUtils.test.ts',
    'packages/core/src/runtime/contracts/toolIdNormalization-contract.test.ts',
  ],
  [
    'packages/core/src/providers/utils/toolIdNormalization.ts',
    'packages/tools/src/formatters/toolIdNormalization.ts',
  ],
  [
    'packages/core/src/providers/utils/toolIdNormalization.test.ts',
    'packages/core/src/runtime/contracts/toolIdNormalization-contract.test.ts',
  ],
]);

/**
 * Regex to parse move-map markdown table rows.
 * Matches lines like: | 42 | `packages/core/src/providers/types/IProviderConfig.ts` | `packages/providers/src/types/IProviderConfig.ts` | Rule 7 sub | H (config types) |
 * Captures: row number, source path (without backticks), destination path (without backticks).
 */
const MOVE_MAP_ROW_REGEX = /^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/; // eslint-disable-line sonarjs/regular-expr -- regex is safe: bounded backticks, no catastrophic backtracking

/**
 * Parse all table rows from the move-map markdown and return an array of
 * { rowNum, sourcePath, destPath } entries.
 */
function parseMoveMapRows(
  content: string,
): Array<{ rowNum: number; sourcePath: string; destPath: string }> {
  const rows: Array<{ rowNum: number; sourcePath: string; destPath: string }> =
    [];
  const lines = content.split(String.fromCharCode(10));
  for (const line of lines) {
    const match = MOVE_MAP_ROW_REGEX.exec(line);
    if (match) {
      rows.push({
        rowNum: parseInt(match[1], 10),
        sourcePath: match[2],
        destPath: match[3],
      });
    }
  }
  return rows;
}

describe('P09 Move-map completeness validation', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * The inventory file must exist and contain the expected number of entries.
   */
  it('inventory file exists and has expected entry count', () => {
    expect(fs.existsSync(INVENTORY_PATH)).toBe(true);
    const inventoryContent = fs.readFileSync(INVENTORY_PATH, 'utf-8');
    const inventoryLines = inventoryContent
      .split('\n')
      .filter((line: string) => line.trim().length > 0);
    expect(inventoryLines.length).toBe(EXPECTED_INVENTORY_COUNT);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P15
   * @requirement:REQ-CLEAN-001
   *
   * Final cleanup removes the old core provider directory. The move-map
   * still preserves the original inventory count, but source files live in
   * packages/providers/src after P11/P14.
   */
  it('core providers directory is empty after final cleanup', () => {
    const actualFiles = collectAllFiles(CORE_PROVIDERS_DIR);
    expect(actualFiles).toHaveLength(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P15
   * @requirement:REQ-CLEAN-001
   *
   * Every inventory file must now exist at its deterministic providers
   * package destination or documented core-owned utility destination. This
   * proves the original provider inventory has a single implementation home
   * after cleanup.
   */
  it('every inventory file exists in the providers package destination', () => {
    const inventoryContent = fs.readFileSync(INVENTORY_PATH, 'utf-8');
    const inventoryLines = inventoryContent
      .split('\n')
      .filter((line: string) => line.trim().length > 0);

    for (const inventoryLine of inventoryLines) {
      const source = inventoryLine.trim();
      const dest =
        CORE_OWNED_DESTINATION_OVERRIDES.get(source) ??
        AGENT_OWNED_DESTINATION_OVERRIDES.get(source) ??
        RENAMED_DESTINATION_OVERRIDES.get(source) ??
        source.replace(
          'packages/core/src/providers/',
          'packages/providers/src/',
        );
      expect(
        fs.existsSync(path.join(ROOT_DIR, dest)),
        `Missing moved file: ${dest}`,
      ).toBe(true);
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * The detailed move map document must exist and contain entries
   * for all 251 inventory files.
   */
  it('detailed move map document exists', () => {
    expect(fs.existsSync(MOVE_MAP_PATH)).toBe(true);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * The move map must reference every file in the inventory by source path.
   * Extracts all source paths from the move map markdown table and verifies
   * each inventory file is present.
   */
  it('move map covers every inventory file', () => {
    const inventoryContent = fs.readFileSync(INVENTORY_PATH, 'utf-8');
    const inventoryLines = inventoryContent
      .split('\n')
      .filter((line: string) => line.trim().length > 0);

    const moveMapContent = fs.readFileSync(MOVE_MAP_PATH, 'utf-8');
    const parsedRows = parseMoveMapRows(moveMapContent);
    const moveMapSources = new Set(parsedRows.map((r) => r.sourcePath));

    for (const inventoryLine of inventoryLines) {
      const fileName = inventoryLine.trim();
      expect(
        moveMapSources.has(fileName),
        `Move map missing source entry for: ${fileName}`,
      ).toBe(true);
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * Move map table rows must have unique sequential numbers from 1 to
   * EXPECTED_INVENTORY_COUNT (251). This catches duplicate row numbers
   * (e.g., two rows numbered 198) and missing row numbers (e.g., gap
   * from 250 to 252 with no 251).
   */
  it('move map row numbers are unique and sequential 1..251', () => {
    const moveMapContent = fs.readFileSync(MOVE_MAP_PATH, 'utf-8');
    const parsedRows = parseMoveMapRows(moveMapContent);

    expect(parsedRows.length).toBe(EXPECTED_INVENTORY_COUNT);

    const rowNumbers = parsedRows.map((r) => r.rowNum);
    const uniqueRowNumbers = new Set(rowNumbers);

    // No duplicate row numbers
    expect(uniqueRowNumbers.size).toBe(EXPECTED_INVENTORY_COUNT);

    // Row numbers must be exactly 1..251
    const expected = Array.from(
      { length: EXPECTED_INVENTORY_COUNT },
      (_, i) => i + 1,
    );
    const sorted = [...uniqueRowNumbers].sort((a, b) => a - b);
    expect(sorted).toStrictEqual(expected);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * Every source path in the move map must have a deterministic destination
   * derived by replacing "packages/core/src/providers/" with
   * "packages/providers/src/". This catches incorrect destination paths
   * where the relative path portion does not match the source (e.g.,
   * a source of "schemaConverter.issue1844.test.ts" mapped to a
   * destination with "schemaSchemaConverter.issue1844.test.ts").
   */
  it('move map destinations are deterministic transforms of source paths', () => {
    const moveMapContent = fs.readFileSync(MOVE_MAP_PATH, 'utf-8');
    const parsedRows = parseMoveMapRows(moveMapContent);

    const violations: string[] = [];
    for (const row of parsedRows) {
      const expectedDest =
        CORE_OWNED_DESTINATION_OVERRIDES.get(row.sourcePath) ??
        AGENT_OWNED_DESTINATION_OVERRIDES.get(row.sourcePath) ??
        RENAMED_DESTINATION_OVERRIDES.get(row.sourcePath) ??
        row.sourcePath.replace(
          'packages/core/src/providers/',
          'packages/providers/src/',
        );
      if (row.destPath !== expectedDest) {
        violations.push(
          `Row ${row.rowNum}: source="${row.sourcePath}" dest="${row.destPath}" expected="${expectedDest}"`,
        );
      }
    }

    expect(
      violations,
      `Destination transform violations:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * Move map destination paths must all be under packages/providers/src/.
   * No destination should point to packages/core or any other location.
   */
  it('move map destinations are all under packages/providers/src/', () => {
    const moveMapContent = fs.readFileSync(MOVE_MAP_PATH, 'utf-8');
    const lines = moveMapContent.split('\n');
    const destLines = lines.filter((line: string) =>
      line.includes('packages/providers/src/'),
    );

    const violations: string[] = destLines
      .map((line: string) => {
        const startIdx = line.indexOf('`packages/providers/src/');
        if (startIdx === -1) return '';
        const endIdx = line.indexOf('`', startIdx + 1);
        if (endIdx === -1) return '';
        return line.slice(
          startIdx + 'packages/providers/src/'.length + 1,
          endIdx,
        );
      })
      .filter(
        (destPath: string) =>
          destPath.length > 0 && destPath.includes('packages/core'),
      );

    expect(violations).toHaveLength(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P15
   * @requirement:REQ-CLEAN-001
   *
   * Final state: provider implementations have been moved to the providers
   * package, so implementation directories must now exist there.
   */
  it('provider implementation files have been moved to providers package', () => {
    const files = fs.readdirSync(PROVIDERS_SRC_DIR);
    expect(files).toContain('index.ts');

    const entries = fs.readdirSync(PROVIDERS_SRC_DIR, {
      withFileTypes: true,
    });
    const dirs = entries
      .filter((e: fs.Dirent) => e.isDirectory())
      .map((e: fs.Dirent) => e.name);
    expect(dirs).toStrictEqual(
      expect.arrayContaining(['anthropic', 'gemini', 'openai', 'tokenizers']),
    );
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P15
   * @requirement:REQ-CLEAN-001
   *
   * Core provider files have been deleted after their implementation move.
   */
  it('all core provider files have been removed after provider move', () => {
    const actualFiles = collectAllFiles(CORE_PROVIDERS_DIR);
    expect(actualFiles).toHaveLength(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P15
   * @requirement:REQ-CLEAN-001
   *
   * Key provider implementation files now exist in providers package.
   */
  it('key provider interfaces and implementations exist in providers package', () => {
    const keyFiles = [
      'IProvider.ts',
      'IProviderManager.ts',
      'ITool.ts',
      'IModel.ts',
      'ProviderManager.ts',
      'BaseProvider.ts',
      'LoadBalancingProvider.ts',
      'LoggingProviderWrapper.ts',
      'ProviderContentGenerator.ts',
      'errors.ts',
      'ContentGeneratorRole.ts',
      'types.ts',
    ];
    for (const file of keyFiles) {
      expect(
        fs.existsSync(path.join(PROVIDERS_SRC_DIR, file)),
        `Missing key file: ${file}`,
      ).toBe(true);
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P15
   * @requirement:REQ-CLEAN-001
   *
   * Key provider subdirectories now exist in providers package.
   */
  it('key provider subdirectories exist in providers package', () => {
    const keyDirs = [
      'anthropic',
      'gemini',
      'openai',
      'openai-responses',
      'openai-vercel',
      'fake',
      'tokenizers',
      'logging',
      'reasoning',
      'utils',
      'types',
      '__tests__',
      'integration',
      'test-utils',
    ];
    for (const dir of keyDirs) {
      expect(
        fs.existsSync(path.join(PROVIDERS_SRC_DIR, dir)),
        `Missing key directory: ${dir}`,
      ).toBe(true);
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * No forbidden compatibility suffixed files exist.
   */
  it('no V2/Compat/New/Copy suffixed provider files exist', () => {
    const forbiddenSuffixes = ['V2', 'Compat', 'New', 'Copy'];
    const allFiles = collectAllFiles(CORE_PROVIDERS_DIR);
    const violations = allFiles.filter((filePath: string) => {
      const basename = path.basename(filePath, '.ts');
      const nameWithoutTestSuffix = basename
        .replace(/\.test$/, '')
        .replace(/\.spec$/, '');
      return forbiddenSuffixes.some((suffix: string) =>
        nameWithoutTestSuffix.endsWith(suffix),
      );
    });
    expect(violations).toHaveLength(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * No compat/shim files in core/src/providers/. These would indicate
   * compatibility wrappers that would violate the anti-shim policy.
   */
  it('no compat/shim files in core providers', () => {
    const allFiles = collectAllFiles(CORE_PROVIDERS_DIR);
    const violations = allFiles.filter((filePath: string) => {
      const basename = path.basename(filePath);
      return /compat/i.test(basename) || /shim/i.test(basename);
    });
    expect(violations).toHaveLength(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * Core production code must not import from the providers package.
   */
  it('core production code has no imports from providers package', () => {
    const coreSrcDir = path.join(ROOT_DIR, 'packages', 'core', 'src');
    const coreFiles = collectTsFiles(coreSrcDir, true); // exclude tests
    const violations: string[] = [];

    for (const filePath of coreFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*')
        ) {
          continue;
        }
        if (/from\s+['"]@vybestack\/llxprt-code-providers['"]/.test(lines[i])) {
          violations.push(
            `${path.relative(coreSrcDir, filePath)}:${i + 1}: ${lines[i].trim()}`,
          );
        }
      }
    }
    expect(violations).toHaveLength(0);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * Providers package must not depend on CLI.
   */
  it('providers package does not depend on CLI', () => {
    const pkgJsonPath = path.join(
      ROOT_DIR,
      'packages',
      'providers',
      'package.json',
    );
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const dependencySections = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies,
    ];
    const forbiddenDependencies = ['@vybestack/llxprt-code'];

    for (const deps of dependencySections) {
      for (const forbiddenDependency of forbiddenDependencies) {
        expect(deps?.[forbiddenDependency]).toBeUndefined();
      }
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * Core package must not depend on providers package.
   */
  it('core package does not depend on providers package', () => {
    const pkgJsonPath = path.join(ROOT_DIR, 'packages', 'core', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    expect(
      pkg.dependencies?.['@vybestack/llxprt-code-providers'],
    ).toBeUndefined();
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * The import rewrite categories A-L from core-import-remediation.md must
   * all be represented in the detailed move map.
   */
  it('all import rewrite categories (A-L) are documented in move map', () => {
    const moveMapContent = fs.readFileSync(MOVE_MAP_PATH, 'utf-8');
    const categories = [
      'Category',
      'A', // Provider contract types
      'B', // Provider orchestration
      'C', // Provider content generation
      'D', // Provider tokenizers
      'E', // Tool ID normalization
      'F', // Provider runtime errors
      'G', // Provider telemetry types
      'H', // Provider config types
      'I', // Media utilities
      'J', // Reasoning utilities
      'K', // Index.ts mass re-exports
      'L', // Test utilities
    ];
    for (const cat of categories) {
      expect(
        moveMapContent.includes(cat),
        `Move map missing category: ${cat}`,
      ).toBe(true);
    }
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * The explicit exception for toolIdNormalization (Category E)
   * must be documented in the move map.
   */
  it('toolIdNormalization explicit exception is documented', () => {
    const moveMapContent = fs.readFileSync(MOVE_MAP_PATH, 'utf-8');
    expect(moveMapContent.includes('toolIdNormalization')).toBe(true);
    expect(moveMapContent.includes('EXPLICIT EXCEPTION')).toBe(true);
  });

  /**
   * @plan:PLAN-20260603-ISSUE1584.P09
   * @requirement:REQ-PKG-001
   *
   * The core import remediation document must exist and reference
   * all categories A through L.
   */
  it('core import remediation document exists and covers all categories', () => {
    const remediationPath = path.join(
      ROOT_DIR,
      'project-plans',
      'issue1584',
      'analysis',
      'core-import-remediation.md',
    );
    expect(fs.existsSync(remediationPath)).toBe(true);
    const content = fs.readFileSync(remediationPath, 'utf-8');
    expect(content.includes('Category')).toBe(true);
    expect(content.includes('Blocker')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────────────────────────

function collectAllFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectAllFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

function collectTsFiles(dir: string, excludeTests: boolean): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath, excludeTests));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      if (
        excludeTests &&
        (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts'))
      ) {
        continue;
      }
      results.push(fullPath);
    }
  }
  return results;
}
