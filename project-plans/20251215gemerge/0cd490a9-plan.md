# Implementation Plan for Upstream Commit 0cd490a9: GOOGLE_CLOUD_PROJECT_ID Fallback

## Summary of Upstream Changes

Upstream commit `0cd490a9` ("feat: support GOOGLE_CLOUD_PROJECT_ID fallback (fixes #2262) (#2725)") introduces support for using `GOOGLE_CLOUD_PROJECT_ID` as an alternative/fallback environment variable for specifying the Google Cloud project ID.

**Changes made upstream:**

1. **packages/core/src/code_assist/setup.ts**: Modified to check both `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_PROJECT_ID` (with the former taking precedence)
2. **packages/core/src/core/contentGenerator.ts**: Modified to check both environment variables
3. **docs/get-started/authentication.md**: Documentation updated

## Current State in LLxprt

- LLxprt only reads from `GOOGLE_CLOUD_PROJECT`, not `GOOGLE_CLOUD_PROJECT_ID`
- The error message only mentions `GOOGLE_CLOUD_PROJECT`
- Debug logging only mentions `GOOGLE_CLOUD_PROJECT`

## Detailed Implementation Steps

### Step 1: Update ProjectIdRequiredError message in setup.ts

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/code_assist/setup.ts`

**Location:** Lines 18-24

**Change:**
```typescript
// REPLACE THIS (lines 18-24):
export class ProjectIdRequiredError extends Error {
  constructor() {
    super(
      'This account requires setting the GOOGLE_CLOUD_PROJECT env var. See https://goo.gle/gemini-cli-auth-docs#workspace-gca',
    );
  }
}

// WITH THIS:
export class ProjectIdRequiredError extends Error {
  constructor() {
    super(
      'This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID env var. See https://goo.gle/gemini-cli-auth-docs#workspace-gca',
    );
  }
}
```

### Step 2: Update debug logging in setupUser function

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/code_assist/setup.ts`

**Location:** Lines 39-42

**Change:**
```typescript
// REPLACE THIS (lines 39-42):
  logger.debug(
    () =>
      `setupUser: starting setup, GOOGLE_CLOUD_PROJECT=${process.env.GOOGLE_CLOUD_PROJECT || 'undefined'}`,
  );

// WITH THIS:
  logger.debug(
    () =>
      `setupUser: starting setup, GOOGLE_CLOUD_PROJECT=${process.env.GOOGLE_CLOUD_PROJECT || 'undefined'}, GOOGLE_CLOUD_PROJECT_ID=${process.env.GOOGLE_CLOUD_PROJECT_ID || 'undefined'}`,
  );
```

### Step 3: Update projectId resolution in setupUser function

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/code_assist/setup.ts`

**Location:** Line 43

**Change:**
```typescript
// REPLACE THIS (line 43):
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || undefined;

// WITH THIS:
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT_ID ||
    undefined;
```

### Step 4: Update googleCloudProject resolution in contentGenerator.ts

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/core/contentGenerator.ts`

**Location:** Line 75

**Change:**
```typescript
// REPLACE THIS (line 75):
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT || undefined;

// WITH THIS:
  const googleCloudProject =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT_ID ||
    undefined;
```

### Step 5: Add unit tests for fallback behavior in setup.test.ts

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/code_assist/setup.test.ts`

**Location:** Add new test cases in the `describe('setupUser for existing user', ...)` block (after line 96)

**Complete test implementations:**

```typescript
  it('should use GOOGLE_CLOUD_PROJECT_ID as fallback when GOOGLE_CLOUD_PROJECT is not set', async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT_ID = 'fallback-project';
    mockLoad.mockResolvedValue({
      currentTier: mockPaidTier,
    });
    const userData = await setupUser({} as OAuth2Client);
    expect(CodeAssistServer).toHaveBeenCalledWith(
      {},
      'fallback-project',
      {},
      undefined,
    );
    expect(userData).toEqual({
      projectId: 'fallback-project',
      userTier: 'standard-tier',
    });
    delete process.env.GOOGLE_CLOUD_PROJECT_ID;
  });

  it('should prefer GOOGLE_CLOUD_PROJECT over GOOGLE_CLOUD_PROJECT_ID when both are set', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'primary-project';
    process.env.GOOGLE_CLOUD_PROJECT_ID = 'fallback-project';
    mockLoad.mockResolvedValue({
      currentTier: mockPaidTier,
    });
    const userData = await setupUser({} as OAuth2Client);
    expect(CodeAssistServer).toHaveBeenCalledWith(
      {},
      'primary-project',
      {},
      undefined,
    );
    expect(userData).toEqual({
      projectId: 'primary-project',
      userTier: 'standard-tier',
    });
    delete process.env.GOOGLE_CLOUD_PROJECT_ID;
  });
