#!/usr/bin/env python3
import re

with open('PLAN.md', 'r') as f:
    content = f.read()

# Add TDD mandate to all REIMPLEMENT cherrypicker prompts that don't have it yet
# Only add if "MANDATORY TDD" is not already present
if content.count('MANDATORY TDD:') < 12:  # There should be ~13 REIMPLEMENT batches
    # Pattern: After "YOUR TASK: Reimplement" add TDD mandate before "REFERENCE:"
    # But only if MANDATORY TDD is not already there
    tdd_mandate = 'MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.\n\n'
    
    # Split into sections and process each
    sections = content.split('#### B')
    for i in range(1, len(sections)):
        section = sections[i]
        # Check if this is a REIMPLEMENT batch and doesn't have TDD mandate
        if 'REIMPLEMENT' in section and 'YOUR TASK: Reimplement' in section and 'MANDATORY TDD:' not in section:
            # Add TDD mandate after "YOUR TASK: Reimplement..." and before "REFERENCE:"
            section = section.replace('\nREFERENCE:', '\n' + tdd_mandate + 'REFERENCE:', 1)
            sections[i] = section
    
    content = '#### B'.join(sections)

# Add behavior coverage to DELIVERABLES if not present
if content.count('100% behavior coverage for changed behaviors') < 40:  # Should be in most batches
    sections = content.split('DELIVERABLES:')
    for i in range(1, len(sections)):
        section = sections[i]
        # Only update if it doesn't already have behavior coverage and ends with verification
        if '100% behavior coverage' not in section and 'verification passes' in section[:200]:
            # Add before "Quick verification passes" or "Full verification passes"
            section = section.replace('. Quick verification passes', '. 100% behavior coverage for changed behaviors. Quick verification passes', 1)
            section = section.replace('. Full verification passes', '. 100% behavior coverage for changed behaviors. Full verification passes', 1)
            sections[i] = section
    
    content = 'DELIVERABLES:'.join(sections)

with open('PLAN.md', 'w') as f:
    f.write(content)

print("Added TDD mandates and behavior coverage requirements")
