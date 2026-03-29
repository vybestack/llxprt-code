#!/usr/bin/env python3
"""
Fix remaining @typescript-eslint warnings across all component files.
Handles the specific patterns found in the codebase.
"""
import json
import subprocess
import re
import os

ROOT = '/Users/acoliver/projects/llxprt/branch-3/llxprt-code'

def run_eslint():
    result = subprocess.run(
        'npx eslint packages/cli/src/ui/components/ --format json',
        shell=True, capture_output=True, text=True, cwd=ROOT
    )
    return json.loads(result.stdout)

def read_file_lines(filepath):
    with open(filepath, 'r') as f:
        return f.readlines()

def write_file_lines(filepath, lines):
    with open(filepath, 'w') as f:
        f.writelines(lines)

def apply_fixes():
    data = run_eslint()
    
    # Group by file
    file_warnings = {}
    for f in data:
        fp = f['filePath']
        ts_warnings = [m for m in f.get('messages', []) if m.get('ruleId', '').startswith('@typescript-eslint/')]
        if ts_warnings:
            file_warnings[fp] = ts_warnings
    
    total_fixed = 0
    
    for fp, warnings in sorted(file_warnings.items()):
        short = fp.replace(ROOT + '/', '')
        lines = read_file_lines(fp)
        changed = False
        
        # Process warnings in reverse order to preserve positions
        sorted_warnings = sorted(warnings, key=lambda w: (w['line'], w['column']), reverse=True)
        
        for w in sorted_warnings:
            rule = w['ruleId']
            mid = w.get('messageId', '')
            line_num = w['line']
            col = w['column']
            line_idx = line_num - 1
            
            if line_idx >= len(lines):
                continue
            
            line = lines[line_idx]
            
            # === strict-boolean-expressions: conditionErrorNullableBoolean ===
            # Pattern: if (x) where x: boolean | null | undefined -> if (x === true) or if (x !== false)
            # Pattern: if (!x) -> if (x !== true) or if (x === false || x == null)
            # Pattern: filter(x => x.disabled) -> filter(x => x.disabled === true)
            # Pattern: filter(x => !x.disabled) -> filter(x => x.disabled !== true)
            # Pattern: x && y -> x === true && y
            if rule == '@typescript-eslint/strict-boolean-expressions' and mid == 'conditionErrorNullableBoolean':
                # Read surrounding context
                before = line[:col-1]
                after = line[col-1:]
                
                # Find the identifier being checked
                # Pattern 1: standalone if (x) or while (x)
                # Pattern 2: x && y
                # Pattern 3: filter(x => x.prop) or filter(x => !x.prop)
                
                # Common: if (!x) -> if (x !== true)
                # Look for !identifier patterns
                match = re.search(r'!\s*(\w+(?:\.\w+(?:\(\))?)*)\s*([)&|,}])', line[col-1:])
                if match and not line[col-1:].lstrip().startswith('!'):
                    pass
                
                # Let me try specific replacements
                pass
            
            # === strict-boolean-expressions: conditionErrorNullableNumber ===
            if rule == '@typescript-eslint/strict-boolean-expressions' and mid == 'conditionErrorNullableNumber':
                # Pattern: if (num) -> if (num != null)
                # Pattern: if (!num) -> if (num == null || num === 0)
                # Pattern: num && ... -> num != null && ...
                sugs = w.get('suggestions', [])
                if sugs:
                    fix = sugs[0].get('fix', {})
                    # Get the range from the suggestion
                    range_start = fix.get('range', [0, 0])[0]
                    range_end = fix.get('range', [0, 0])[1]
                    fix_text = fix.get('text', '')
                    if fix_text:
                        # Find the text in the line at the column position
                        # The suggestion wraps the condition with parentheses
                        old_text = line[col-1:].split(')')[0] if ')' in line[col-1:] else line[col-1:].strip()
                        # Try a simpler approach - just replace the identifier at the column with the suggested fix
                        pass
            
            # === strict-boolean-expressions: conditionErrorObject ===
            # Usually paired with alwaysTruthy - will be handled there
            
            # === strict-boolean-expressions: conditionErrorNumber ===
            if rule == '@typescript-eslint/strict-boolean-expressions' and mid == 'conditionErrorNumber':
                # Pattern: Number(x) || 1 -> Number(x) || 1 (this is intentional, use ?? 1)
                # Pattern: lines.length ? [lines[0]] : [''] -> lines.length > 0 ? ...
                pass
            
            # === no-unnecessary-condition: neverNullish ===
            if rule == '@typescript-eslint/no-unnecessary-condition' and mid == 'neverNullish':
                # Pattern: x ?? false -> x (if x is never nullish)
                # Pattern: x ?? '' -> x (if x is never nullish)
                # Pattern: x ?? 0 -> x
                # Find the ?? at the column
                rest = line[col-1:]
                match = re.match(r'(\w+(?:\.\w+(?:\(\))?)*)\s*\?\?\s*(?:false|0|\'\'|null|undefined|\[0\])', rest)
                if match:
                    var_name = match.group(1)
                    # Replace the entire ?? default with nothing
                    full_match = match.group(0)
                    lines[line_idx] = line[:col-1] + var_name + line[col-1+len(full_match):]
                    changed = True
                    total_fixed += 1
                    print(f"  {short}:{line_num}: Removed unnecessary nullish coalescing")
            
            # === no-unnecessary-condition: alwaysFalsy ===
            if rule == '@typescript-eslint/no-unnecessary-condition' and mid == 'alwaysFalsy':
                # Pattern: if (!x) where x is always defined -> always true, remove the check
                # Pattern: if (!providerManager) -> this is a type guard that's always true
                pass
            
        if changed:
            write_file_lines(fp, lines)
    
    print(f"\nTotal fixes applied: {total_fixed}")

if __name__ == '__main__':
    apply_fixes()
