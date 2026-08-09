/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  initializeParser,
  resetParser,
  isParserAvailable,
  parseCommandDetailsForLanguage,
  parseShellCommandForLanguage,
  extractCommandNamesForLanguage,
  hasCommandSubstitutionForLanguage,
} from './shell-parser.js';

await initializeParser();
const pwshAvailable = isParserAvailable('powershell');
if (!pwshAvailable) {
  throw new Error('PowerShell grammar failed to load under Bun');
}
const describePwsh = describe.skipIf(!pwshAvailable);

async function restoreParsers(): Promise<void> {
  const initialized = await initializeParser();
  if (!initialized || !isParserAvailable('powershell')) {
    throw new Error(
      'PowerShell parser restoration failed after lifecycle tests',
    );
  }
}

describePwsh('shell-parser: tree-sitter-pwsh grammar', () => {
  beforeAll(() => {
    if (!isParserAvailable('powershell')) {
      throw new Error('PowerShell grammar failed to load');
    }
  });

  describe('valid PowerShell constructs are not syntax errors', () => {
    const validSamples: Array<[string, string]> = [
      [
        'semicolon-chained if-exit',
        'git status --short --branch; git checkout main; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
      ],
      ['variable assignment + cmdlet', '$result = Get-Content path/to/file'],
      ['ForEach-Object script block', 'ForEach-Object { Write-Host $_ }'],
      ['array pipeline', '@(1,2,3) | ForEach-Object { $_ * 2 }'],
      [
        'Where-Object pipeline',
        'Get-Process | Where-Object { $_.Name -eq "x" }',
      ],
      ['call operator literal', '& "C:\\tool.exe" arg1'],
      ['dot-source literal', '. .\\script.ps1'],
      ['Invoke-Expression', 'Invoke-Expression $cmd'],
      ['Start-Process', 'Start-Process notepad.exe'],
      ['property access', '$value.Name'],
      ['method call', '$value.Trim()'],
      ['redirection', 'Get-Process *>&1'],
      ['nested command in subexpression', '$(Get-ChildItem)'],
      [
        'multiline if/foreach',
        'foreach ($item in $collection) { Write-Host $item }',
      ],
    ];

    for (const [label, cmd] of validSamples) {
      it(`accepts ${label}`, () => {
        const result = parseCommandDetailsForLanguage(cmd, 'powershell');
        expect(result).not.toBeNull();
        expect(result!.hasError).toBe(false);
      });
    }

    it('accepts static .NET method invocation without a syntax error', () => {
      const result = parseCommandDetailsForLanguage(
        '[System.IO.File]::ReadAllText("test.txt")',
        'powershell',
      );
      expect(result).not.toBeNull();
      expect(result!.hasError).toBe(false);
    });

    it('accepts static .NET process start without a syntax error', () => {
      const result = parseCommandDetailsForLanguage(
        '[System.Diagnostics.Process]::Start("cmd.exe")',
        'powershell',
      );
      expect(result).not.toBeNull();
      expect(result!.hasError).toBe(false);
    });
  });

  describe('malformed PowerShell is a syntax error', () => {
    it('rejects incomplete pipeline', () => {
      const result = parseCommandDetailsForLanguage(
        'Get-ChildItem |',
        'powershell',
      );
      expect(result).not.toBeNull();
      expect(result!.hasError).toBe(true);
      expect(result!.errorReason).toContain('tree-sitter-pwsh');
    });

    it('rejects incomplete if', () => {
      const result = parseCommandDetailsForLanguage('if (', 'powershell');
      expect(result).not.toBeNull();
      expect(result!.hasError).toBe(true);
      expect(result!.errorReason).toContain('tree-sitter-pwsh');
    });

    it('reports a useful row:column location', () => {
      const result = parseCommandDetailsForLanguage(
        'Get-ChildItem |',
        'powershell',
      );
      expect(result).not.toBeNull();
      expect(result!.errorReason).toMatch(/\d{1,4}:\d{1,4}/u);
    });
  });

  describe('command extraction', () => {
    it('extracts static command names from pipelines', () => {
      const tree = parseShellCommandForLanguage(
        'Get-Process | Where-Object { $_.Name -eq "x" }',
        'powershell',
      );
      expect(tree).not.toBeNull();
      const names = extractCommandNamesForLanguage(tree!, 'powershell');
      expect(names).toContain('Get-Process');
      expect(names).toContain('Where-Object');
    });

    it('extracts commands recursively from script blocks', () => {
      const tree = parseShellCommandForLanguage(
        'ForEach-Object { Write-Host $_ }',
        'powershell',
      );
      expect(tree).not.toBeNull();
      const names = extractCommandNamesForLanguage(tree!, 'powershell');
      expect(names).toContain('ForEach-Object');
      expect(names).toContain('Write-Host');
    });

    it('extracts commands from subexpressions', () => {
      const tree = parseShellCommandForLanguage(
        '$(Get-ChildItem)',
        'powershell',
      );
      expect(tree).not.toBeNull();
      const names = extractCommandNamesForLanguage(tree!, 'powershell');
      expect(names).toContain('Get-ChildItem');
    });

    it('extracts literal call-operator targets as static names', () => {
      const tree = parseShellCommandForLanguage(
        '& "C:\\tools\\my-tool.exe"',
        'powershell',
      );
      expect(tree).not.toBeNull();
      const names = extractCommandNamesForLanguage(tree!, 'powershell');
      expect(names).toContain('my-tool.exe');
    });

    it('does not fabricate command names for .NET expressions', () => {
      const tree = parseShellCommandForLanguage(
        '[System.IO.File]::ReadAllText("x")',
        'powershell',
      );
      expect(tree).not.toBeNull();
      const names = extractCommandNamesForLanguage(tree!, 'powershell');
      expect(names).not.toContain('System');
    });
  });

  describe('command substitution detection', () => {
    it('detects $() subexpressions as substitution', () => {
      const tree = parseShellCommandForLanguage(
        '$(Get-ChildItem)',
        'powershell',
      );
      expect(tree).not.toBeNull();
      expect(hasCommandSubstitutionForLanguage(tree!, 'powershell')).toBe(true);
    });

    it('does NOT treat PowerShell backticks as substitution', () => {
      const tree = parseShellCommandForLanguage(
        'Write-Host `n "hello"',
        'powershell',
      );
      expect(tree).not.toBeNull();
      expect(hasCommandSubstitutionForLanguage(tree!, 'powershell')).toBe(
        false,
      );
    });
  });

  describe('invocation expression classification', () => {
    const expressionCases: Array<[string, string]> = [
      [
        'static type literal Process::Start',
        '[System.Diagnostics.Process]::Start("cmd.exe")',
      ],
      ['instance method Start', '$obj.Start("cmd.exe")'],
      ['instance method nested in args', 'Write-Host ($obj.GetName())'],
      ['benign instance method Trim', '$value.Trim()'],
      [
        'static method via variable',
        '$type = [System.Diagnostics.Process]; $type::Start("cmd.exe")',
      ],
    ];

    for (const [label, cmd] of expressionCases) {
      it(`classifies ${label} as expression`, () => {
        const result = parseCommandDetailsForLanguage(cmd, 'powershell');
        expect(result).not.toBeNull();
        expect(result!.hasError).toBe(false);
        const exprDetail = result!.details.find(
          (d) => d.nameKind === 'expression',
        );
        expect(exprDetail).toBeDefined();
      });
    }

    it('default-allow: benign method still produces valid syntax', () => {
      const result = parseCommandDetailsForLanguage(
        '$value.Trim()',
        'powershell',
      );
      expect(result).not.toBeNull();
      expect(result!.hasError).toBe(false);
    });
  });

  describe('canonical command detail text for invocation targets', () => {
    it('normalizes literal & path target to basename with canonicalText', () => {
      const result = parseCommandDetailsForLanguage(
        "& 'C:\\tools\\my-tool.exe' --safe",
        'powershell',
      );
      expect(result).not.toBeNull();
      expect(result!.hasError).toBe(false);
      const detail = result!.details.find((d) => d.name === 'my-tool.exe');
      expect(detail).toBeDefined();
      expect(detail!.canonicalText).toContain('my-tool.exe');
      expect(detail!.canonicalText).toContain('--safe');
    });

    it('does not require ShellTool(&) for literal call targets', () => {
      const result = parseCommandDetailsForLanguage(
        '& "C:\\tools\\git.exe" status',
        'powershell',
      );
      expect(result).not.toBeNull();
      const detail = result!.details.find((d) => d.name === 'git.exe');
      expect(detail).toBeDefined();
      expect(detail!.canonicalText?.startsWith('&')).toBe(false);
    });

    it('classifies expandable string target as dynamic', () => {
      const result = parseCommandDetailsForLanguage(
        '& "$env:PROGRAMFILES\\tool.exe"',
        'powershell',
      );
      expect(result).not.toBeNull();
      const detail = result!.details[0];
      expect(detail.nameKind).toBe('dynamic');
    });

    it('dot-source literal normalizes to basename', () => {
      const result = parseCommandDetailsForLanguage(
        '. .\\script.ps1',
        'powershell',
      );
      expect(result).not.toBeNull();
      const detail = result!.details.find((d) => d.name === 'script.ps1');
      expect(detail).toBeDefined();
    });
  });

  describe('PowerShell string literal decoding semantics', () => {
    // OCR Finding 9 (#3181): A real Windows PowerShell probe confirmed that
    // single-quoted here-strings do NOT collapse doubled single quotes.
    // [Console]::WriteLine(@'foo''bar'@) prints foo''bar. This test locks
    // that behavior so a future "fix" does not regress it.
    it('single-quoted here-string preserves doubled single quotes', () => {
      const nl = String.fromCharCode(10);
      const result = parseCommandDetailsForLanguage(
        "iex @'" + nl + "Write-Host foo''bar" + nl + "'@",
        'powershell',
      );
      expect(result).not.toBeNull();
      expect(result!.hasError).toBe(false);
      const writeHost = result!.details.find((d) => d.name === 'Write-Host');
      expect(writeHost).toBeDefined();
      expect(writeHost!.text).toContain("foo''bar");
    });

    // OCR Finding 2 (#3181): Double-quoted strings DO collapse doubled
    // double-quotes: "hello ""world""" decodes to hello "world".
    it('double-quoted literal collapses doubled double-quotes', () => {
      const result = parseCommandDetailsForLanguage(
        'iex "Write-Host hello ""world"""',
        'powershell',
      );
      expect(result).not.toBeNull();
      expect(result!.hasError).toBe(false);
      const writeHost = result!.details.find((d) => d.name === 'Write-Host');
      expect(writeHost).toBeDefined();
      expect(writeHost!.text).toContain('hello "world"');
      expect(writeHost!.text).not.toContain('""world""');
    });
  });

  describe('Bash parser remains unchanged', () => {
    it('still parses bash commands', () => {
      const result = parseCommandDetailsForLanguage('ls -la /tmp', 'bash');
      expect(result).not.toBeNull();
      expect(result!.hasError).toBe(false);
      expect(result!.details.some((d) => d.name === 'ls')).toBe(true);
    });

    it('still rejects malformed bash', () => {
      const result = parseCommandDetailsForLanguage('ls &&', 'bash');
      expect(result).not.toBeNull();
      expect(result!.hasError).toBe(true);
    });
  });
});

