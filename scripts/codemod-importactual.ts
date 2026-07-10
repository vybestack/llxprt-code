/**
 * Codemod: transforms vi.mock('./relative', ... (importOriginal) => ...) and
 * vi.importActual('./relative') to use query-param imports that bypass
 * Bun's mock.module interception.
 *
 * Usage: bun scripts/codemod-importactual.ts <file1> [file2] ...
 */

import { readFileSync, writeFileSync } from 'node:fs';

function transformFile(filePath: string): {
  changed: boolean;
  changes: number;
} {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let changes = 0;
  let currentMockPath: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Detect vi.mock('./path', ... (importOriginal) => { and extract path
    const mockMatch = line.match(
      /vi\.mock\(\s*['"](\.\.?\/[^'"]+)['"]\s*,\s*(?:async\s*)?\(importOriginal(?:<[^>]*>)?\)\s*=>/,
    );
    if (mockMatch) {
      currentMockPath = mockMatch[1];
      // Replace the entire (importOriginal<...>) with ()
      line = line.replace(/\(importOriginal(?:<[^>]*>)?\)/, '()');
      lines[i] = line;
      changes++;
      continue;
    }

    // Handle _importOriginal variant
    if (
      line.match(
        /vi\.mock\(\s*['"](\.\.?\/[^'"]+)['"]\s*,\s*(?:async\s*)?\(_importOriginal\)\s*=>/,
      )
    ) {
      line = line.replace(/\(_importOriginal\)/, '()');
      lines[i] = line;
      changes++;
      continue;
    }

    // Replace importOriginal() calls within the factory body
    if (currentMockPath && line.includes('importOriginal')) {
      const escapedPath = currentMockPath.replace(/'/g, "\\'");
      // Handle: await importOriginal<...>() or importOriginal<...>()
      line = line.replace(
        /await\s+importOriginal(?:<[^>]*>)?\(\)/g,
        `await import('${escapedPath}?__importActual')`,
      );
      // Handle non-awaited: importOriginal<...>()
      line = line.replace(
        /importOriginal(?:<[^>]*>)?\(\)/g,
        `import('${escapedPath}?__importActual')`,
      );
      if (line !== lines[i]) {
        lines[i] = line;
        changes++;
      }
    }

    // Detect end of factory block
    if (currentMockPath && /^\s*\}\);?\s*$/.test(line)) {
      currentMockPath = null;
    }

    // Handle standalone vi.importActual('./path') calls
    if (line.includes('vi.importActual')) {
      const importActualMatch = line.match(
        /vi\.importActual(?:<[^>]*>)?\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/,
      );
      if (importActualMatch) {
        const path = importActualMatch[1];
        const escapedPath = path.replace(/'/g, "\\'");
        line = line.replace(
          /vi\.importActual(?:<[^>]*>)?\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
          `import('${escapedPath}?__importActual')`,
        );
        if (line !== lines[i]) {
          lines[i] = line;
          changes++;
        }
      }
    }
  }

  let result = lines.join('\n');
  // Multi-line vi.importActual: vi.importActual<typeof import('./p')>(
  //   './p',
  // );
  result = result.replace(
    /vi\.importActual<typeof import\(['"](\.\.?\/[^'"]+)['"]\)>\(\s*['"]\1['"]\s*,?\s*\)/g,
    (_m, p: string) => `import('${p}?__importActual')`,
  );
  result = result.replace(
    /vi\.importActual<typeof import\(['"](\.\.?\/[^'"]+)['"]\)>\(\s*['"](\.\.?\/[^'"]+)['"]\s*,?\s*\)/g,
    (_m, _tp: string, cp: string) => `import('${cp}?__importActual')`,
  );
  result = result.replace(
    /vi\.importActual<[^>]+>\(\s*['"](\.\.?\/[^'"]+)['"]\s*,?\s*\)/g,
    (_m, p: string) => `import('${p}?__importActual')`,
  );
  if (result !== content) {
    writeFileSync(filePath, result);
    return { changed: true, changes };
  }
  return { changed: false, changes: 0 };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(
    'Usage: bun scripts/codemod-importactual.ts <file1> [file2] ...',
  );
  process.exit(1);
}

let totalChanged = 0;
let totalUnchanged = 0;
for (const file of files) {
  const result = transformFile(file);
  if (result.changed) {
    console.log(`  CHANGED (${result.changes} edits): ${file}`);
    totalChanged++;
  } else {
    console.log(`  skipped: ${file}`);
    totalUnchanged++;
  }
}

console.log(`\n${totalChanged} files changed, ${totalUnchanged} unchanged`);
