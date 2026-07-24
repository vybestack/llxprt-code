#!/usr/bin/env bash
# Assign an issue to a commenter who posted an exact `/assign` command.
# Invoked by .github/workflows/assign.yml.
#
# Uses targeted REST mutations (POST /labels, POST /assignees) instead of
# whole-array PATCH to preserve concurrent human state and comma-bearing
# label names. Adds label first, then assignee; rolls back only this run's
# additions on partial failure.
#
# Durable history: after successful assignment/cap verification, this script
# directly creates/validates the per-user history label (asnhist--LOGIN).
# GitHub suppresses recursive issues:assigned workflows caused by
# GITHUB_TOKEN, so the record-history job may not fire for automated
# assignments. This script ensures durability regardless.
set -euo pipefail

MARKER='<!-- llxprt-assign-feedback -->'
AUTO_ASSIGNED_LABEL='auto-assigned'
AUTO_ASSIGNED_COLOR='0E8A16'
AUTO_ASSIGNED_DESC='Assigned via /assign automation'
# Source shared history-label constants (policy values + login validation).
# shellcheck source-path=SCRIPTDIR
source "$(dirname "${BASH_SOURCE[0]}")/assign-constants.sh"
MAX_ASSIGNMENTS=3
BOT_LOGIN='github-actions[bot]'
HISTORY_FILE="${ASSIGNMENT_HISTORY_FILE:-.github/assignment-history.txt}"

: "${GITHUB_REPOSITORY:?Missing GITHUB_REPOSITORY}"
: "${ISSUE_NUMBER:?Missing ISSUE_NUMBER}"
: "${COMMENTER_LOGIN:?Missing COMMENTER_LOGIN}"

if [[ -n "${GH_TOKEN:-}" ]]; then
  export GH_TOKEN
elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
  export GH_TOKEN="${GITHUB_TOKEN}"
else
  echo "‼ Missing \$GH_TOKEN / \$GITHUB_TOKEN" >&2
  exit 1
fi

USER_LOGIN="${COMMENTER_LOGIN}"
ISSUE="${ISSUE_NUMBER}"
REPO="${GITHUB_REPOSITORY}"
export ASSIGNEE_LOGIN="${USER_LOGIN}"

ASSIGN_TEMP_DIR="$(mktemp -d)"
MUTATION_STARTED=false
LIFECYCLE_COMMITTED=false
label_added_by_this_run=false

# shellcheck disable=SC2329  # Invoked by EXIT/INT/TERM traps.
cleanup_temp_files() {
  if [[ -n "${ASSIGN_TEMP_DIR:-}" && -d "${ASSIGN_TEMP_DIR}" ]]; then
    rm -rf -- "${ASSIGN_TEMP_DIR}"
  fi
}

trap cleanup_temp_files EXIT
export GITHUB_REPOSITORY="${REPO}"

# ---------------------------------------------------------------------------
# Read helpers: all return raw JSON arrays via jq for exact membership checks.
# Tri-state: success (0, stdout=data), absence (1, no stdout), error (1+ via ||).
# ---------------------------------------------------------------------------

# Returns the raw .assignees JSON array from the issue object.
get_issue_assignees_json() {
  gh api "repos/${REPO}/issues/${ISSUE}" --jq '.assignees // []'
}

# Returns the raw .labels JSON array from the issue object.
get_issue_labels_json() {
  gh api "repos/${REPO}/issues/${ISSUE}" --jq '.labels // []'
}

# Returns the issue state string (e.g. "open", "closed").
# Tri-state: success (0, stdout=state), error (nonzero, no stdout).
get_issue_state() {
  local raw
  raw="$(gh api "repos/${REPO}/issues/${ISSUE}" --jq '.')" || return 1
  echo "${raw}" | jq -r '.state // empty'
}

# Validate an issue state string is exactly "open" or "closed".
# Returns 0 if the state is recognized; nonzero otherwise.
is_valid_state() {
  local s="$1"
  [[ "${s}" == "open" || "${s}" == "closed" ]]
}

# Count NON-PR issues assigned to a user using fully paginated REST.
# Uses /repos/{repo}/issues?assignee=...&state=...&per_page=100, merges pages
# externally, and explicitly excludes items where .pull_request != null.
# Args: user, state_filter (must be "open", "closed", or "all" — omitted
# state defaults to open on GitHub, so callers must be explicit).
# Returns: numeric count on stdout; exit nonzero on any API error.
rest_issue_count() {
  local user="$1"
  local state_filter="$2"
  case "${state_filter}" in
    open|closed|all) ;;
    *)
      echo "‼ rest_issue_count: invalid state_filter '${state_filter}'" >&2
      return 1
      ;;
  esac
  local url="repos/${REPO}/issues?assignee=${user}&state=${state_filter}&per_page=100"
  local all_pages
  all_pages="$(gh api "${url}" --paginate 2>/dev/null)" || return 1
  # Merge paginated output (one JSON array per page) and count non-PR items.
  local count
  count="$(echo "${all_pages}" | jq -s \
    'if all(.[]; type == "array") then add else error("non-array page") end
     | [.[]? | select(.pull_request == null)] | length')" || return 1
  if ! [[ "${count}" =~ ^[0-9]+$ ]]; then
    echo "‼ Non-numeric REST issue count for @${user}" >&2
    return 1
  fi
  echo "${count}"
}

# Returns the count of open NON-PR issues assigned to a user (numeric string).
# Uses fully paginated REST /repos/{repo}/issues?assignee=...&state=open
# instead of the Search API (avoids stale-index issues for cap enforcement).
get_open_assigned_count() {
  local user="$1"
  rest_issue_count "${user}" "open"
}

