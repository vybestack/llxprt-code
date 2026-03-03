#!/usr/bin/env python3
import re

with open('PLAN.md', 'r') as f:
    content = f.read()

# Pattern 1: Update "After changes, run verification:\nnpm run lint\nnpm run typecheck" to Quick
content = re.sub(
    r'After changes, run verification:\nnpm run lint\nnpm run typecheck',
    'After changes, run Quick verification:\nnpm run lint && npm run typecheck',
    content
)

# Pattern 2: Update "After cherry-pick, run verification:\nnpm run lint\nnpm run typecheck" to Quick  
content = re.sub(
    r'After cherry-pick, run verification:\nnpm run lint\nnpm run typecheck',
    'After cherry-pick, run Quick verification:\nnpm run lint && npm run typecheck',
    content
)

# Pattern 3: Update "DELIVERABLES:...Lint and typecheck pass" to "Quick verification passes"
content = re.sub(
    r'(DELIVERABLES:.*?)Lint and typecheck pass',
    r'\1Quick verification passes',
    content
)

# Pattern 4: Update "Run verification:\n   npm run lint\n   npm run typecheck" to Quick
content = re.sub(
    r'Run verification:\n   npm run lint\n   npm run typecheck',
    'Run Quick verification:\n   npm run lint && npm run typecheck',
    content
)

with open('PLAN.md', 'w') as f:
    f.write(content)

print("Updated PLAN.md with standardized verification commands")
