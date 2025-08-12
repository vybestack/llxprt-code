/**
 * Mock Theater Detection Tool
 * Identifies sophisticated test fraud patterns
 */

import * as fs from 'fs';
import * as ts from 'typescript';

interface MockTheaterViolation {
  type: 'mock-verification' | 'circular-mock' | 'structure-only' | 'no-op';
  location: string;
  description: string;
}

export class MockTheaterDetector {
  private violations: MockTheaterViolation[] = [];

  detectMockTheater(testFile: string): MockTheaterViolation[] {
    const content = fs.readFileSync(testFile, 'utf8');
    const sourceFile = ts.createSourceFile(
      testFile,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    this.detectMockVerification(sourceFile);
    this.detectCircularMocks(content);
    this.detectStructureTheater(content);
    this.detectNoOpVerification(content);
    this.detectImplementationTesting(sourceFile);

    return this.violations;
  }

  private detectMockVerification(sourceFile: ts.SourceFile) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const text = node.getText();
        
        // Basic mock verification
        if (text.includes('.toHaveBeenCalled()') ||
            text.includes('.toHaveBeenCalledWith(') ||
            text.includes('.toHaveBeenCalledTimes(')) {
          this.violations.push({
            type: 'mock-verification',
            location: `Line ${sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1}`,
            description: 'Test verifies mock was called instead of testing behavior'
          });
        }
        
        // Spy verification
        if (text.includes('expect(spy)') || text.includes('expect(mock')) {
          this.violations.push({
            type: 'mock-verification',
            location: `Line ${sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1}`,
            description: 'Test verifies spy/mock instead of actual behavior'
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    
    visit(sourceFile);
  }

  private detectCircularMocks(content: string) {
    // Find mock setups and their return values
    const mockSetups = new Map<string, string>();
    const setupRegex = /(\w+)\.mockResolvedValue\((.*?)\)|(\w+)\.mockReturnValue\((.*?)\)/g;
    
    let match;
    while ((match = setupRegex.exec(content)) !== null) {
      const mockName = match[1] || match[3];
      const mockValue = match[2] || match[4];
      mockSetups.set(mockName, mockValue);
    }
    
    // Find assertions that test mock values
    const assertionRegex = /expect\((.*?)\)\.toBe\((.*?)\)|expect\((.*?)\)\.toEqual\((.*?)\)/g;
    
    while ((match = assertionRegex.exec(content)) !== null) {
      const tested = match[1] || match[3];
      const expected = match[2] || match[4];
      
      // Check if assertion is testing a mock's return value
      for (const [mockName, mockValue] of mockSetups) {
        if (tested.includes(mockName) && expected.includes(mockValue)) {
          this.violations.push({
            type: 'circular-mock',
            location: 'Test file',
            description: `Circular mock: test expects ${mockValue} which is the mock's return value`
          });
        }
      }
    }
  }

  private detectStructureTheater(content: string) {
    // Tests that only verify structure exists
    // const structureTests = [
    //   /it\(['"](.*?)['"]/g
    // ];
    
    const matches = content.match(/it\(['"](.*?)['"][\s\S]*?\}\)/g) || [];
    
    for (const testBlock of matches) {
      let hasValueAssertion = false;
      let hasStructureAssertion = false;
      
      // Check for value assertions
      if (testBlock.includes('.toBe(') || 
          testBlock.includes('.toEqual(') ||
          testBlock.includes('.toMatch(')) {
        hasValueAssertion = true;
      }
      
      // Check for structure assertions
      if (testBlock.includes('.toHaveProperty(') ||
          testBlock.includes('.toBeDefined()') ||
          testBlock.includes('.toBeUndefined()')) {
        hasStructureAssertion = true;
      }
      
      // If only structure assertions, it's theater
      if (hasStructureAssertion && !hasValueAssertion) {
        const testName = testBlock.match(/it\(['"](.*?)['"]/)?.[1];
        this.violations.push({
          type: 'structure-only',
          location: `Test: ${testName}`,
          description: 'Test only verifies structure exists, not actual values'
        });
      }
    }
  }

  private detectNoOpVerification(content: string) {
    // Tests that don't actually test anything
    const noOpPatterns = [
      /expect\(.*?\)\.not\.toThrow\(\)/g,
      /expect\(.*?\)\.not\.toReject\(\)/g,
      /expect\(\(\) => .*?\)\.not\.toThrow\(\)/g
    ];
    
    for (const pattern of noOpPatterns) {
      const matches = content.match(pattern) || [];
      for (const match of matches) {
        // Check if there's a specific error being tested
        if (!match.includes('toThrow(') || match.includes('toThrow()')) {
          this.violations.push({
            type: 'no-op',
            location: 'Test file',
            description: `No-op test: ${match} - empty function would pass`
          });
        }
      }
    }
  }

  private detectImplementationTesting(sourceFile: ts.SourceFile) {
    const text = sourceFile.getText();
    
    // Testing private members
    if (text.includes('["_') || text.includes("['_") || text.includes('#private')) {
      this.violations.push({
        type: 'structure-only',
        location: 'Test file',
        description: 'Testing private implementation details'
      });
    }
    
    // Testing internal methods
    const internalMethodPatterns = [
      /expect\(.*?\._internal/g,
      /expect\(.*?\.private/g,
      /spyOn\(.*?, ['"]_/g
    ];
    
    for (const pattern of internalMethodPatterns) {
      if (pattern.test(text)) {
        this.violations.push({
          type: 'structure-only',
          location: 'Test file',
          description: 'Testing internal implementation methods'
        });
      }
    }
  }
}

// CLI execution
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx mock-theater-detector.ts <test-file-path>');
    process.exit(1);
  }

  const detector = new MockTheaterDetector();
  const violations = detector.detectMockTheater(filePath);
  
  if (violations.length === 0) {
    console.log('✅ No mock theater detected');
    process.exit(0);
  } else {
    console.error('❌ Mock theater violations detected:');
    violations.forEach(v => {
      console.error(`  [${v.type}] ${v.location}: ${v.description}`);
    });
    process.exit(1);
  }
}