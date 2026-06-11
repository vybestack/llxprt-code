export const READ_FILE_FIXTURE = {
  capturedAt: '2026-06-08T23:45:10.325Z',
  contract: {
    llmContentType: 'string | Part[]',
    returnDisplayType: 'string',
    errorType: '{ message: string; type?: ToolErrorType } | undefined',
    suppressDisplayType: 'boolean | undefined',
  },
  exampleContent: 'Hello, fixture world!',
  expectedLlmContentContains: ['Hello, fixture world!'],
} as const;

export const WRITE_FILE_FIXTURE = {
  capturedAt: '2026-06-08T23:45:10.325Z',
  contract: {
    llmContentType: 'string | Part[]',
    returnDisplayType: 'string',
    errorType: '{ message: string; type?: ToolErrorType } | undefined',
  },
  expectedWrittenContent: 'Written by fixture test',
} as const;

export const GLOB_FIXTURE = {
  capturedAt: '2026-06-08T23:45:10.325Z',
  contract: {
    llmContentType: 'string | Part[]',
    returnDisplayType: 'string',
  },
  expectedPatterns: ['*.ts', '*.txt'],
  expectedFilePatterns: ['.ts$', '.txt$'],
} as const;