get_merged_pr_count() {
  local user="$1"
  local _stderr_file raw
  _stderr_file="$(mktemp "${ASSIGN_TEMP_DIR}/capture.XXXXXX")"
  raw="$(gh api "search/issues?q=repo:${REPO}+author:${user}+type:pr+is:merged&per_page=1" --jq '.' 2>"${_stderr_file}")" || {
    local _diag
    _diag="$(cat "${_stderr_file}" 2>/dev/null || true)"
    rm -f "${_stderr_file}"
    echo "‼ Merged PR search failed for @${user}: ${_diag}" >&2
    return 1
  }
  rm -f "${_stderr_file}"
  # Parse full response: total_count numeric, incomplete_results exactly false.
  local tc ir
  tc="$(echo "${raw}" | jq -r '.total_count')" || return 1
  ir="$(echo "${raw}" | jq -r '.incomplete_results')" || return 1
  if ! [[ "${tc}" =~ ^[0-9]+$ ]]; then
    echo "‼ Non-numeric or missing total_count for merged PR search for @${user}" >&2
    return 1
  fi
  if [[ "${ir}" != "false" ]]; then
    echo "‼ Search API returned incomplete_results (infra error) for @${user}" >&2
    return 1
  fi
  echo "${tc}"
}

# Count current NON-PR issue assignments for a user via REST (avoids Search
# API index lag). Returns numeric string.
# Tri-state: 0 = query succeeded (stdout=count); nonzero = error.
# Uses state=all so closed issues count as prior assignments (an omitted
# state defaults to open on GitHub and would miss closed assignments).
get_current_issue_count() {
  local user="$1"
  rest_issue_count "${user}" "all"
}

# Static backfill exact-line lookup (no API calls).
has_backfill_assignment() {
  local user="$1"
  [[ -f "${HISTORY_FILE}" ]] || return 1
  grep -Fxq -- "${user}" "${HISTORY_FILE}"
}

# O(1) GET for the per-login history label.
# Tri-state: 0 = label exists with correct definition; 1 = absent or
# collision (wrong definition); 2 = API error (non-404).
has_history_label() {
  local user="$1"
  local label_name="${HISTORY_PREFIX}${user}"
  local _stderr_file raw
  _stderr_file="$(mktemp "${ASSIGN_TEMP_DIR}/capture.XXXXXX")"
  raw="$(gh api "repos/${REPO}/labels/${label_name}" --jq '.' 2>"${_stderr_file}")" || {
    local _diag
    _diag="$(cat "${_stderr_file}" 2>/dev/null || true)"
    rm -f "${_stderr_file}"
    # Distinguish 404 (absence) from other failures (error).
    # gh exits with code 1 for both, but stderr contains the HTTP status.
    if echo "${_diag}" | grep -qE 'HTTP.?404|404.*not found'; then
      return 1  # absence
    fi
    return 2  # error
  }
  rm -f "${_stderr_file}"
  # Validate exact definition (collision detection).
  local color desc
  color="$(echo "${raw}" | jq -r '.color // ""')" || return 2
  desc="$(echo "${raw}" | jq -r '.description // ""')" || return 2
  if [[ "${color}" != "${HISTORY_COLOR}" ]] || [[ "${desc}" != "${HISTORY_DESC}" ]]; then
    return 1  # collision with human label — treat as absent
  fi
  return 0
}

# Historical eligibility: current issue search, then backfill, then per-login label.
# Any API error propagates as a failure (not eligibility).
has_historical_assignment() {
  local user="$1"
  local current_count
  current_count="$(get_current_issue_count "${user}")" || return 2
  if [[ "${current_count}" -gt 0 ]]; then
    return 0
  fi
  if has_backfill_assignment "${user}"; then
    return 0
  fi
  has_history_label "${user}"
  case $? in
    0) return 0 ;;
    1) return 1 ;;  # absent
    *) return 2 ;;  # error
  esac
}

# ---------------------------------------------------------------------------
# Label definition validation helpers.
# ---------------------------------------------------------------------------

# Check if a label exists and validate its definition matches expected values.
# Returns: 0 = exists with correct definition; 1 = absent; 2 = exists but
# conflicting definition; 3 = API error.
validate_label_definition() {
  local label_name="$1"
  local expected_color="$2"
  local expected_desc="$3"
  local _stderr_file raw
  _stderr_file="$(mktemp "${ASSIGN_TEMP_DIR}/capture.XXXXXX")"
  raw="$(gh api "repos/${REPO}/labels/${label_name}" --jq '.' 2>"${_stderr_file}")" || {
    local _diag
    _diag="$(cat "${_stderr_file}" 2>/dev/null || true)"
    rm -f "${_stderr_file}"
    if echo "${_diag}" | grep -qE 'HTTP.?404|404.*not found'; then
      return 1  # absent
    fi
    return 3  # error
  }
  rm -f "${_stderr_file}"
  local color desc
  color="$(echo "${raw}" | jq -r '.color // ""')" || return 3
  desc="$(echo "${raw}" | jq -r '.description // ""')" || return 3
  if [[ "${color}" != "${expected_color}" ]] || [[ "${desc}" != "${expected_desc}" ]]; then
    return 2  # conflicting definition
  fi
  return 0
}

ensure_label_exists() {
  local label_name="$1"
  local expected_color="$2"
  local expected_desc="$3"
  local rc
  validate_label_definition "${label_name}" "${expected_color}" "${expected_desc}"
  rc=$?
  case ${rc} in
    0) return 0 ;;  # exists, correct definition
    1) ;;            # absent — proceed to create
    2)
      echo "‼ Label '${label_name}' exists with conflicting definition" >&2
      return 1
      ;;
    3) return 1 ;;   # API error
    *)
      echo "‼ Unexpected label validation status: ${rc}" >&2
      return 1
      ;;
  esac
  # Create the label.
  if ! gh api --method POST "repos/${REPO}/labels" \
    -f name="${label_name}" \
    -f color="${expected_color}" \
    -f description="${expected_desc}" \
    --silent >/dev/null 2>&1; then
    # POST failed — re-check if it was created concurrently (race).
    validate_label_definition "${label_name}" "${expected_color}" "${expected_desc}"
    rc=$?
    case ${rc} in
      0) return 0 ;;
      *) return 1 ;;
    esac
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Mutation helpers (targeted POST/DELETE).
# ---------------------------------------------------------------------------

