#!/usr/bin/env bash
# Shared constants for assignment automation scripts.
#
# Source-only — do NOT execute this file directly.
# Sourced by assign-issue.sh and record-assignment-history.sh to eliminate
# production drift for history-label policy values.
#
# Must remain shellcheck-clean (enable=all, severity=style).
# shellcheck disable=SC2034

HISTORY_PREFIX='asnhist--'
HISTORY_COLOR='0E8A16'
HISTORY_DESC='Issue assignment history index'

# Validate a GitHub login per the real GitHub username rules:
# 1-39 chars, alphanumeric segments separated by single hyphens; reject
# leading/trailing/consecutive hyphens and non-alphanumeric characters.
# Returns 0 on valid; nonzero on invalid.
validate_github_login() {
  local login="$1"
  local len="${#login}"
  [[ "${len}" -ge 1 && "${len}" -le 39 ]] || return 1
  [[ "${login}" =~ ^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$ ]] || return 1
}
