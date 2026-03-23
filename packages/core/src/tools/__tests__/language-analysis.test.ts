/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  extractImports,
} from '../ast-edit/language-analysis.js';

describe('language-analysis', () => {
  describe('detectLanguage', () => {
    it('should detect TypeScript files', () => {
      expect(detectLanguage('/path/to/file.ts')).toBe('typescript');
      expect(detectLanguage('/path/to/file.tsx')).toBe('typescript');
    });

    it('should detect JavaScript files', () => {
      expect(detectLanguage('/path/to/file.js')).toBe('javascript');
      expect(detectLanguage('/path/to/file.jsx')).toBe('javascript');
    });

    it('should detect Python files', () => {
      expect(detectLanguage('/path/to/file.py')).toBe('python');
    });

    it('should return "unknown" for unsupported extensions', () => {
      expect(detectLanguage('/path/to/file.xyz')).toBe('unknown');
      expect(detectLanguage('/path/to/file')).toBe('unknown');
    });
  });

  describe('extractImports', () => {
    describe('TypeScript/JavaScript', () => {
      it('should extract ES6 imports', () => {
        const content = `import { foo } from "./bar";
import * as utils from "../utils";
const x = 1;`;
        const imports = extractImports(content, 'typescript');

        expect(imports).toHaveLength(2);
        expect(imports[0].module).toBe('./bar');
        expect(imports[0].items).toEqual(['foo']);
        expect(imports[0].line).toBe(1);

        expect(imports[1].module).toBe('../utils');
        expect(imports[1].items).toEqual([]);
        expect(imports[1].line).toBe(2);
      });

      it('should extract multiple items from destructured import', () => {
        const content = `import { alpha, beta, gamma } from "./greek";`;
        const imports = extractImports(content, 'javascript');

        expect(imports).toHaveLength(1);
        expect(imports[0].module).toBe('./greek');
        expect(imports[0].items).toEqual(['alpha', 'beta', 'gamma']);
      });

      it('should handle empty content', () => {
        const imports = extractImports('', 'typescript');
        expect(imports).toEqual([]);
      });
    });

    describe('Python', () => {
      it('should extract standard Python imports', () => {
        const content = `import os
from pathlib import Path
import sys`;
        const imports = extractImports(content, 'python');

        expect(imports).toHaveLength(3);
        expect(imports[0].module).toBe('os');
        expect(imports[0].line).toBe(1);

        expect(imports[1].module).toBe('pathlib');
        expect(imports[1].items).toEqual(['Path']);
        expect(imports[1].line).toBe(2);

        expect(imports[2].module).toBe('sys');
        expect(imports[2].line).toBe(3);
      });

      it('should handle from...import syntax with multiple items', () => {
        const content = `from typing import List, Dict, Optional`;
        const imports = extractImports(content, 'python');

        expect(imports).toHaveLength(1);
        expect(imports[0].module).toBe('typing');
        expect(imports[0].items).toEqual(['List', 'Dict', 'Optional']);
      });

      it('should handle dotted module names', () => {
        const content = `from os.path import join, exists`;
        const imports = extractImports(content, 'python');

        expect(imports).toHaveLength(1);
        expect(imports[0].module).toBe('os.path');
        expect(imports[0].items).toEqual(['join', 'exists']);
      });
    });

    describe('Unknown language', () => {
      it('should return empty array for unknown language', () => {
        const content = `some random content`;
        const imports = extractImports(content, 'unknown');
        expect(imports).toEqual([]);
      });
    });
  });
});
