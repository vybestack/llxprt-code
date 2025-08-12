# GitHub Issue Integration Functional Overview

This document describes the functional behavior of the GitHub Issue integration feature. The goal is to provide a seamless and intuitive way for users to reference and search for GitHub issues directly from the input prompt.

## Core Functionality

The feature is activated by using the `#` character. This allows for quick referencing of issues by number or searching by text, mirroring the common convention used in commit messages and GitHub conversations.

### Key Features:

1.  **Unified Trigger (`#`):** A single `#` character activates the issue search mode, eliminating the need for complex or new syntax.

2.  **Smart Detection:** The system automatically detects whether the user is referencing an issue by number or searching by title.
    *   **Numeric Reference (e.g., `#135`):** If the input following the `#` is a number, the system performs a direct lookup for that specific issue.
    *   **Text Search (e.g., `#Git integration`):** If the input contains non-numeric characters, it triggers a real-time, case-insensitive search against the titles of all open issues.

3.  **Interactive Autocomplete:**
    *   As the user types, a list of matching issues is displayed as suggestions below the input line.
    *   The search continues until the user presses `Enter` or `Tab` to select an issue, or `Escape` to cancel the search. This allows for multi-word search queries.

4.  **Canonicalization on Selection:** Upon selecting an issue from the suggestion list (whether from a numeric or text search), the input in the prompt will collapse to its canonical form: the issue number (e.g., `#135`). This keeps the final prompt clean and unambiguous.

## Caching Mechanism

To ensure a fast and responsive user experience, the system will use a local, file-based cache.

*   **Location:** A repository-specific cache of open issues will be stored in `.llxprt/ghcache/issues.json`.
*   **Updates:** The cache will be updated automatically in the background. An initial fetch will grab all open issues, and subsequent updates will efficiently fetch only new or changed issues since the last update. This provides near-instantaneous search results without noticeable network latency during use.