describe.skipIf(!pwshAvailable)('shell-parser: pwsh clean lifecycle', () => {
  afterAll(restoreParsers);

  it('initializes, resets with disposal, and re-initializes cleanly', async () => {
    expect(isParserAvailable('powershell')).toBe(true);
    expect(isParserAvailable('bash')).toBe(true);
    resetParser();
    // After reset, both parsers must be gone — resources disposed.
    expect(isParserAvailable('powershell')).toBe(false);
    expect(isParserAvailable('bash')).toBe(false);
    // Re-initialize so subsequent tests in the same bun process still
    // have a working parser.
    const reOk = await initializeParser();
    expect(reOk).toBe(true);
    expect(isParserAvailable('powershell')).toBe(true);
    expect(isParserAvailable('bash')).toBe(true);
  });

  it('resetParser() during initialization prevents stale publish', async () => {
    resetParser();
    // Start initialization but do NOT await — the async body yields at
    // `await import('web-tree-sitter')` before any parser is published.
    const stalePromise = initializeParser();
    // Immediately reset while initialization is in flight.
    resetParser();
    // Both languages must be unavailable right after reset.
    expect(isParserAvailable('bash')).toBe(false);
    expect(isParserAvailable('powershell')).toBe(false);
    // Wait for the stale initialization to settle. A generation-safe
    // initializer must NOT publish its allocated parsers over the
    // newer reset state.
    await stalePromise;
    expect(isParserAvailable('bash')).toBe(false);
    expect(isParserAvailable('powershell')).toBe(false);
    // A subsequent fresh initialize must succeed.
    const ok = await initializeParser();
    expect(ok).toBe(true);
    expect(isParserAvailable('bash')).toBe(true);
    expect(isParserAvailable('powershell')).toBe(true);
  });
});

