# Running Integration Tests in GitHub Actions

The CLI integration tests spawn actual CLI processes to test real behavior. To prevent browser windows from opening during authentication in CI environments, the following environment variables are set:

## Environment Variables for CI

```yaml
env:
  CI: 'true'
  LLXPRT_NO_BROWSER_AUTH: 'true'
  GITHUB_ACTIONS: 'true'
  DISPLAY: '' # No display available
```

## Test Configuration

1. **Timeouts**: Tests use a 5-second timeout to prevent hanging
2. **Authentication**: Tests provide API keys via keyfiles to avoid triggering OAuth flows
3. **Home Directory**: Tests use temporary directories to isolate profile loading

## Key Points

- The `CI` and `LLXPRT_NO_BROWSER_AUTH` environment variables should prevent browser-based authentication
- All tests that spawn CLI processes should provide authentication (via `--key` or `--keyfile`) to avoid auth prompts
- Tests should complete quickly (within 5 seconds) or they'll be killed with exitCode -1

## Running Tests Locally

To run integration tests locally without opening browser windows:

```bash
CI=true LLXPRT_NO_BROWSER_AUTH=true npm test
```

## Troubleshooting

If browser windows still open:

1. Check that the CLI respects the `LLXPRT_NO_BROWSER_AUTH` environment variable
2. Ensure all test cases provide proper authentication
3. Consider mocking the authentication flow in test environments