```

### Step 6: Add unit tests for fallback behavior in contentGenerator.test.ts

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/packages/core/src/core/contentGenerator.test.ts`

**Location:** Add new test cases in the `describe('createContentGeneratorConfig', ...)` block (after line 141)

**Complete test implementations:**

```typescript
  it('should use GOOGLE_CLOUD_PROJECT_ID as fallback for Vertex AI when GOOGLE_CLOUD_PROJECT is not set', async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT_ID = 'fallback-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const config = await createContentGeneratorConfig(
      mockConfig,
      AuthType.USE_VERTEX_AI,
    );
    expect(config.vertexai).toBe(true);
    expect(config.apiKey).toBeUndefined();
    delete process.env.GOOGLE_CLOUD_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_LOCATION;
  });

  it('should prefer GOOGLE_CLOUD_PROJECT over GOOGLE_CLOUD_PROJECT_ID for Vertex AI when both are set', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'primary-project';
    process.env.GOOGLE_CLOUD_PROJECT_ID = 'fallback-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const config = await createContentGeneratorConfig(
      mockConfig,
      AuthType.USE_VERTEX_AI,
    );
    expect(config.vertexai).toBe(true);
    expect(config.apiKey).toBeUndefined();
    delete process.env.GOOGLE_CLOUD_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_LOCATION;
  });
```

### Step 7: Update documentation in authentication.md

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/docs/cli/authentication.md`

**Changes Required:**

#### Change 7.1: Update line 9 (workspace-gca anchor section)
```markdown
// REPLACE THIS (line 9):
      1. You have a Google Workspace account. Google Workspace is a paid service for businesses and organizations that provides a suite of productivity tools, including a custom email domain (e.g. your-name@your-company.com), enhanced security features, and administrative controls. These accounts are often managed by an employer or school.

// WITH THIS:
      1. You have a Google Workspace account. Google Workspace is a paid service for businesses and organizations that provides a suite of productivity tools, including a custom email domain (e.g. your-name@your-company.com), enhanced security features, and administrative controls. These accounts are often managed by an employer or school.