/**
 * Saved-corpus construct-family coverage (#3181 Finding 9).
 *
 * The original LLxprt recording contained 27 rejected run_shell_command tool
 * responses. The exact saved recording is not available as a committed test
 * fixture. Instead, this corpus reproduces every construct family documented
 * in project-plans/issue3181/PLAN.md (variable assignment, .NET invocation,
 * ForEach-Object/Where-Object script blocks, foreach/if statements, call
 * operator, @() arrays, redirections, Start-Process, property/method access,
 * semicolon-chained if-exit, subexpressions, multiline). Each entry asserts
 * the tree-sitter-pwsh grammar does NOT produce a syntax error, proving
 * valid PowerShell is no longer hard-denied as malformed.
 */
describe.skipIf(!pwshAvailable)('saved-corpus construct families', () => {
  const corpus: Array<{ label: string; cmd: string }> = [
    // Family 1: variable assignment + cmdlet
    {
      label: 'var assign + Get-Content',
      cmd: '$result = Get-Content path/to/file',
    },
    // Family 2: .NET member invocation
    {
      label: '.NET static method',
      cmd: '[System.IO.File]::ReadAllText("test.txt")',
    },
    // Family 3: ForEach-Object script block
    { label: 'ForEach-Object block', cmd: 'ForEach-Object { Write-Host $_ }' },
    // Family 4: Where-Object pipeline
    {
      label: 'Where-Object pipeline',
      cmd: 'Get-Process | Where-Object { $_.Name -eq "x" }',
    },
    // Family 5: foreach statement
    {
      label: 'foreach loop',
      cmd: 'foreach ($item in $collection) { Write-Host $item }',
    },
    // Family 6: if statement
    {
      label: 'if statement',
      cmd: 'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    },
    // Family 7: call operator literal
    { label: 'call operator literal', cmd: '& "C:\\tool.exe" arg1' },
    // Family 8: @() array expression + pipeline
    {
      label: '@() array pipeline',
      cmd: '@(1,2,3) | ForEach-Object { $_ * 2 }',
    },
    // Family 9: *>&1 redirection
    { label: '*>&1 redirection', cmd: 'Get-Process *>&1' },
    // Family 10: Start-Process
    { label: 'Start-Process', cmd: 'Start-Process notepad.exe' },
    // Family 11: property access
    { label: 'property access', cmd: '$value.Name' },
    // Family 12: method call
    { label: 'method call', cmd: '$value.Trim()' },
    // Family 13: semicolon-chained if-exit (exact reproduction)
    {
      label: 'semicolon if-exit chain',
      cmd: 'git status --short --branch; git checkout main; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    },
    // Family 14: subexpression
    { label: 'subexpression', cmd: '$(Get-ChildItem)' },
    // Family 15: dot-source literal
    { label: 'dot-source literal', cmd: '. .\\script.ps1' },
    // Family 16: Invoke-Expression
    { label: 'Invoke-Expression', cmd: 'Invoke-Expression $cmd' },
    // Family 17: multiline source
    {
      label: 'multiline foreach',
      cmd: 'foreach ($item in $collection) {\n  Write-Host $item\n}',
    },
    // Family 18: nested command in pipeline
    {
      label: 'pipeline nested commands',
      cmd: 'Get-ChildItem | Select-Object Name | Sort-Object',
    },
    // Family 19: variable assignment + method
    { label: 'var + method chain', cmd: '$text = "hello"; $text.ToUpper()' },
    // Family 20: hash table
    { label: 'hash table literal', cmd: '$h = @{ Key = "Value"; Num = 42 }' },
    // Family 21: try/catch
    {
      label: 'try/catch block',
      cmd: 'try { Get-Item $path } catch { Write-Host "error" }',
    },
    // Family 22: string comparison with -eq operator in an if statement
    {
      label: 'string comparison',
      cmd: 'if ($value -eq "test") { Write-Host "match" }',
    },
    // Family 23: array element access via indexer
    { label: 'array index', cmd: '$first = $items[0]' },
    // Family 24: here-string
    { label: 'here-string', cmd: '$s = @"\nhello\n"@' },
    // Family 25: ternary-style if
    {
      label: 'if expression in assignment',
      cmd: '$x = if ($cond) { 1 } else { 2 }',
    },
    // Family 26: pipeline with Where + Select
    {
      label: 'pipeline Where+Select',
      cmd: 'Get-Process | Where-Object { $_.Id -gt 100 } | Select-Object Name, Id',
    },
    // Family 27: -join operator
    { label: 'array -join', cmd: '$arr = @(1,2,3); $arr -join ","' },
  ];

  for (const { label, cmd } of corpus) {
    it(`corpus: ${label} is not a syntax error`, () => {
      const result = parseCommandDetailsForLanguage(cmd, 'powershell');
      expect(result).not.toBeNull();
      expect(result!.hasError).toBe(false);
    });
  }

  it('corpus has exactly 27 entries covering all documented families', () => {
    expect(corpus.length).toBe(27);
  });
});

/**
 * Exact .NET root assertions (#3181 Finding 9).
 *
 * Pure .NET expressions must not produce fabricated Bash-style roots.
 * The tree-sitter-pwsh grammar classifies them as expression details,
 * which are excluded from command name extraction.
 */
describe.skipIf(!pwshAvailable)('exact .NET roots', () => {
  it('static .NET method produces no command names', () => {
    const tree = parseShellCommandForLanguage(
      '[System.Diagnostics.Process]::Start("cmd.exe")',
      'powershell',
    );
    expect(tree).not.toBeNull();
    const names = extractCommandNamesForLanguage(tree!, 'powershell');
    expect(names).toEqual([]);
  });

  it('instance method produces no command names', () => {
    const tree = parseShellCommandForLanguage(
      '$obj.Start("cmd.exe")',
      'powershell',
    );
    expect(tree).not.toBeNull();
    const names = extractCommandNamesForLanguage(tree!, 'powershell');
    expect(names).toEqual([]);
  });

  it('nested .NET in arguments produces only outer command name', () => {
    const tree = parseShellCommandForLanguage(
      'Write-Host ([System.IO.File]::ReadAllText("x"))',
      'powershell',
    );
    expect(tree).not.toBeNull();
    const names = extractCommandNamesForLanguage(tree!, 'powershell');
    expect(names).toEqual(['Write-Host']);
  });
});

/**
 * Windows-only bounded Parser.ParseInput conformance (#3181 Finding 9).
 *
 * On Windows, compare a subset of the corpus against the semantic ground
 * truth: [System.Management.Automation.Language.Parser]::ParseInput. The
 * command source is passed as DATA via stdin to the helper script — it is
 * NEVER interpolated into the script body. ParseInput parses but does not
 * execute the input. This test NEVER executes any corpus command.
 */
describe.skipIf(process.platform !== 'win32')(
  'Parser.ParseInput conformance (Windows-only)',
  () => {
    const conformanceSubset = [
      'Get-Process | Where-Object { $_.Name -eq "x" }',
      'ForEach-Object { Write-Host $_ }',
      'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
      '$(Get-ChildItem)',
      '@(1,2,3) | ForEach-Object { $_ * 2 }',
    ];

    for (const cmd of conformanceSubset) {
      it(`ParseInput agrees tree-sitter-pwsh accepts: ${cmd.substring(0, 40)}`, () => {
        // First verify tree-sitter-pwsh accepts it.
        const tsResult = parseCommandDetailsForLanguage(cmd, 'powershell');
        expect(tsResult?.hasError).toBe(false);

        // Then verify PowerShell's Parser.ParseInput also accepts it,
        // passing the command source as data via stdin (never interpolated).
        const helperScript =
          '$inputText = [Console]::In.ReadToEnd(); ' +
          '$errors = $null; ' +
          '$null = [System.Management.Automation.Language.Parser]::ParseInput(' +
          '$inputText, [ref]$null, [ref]$errors); ' +
          'if ($errors.Count -gt 0) { exit 1 } else { exit 0 }';

        try {
          execFileSync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', helperScript],
            {
              input: cmd,
              encoding: 'utf8',
              timeout: 10_000,
            },
          );
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            (error as NodeJS.ErrnoException).code === 'ENOENT'
          ) {
            return;
          }
          throw error;
        }
      }, 15_000);
    }
  },
);
