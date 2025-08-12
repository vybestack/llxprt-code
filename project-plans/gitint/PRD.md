# GitHub Issue Integration: Project Requirements Document

This document outlines the specific requirements for implementing the GitHub Issue Integration feature.

## 1. Core Functional Requirements

1.1. The system MUST activate a "GitHub Issue Search" mode when the user types the `#` character into the prompt.

1.2. When the input following the `#` consists only of numbers (e.g., `#135`), the system MUST perform a direct lookup for that issue number from the cache.

1.3. When the input following the `#` contains non-numeric characters (e.g., `#fix bug`), the system MUST perform a real-time, case-insensitive text search against the `title` field of all issues in the cache.

1.4. Upon user selection, the search text MUST be replaced in the prompt by the canonical issue reference (e.g., `#135`).

## 2. User Interface & Interaction Requirements

2.1. The system MUST display a list of matching issue suggestions below the input line as the user types a search query.

2.2. The issue search mode MUST continue to capture input for the search query (including spaces) until the user presses `Enter` (select), `Tab` (select/autocomplete), or `Escape` (cancel).

2.3. The suggestion list UI MUST be visually consistent with other autocomplete features within the application.

## 3. Caching & Data Requirements

3.1. The system MUST store the issue cache in a local file at `.llxprt/ghcache/issues.json` relative to the project root.

3.2. The cache MUST be a JSON object containing an `issues` array of open issues. Each issue object in the array MUST contain at least the `number`, `title`, `state`, and `author`.

3.3. The system should fetch up to a configurable limit of open issues, with the default limit being 10,000.

3.4. On first activation (or if the cache file does not exist), the system MUST trigger a background process to create the cache file.

3.5. On subsequent activations, the system MUST check the file modification timestamp of `issues.json`. If the file is older than the configured TTL, a "fire-and-forget" background process MUST be triggered to update it.

3.6. The cache Time To Live (TTL) MUST be configurable via a `github.issueCacheTtlMinutes` setting. The default value MUST be 5 minutes.

3.7. All failures in the cache update process (e.g., `gh` not installed, no authentication) MUST fail silently from a UI perspective. Errors MUST be logged to the debug console for troubleshooting.

3.8. If the cache file does not exist or is empty when a user types `#`, the feature MUST simply show no suggestions. It MUST NOT display an error or loading state.


## 4. Integration Requirements

4.1. The `#` trigger and its associated UI MUST integrate seamlessly with the primary input prompt and not conflict with existing autocompletion features (e.g., `@` for file paths).

4.2. The application's lifecycle manager MUST trigger the cache update check during application startup or the initialization of a new session.

4.3. The context processing system MUST be updated to recognize a canonical issue reference (e.g., `#135`) in the prompt.

4.4. When an issue reference is detected, the system MUST fetch the full details of that issue from the cache (or via a direct API call if necessary) and make it available as context for the language model.