```

#### Change 7.2: Update lines 15-16 (mention both env vars)
```markdown
// REPLACE THIS (lines 15-16):
      - If you fall into one of these categories, you must first configure a Google Cloud Project ID to use, [enable the Gemini for Cloud API](https://cloud.google.com/gemini/docs/discover/set-up-gemini#enable-api) and [configure access permissions](https://cloud.google.com/gemini/docs/discover/set-up-gemini#grant-iam).

      You can temporarily set the environment variable in your current shell session using the following command:

// WITH THIS:
      - If you fall into one of these categories, you must first configure a Google Cloud Project ID to use, [enable the Gemini for Cloud API](https://cloud.google.com/gemini/docs/discover/set-up-gemini#enable-api) and [configure access permissions](https://cloud.google.com/gemini/docs/discover/set-up-gemini#grant-iam).

      You can set either `GOOGLE_CLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT_ID` (they are interchangeable, with `GOOGLE_CLOUD_PROJECT` taking precedence if both are set).

      You can temporarily set the environment variable in your current shell session using the following command:
```

#### Change 7.3: Update line 20 (add alternative example)
```markdown
// ADD AFTER line 21:
      ```bash
      export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"
      ```

      Or alternatively:

      ```bash
      export GOOGLE_CLOUD_PROJECT_ID="YOUR_PROJECT_ID"
      ```
```

#### Change 7.4: Update lines 23-28 (add both env var options to bashrc example)
```markdown
// REPLACE THIS (lines 23-28):
      - For repeated use, you can add the environment variable to your [.env file](#persisting-environment-variables-with-env-files) or your shell's configuration file (like `~/.bashrc`, `~/.zshrc`, or `~/.profile`). For example, the following command adds the environment variable to a `~/.bashrc` file:

      ```bash
      echo 'export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"' >> ~/.bashrc
      source ~/.bashrc
      ```

// WITH THIS:
      - For repeated use, you can add the environment variable to your [.env file](#persisting-environment-variables-with-env-files) or your shell's configuration file (like `~/.bashrc`, `~/.zshrc`, or `~/.profile`). For example, the following command adds the environment variable to a `~/.bashrc` file:

      ```bash
      echo 'export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"' >> ~/.bashrc
      source ~/.bashrc
      ```

      Or using `GOOGLE_CLOUD_PROJECT_ID`:

      ```bash
      echo 'export GOOGLE_CLOUD_PROJECT_ID="YOUR_PROJECT_ID"' >> ~/.bashrc
      source ~/.bashrc
      ```
```

#### Change 7.5: Update line 99 (mention both env vars in ADC section)
```markdown
// REPLACE THIS (line 99):
      - **Required Environment Variables for ADC:**
        - When using ADC (either with `gcloud` or a service account), you must also set the `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` environment variables. In the following methods, replace `YOUR_PROJECT_ID` and `YOUR_PROJECT_LOCATION` with the relevant values for your project:

// WITH THIS:
      - **Required Environment Variables for ADC:**
        - When using ADC (either with `gcloud` or a service account), you must also set the `GOOGLE_CLOUD_PROJECT` (or `GOOGLE_CLOUD_PROJECT_ID`) and `GOOGLE_CLOUD_LOCATION` environment variables. In the following methods, replace `YOUR_PROJECT_ID` and `YOUR_PROJECT_LOCATION` with the relevant values for your project:
```

#### Change 7.6: Update line 172 (mention both env vars in non-interactive section)
```markdown
// REPLACE THIS (line 172):
      - **Using Application Default Credentials (ADC):**
        - Run `gcloud auth application-default login` in your environment to configure ADC.
        - Ensure the `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` environment variables are set.

// WITH THIS:
      - **Using Application Default Credentials (ADC):**
        - Run `gcloud auth application-default login` in your environment to configure ADC.
        - Ensure the `GOOGLE_CLOUD_PROJECT` (or `GOOGLE_CLOUD_PROJECT_ID`) and `GOOGLE_CLOUD_LOCATION` environment variables are set.
```

## Files to Modify

| File | Type of Change | Lines Modified |
|------|----------------|----------------|
| `packages/core/src/code_assist/setup.ts` | Add fallback, update error message, update debug logging | Lines 18-24, 39-43 |
| `packages/core/src/core/contentGenerator.ts` | Add fallback for googleCloudProject | Line 75 |
| `packages/core/src/code_assist/setup.test.ts` | Add fallback and precedence tests | Add 2 new test cases after line 96 |
| `packages/core/src/core/contentGenerator.test.ts` | Add fallback and precedence tests | Add 2 new test cases after line 141 |
| `docs/cli/authentication.md` | Explain fallback behavior | Lines 9-28, 99, 172 |

## Acceptance Criteria

- [ ] Setting `GOOGLE_CLOUD_PROJECT` continues to work exactly as before
- [ ] When only `GOOGLE_CLOUD_PROJECT_ID` is set, the CLI uses it for both setup.ts and contentGenerator.ts
- [ ] When both are set, `GOOGLE_CLOUD_PROJECT` takes precedence in both files
- [ ] `ProjectIdRequiredError` message mentions both `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_PROJECT_ID`
- [ ] Debug logging in setup.ts shows both environment variable values
- [ ] Test `should use GOOGLE_CLOUD_PROJECT_ID as fallback when GOOGLE_CLOUD_PROJECT is not set` passes in setup.test.ts
- [ ] Test `should prefer GOOGLE_CLOUD_PROJECT over GOOGLE_CLOUD_PROJECT_ID when both are set` passes in setup.test.ts
- [ ] Test `should use GOOGLE_CLOUD_PROJECT_ID as fallback for Vertex AI when GOOGLE_CLOUD_PROJECT is not set` passes in contentGenerator.test.ts
- [ ] Test `should prefer GOOGLE_CLOUD_PROJECT over GOOGLE_CLOUD_PROJECT_ID for Vertex AI when both are set` passes in contentGenerator.test.ts
- [ ] All existing tests continue to pass
- [ ] Documentation updated to mention both environment variables in all relevant sections
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run format` has been run
- [ ] `npm run build` succeeds
