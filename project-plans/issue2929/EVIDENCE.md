# Captured evidence: real OCR 1.8.4 vs 1.7.17 outputs

## ocr version (1.8.4, npm --ignore-scripts install)
```
open-code-review v1.8.4 (e78474478) darwin/arm64
built at: 2026-08-01T03:29:59Z
https://github.com/alibaba/open-code-review
```

## ocr review --preview --from bd043b144 --to d577f1665 (byte-identical on 1.7.17 and 1.8.4)
```

Preview: 18 file(s) changed  |  [32m+5179[0m  [31m-193[0m

[1mWill review (7):[0m
  [32m[A][0m  .github/scripts/ocr-trusted-marker.cjs                    [32m+159 [0m [31m-0   [0m
  [33m[M][0m  .github/workflows/ocr-review.yml                          [32m+837 [0m [31m-127 [0m
  [32m[A][0m  scripts/re-embed-trusted-marker.cjs                       [32m+228 [0m [31m-0   [0m
  [33m[M][0m  scripts/tests/ocr-review-workflow-helpers.ts              [32m+115 [0m [31m-1   [0m
  [32m[A][0m  scripts/tests/ocr-trusted-marker-test-helpers.ts          [32m+860 [0m [31m-0   [0m
  [33m[M][0m  scripts/tests/typed-test-helpers.ts                       [32m+21  [0m [31m-0   [0m
  [33m[M][0m  tsconfig.scripts.json                                     [32m+6   [0m [31m-0   [0m

[1mExcluded from review (11):[0m
  [32m[A][0m  project-plans/issue2860/PLAN.md                           [2m(unsupported_ext)[0m
  [32m[A][0m  project-plans/issue2860/REVIEW-TRIAGE.md                  [2m(unsupported_ext)[0m
  [33m[M][0m  scripts/tests/ocr-auto-review-limit.test.ts               [2m(default_path)[0m
  [32m[A][0m  scripts/tests/ocr-heredoc-extraction.test.ts              [2m(default_path)[0m
  [33m[M][0m  scripts/tests/ocr-review-incremental-checkpoint-b.test.ts [2m(default_path)[0m
  [33m[M][0m  scripts/tests/ocr-review-workflow-behaviors.test.ts       [2m(default_path)[0m
  [33m[M][0m  scripts/tests/ocr-review-workflow-features.test.ts        [2m(default_path)[0m
  [32m[A][0m  scripts/tests/ocr-trusted-marker-workflow-b.test.ts       [2m(default_path)[0m
  [32m[A][0m  scripts/tests/ocr-trusted-marker-workflow.test.ts         [2m(default_path)[0m
  [32m[A][0m  scripts/tests/ocr-trusted-marker.test.ts                  [2m(default_path)[0m
  [32m[A][0m  scripts/tests/re-embed-trusted-marker.test.ts             [2m(default_path)[0m

```

## ocr review --format json --audience agent (1.7.17)
```json
{
  "status": "success",
  "message": "No comments generated. Looks good to me.",
  "summary": {
    "files_reviewed": 2,
    "comments": 0,
    "total_tokens": 213955,
    "input_tokens": 211161,
    "output_tokens": 2794,
    "cache_read_tokens": 177216,
    "elapsed": "56s"
  },
  "tool_calls": {
    "total": 20,
    "by_tool": {
      "code_search": 7,
      "file_read": 12,
      "file_read_diff": 1
    }
  },
  "comments": [],
  "session_id": "1455b403-5e1c-4553-a514-25d6f21bc5f1"
}
```

## ocr review --format json --audience agent (1.8.4, completed_with_errors)
```json
{
  "status": "completed_with_errors",
  "message": "Some files could not be reviewed due to errors.",
  "summary": {
    "files_reviewed": 2,
    "comments": 0,
    "total_tokens": 92295,
    "input_tokens": 90747,
    "output_tokens": 1548,
    "cache_read_tokens": 73792,
    "elapsed": "1m36s"
  },
  "tool_calls": {
    "total": 12,
    "by_tool": {
      "code_search": 4,
      "file_read": 6,
      "file_read_diff": 2
    }
  },
  "comments": [],
  "warnings": [
    {
      "file": "packages/cli/src/ui/utils/commandUtils.ts",
      "message": "main_task did not complete before stopping",
      "type": "subtask_error"
    }
  ],
  "session_id": "ff715c9b-38c6-4510-9042-ebda3ce05931"
}
```

## ocr review --format json --audience agent (1.8.4, success, env-var credentials)
```json
{
  "status": "success",
  "message": "No comments generated. Looks good to me.",
  "summary": {
    "files_reviewed": 1,
    "comments": 0,
    "total_tokens": 25136,
    "input_tokens": 24956,
    "output_tokens": 180,
    "cache_read_tokens": 5696,
    "elapsed": "10s"
  },
  "tool_calls": {
    "total": 2,
    "by_tool": {
      "code_search": 1,
      "file_read": 1
    }
  },
  "comments": [],
  "session_id": "d134ae81-69a9-480d-b72b-003ce812f9c5"
}
```