# Add a single label via targeted POST (preserves existing labels, commas).
add_label() {
  local issue_num="$1"
  local label_name="$2"
  gh api --method POST "repos/${REPO}/issues/${issue_num}/labels" \
    -f "labels[]=${label_name}" --silent >/dev/null 2>&1
}

# Add assignee via targeted POST (preserves existing assignees).
add_assignee() {
  local issue_num="$1"
  local login="$2"
  gh api --method POST "repos/${REPO}/issues/${issue_num}/assignees" \
    -f "assignees[]=${login}" --silent >/dev/null 2>&1
}

# Remove assignee via targeted DELETE.
remove_assignee() {
  local issue_num="$1"
  local login="$2"
  gh api --method DELETE "repos/${REPO}/issues/${issue_num}/assignees" \
    -f "assignees[]=${login}" --silent >/dev/null 2>&1
}

# Remove a single label via targeted DELETE. Uses jq @uri for URL encoding
# to safely handle label names with special characters.
remove_label() {
  local issue_num="$1"
  local label_name="$2"
  local encoded
  encoded="$(printf '%s' "${label_name}" | jq -sRr '@uri')"
  gh api --method DELETE "repos/${REPO}/issues/${issue_num}/labels/${encoded}" \
    --silent >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Verified rollback: removes only this run's assignee, re-reads exact
# assignee JSON, then decides whether to also remove the label.
#
# If a competing winner remains assigned after removing this run's assignee,
# the marker label is PRESERVED (the competing assignment owns it now).
# If no other assignee remains and this run definitively owns the marker,
# the label is also removed. Verified rollback must succeed; callers must
# NOT treat a failed rollback as success.
# ---------------------------------------------------------------------------

rollback_ownership_from_snapshot() {
  local assignees_json="$1"
  local timeline_json="$2"
  local login="$3"

  echo "${timeline_json}" | jq -r \
    --argjson current_assignees "${assignees_json}" \
    --arg login "${login}" \
    --arg bot "${BOT_LOGIN}" '
      if type != "array" then error("timeline is not an array") else . end
      | to_entries as $entries
      | ($entries | map(select(
          (.value.event == "assigned" or .value.event == "unassigned") and
          (.value.assignee | type == "object") and
          .value.assignee.login == $login
        ))) as $transitions
      | if ($current_assignees | map(.login) | index($login)) == null then
          "ABSENT"
        else
          ($transitions | map(select(.value.assignee.login == $login)) | last // null) as $latest
          | if $latest != null and
               $latest.value.event == "assigned" and
               ($latest.value.actor.login // "") == $bot then
              "BOT \($latest.key) \($entries | length)"
            else
              "PRESERVE"
            end
        end
    ' 2>/dev/null
}

marker_removal_is_safe() {
  local assignees_json="$1"
  local timeline_json="$2"

  echo "${timeline_json}" | jq -e \
    --argjson current_assignees "${assignees_json}" \
    --arg bot "${BOT_LOGIN}" '
      if type != "array" then error("timeline is not an array") else . end
      | to_entries
      | map(select(.value.event == "assigned" or .value.event == "unassigned")) as $transitions
      | [$current_assignees[].login as $login
          | ($transitions | map(select(
              (.value.assignee | type == "object") and
              .value.assignee.login == $login
            )) | last // null) as $latest
          | $latest != null and
            $latest.value.event == "assigned" and
            ($latest.value.actor.login // "") != "" and
            $latest.value.actor.login != $bot
        ] | all
    ' >/dev/null 2>&1
}

human_takeover_before_rollback_unassign() {
  local timeline_json="$1"
  local login="$2"
  local bot_assignment_pos="$3"
  local snapshot_length="$4"

  echo "${timeline_json}" | jq -e \
    --arg login "${login}" \
    --arg bot "${BOT_LOGIN}" \
    --argjson bot_pos "${bot_assignment_pos}" \
    --argjson snapshot_length "${snapshot_length}" '
      to_entries as $entries
      | ($entries | map(select(
          .key >= $snapshot_length and
          .value.event == "unassigned" and
          .value.assignee.login == $login and
          .value.actor.login == $bot
        )) | first // null) as $cleanup_unassign
      | $cleanup_unassign != null and
        any($entries[];
          .key > $bot_pos and
          .key < $cleanup_unassign.key and
          .value.event == "assigned" and
          .value.assignee.login == $login and
          (.value.actor.login // "") != $bot
        )
    ' >/dev/null 2>&1
}

rollback_this_run() {
  local issue_num="$1"
  local login="$2"
  local label_name="$3"
  local rolled_label="${4:-false}"
  local assignees_json timeline_json ownership

  if ! assignees_json="$(get_issue_assignees_json 2>/dev/null)" ||
     ! timeline_json="$(fetch_timeline_json)" ||
     ! ownership="$(rollback_ownership_from_snapshot "${assignees_json}" "${timeline_json}" "${login}")"; then
    echo "‼ Rollback: failed to establish authoritative ownership for @${login} on #${issue_num}" >&2
    return 1
  fi

  if [[ "${ownership}" == BOT\ * ]]; then
    local bot_assignment_pos snapshot_length
    read -r _ bot_assignment_pos snapshot_length <<<"${ownership}"
    if ! remove_assignee "${issue_num}" "${login}"; then
      echo "‼ Rollback: targeted DELETE failed for @${login} on #${issue_num}" >&2
      return 1
    fi

    if ! assignees_json="$(get_issue_assignees_json 2>/dev/null)" ||
       ! timeline_json="$(fetch_timeline_json)"; then
      echo "‼ Rollback: failed to verify targeted DELETE for @${login} on #${issue_num}" >&2
      return 1
    fi

    if human_takeover_before_rollback_unassign "${timeline_json}" "${login}" "${bot_assignment_pos}" "${snapshot_length}"; then
      add_assignee "${issue_num}" "${login}" || true
      if ! assignees_json="$(get_issue_assignees_json 2>/dev/null)" ||
         ! echo "${assignees_json}" | jq -e --arg login "${login}" '[.[].login] | index($login) != null' >/dev/null 2>&1; then
        echo "‼ Rollback compensation FAILED for human-owned @${login} on #${issue_num}" >&2
      else
        echo "‼ Rollback detected a concurrent human takeover of @${login}; restored assignee and retained marker" >&2
      fi
      return 1
    fi

    if echo "${assignees_json}" | jq -e --arg login "${login}" '[.[].login] | index($login) != null' >/dev/null 2>&1; then
      echo "‼ Rollback verification FAILED: @${login} still assigned to #${issue_num}" >&2
      return 1
    fi
  elif [[ "${ownership}" == "PRESERVE" ]]; then
    echo "Rollback: preserving human/unknown-owned @${login} on #${issue_num}" >&2
  elif [[ "${ownership}" != "ABSENT" ]]; then
    echo "‼ Rollback: ambiguous ownership result for @${login} on #${issue_num}" >&2
    return 1
  fi

  local preserve_marker_for_bot_contender=false
  if echo "${assignees_json}" | jq -e --arg login "${login}" \
    'any(.[]; .login != $login)' >/dev/null 2>&1; then
    preserve_marker_for_bot_contender=true
  fi

  if [[ "${rolled_label}" == "true" ]]; then
    if ! assignees_json="$(get_issue_assignees_json 2>/dev/null)" ||
       ! timeline_json="$(fetch_timeline_json)"; then
      echo "‼ Rollback: failed to verify marker ownership on #${issue_num}" >&2
      return 1
    fi
    if [[ "${preserve_marker_for_bot_contender}" != "true" ]] &&
       marker_removal_is_safe "${assignees_json}" "${timeline_json}"; then
      remove_label "${issue_num}" "${label_name}" || true
      local verify_labels
      if ! verify_labels="$(get_issue_labels_json 2>/dev/null)"; then
        echo "‼ Rollback: failed to verify label removal on #${issue_num}" >&2
        return 1
      fi
      if echo "${verify_labels}" | jq -e --arg lbl "${label_name}" '[.[].name] | index($lbl) != null' >/dev/null 2>&1; then
        echo "‼ Rollback verification FAILED: label '${label_name}' still on #${issue_num}" >&2
        return 1
      fi
    fi
  fi
  return 0
}

# Verified rollback that exits nonzero if rollback itself fails.
# Never treats a failed rollback as success. If rollback fails, the
# state is left diagnosable (assignee/label may remain for next run).
#
# On SUCCESSFUL rollback, posts feedback only when post_feedback_on_success
# is "true". Contention-loser callers pass "false" to avoid overwriting the
# winner's sticky.
#
# Args: issue_num login label_name rolled_label feedback_msg exit_code [post_feedback_on_success]
verified_rollback_and_fail() {
  local issue_num="$1"
  local login="$2"
  local label_name="$3"
  local rolled_label="$4"
  local feedback_msg="$5"
  local exit_code="${6:-1}"
  local post_feedback_on_success="${7:-true}"

  if ! rollback_this_run "${issue_num}" "${login}" "${label_name}" "${rolled_label}"; then
    echo "‼ Rollback FAILED for @${login} on #${issue_num} — state left for diagnosis" >&2
    post_sticky_feedback "${feedback_msg}" || true
    exit "${exit_code}"
  fi

  if [[ "${post_feedback_on_success}" == "true" ]]; then
    post_sticky_feedback "${feedback_msg}" || true
  fi
  exit "${exit_code}"
}

# shellcheck disable=SC2329  # Invoked by INT/TERM traps.
handle_lifecycle_signal() {
  local signal_name="$1"
  local exit_code="$2"
  trap - INT TERM
  echo "‼ Received ${signal_name} during assignment lifecycle for @${USER_LOGIN} on #${ISSUE}" >&2
  if [[ "${MUTATION_STARTED}" == "true" && "${LIFECYCLE_COMMITTED}" != "true" ]]; then
    if rollback_this_run "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}"; then
      echo "Rollback completed after ${signal_name}" >&2
    else
      echo "‼ Rollback after ${signal_name} could not be verified; recoverable marker state was retained" >&2
    fi
  fi
  cleanup_temp_files
  exit "${exit_code}"
}

# ---------------------------------------------------------------------------
# Deterministic winner election via authoritative paginated timeline.
#
# Uses EVENT POSITION (flattened timeline array index) for total ordering —
# NOT created_at timestamps (which collide at second resolution).
#
# Election algorithm:
#   1. For each currently assigned login, find its latest assignment
#      transition (assigned/unassigned) by EVENT POSITION.
#   2. If ANY login's latest transition was made by a human (non-bot),
#      the issue has human ownership — this run must rollback itself.
#   3. Among bot-established current assignments, the earliest current-stint
#      assigned event (by position) is the deterministic winner.
#   4. At least one and at most one automated winner is guaranteed.
#
# Output: the winning login on stdout; empty if human ownership detected.
# Returns: 0 = winner determined; 1 = error/ambiguous.
# ---------------------------------------------------------------------------

# Fetch and flatten the full paginated issue timeline.
# Output: single JSON array on stdout.
fetch_timeline_json() {
  gh api "repos/${REPO}/issues/${ISSUE}/timeline?per_page=100" \
    --paginate 2>/dev/null \
    | jq -s 'if all(.[]; type == "array") then add else error("non-array page in timeline") end'
}

# Deterministic election: returns the winning login or empty.
# Uses timeline event positions for total ordering.
#
# Args: assignees_json, timeline_json
# Output: winning login (empty if human ownership), or "AMBIGUOUS".
# Returns: 0 = success; 1 = error.
elect_winner() {
  local assignees_json="$1"
  local timeline_json="$2"

  local result
  result="$(echo "${timeline_json}" | jq -r --argjson current_assignees "${assignees_json}" --arg bot "${BOT_LOGIN}" '
    if type != "array" then error("timeline is not an array") else . end
    | to_entries as $all_entries
    | ($all_entries | map(select(.value.event == "assigned" or .value.event == "unassigned"))) as $assign_entries
    | ($assign_entries | map(
        select(
          (.value.assignee | type == "object")
          and (.value.assignee.login | type == "string")
          and (.value.assignee.login | length > 0)
        )
      )) as $valid_assign_entries
    | ($assign_entries | length) as $total_assign_entries
    | ($valid_assign_entries | length) as $valid_count
    | if $total_assign_entries > $valid_count then
        error("malformed assignee data in timeline transition events")
      else . end
    | ($current_assignees | map(.login)) as $logins
    | [
        $logins[]
        | . as $login
        | ($valid_assign_entries | map(select(.value.assignee.login == $login))) as $login_transitions
        | ($login_transitions | last // null) as $last_entry
        | if $last_entry != null then
            {
              login: $login,
              pos: $last_entry.key,
              actor: ($last_entry.value.actor.login // "unknown"),
              event: $last_entry.value.event
            }
          else
            {
              login: $login,
              pos: -1,
              actor: "unknown",
              event: "unknown"
            }
          end
      ] as $latest_per_login
    | ($latest_per_login | map(select(.actor != $bot)) | length > 0) as $has_human
    | if $has_human then
        ""
      else
        ($latest_per_login
          | map(select(.event == "assigned"))
          | sort_by(.pos)
          | .[0].login // "AMBIGUOUS")
      end
  ' 2>/dev/null)" || return 1

  echo "${result}"
}

# Run the winner election: fetch fresh assignees + timeline, elect, and
# determine if this run is the winner. Retries a bounded number of times
# so contemporaneous contenders can appear in the timeline.
#
# Sets global: ELECTION_WINNER (the winning login or empty).
# Returns: 0 = this run won or no winner needed; 1 = error/rollback needed.
# Sets global: SHOULD_ROLLBACK (true/false).
ELECTION_RETRIES="${ASSIGN_ELECTION_RETRIES:-5}"
ELECTION_DELAY="${ASSIGN_ELECTION_DELAY:-1}"

run_election() {
  SHOULD_ROLLBACK="false"
  local attempt
  for attempt in $(seq 1 $((ELECTION_RETRIES + 1))); do
    local assignees_json timeline_json
    if ! assignees_json="$(get_issue_assignees_json)"; then
      echo "‼ Election: failed to read assignees for #${ISSUE}" >&2
      SHOULD_ROLLBACK="true"
      return 1
    fi
    if ! timeline_json="$(fetch_timeline_json)"; then
      echo "‼ Election: failed to fetch timeline for #${ISSUE}" >&2
      SHOULD_ROLLBACK="true"
      return 1
    fi

    local winner
    if ! winner="$(elect_winner "${assignees_json}" "${timeline_json}")"; then
      echo "‼ Election: error during election for #${ISSUE}" >&2
      SHOULD_ROLLBACK="true"
      return 1
    fi

    if [[ -z "${winner}" ]]; then
      echo "WARNING: Human ownership detected on #${ISSUE}; rolling back @${USER_LOGIN}" >&2
      SHOULD_ROLLBACK="true"
      ELECTION_WINNER=""
      return 0
    fi

    if [[ "${winner}" == "AMBIGUOUS" ]]; then
      echo "‼ Election: ambiguous result for #${ISSUE}" >&2
      SHOULD_ROLLBACK="true"
      return 1
    fi

    if [[ "${winner}" == "${USER_LOGIN}" ]]; then
      ELECTION_WINNER="${winner}"
      SHOULD_ROLLBACK="false"
      return 0
    fi

    if [[ "${attempt}" -le "${ELECTION_RETRIES}" ]]; then
      sleep "${ELECTION_DELAY}"
    fi
  done

  echo "WARNING: Election loser: @${USER_LOGIN} is not the winner (@${winner} won) on #${ISSUE}" >&2
  ELECTION_WINNER="${winner}"
  SHOULD_ROLLBACK="true"
  return 0
}

# ---------------------------------------------------------------------------
# Sticky feedback (fail-closed: lookup errors ≠ absence).
# ---------------------------------------------------------------------------

post_sticky_feedback() {
  local message="$1"
  local body
  body="$(printf '%s\n%s\n' "${MARKER}" "${message}")"

  local _comments_stderr_file
  _comments_stderr_file="$(mktemp "${ASSIGN_TEMP_DIR}/capture.XXXXXX")"
  local all_comments_raw
  all_comments_raw="$(gh api "repos/${REPO}/issues/${ISSUE}/comments" --paginate 2>"${_comments_stderr_file}")" || {
    echo "‼ Failed to fetch comments for feedback" >&2
    cat "${_comments_stderr_file}" >&2 2>/dev/null || true
    rm -f "${_comments_stderr_file}"
    return 1
  }
  rm -f "${_comments_stderr_file}"

  local all_comment_ids
  all_comment_ids="$(echo "${all_comments_raw}" | jq -s 'add | [(.[]? | select(.user.login == $bot and ((.body // "") | startswith($marker))) | .id)] | sort' \
    --arg bot "${BOT_LOGIN}" --arg marker "${MARKER}")" || {
    echo "‼ Failed to parse comments for feedback" >&2
    return 1
  }

  local count
  count="$(echo "${all_comment_ids}" | jq 'length')"

  if [[ "${count}" -eq 0 ]]; then
    gh api --method POST "repos/${REPO}/issues/${ISSUE}/comments" \
      -f body="${body}" --silent >/dev/null 2>&1 || return 1
    return 0
  fi

  local keep_id
  keep_id="$(echo "${all_comment_ids}" | jq -r '.[-1]')"

  gh api --method PATCH "repos/${REPO}/issues/comments/${keep_id}" \
    -f body="${body}" --silent >/dev/null 2>&1 || return 1

  if [[ "${count}" -gt 1 ]]; then
    echo "${all_comment_ids}" | jq -r '.[:-1][]' | while IFS= read -r dup_id; do
      gh api --method DELETE "repos/${REPO}/issues/comments/${dup_id}" \
        --silent >/dev/null 2>&1 || true
    done
  fi
}

abort_infra_error() {
  local msg="$1"
  echo "${msg}" >&2
  post_sticky_feedback "[ERROR] Could not process /assign for @${USER_LOGIN}: unable to verify state due to an API error. Please try again or contact a maintainer." || true
  exit 1
}

# ---------------------------------------------------------------------------
# Main flow.
# ---------------------------------------------------------------------------

echo " Processing /assign for issue #${ISSUE} by @${USER_LOGIN}"

# Step -1: Closed-issue guard — closed issues cannot be assigned.
# Malformed/missing state is an infrastructure failure (exit 1).
pre_state=""
pre_state="$(get_issue_state)" || abort_infra_error "‼ Failed to read issue state for #${ISSUE}"
if ! is_valid_state "${pre_state}"; then
  abort_infra_error "‼ Issue #${ISSUE} has malformed state '${pre_state}'"
fi
if [[ "${pre_state}" != "open" ]]; then
  echo "WARNING: Issue #${ISSUE} is ${pre_state}, not open"
  post_sticky_feedback "[ERROR] Could not assign @${USER_LOGIN}: this issue is **${pre_state}**, not open. Only open issues can be assigned." || true
  exit 0
fi

# Step 0: Read current assignees as JSON array (exact membership).
pre_assignees_json=""
pre_assignees_json="$(get_issue_assignees_json)" || abort_infra_error "‼ Failed to read assignees for #${ISSUE}"

if echo "${pre_assignees_json}" | jq -e '. | length > 0' >/dev/null 2>&1; then
  assignee_csv="$(echo "${pre_assignees_json}" | jq -r '[.[].login] | join(", ")')"
  echo "WARNING: Issue #${ISSUE} is already assigned to: ${assignee_csv}"
  post_sticky_feedback "[ERROR] Could not assign @${USER_LOGIN}: this issue is already assigned to **${assignee_csv}**." || true
  exit 0
fi

# Step 0b: Check for pre-existing auto-assigned marker on an unassigned issue.
# This is inconsistent provenance — fail closed, do not assign.
pre_labels_json=""
pre_labels_json="$(get_issue_labels_json)" || abort_infra_error "‼ Failed to read labels for #${ISSUE}"

if echo "${pre_labels_json}" | jq -e --arg lbl "${AUTO_ASSIGNED_LABEL}" '[.[].name] | index($lbl) != null' >/dev/null 2>&1; then
  echo "WARNING: Issue #${ISSUE} is unassigned but already carries '${AUTO_ASSIGNED_LABEL}' label — inconsistent provenance"
  post_sticky_feedback "[ERROR] Could not assign @${USER_LOGIN}: this issue has an inconsistent state (auto-assigned label without an assignee). Please contact a maintainer." || true
  exit 1
fi

# Step 1: Cap check (pre-mutation).
open_count=""
open_count="$(get_open_assigned_count "${USER_LOGIN}")" || abort_infra_error "‼ Failed to query open assigned count for @${USER_LOGIN}"

if [[ "${open_count}" -ge "${MAX_ASSIGNMENTS}" ]]; then
  echo "WARNING: @${USER_LOGIN} already has ${open_count} open assigned issues (max ${MAX_ASSIGNMENTS})"
  post_sticky_feedback "[ERROR] Could not assign @${USER_LOGIN}: you already have **${open_count}** open assigned issues (maximum is **${MAX_ASSIGNMENTS}** per CONTRIBUTING.md). Please finish or unassign one first." || true
  exit 0
fi

# Step 2: Eligibility.
is_eligible=false
eligibility_reason=""

merged_count=""
merged_count="$(get_merged_pr_count "${USER_LOGIN}")" || abort_infra_error "‼ Failed to query merged PRs for @${USER_LOGIN}"

if [[ "${merged_count}" -gt 0 ]]; then
  is_eligible=true
  eligibility_reason="prior merged PR(s)"
fi

if [[ "${is_eligible}" != "true" ]]; then
  hist_rc=0
  has_historical_assignment "${USER_LOGIN}" || hist_rc=$?
  case ${hist_rc} in
    0)
      is_eligible=true
      eligibility_reason="prior issue assignment"
      ;;
    1) ;;  # absent — not eligible via history
    2)
      abort_infra_error "‼ Failed to query historical assignment for @${USER_LOGIN}"
      ;;
    *)
      abort_infra_error "‼ Unexpected historical assignment status for @${USER_LOGIN}: ${hist_rc}"
      ;;
  esac
fi

if [[ "${is_eligible}" != "true" ]]; then
  echo "WARNING: @${USER_LOGIN} is not eligible for self-assignment"
  post_sticky_feedback "[ERROR] Could not assign @${USER_LOGIN}: eligibility requires at least one merged PR in this repository, or a prior issue assignment. Please open a PR first or ask a maintainer to assign you." || true
  exit 0
fi

echo "[OK] Eligible via: ${eligibility_reason}"

# Step 3: Validate/create the shared auto-assigned label (with exact definition).
ensure_label_exists "${AUTO_ASSIGNED_LABEL}" "${AUTO_ASSIGNED_COLOR}" "${AUTO_ASSIGNED_DESC}" \
  || abort_infra_error "‼ Failed to validate/create label '${AUTO_ASSIGNED_LABEL}'"

# Step 4: Re-read assignees immediately before mutation (race protection).
pre_assignees_json=""
pre_assignees_json="$(get_issue_assignees_json)" || abort_infra_error "‼ Failed to re-read assignees for #${ISSUE}"

if echo "${pre_assignees_json}" | jq -e '. | length > 0' >/dev/null 2>&1; then
  assignee_csv="$(echo "${pre_assignees_json}" | jq -r '[.[].login] | join(", ")')"
  echo "WARNING: Issue #${ISSUE} was assigned by a concurrent run: ${assignee_csv}"
  post_sticky_feedback "[ERROR] Could not assign @${USER_LOGIN}: this issue was assigned to **${assignee_csv}** by a concurrent request." || true
  exit 0
fi

# Step 4b: Re-validate issue state is still open immediately before mutation.
pre_mutation_state=""
pre_mutation_state="$(get_issue_state)" || abort_infra_error "‼ Failed to re-read issue state for #${ISSUE}"
if ! is_valid_state "${pre_mutation_state}"; then
  abort_infra_error "‼ Issue #${ISSUE} has malformed state '${pre_mutation_state}'"
fi
if [[ "${pre_mutation_state}" != "open" ]]; then
  echo "WARNING: Issue #${ISSUE} became ${pre_mutation_state} before mutation"
  post_sticky_feedback "[ERROR] Could not assign @${USER_LOGIN}: this issue is **${pre_mutation_state}**, not open. Only open issues can be assigned." || true
  exit 0
fi

pre_open_count=""
pre_open_count="$(get_open_assigned_count "${USER_LOGIN}")" || abort_infra_error "‼ Failed to re-query open assigned count for @${USER_LOGIN}"

if [[ "${pre_open_count}" -ge "${MAX_ASSIGNMENTS}" ]]; then
  echo "WARNING: @${USER_LOGIN} reached cap (${pre_open_count}) before assignment"
  post_sticky_feedback "[ERROR] Could not assign @${USER_LOGIN}: you now have **${pre_open_count}** open assigned issues (maximum is **${MAX_ASSIGNMENTS}**). Another assignment may have completed concurrently." || true
  exit 0
fi

# Step 5: Add auto-assigned label (targeted POST).
MUTATION_STARTED=true
trap 'handle_lifecycle_signal INT 130' INT
trap 'handle_lifecycle_signal TERM 143' TERM

if add_label "${ISSUE}" "${AUTO_ASSIGNED_LABEL}"; then
  label_added_by_this_run=true
else
  # Label add failed — re-read to confirm current state.
  verified_labels_json=""
  if ! verified_labels_json="$(get_issue_labels_json)"; then
    abort_infra_error "‼ Failed to verify labels after add failure for #${ISSUE}"
  fi
  if ! echo "${verified_labels_json}" | jq -e --arg lbl "${AUTO_ASSIGNED_LABEL}" '[.[].name] | index($lbl) != null' >/dev/null 2>&1; then
    abort_infra_error "‼ Label add failed and label is not present for #${ISSUE}"
  fi
  # Label POST returned error but label IS confirmed present (applied_error
  # or concurrent race). Track as confirmed-present so that ownership-aware
  # rollback on every later failure and INT/TERM attempts marker removal.
  # rollback_this_run / marker_removal_is_safe already preserve the marker
  # when a competing assignment stint owns it.
  label_added_by_this_run=true
fi

# Step 6: Add assignee (targeted POST).
if ! add_assignee "${ISSUE}" "${USER_LOGIN}"; then
  echo "‼ Assignee POST failed for #${ISSUE}" >&2
  verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
    "[ERROR] Could not assign @${USER_LOGIN}: GitHub API error during assignment. Please try again or contact a maintainer." 1
fi

# Step 7: Deterministic winner election via authoritative paginated timeline.
# Uses EVENT POSITION for total ordering. If any human owns the issue,
# rollback. Among bot-established assignments, the earliest current-stint
# assigned event wins. The winner waits/retries so contemporaneous
# contenders can appear, then enforces exactly itself remains.
ELECTION_WINNER=""
SHOULD_ROLLBACK="false"

if ! run_election; then
  verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
    "[ERROR] Could not assign @${USER_LOGIN}: election verification failed. Please contact a maintainer." 1
fi

if [[ "${SHOULD_ROLLBACK}" == "true" ]]; then
  if [[ -z "${ELECTION_WINNER}" ]]; then
    verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
      "[ERROR] Could not assign @${USER_LOGIN}: a human has taken ownership of this issue." 1
  else
    verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
      "[ERROR] Could not assign @${USER_LOGIN}: another assignment was selected. Please try a different issue." 1 false
  fi
fi

# Winner enforcement: wait/retry for losers to rollback, then verify
# exactly this run's login remains assigned. Re-runs the election when
# contention persists — only rolls back if this run is no longer the winner.
enforcement_ok=false
enforcement_retries=$((ELECTION_RETRIES * 3 + 5))
for _e_attempt in $(seq 1 $((enforcement_retries + 1))); do
  verified_assignees_json=""
  if ! verified_assignees_json="$(get_issue_assignees_json)"; then
    echo "‼ Failed to verify assignees for #${ISSUE}" >&2
    verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
      "[ERROR] Could not assign @${USER_LOGIN}: unable to verify assignment state. Please contact a maintainer." 1
  fi

  assignee_count="$(echo "${verified_assignees_json}" | jq 'length')"
  has_commenter="$(echo "${verified_assignees_json}" | jq -r --arg login "${USER_LOGIN}" '[.[].login] | index($login) != null')"

  if [[ "${assignee_count}" == "1" ]] && [[ "${has_commenter}" == "true" ]]; then
    enforcement_ok=true
    break
  fi

  # Contention persists — re-run election to check if this run is still the winner.
  # If no longer the winner, roll back. If still the winner, keep waiting.
  if [[ "${has_commenter}" != "true" ]]; then
    echo "WARNING: @${USER_LOGIN} no longer assigned to #${ISSUE} during enforcement" >&2
    verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
      "[ERROR] Could not assign @${USER_LOGIN}: another assignment was selected. Please try a different issue." 1 false
  fi

  recheck_timeline=""
  recheck_assignees=""
  recheck_winner=""
  if ! recheck_assignees="$(get_issue_assignees_json)" || \
     ! recheck_timeline="$(fetch_timeline_json)"; then
    echo "‼ Enforcement re-election: API error for #${ISSUE}" >&2
    verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
      "[ERROR] Could not assign @${USER_LOGIN}: election verification failed. Please contact a maintainer." 1
  fi

  if ! recheck_winner="$(elect_winner "${recheck_assignees}" "${recheck_timeline}")"; then
    echo "‼ Enforcement re-election: error for #${ISSUE}" >&2
    verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
      "[ERROR] Could not assign @${USER_LOGIN}: election verification failed. Please contact a maintainer." 1
  fi

  if [[ -z "${recheck_winner}" ]]; then
    echo "WARNING: Human ownership detected during enforcement on #${ISSUE}; rolling back @${USER_LOGIN}" >&2
    verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
      "[ERROR] Could not assign @${USER_LOGIN}: a human has taken ownership of this issue." 1
  fi

  if [[ "${recheck_winner}" != "${USER_LOGIN}" ]]; then
    echo "WARNING: @${USER_LOGIN} is no longer the winner (@${recheck_winner} won) on #${ISSUE}" >&2
    verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
      "[ERROR] Could not assign @${USER_LOGIN}: another assignment was selected. Please try a different issue." 1 false
  fi

  if [[ "${_e_attempt}" -le "${enforcement_retries}" ]]; then
    sleep "${ELECTION_DELAY}"
  fi
done

if [[ "${enforcement_ok}" != "true" ]]; then
  echo "WARNING: Post-election contention on #${ISSUE}: assignees = $(echo "${verified_assignees_json}" | jq -r '[.[].login] | join(", ")')" >&2
  verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
    "[ERROR] Could not assign @${USER_LOGIN}: unable to enforce single-winner assignment. Please contact a maintainer." 1 false
fi

# Step 8: Verify label was added.
verified_labels_json=""
if ! verified_labels_json="$(get_issue_labels_json)"; then
  verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
    "[ERROR] Could not assign @${USER_LOGIN}: unable to verify label state. Please contact a maintainer." 1
fi

if ! echo "${verified_labels_json}" | jq -e --arg lbl "${AUTO_ASSIGNED_LABEL}" '[.[].name] | index($lbl) != null' >/dev/null 2>&1; then
  echo "‼ Label verification failed for #${ISSUE}" >&2
  verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
    "[ERROR] Could not assign @${USER_LOGIN}: the label could not be verified. Please contact a maintainer." 1
fi

# Step 9: Post-mutation cap enforcement (fail-closed).
post_open_count=""
if ! post_open_count="$(get_open_assigned_count "${USER_LOGIN}")"; then
  echo "‼ Post-mutation cap query failed for @${USER_LOGIN}" >&2
  verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
    "[ERROR] Could not assign @${USER_LOGIN}: unable to verify the assignment cap due to an API error. Please try again or contact a maintainer." 1
fi

if [[ "${post_open_count}" -gt "${MAX_ASSIGNMENTS}" ]]; then
  echo "WARNING: Post-mutation open count (${post_open_count}) exceeds cap; rolling back @${USER_LOGIN} on #${ISSUE}" >&2
  # Verified rollback must succeed before exiting. If it fails, exit nonzero.
  verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
    "[ERROR] Could not assign @${USER_LOGIN}: assignment would exceed the **${MAX_ASSIGNMENTS}**-issue cap. Another assignment may have completed concurrently." 1
fi

# Step 10: Create durable history label directly (GitHub suppresses recursive
# issues:assigned workflows from GITHUB_TOKEN).
# Delegates to the shared record-assignment-history.sh script for consistent
# exact label definition validation and collision failure.
if ! bash "$(dirname "${BASH_SOURCE[0]}")/record-assignment-history.sh"; then
  echo "‼ Failed to create history label for @${USER_LOGIN}" >&2
  verified_rollback_and_fail "${ISSUE}" "${USER_LOGIN}" "${AUTO_ASSIGNED_LABEL}" "${label_added_by_this_run}" \
    "[ERROR] Could not assign @${USER_LOGIN}: failed to record assignment history. Please try again or contact a maintainer." 1
fi

LIFECYCLE_COMMITTED=true
trap - INT TERM

echo "[OK] Assigned @${USER_LOGIN} to issue #${ISSUE}"
post_sticky_feedback "[OK] Assigned @${USER_LOGIN} to this issue via \`/assign\` (${eligibility_reason}).

Please open a linked PR within **2 weeks**, or the automation may unassign stale auto-assignments (maintainer \`acoliver\` is exempt as an assignee)."
exit 0
