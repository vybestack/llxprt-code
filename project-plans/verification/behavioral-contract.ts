/**
 * Behavioral Contract Verification Tool
 * Ensures tests verify actual behavior, not implementation details
 */

import * as fs from 'fs';
// import * as path from 'path';
import * as ts from 'typescript';

// Commented out as not currently used
// interface BehaviorProof {
//   requirement: string;
//   scenario: string;
//   given: Record<string, unknown>;
//   when: string;
//   then: Record<string, unknown>;
// }

interface ValidationResult {
  valid: boolean;
  reason?: string;
  violations: string[];
}

export class BehavioralContractValidator {
  private violations: string[] = [];

  validateTestFile(filePath: string): ValidationResult {
    const content = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    this.checkForBehavioralAssertions(sourceFile);
    this.checkForMockTheater(sourceFile);
    this.checkForStructureOnlyTests(sourceFile);
    this.checkForRequirementCoverage(sourceFile);

    return {
      valid: this.violations.length === 0,
      reason: this.violations.length > 0 ? this.violations[0] : undefined,
      violations: this.violations
    };
  }

  private checkForBehavioralAssertions(sourceFile: ts.SourceFile) {
    let hasAssertions = false;
    
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const text = node.getText();
        // Check for value assertions
        if (text.includes('toBe(') || 
            text.includes('toEqual(') ||
            text.includes('toMatch(') ||
            text.includes('toContain(') ||
            text.includes('toThrow(')) {
          hasAssertions = true;
        }
        
        // Flag structure-only assertions
        if (text.includes('toHaveProperty(') && !text.includes('toHaveProperty(')) {
          this.violations.push(`Structure-only test found: ${text.substring(0, 50)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    
    visit(sourceFile);
    
    if (!hasAssertions) {
      this.violations.push('No behavioral assertions found in test file');
    }
  }

  private checkForMockTheater(sourceFile: ts.SourceFile) {
    const text = sourceFile.getText();
    
    // Check for mock verification anti-patterns
    if (text.includes('toHaveBeenCalled()') || 
        text.includes('toHaveBeenCalledWith(') ||
        text.includes('toHaveBeenCalledTimes(')) {
      this.violations.push('Mock theater detected: tests verify mock calls instead of behavior');
    }
    
    // Check for circular mock dependencies
    const mockSetups = text.match(/mock[A-Z]\w+\.mockResolvedValue\((.*?)\)/g) || [];
    const assertions = text.match(/expect\((.*?)\)\.toBe\((.*?)\)/g) || [];
    
    for (const setup of mockSetups) {
      const mockValue = setup.match(/mockResolvedValue\((.*?)\)/)?.[1];
      for (const assertion of assertions) {
        if (assertion.includes(mockValue || '')) {
          this.violations.push('Circular mock dependency: test only verifies mock return value');
        }
      }
    }
  }

  private checkForStructureOnlyTests(sourceFile: ts.SourceFile) {
    const text = sourceFile.getText();
    
    // Find tests that only check structure
    const structureOnlyPatterns = [
      /expect\(.*?\)\.toHaveProperty\(['"]\w+['"]\)/g,
      /expect\(.*?\)\.toBeDefined\(\)/g,
      /expect\(.*?\)\.toBeUndefined\(\)/g,
      /expect\(.*?\)\.not\.toThrow\(\)/g
    ];
    
    for (const pattern of structureOnlyPatterns) {
      const matches = text.match(pattern) || [];
      for (const match of matches) {
        // Check if there's a value assertion nearby
        const index = text.indexOf(match);
        const nearbyText = text.substring(Math.max(0, index - 200), index + 200);
        if (!nearbyText.includes('toBe(') && !nearbyText.includes('toEqual(')) {
          this.violations.push(`Structure-only test: ${match}`);
        }
      }
    }
  }

  private checkForRequirementCoverage(sourceFile: ts.SourceFile) {
    const text = sourceFile.getText();
    
    // Extract all @requirement tags
    const requirementTags = text.match(/@requirement\s+(REQ-[\d.]+)/g) || [];
    const requirements = requirementTags.map(tag => tag.replace('@requirement ', ''));
    
    // Check each requirement has behavioral assertion
    for (const req of requirements) {
      const reqIndex = text.indexOf(`@requirement ${req}`);
      const testEndIndex = text.indexOf('});', reqIndex);
      const testBody = text.substring(reqIndex, testEndIndex);
      
      if (!testBody.includes('toBe(') && 
          !testBody.includes('toEqual(') &&
          !testBody.includes('toThrow(')) {
        this.violations.push(`Requirement ${req} has no behavioral assertions`);
      }
    }
  }
}

// CLI execution
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx behavioral-contract.ts <test-file-path>');
    process.exit(1);
  }

  const validator = new BehavioralContractValidator();
  const result = validator.validateTestFile(filePath);
  
  if (result.valid) {
    console.log('✅ Behavioral contracts valid');
    process.exit(0);
  } else {
    console.error('❌ Behavioral contract violations:');
    result.violations.forEach(v => console.error(`  - ${v}`));
    process.exit(1);
  }
}