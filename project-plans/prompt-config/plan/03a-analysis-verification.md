# Task 03a: Verify Domain Analysis

## Objective

Verify that the domain analysis is complete, accurate, and covers all requirements without including implementation details.

## Verification Checklist

### 1. File Creation

```bash
test -f analysis/domain-model.md || echo "FAIL: domain-model.md not created"
```

### 2. Requirements Coverage

Verify every REQ tag is addressed in the analysis:

```bash
# Extract all REQ tags from specification
REQ_TAGS=$(grep -o "REQ-[0-9.]*" ../specification.md | sort -u)

# Check each is mentioned in domain model
for req in $REQ_TAGS; do
  grep -q "$req" analysis/domain-model.md || echo "FAIL: $req not addressed in analysis"
done
```

### 3. Entity Completeness

Check that all major entities are defined:
- [ ] PromptFile entity with properties
- [ ] PromptContext entity with properties  
- [ ] ResolvedPrompt entity with properties
- [ ] FileSystemLocation entity with properties
- [ ] Clear relationships between entities

### 4. State Transition Validation

Verify state transitions are logical:
- [ ] Start state clearly defined
- [ ] End states identified
- [ ] All transitions have triggers
- [ ] No impossible state transitions
- [ ] States match system lifecycle

### 5. Business Rules Extraction

For each REQ section, verify business rules are extracted:

```bash
# Check key business rules are documented
grep -q "most-specific-first order" analysis/domain-model.md || echo "FAIL: Resolution order rule missing"
grep -q "core → env → tools → user memory" analysis/domain-model.md || echo "FAIL: Assembly order rule missing"
grep -q "Never overwrite existing" analysis/domain-model.md || echo "FAIL: Installation rule missing"
grep -q "Code blocks must be preserved" analysis/domain-model.md || echo "FAIL: Compression rule missing"
```

### 6. Edge Case Coverage

Verify edge cases from error-scenarios.md are included:

```bash
# Key edge cases that must be covered
EDGE_CASES=(
  "directory doesn't exist"
  "permissions"
  "Path traversal"
  "Large files"
  "Invalid UTF-8"
  "Empty enabledTools"
  "Unknown provider"
  "Unclosed variable"
  "Cache.*memory"
)

for edge in "${EDGE_CASES[@]}"; do
  grep -qi "$edge" analysis/domain-model.md || echo "FAIL: Edge case not covered: $edge"
done
```

### 7. No Implementation Details

Check for implementation details that shouldn't be in analysis:

```bash
# These indicate implementation, not domain analysis
grep -i "class\|function\|method\|private\|public" analysis/domain-model.md && echo "FAIL: Implementation details found"
grep -i "typescript\|javascript\|npm\|node" analysis/domain-model.md && echo "FAIL: Technology details in domain analysis"
grep -E "async|await|promise|callback" analysis/domain-model.md && echo "FAIL: Async implementation details"
```

### 8. Data Flow Validation

Verify data flow is logical and complete:
- [ ] Flow starts with external request
- [ ] All components involved are shown
- [ ] Decision points identified
- [ ] Happy path and error paths shown

### 9. Error Categorization

Check error scenarios are properly categorized:
- [ ] Fatal errors that stop execution
- [ ] Recoverable errors with fallbacks
- [ ] Warnings that log and continue
- [ ] Each category has examples

### 10. Completeness Check

```bash
# Document should be substantial
WORD_COUNT=$(wc -w < analysis/domain-model.md)
if [ $WORD_COUNT -lt 1000 ]; then
  echo "FAIL: Analysis seems too brief ($WORD_COUNT words)"
fi

# Should have all major sections
for section in "Entity Relationships" "State Transitions" "Business Rules" "Edge Cases" "Error Scenarios" "Data Flow"; do
  grep -q "$section" analysis/domain-model.md || echo "FAIL: Missing section: $section"
done
```

## Fraud Detection

Look for signs of inadequate analysis:

1. **Copy-paste from spec**: Large verbatim sections from specification.md
2. **Missing relationships**: Entities defined but relationships not explained
3. **Shallow rules**: Business rules just restated, not analyzed
4. **Generic edge cases**: "Handle errors gracefully" instead of specific cases
5. **Implementation bias**: Jumping to how instead of what/why

## Success Criteria

- All REQ tags addressed
- Entities and relationships clearly defined
- Business rules extracted and documented
- Comprehensive edge case coverage
- No implementation details
- Logical state transitions and data flow