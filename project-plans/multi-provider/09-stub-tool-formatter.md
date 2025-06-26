# Phase 09 – Stub ToolFormatter (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To create a stub for the `ToolFormatter` class, which will be responsible for converting tool definitions to provider-specific formats and parsing tool calls from provider responses. All new methods will throw `NotYetImplemented` errors.

## Deliverables

- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/IToolFormatter.ts`: Interface for tool formatting.
- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts`: Stub implementation of `ToolFormatter`.
- `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.test.ts`: Basic test file for `ToolFormatter`.

## Checklist (implementer)

- [ ] Create `packages/cli/src/tools/IToolFormatter.ts` with the following interface:

  ```typescript
  import { ITool } from '../providers/ITool';
  import { IMessage } from '../providers/IMessage';

  export type ToolFormat = 'openai' | 'hermes' | 'xml'; // Extend as needed

  export interface IToolFormatter {
    toProviderFormat(tools: ITool[], format: ToolFormat): any;
    fromProviderFormat(
      rawToolCall: any,
      format: ToolFormat,
    ): IMessage['tool_calls'];
  }
  ```

- [ ] Create `packages/cli/src/tools/ToolFormatter.ts` with a stub class implementing `IToolFormatter` and throwing `NotYetImplemented` for all methods.

  ```typescript
  import { IToolFormatter, ToolFormat } from './IToolFormatter';
  import { ITool, IMessage } from '../providers/ITool'; // Adjust path as needed

  export class ToolFormatter implements IToolFormatter {
    toProviderFormat(tools: ITool[], format: ToolFormat): any {
      throw new Error('NotYetImplemented');
    }

    fromProviderFormat(
      rawToolCall: any,
      format: ToolFormat,
    ): IMessage['tool_calls'] {
      throw new Error('NotYetImplemented');
    }
  }
  ```

- [ ] Create `packages/cli/src/tools/ToolFormatter.test.ts` with a basic test suite that imports `ToolFormatter` and asserts that calling `toProviderFormat()` and `fromProviderFormat()` throws `NotYetImplemented`.

  ```typescript
  import { ToolFormatter } from './ToolFormatter';
  import { ITool } from '../providers/ITool';

  describe('ToolFormatter', () => {
    let formatter: ToolFormatter;

    beforeEach(() => {
      formatter = new ToolFormatter();
    });

    it('should throw NotYetImplemented for toProviderFormat', () => {
      const tools: ITool[] = [];
      expect(() => formatter.toProviderFormat(tools, 'openai')).toThrow(
        'NotYetImplemented',
      );
    });

    it('should throw NotYetImplemented for fromProviderFormat', () => {
      const rawToolCall = {};
      expect(() => formatter.fromProviderFormat(rawToolCall, 'openai')).toThrow(
        'NotYetImplemented',
      );
    });
  });
  ```

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/tools/ToolFormatter.test.ts
```

**STOP. Wait for Phase 09a verification.**
