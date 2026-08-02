/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for language-specific import extraction (issue #1746).
 *
 * Covers import parsing for languages whose syntax differs from JS/TS:
 * - Python: `import name`, `from module import items`, dotted names, aliases
 * - Go: `import "pkg"` and `import ( ... )` block syntax
 * - Ruby: `require 'gem'` and `require_relative 'file'`
 *
 * Rust and C import extraction are covered by their dedicated validation
 * test files (ast-edit-rust-validation.test.ts, ast-edit-c-validation.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { extractImports } from '../language-analysis.js';

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe('ast_edit Python import extraction', () => {
  it('extracts a bare import statement', () => {
    const code = 'import os\n';
    const imports = extractImports(code, 'python');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('os');
    expect(imports[0].items).toEqual([]);
    expect(imports[0].line).toBe(1);
  });

  it('extracts from-import with a single item', () => {
    const code = 'from pathlib import Path\n';
    const imports = extractImports(code, 'python');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('pathlib');
    expect(imports[0].items).toEqual(['Path']);
  });

  it('extracts from-import with multiple items', () => {
    const code = 'from typing import List, Dict\n';
    const imports = extractImports(code, 'python');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('typing');
    expect(imports[0].items).toEqual(['List', 'Dict']);
  });

  it('extracts dotted module names from from-imports', () => {
    const code = 'from os.path import join, exists\n';
    const imports = extractImports(code, 'python');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('os.path');
    expect(imports[0].items).toEqual(['join', 'exists']);
  });

  it('extracts dotted module names from bare imports', () => {
    const code = 'import os.path\n';
    const imports = extractImports(code, 'python');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('os.path');
    expect(imports[0].items).toEqual([]);
  });

  it('strips aliases from bare imports', () => {
    const code = 'import numpy as np\n';
    const imports = extractImports(code, 'python');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('numpy');
    expect(imports[0].items).toEqual([]);
  });

  it('strips aliases from from-import items', () => {
    const code = 'from typing import List as L, Dict as D\n';
    const imports = extractImports(code, 'python');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('typing');
    expect(imports[0].items).toEqual(['List', 'Dict']);
  });

  it('records correct line numbers for multiple imports', () => {
    const code = 'import os\nimport sys\nfrom typing import List\n';
    const imports = extractImports(code, 'python');

    expect(imports).toHaveLength(3);
    expect(imports[0].module).toBe('os');
    expect(imports[0].line).toBe(1);
    expect(imports[1].module).toBe('sys');
    expect(imports[1].line).toBe(2);
    expect(imports[2].module).toBe('typing');
    expect(imports[2].line).toBe(3);
  });

  it('ignores commented-out import lines', () => {
    const code = '# import os\nfrom pathlib import Path\n';
    const imports = extractImports(code, 'python');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('pathlib');
  });
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

describe('ast_edit Go import extraction', () => {
  it('extracts a single-line import', () => {
    const code = 'import "fmt"\n';
    const imports = extractImports(code, 'go');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('fmt');
    expect(imports[0].items).toEqual([]);
    expect(imports[0].line).toBe(1);
  });

  it('extracts a single-line import with a package alias', () => {
    const code = 'import f "fmt"\n';
    const imports = extractImports(code, 'go');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('fmt');
    expect(imports[0].items).toEqual([]);
  });

  it('extracts a single-line dot import', () => {
    const code = 'import . "github.com/foo/bar"\n';
    const imports = extractImports(code, 'go');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('github.com/foo/bar');
  });

  it('extracts a single-line blank import', () => {
    const code = 'import _ "github.com/foo/init"\n';
    const imports = extractImports(code, 'go');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('github.com/foo/init');
  });

  it('extracts all packages from a block import', () => {
    const code = [
      'import (',
      '\t"fmt"',
      '\t"os"',
      '\t"io/ioutil"',
      ')',
      '',
    ].join('\n');
    const imports = extractImports(code, 'go');

    expect(imports).toHaveLength(3);
    expect(imports[0].module).toBe('fmt');
    expect(imports[0].line).toBe(2);
    expect(imports[1].module).toBe('os');
    expect(imports[1].line).toBe(3);
    expect(imports[2].module).toBe('io/ioutil');
    expect(imports[2].line).toBe(4);
  });

  it('extracts aliased packages and strips comments from a block import', () => {
    const code = [
      'import (',
      '\tf "fmt" // formatting',
      '\t. "github.com/foo/bar"',
      '\t_ "github.com/foo/init"',
      ')',
      '',
    ].join('\n');
    const imports = extractImports(code, 'go');

    expect(imports).toHaveLength(3);
    expect(imports[0].module).toBe('fmt');
    expect(imports[1].module).toBe('github.com/foo/bar');
    expect(imports[2].module).toBe('github.com/foo/init');
  });

  it('skips blank lines inside a block import', () => {
    const code = ['import (', '', '\t"fmt"', '', '\t"os"', ')', ''].join('\n');
    const imports = extractImports(code, 'go');

    expect(imports).toHaveLength(2);
    expect(imports[0].module).toBe('fmt');
    expect(imports[1].module).toBe('os');
  });

  it('handles a block whose closing paren shares a line with a package', () => {
    const code = ['import (', '\t"fmt"', '\t"os")', ''].join('\n');
    const imports = extractImports(code, 'go');

    expect(imports).toHaveLength(2);
    expect(imports[0].module).toBe('fmt');
    expect(imports[1].module).toBe('os');
    expect(imports[1].line).toBe(3);
  });

  it('does not terminate a block on a closing paren inside a comment', () => {
    const code = [
      'import (',
      '\t"fmt" // see issue ) for details',
      '\t"os"',
      ')',
      '',
    ].join('\n');
    const imports = extractImports(code, 'go');

    expect(imports).toHaveLength(2);
    expect(imports[0].module).toBe('fmt');
    expect(imports[0].line).toBe(2);
    expect(imports[1].module).toBe('os');
    expect(imports[1].line).toBe(3);
  });

  it('ignores non-import lines', () => {
    const code = 'package main\n\nfunc main() {}\n';
    const imports = extractImports(code, 'go');

    expect(imports).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Ruby
// ---------------------------------------------------------------------------

describe('ast_edit Ruby import extraction', () => {
  it('extracts a require with single quotes', () => {
    const code = "require 'json'\n";
    const imports = extractImports(code, 'ruby');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('json');
    expect(imports[0].items).toEqual([]);
    expect(imports[0].line).toBe(1);
  });

  it('extracts a require with double quotes', () => {
    const code = 'require "json"\n';
    const imports = extractImports(code, 'ruby');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('json');
  });

  it('extracts require_relative with single quotes', () => {
    const code = "require_relative 'lib/helper'\n";
    const imports = extractImports(code, 'ruby');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('lib/helper');
  });

  it('extracts require_relative with double quotes', () => {
    const code = 'require_relative "lib/helper"\n';
    const imports = extractImports(code, 'ruby');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('lib/helper');
  });

  it('extracts parenthesized require', () => {
    const code = "require('json')\n";
    const imports = extractImports(code, 'ruby');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('json');
  });

  it('extracts parenthesized require_relative', () => {
    const code = "require_relative('lib/helper')\n";
    const imports = extractImports(code, 'ruby');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('lib/helper');
  });

  it('extracts require without a space before the string', () => {
    const code = "require'json'\n";
    const imports = extractImports(code, 'ruby');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('json');
  });

  it('extracts require_relative without a space before the string', () => {
    const code = "require_relative'lib/helper'\n";
    const imports = extractImports(code, 'ruby');

    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('lib/helper');
  });

  it('records correct line numbers for multiple requires', () => {
    const code = [
      "require 'json'",
      "require 'net/http'",
      "require_relative 'lib/helper'",
      '',
    ].join('\n');
    const imports = extractImports(code, 'ruby');

    expect(imports).toHaveLength(3);
    expect(imports[0].module).toBe('json');
    expect(imports[0].line).toBe(1);
    expect(imports[1].module).toBe('net/http');
    expect(imports[1].line).toBe(2);
    expect(imports[2].module).toBe('lib/helper');
    expect(imports[2].line).toBe(3);
  });

  it('ignores non-require lines', () => {
    const code = "puts 'hello'\n# require 'commented'\n";
    const imports = extractImports(code, 'ruby');

    expect(imports).toHaveLength(0);
  });
});
