#!/usr/bin/env bash
# Unassign stale auto-assigned issues with no qualifying linked PR activity
# for 2 weeks. Invoked by .github/workflows/assign-stale-cleanup.yml.
#
# Uses targeted DELETE endpoints (never whole-array PATCH) to preserve
# concurrent human state and comma-bearing label names. Only the exact
# automation assignee and auto-assigned label are removed.
#
# acoliver is never unassigned. Timeline/API failures preserve state and
# cause a nonzero exit (never destructive cleanup).
set -euo pipefail

AUTO_ASSIGNED_LABEL='auto-assigned'
AUTO_ASSIGNED_COLOR='0E8A16'
AUTO_ASSIGNED_DESC='Assigned via /assign automation'
STALE_DAYS=14
EXEMPT_LOGIN='acoliver'
BOT_LOGIN='github-actions[bot]'
ASSIGN_RETRY_DELAY="${ASSIGN_RETRY_DELAY:-5}"

: "${GITHUB_REPOSITORY:?Missing GITHUB_REPOSITORY}"

EXPECTED_REPO_URL="https://api.github.com/repos/${GITHUB_REPOSITORY}"

if [[ -n "${GH_TOKEN:-}" ]]; then
  export GH_TOKEN
elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
  export GH_TOKEN="${GITHUB_TOKEN}"
else
  echo "‼️ Missing \$GH_TOKEN / \$GITHUB_TOKEN" >&2
  exit 1
fi

REPO="${GITHUB_REPOSITORY}"

CLEANUP_TEMP_DIR="$(mktemp -d)"

# shellcheck disable=SC2329  # Invoked by EXIT/INT/TERM traps.
cleanup_temp_files() {
  if [[ -n "${CLEANUP_TEMP_DIR:-}" && -d "${CLEANUP_TEMP_DIR}" ]]; then
    rm -rf -- "${CLEANUP_TEMP_DIR}"
  fi
}

trap cleanup_temp_files EXIT
trap 'cleanup_temp_files; trap - EXIT; exit 130' INT
trap 'cleanup_temp_files; trap - EXIT; exit 143' TERM

retry_gh() {
  local attempt
  for attempt in 1 2 3 4; do
    if "$@"; then
      return 0
    fi
    if [[ "${attempt}" -lt 4 ]]; then
      echo "Attempt ${attempt} failed, retrying: $*" >&2
      sleep "${ASSIGN_RETRY_DELAY}"
    fi
  done
  echo "All retries exhausted for: $*" >&2
  return 1
}

threshold_iso() {
  if [[ -n "${ASSIGN_NOW:-}" ]]; then
    local now_epoch
    now_epoch="$(iso_to_epoch "${ASSIGN_NOW}")" || return 1
    local threshold_epoch
    threshold_epoch=$((now_epoch - STALE_DAYS * 86400))
    date -u -d "@${threshold_epoch}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
      date -u -r "${threshold_epoch}" +%Y-%m-%dT%H:%M:%SZ
    return 0
  fi
  if date -u -d "${STALE_DAYS} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null; then
    return 0
  fi
  date -u -v-"${STALE_DAYS}"d +%Y-%m-%dT%H:%M:%SZ
}

iso_to_epoch() {
  local iso="$1"
  local normalized="${iso%Z}"
  normalized="${normalized%%.*}"
  if date -u -d "${normalized}Z" +%s 2>/dev/null; then
    return 0
  fi
  date -u -j -f "%Y-%m-%dT%H:%M:%S" "${normalized}" +%s 2>/dev/null
}

# Run a command with bounded retry, capturing combined stdout.
# Sets the global RETRY_CAPTURE_OUT on success. Returns 0 on success, 1 on
# exhaustion. Stderr from the command is suppressed (goes to /dev/null).
# Args: command...
retry_gh_capture() {
  local _capture_file
  _capture_file="$(mktemp "${CLEANUP_TEMP_DIR}/capture.XXXXXX")"
  local attempt
  for attempt in 1 2 3 4; do
    : >"${_capture_file}"
    if "$@" >"${_capture_file}" 2>/dev/null; then
      RETRY_CAPTURE_OUT="$(cat "${_capture_file}")"
      rm -f "${_capture_file}"
      return 0
    fi
    if [[ "${attempt}" -lt 4 ]]; then
      echo "Attempt ${attempt} failed, retrying: $*" >&2
      sleep "${ASSIGN_RETRY_DELAY}"
    fi
  done
  rm -f "${_capture_file}"
  echo "All retries exhausted for: $*" >&2
  return 1
}

# gh api --paginate emits one JSON array per page; jq -s merges them.
# Uses retry_gh_capture for bounded retry on transient failures. The gh call
# and jq merge are run as a single bash -c with pipefail so that a gh failure
# (nonzero exit, empty stdout) is detected even though jq succeeds on empty
# input. Stdout is captured cleanly without stderr corruption.
fetch_issue_timeline() {
  local issue_number="$1"
  local _raw_pages
  if ! retry_gh_capture gh api "repos/${REPO}/issues/${issue_number}/timeline?per_page=100" --paginate; then
    return 1
  fi
  _raw_pages="${RETRY_CAPTURE_OUT}"
  printf '%s' "${_raw_pages}" | jq -s 'if all(.[]; type == "array") then add else error("non-array page in timeline") end'
}

# Read current assignees as a raw JSON array.
get_issue_assignees_json() {
  local issue_number="$1"
  gh api "repos/${REPO}/issues/${issue_number}" \
    --jq '.assignees // []' 2>/dev/null
}


# Provenance extraction from a pre-fetched timeline snapshot.
# Args: assignees_json, timeline_json.
# Output: "LOGIN TIMESTAMP POSITION" or empty. Returns nonzero on error/ambiguity.
find_provenance_from_timeline() {
  local assignees_json="$1"
  local timeline_json="$2"

  local result
  result="$(echo "${timeline_json}" | jq -r \
    --argjson current_assignees "${assignees_json}" \
    --arg label "${AUTO_ASSIGNED_LABEL}" \
    --arg bot "${BOT_LOGIN}" '
    if type != "array" then error("timeline is not an array") else . end
    | to_entries as $all_entries
    | ($all_entries | map(select(.value.event == "assigned" or .value.event == "unassigned"))) as $assign_entries
    | ($all_entries | map(select(.value.event == "labeled" or .value.event == "unlabeled"))) as $label_entries
    | ($current_assignees | map(.login)) as $logins
    | $logins[]
    | . as $login
    | ($assign_entries | map(select(.value.assignee.login == $login))) as $login_transitions
    | ($login_transitions | last // null) as $last_entry
    | ($login_transitions[-2] // null) as $boundary_entry
    | if $last_entry != null and $last_entry.value.event == "assigned" and $last_entry.value.actor.login == $bot then
        $last_entry.value.created_at as $assigned_at
        | $last_entry.key as $assigned_pos
        | ($boundary_entry.key // -1) as $boundary_pos
        | ($label_entries | map(select(
            .value.label.name == $label
            and (.key > $boundary_pos)
            and (.key <= $assigned_pos)
            and .value.actor.login == $bot
            and .value.event == "labeled"
          )) | last // null) as $qualifying_entry
        | if $qualifying_entry != null then
            ($label_entries | map(select(
              .value.label.name == $label
              and (.key > $qualifying_entry.key)
              and .value.event == "unlabeled"
            )) | length > 0) as $has_invalidating_unlabel
            | if $has_invalidating_unlabel then
                empty
              else
                "\($login) \($assigned_at) \($assigned_pos)"
              end
          else
            empty
          end
      else
        empty
      end
  ' 2>/dev/null)" || return 1

  local line_count
  line_count="$(echo "${result}" | grep -c . || true)"
  if [[ "${line_count}" -gt 1 ]]; then
    echo "Multiple automated provenance records found" >&2
    return 1
  fi

  echo "${result}"
}

# Qualifying linked PR requires the same repository and assignee author, with
# linkage at or after assignment. Returns nonzero for malformed snapshots.
has_qualifying_linked_pr_from_timeline() {
  local assignee="$1"
  local assigned_at="$2"
  local timeline_json="$3"

  local result
  result="$(echo "${timeline_json}" | jq -r --arg assignee "${assignee}" --arg assigned_at "${assigned_at}" --arg repo_url "${EXPECTED_REPO_URL}" '
    if type != "array" then error("timeline is not an array") else . end
    | map(select(
        (.event == "cross-referenced") and
        (.source.issue.pull_request != null) and
        (.source.issue.user.login == $assignee) and
        (.created_at >= $assigned_at) and
        (.source.issue.repository_url == $repo_url)
      ))
    | length > 0
  ' 2>/dev/null)" || return 1

  echo "${result}"
}

# Discover candidates: open issues with auto-assigned label.
# GitHub /issues includes PRs; filter to issues only.
# Captures gh stderr so a sanitized first line can be printed on failure
# (pipefail already ensures no partial results leak through).
discover_candidates() {
  local _stderr_file _raw
  _stderr_file="$(mktemp "${CLEANUP_TEMP_DIR}/discover.XXXXXX")"
  _raw="$(gh api "repos/${REPO}/issues?state=open&labels=${AUTO_ASSIGNED_LABEL}&per_page=100" \
    --paginate 2>"${_stderr_file}" \
    | jq -sr 'if all(.[]; type == "array") then add else error("non-array page") end
             | .[]? | select(.pull_request == null) | "\(.number)\t\(.assignees)"')"
  local _rc=$?
  if [[ "${_rc}" -ne 0 ]]; then
    local _diag
    _diag="$(head -1 "${_stderr_file}" 2>/dev/null | tr -d '\000-\037' || true)"
    rm -f "${_stderr_file}"
    printf '‼ Candidate discovery failed: %s\n' "${_diag}" >&2
    return 1
  fi
  rm -f "${_stderr_file}"
  printf '%s' "${_raw}"
}

# Remove only the auto-assigned label via targeted DELETE. Uses jq @uri.
# On DELETE failure (including 404 from a race that already removed the
# label), re-reads the issue to verify the label is actually absent. Only an
# issue read confirming absence allows treating the failure as success.
remove_label_targeted() {
  local issue_number="$1"
  local label_name="$2"
  local encoded
  encoded="$(printf '%s' "${label_name}" | jq -sRr '@uri')"
  if retry_gh gh api --method DELETE "repos/${REPO}/issues/${issue_number}/labels/${encoded}" \
    --silent >/dev/null 2>&1; then
    return 0
  fi
  # DELETE failed — verify whether the label is actually absent via issue read.
  local verify_labels
  if ! verify_labels="$(gh api "repos/${REPO}/issues/${issue_number}" --jq '.labels // []' 2>/dev/null)"; then
    echo "   Warning: Label-removal DELETE failed and verification read failed for #${issue_number}" >&2
    return 1
  fi
  if echo "${verify_labels}" | jq -e --arg lbl "${label_name}" '[.[].name] | index($lbl) != null' >/dev/null 2>&1; then
    echo "   Warning: Label-removal DELETE failed and label still present for #${issue_number}" >&2
    return 1
  fi
  # Label is confirmed absent — desired state achieved despite DELETE failure.
  return 0
}

# Remove only a specific assignee via targeted DELETE.
remove_assignee_targeted() {
  local issue_number="$1"
  local login="$2"
  if ! retry_gh gh api --method DELETE "repos/${REPO}/issues/${issue_number}/assignees" \
    -f "assignees[]=${login}" --silent >/dev/null 2>&1; then
    echo "   Warning: Assignee-removal DELETE failed for #${issue_number}" >&2
    return 1
  fi
  return 0
}

# Remove auto-assigned label only (no assignees to clean).

restore_assignee_targeted() {
  local issue_number="$1"
  local login="$2"
  retry_gh gh api --method POST "repos/${REPO}/issues/${issue_number}/assignees" \
    -f "assignees[]=${login}" --silent >/dev/null 2>&1 || true

  local verify_assignees
  if ! verify_assignees="$(get_issue_assignees_json "${issue_number}")"; then
    return 1
  fi
  echo "${verify_assignees}" | jq -e --arg login "${login}" \
    '[.[].login] | index($login) != null' >/dev/null 2>&1
}

# Restore the auto-assigned marker label via targeted POST. Verifies presence
# after POST. Returns 0 if present, 1 otherwise.
restore_label_targeted() {
  local issue_number="$1"
  retry_gh gh api --method POST "repos/${REPO}/issues/${issue_number}/labels" \
    -f "labels[]=${AUTO_ASSIGNED_LABEL}" --silent >/dev/null 2>&1 || true

  local verify_labels
  if ! verify_labels="$(gh api "repos/${REPO}/issues/${issue_number}" --jq '.labels // []' 2>/dev/null)"; then
    return 1
  fi
  echo "${verify_labels}" | jq -e --arg lbl "${AUTO_ASSIGNED_LABEL}" \
    '[.[].name] | index($lbl) != null' >/dev/null 2>&1
}

human_takeover_before_cleanup_unassign() {
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

# Detect any fresh "assigned" transition at or after the pre-delete snapshot
# position. A concurrent /assign (by bot OR human, any login) between our
# pre-delete validation and the stale DELETE creates such an event.
# Uses an ordered per-login transition model: returns true only if at least
# one login's LATEST transition at or after the snapshot is "assigned".
# A login that was assigned then independently unassigned does NOT count.
# Returns 0 (true) if a live fresh assignment exists, 1 (false) otherwise.
fresh_assignment_after_snapshot() {
  local timeline_json="$1"
  local snapshot_length="$2"

  echo "${timeline_json}" | jq -e \
    --argjson snapshot_length "${snapshot_length}" '
      if type != "array" then error("timeline is not an array") else . end
      | to_entries
      | map(select(
          .key >= $snapshot_length
          and (.value.event == "assigned" or .value.event == "unassigned")
        ))
      | group_by(.value.assignee.login)
      | map(select(length > 0))
      | any((last | .value.event) == "assigned")
    ' >/dev/null 2>&1
}

# Extract logins whose LATEST transition at or after the snapshot position
# is "assigned". Uses an ordered per-login transition model: for each login,
# examines all assigned/unassigned events at or after the snapshot, and only
# includes the login if its last transition is "assigned". A login that was
# assigned then independently unassigned after the snapshot is NOT restored.
# Output: one login per line.
fresh_assignment_logins_after_snapshot() {
  local timeline_json="$1"
  local snapshot_length="$2"

  echo "${timeline_json}" | jq -r \
    --argjson snapshot_length "${snapshot_length}" '
      if type != "array" then error("timeline is not an array") else . end
      | to_entries
      | map(select(
          .key >= $snapshot_length
          and (.value.event == "assigned" or .value.event == "unassigned")
        ))
      | sort_by(.value.assignee.login)
      | group_by(.value.assignee.login)
      | map(select(length > 0))
      | map(select((last | .value.event) == "assigned"))
      | map(first | .value.assignee.login)
      | .[]
    ' 2>/dev/null
}

remove_label_only() {
  local issue_number="$1"
  remove_label_targeted "${issue_number}" "${AUTO_ASSIGNED_LABEL}"
}

# Validate the canonical auto-assigned label definition before any candidate
# discovery or mutation (fail-closed, matching assign-issue.sh).
# Returns: 0 = exists with correct definition; 1 = absent (clean no-op);
# 2 = conflicting definition; 3 = API error.
validate_marker_label() {
  local _stderr_file raw
  _stderr_file="$(mktemp "${CLEANUP_TEMP_DIR}/capture.XXXXXX")"
  raw="$(gh api "repos/${REPO}/labels/${AUTO_ASSIGNED_LABEL}" --jq '.' 2>"${_stderr_file}")" || {
    local _diag
    _diag="$(cat "${_stderr_file}" 2>/dev/null || true)"
    rm -f "${_stderr_file}"
    if printf '%s' "${_diag}" | grep -qE 'HTTP.?404|404.*not found'; then
      return 1
    fi
    return 3
  }
  rm -f "${_stderr_file}"
  local color desc
  color="$(echo "${raw}" | jq -r '.color // ""')" || return 3
  desc="$(echo "${raw}" | jq -r '.description // ""')" || return 3
  if [[ "${color}" != "${AUTO_ASSIGNED_COLOR}" ]] || [[ "${desc}" != "${AUTO_ASSIGNED_DESC}" ]]; then
    return 2
  fi
  return 0
}

process_issue() {
  local issue_number="$1"
  local assignees_json="$2"
  local threshold_epoch="$3"

  local assignee_count
  assignee_count="$(echo "${assignees_json}" | jq 'length' 2>/dev/null || echo '?')"

  echo "🔄 Checking auto-assigned issue #${issue_number} (assignees: ${assignee_count})"

  if [[ "${assignee_count}" == "0" ]]; then
    echo "   No assignees; removing stale ${AUTO_ASSIGNED_LABEL} label"
    remove_label_only "${issue_number}"
    return $?
  fi

  local bot_assignment=""
  local initial_timeline_json=""
  # Fetch ONE initial timeline snapshot per issue and use it for BOTH
  # initial provenance extraction and the initial linked-PR check. This
  # avoids a duplicate timeline fetch (a separate fresh pre-delete snapshot
  # is still mandatory before destructive DELETE for race safety).
  initial_timeline_json="$(fetch_issue_timeline "${issue_number}")" || {
    echo "   Warning: Initial timeline read failed for #${issue_number}; preserving state" >&2
    return 1
  }

  bot_assignment="$(find_provenance_from_timeline "${assignees_json}" "${initial_timeline_json}")" || {
    echo "   Warning: Provenance check failed for #${issue_number} (ambiguous or error); preserving state" >&2
    return 1
  }

  if [[ -z "${bot_assignment}" ]]; then
    echo "   No automated assignment provenance for #${issue_number}; removing label only"
    remove_label_only "${issue_number}"
    return $?
  fi

  local bot_login bot_assignment_rest bot_assigned_at bot_assigned_pos
  bot_login="${bot_assignment%% *}"
  bot_assignment_rest="${bot_assignment#* }"
  bot_assigned_at="${bot_assignment_rest%% *}"
  bot_assigned_pos="${bot_assignment_rest##* }"

  echo "   Bot-assigned @${bot_login} at ${bot_assigned_at} (timeline position ${bot_assigned_pos})"

  if [[ "${bot_login}" == "${EXEMPT_LOGIN}" ]]; then
    echo "   Keeping @${EXEMPT_LOGIN} on #${issue_number} (exempt)"
    return 0
  fi

  local bot_assigned_epoch
  bot_assigned_epoch="$(iso_to_epoch "${bot_assigned_at}" || true)"
  if [[ -z "${bot_assigned_epoch}" ]]; then
    echo "   Warning: Could not parse assignment time '${bot_assigned_at}' for #${issue_number}; preserving state" >&2
    return 1
  fi

  if [[ "${bot_assigned_epoch}" -gt "${threshold_epoch}" ]]; then
    echo "   Assignment for #${issue_number} is newer than ${STALE_DAYS} days; keeping"
    return 0
  fi

  # Use the same initial timeline snapshot for the initial linked-PR check
  # (a separate fresh pre-delete snapshot is taken before DELETE).
  local has_pr="false"
  has_pr="$(has_qualifying_linked_pr_from_timeline "${bot_login}" "${bot_assigned_at}" "${initial_timeline_json}")" || {
    echo "   Warning: Linked PR query failed for #${issue_number}; preserving state" >&2
    return 1
  }

  if [[ "${has_pr}" == "true" ]]; then
    echo "   @${bot_login} has qualifying linked PR activity for #${issue_number}; keeping"
    return 0
  fi

  # Re-read current assignees and fetch ONE fresh timeline snapshot immediately
  # before destructive DELETE. Both provenance revalidation and linked-PR
  # revalidation run against this single snapshot, so a qualifying PR that
  # appears between the initial check and the pre-delete revalidation is
  # detected (race protection).
  local pre_delete_assignees_json=""
  pre_delete_assignees_json="$(get_issue_assignees_json "${issue_number}")" || {
    echo "   Warning: Pre-delete assignee read failed for #${issue_number}; preserving state" >&2
    return 1
  }

  local pre_delete_timeline_json=""
  pre_delete_timeline_json="$(fetch_issue_timeline "${issue_number}")" || {
    echo "   Warning: Pre-delete timeline read failed for #${issue_number}; preserving state" >&2
    return 1
  }

  local pre_delete_assignment=""
  pre_delete_assignment="$(find_provenance_from_timeline "${pre_delete_assignees_json}" "${pre_delete_timeline_json}")" || {
    echo "   Warning: Pre-delete revalidation failed for #${issue_number}; preserving state" >&2
    return 1
  }

  if [[ -z "${pre_delete_assignment}" ]]; then
    echo "   Provenance changed before DELETE for #${issue_number}; human may have reassigned; removing label only"
    remove_label_only "${issue_number}"
    return $?
  fi

  local revalidated_login revalidated_rest revalidated_pos
  revalidated_login="${pre_delete_assignment%% *}"
  revalidated_rest="${pre_delete_assignment#* }"
  revalidated_pos="${revalidated_rest##* }"
  if [[ "${revalidated_login}" != "${bot_login}" ]]; then
    echo "   Warning: Provenance login mismatch for #${issue_number}; preserving state" >&2
    return 0
  fi
  if [[ "${revalidated_pos}" != "${bot_assigned_pos}" ]]; then
    echo "   Warning: Provenance timeline position changed for #${issue_number}; preserving state" >&2
    return 0
  fi

  # Re-run the linked-PR predicate against the same fresh pre-delete snapshot.
  # A qualifying PR that appeared between the initial check and this pre-delete
  # revalidation must block deletion (race protection).
  local pre_delete_has_pr="false"
  pre_delete_has_pr="$(has_qualifying_linked_pr_from_timeline "${bot_login}" "${bot_assigned_at}" "${pre_delete_timeline_json}")" || {
    echo "   Warning: Pre-delete linked-PR revalidation failed for #${issue_number}; preserving state" >&2
    return 1
  }

  if [[ "${pre_delete_has_pr}" == "true" ]]; then
    echo "   @${bot_login} has qualifying linked PR activity (detected before DELETE) for #${issue_number}; keeping"
    return 0
  fi

  # Verify bot_login is still assigned using exact jq index.
  if ! echo "${pre_delete_assignees_json}" | jq -e --arg login "${bot_login}" '[.[].login] | index($login) != null' >/dev/null 2>&1; then
    echo "   @${bot_login} no longer assigned before DELETE for #${issue_number}; nothing to do"
    return 0
  fi

  echo "   Unassigning stale @${bot_login} from #${issue_number}"

  local pre_delete_timeline_length
  pre_delete_timeline_length="$(echo "${pre_delete_timeline_json}" | jq 'length')" || {
    echo "   Warning: Could not capture pre-delete timeline position for #${issue_number}" >&2
    return 1
  }

  # Remove assignee first via targeted DELETE.
  if ! remove_assignee_targeted "${issue_number}" "${bot_login}"; then
    return 1
  fi

  local post_assignee_delete_timeline=""
  post_assignee_delete_timeline="$(fetch_issue_timeline "${issue_number}")" || {
    echo "   Warning: Post-assignee-DELETE timeline read failed for #${issue_number}; retaining marker" >&2
    return 1
  }

  if human_takeover_before_cleanup_unassign "${post_assignee_delete_timeline}" "${bot_login}" "${revalidated_pos}" "${pre_delete_timeline_length}"; then
    if restore_assignee_targeted "${issue_number}" "${bot_login}"; then
      echo "   Warning: Human same-login takeover detected during DELETE; restored @${bot_login} and retained marker for #${issue_number}" >&2
    else
      echo "   Warning: Human same-login takeover detected but compensation FAILED for @${bot_login} on #${issue_number}; marker retained" >&2
    fi
    return 1
  fi

  # Immediately re-read and verify login is absent BEFORE label DELETE.
  # If still present (successful no-op or post-handler race), retain marker.
  local mid_delete_assignees_json=""
  if ! mid_delete_assignees_json="$(get_issue_assignees_json "${issue_number}")"; then
    echo "   Warning: Post-assignee-DELETE verification read failed for #${issue_number}" >&2
    return 1
  fi

  if echo "${mid_delete_assignees_json}" | jq -e --arg login "${bot_login}" '[.[].login] | index($login) != null' >/dev/null 2>&1; then
    echo "   Warning: @${bot_login} still assigned after DELETE (no-op or race); retaining marker for #${issue_number}" >&2
    return 1
  fi

  # Defensive reconciliation: check if any fresh assignment transition
  # (by bot OR human, any login) appeared at or after the pre-delete
  # snapshot position. A concurrent /assign between stale validation and
  # the stale DELETE creates such an event. If detected, we must preserve
  # the fresh assignment(s) and retain the auto-assigned marker.
  #
  # Same-login: the stale DELETE may have removed the fresh bot assignment.
  # Restore it via targeted POST and verify.
  # Different-login: the fresh assignee is untouched by the stale DELETE
  # (targeted endpoint removes only bot_login). Just retain the marker.
  if fresh_assignment_after_snapshot "${post_assignee_delete_timeline}" "${pre_delete_timeline_length}"; then
    local _fresh_logins
    _fresh_logins="$(fresh_assignment_logins_after_snapshot "${post_assignee_delete_timeline}" "${pre_delete_timeline_length}")" || true

    local _restored_any=0
    while IFS= read -r _fresh_login; do
      [[ -z "${_fresh_login}" ]] && continue
      # Check if this fresh login is currently assigned (it may have been
      # deleted by the stale DELETE if it's the same login as bot_login).
      if echo "${mid_delete_assignees_json}" | jq -e --arg login "${_fresh_login}" '[.[].login] | index($login) != null' >/dev/null 2>&1; then
        # Already assigned — fresh assignment survives. Nothing to do.
        :
      else
        # Same-login fresh assignment was deleted by the stale DELETE.
        # Restore via targeted POST and verify.
        if restore_assignee_targeted "${issue_number}" "${_fresh_login}"; then
          echo "   Warning: Fresh assignment @${_fresh_login} was deleted by stale DELETE; restored and retaining marker for #${issue_number}" >&2
          _restored_any=1
        else
          echo "   Warning: Fresh assignment @${_fresh_login} restoration FAILED for #${issue_number}; marker retained" >&2
        fi
      fi
    done <<<"${_fresh_logins}"

    echo "   Warning: Fresh assignment detected after stale DELETE; retaining marker for #${issue_number}" >&2
    return 1
  fi

  # Pre-marker-delete reconciliation: re-read assignees + fresh timeline
  # immediately before label DELETE to detect races that landed between the
  # mid-assignee read and now. If a fresh assignment stint appeared, we must
  # preserve/restore it and retain the marker — fail this issue safely.
  local pre_label_assignees_json=""
  pre_label_assignees_json="$(get_issue_assignees_json "${issue_number}")" || {
    echo "   Warning: Pre-label-DELETE assignee read failed for #${issue_number}; retaining marker" >&2
    return 1
  }

  local pre_label_timeline_json=""
  pre_label_timeline_json="$(fetch_issue_timeline "${issue_number}")" || {
    echo "   Warning: Pre-label-DELETE timeline read failed for #${issue_number}; retaining marker" >&2
    return 1
  }

  local pre_label_timeline_length
  pre_label_timeline_length="$(echo "${pre_label_timeline_json}" | jq 'length')" || {
    echo "   Warning: Could not capture pre-label-DELETE timeline length for #${issue_number}" >&2
    return 1
  }

  if fresh_assignment_after_snapshot "${pre_label_timeline_json}" "${pre_delete_timeline_length}"; then
    local _pre_label_fresh_logins
    _pre_label_fresh_logins="$(fresh_assignment_logins_after_snapshot "${pre_label_timeline_json}" "${pre_delete_timeline_length}")" || true
    while IFS= read -r _fresh_login; do
      [[ -z "${_fresh_login}" ]] && continue
      if ! echo "${pre_label_assignees_json}" | jq -e --arg login "${_fresh_login}" '[.[].login] | index($login) != null' >/dev/null 2>&1; then
        restore_assignee_targeted "${issue_number}" "${_fresh_login}" || true
      fi
    done <<<"${_pre_label_fresh_logins}"
    echo "   Warning: Fresh assignment detected before label DELETE; retaining marker for #${issue_number}" >&2
    return 1
  fi

  # Remove auto-assigned label via targeted DELETE.
  if ! remove_label_targeted "${issue_number}" "${AUTO_ASSIGNED_LABEL}"; then
    echo "   Assignment removed for #${issue_number}, but label remains for retry" >&2
    return 1
  fi

  # Post-marker-delete compensation: re-read fresh timeline immediately
  # after label DELETE. A fresh assignment that landed during or immediately
  # after label DELETE must be compensated: restore the marker label so the
  # fresh assignment is tracked.
  local post_label_timeline_json=""
  post_label_timeline_json="$(fetch_issue_timeline "${issue_number}")" || {
    echo "   Warning: Post-label-DELETE timeline read failed for #${issue_number}; retaining marker" >&2
    return 1
  }

  if fresh_assignment_after_snapshot "${post_label_timeline_json}" "${pre_label_timeline_length}"; then
    # A fresh assignment appeared between pre-label-DELETE snapshot and now.
    # Restore the marker so the fresh assignment is tracked.
    if restore_label_targeted "${issue_number}"; then
      echo "   Warning: Fresh assignment detected after label DELETE; restored marker for #${issue_number}" >&2
    else
      echo "   Warning: Fresh assignment detected after label DELETE but marker restore FAILED for #${issue_number}" >&2
    fi
    return 1
  fi

  # Re-read and verify final state using exact jq index.
  local post_delete_assignees_json=""
  post_delete_assignees_json="$(get_issue_assignees_json "${issue_number}")" || {
    echo "   Warning: Post-delete verification read failed for #${issue_number}" >&2
    return 1
  }

  if echo "${post_delete_assignees_json}" | jq -e --arg login "${bot_login}" '[.[].login] | index($login) != null' >/dev/null 2>&1; then
    echo "   Warning: @${bot_login} still assigned after DELETE for #${issue_number}" >&2
    return 1
  fi

  # Verify co-assignees were preserved using exact jq index.
  local other_logins
  other_logins="$(echo "${pre_delete_assignees_json}" | jq -r --arg bot "${bot_login}" '[.[].login] | map(select(. != $bot)) | .[]' 2>/dev/null || true)"
  if [[ -n "${other_logins}" ]]; then
    while IFS= read -r co_login; do
      [[ -z "${co_login}" ]] && continue
      if ! echo "${post_delete_assignees_json}" | jq -e --arg login "${co_login}" '[.[].login] | index($login) != null' >/dev/null 2>&1; then
        echo "   Warning: Co-assignee @${co_login} was unexpectedly removed from #${issue_number}" >&2
        return 1
      fi
    done <<<"${other_logins}"
  fi

  retry_gh gh api --method POST "repos/${REPO}/issues/${issue_number}/comments" \
    -f body="⏱️ Automatically unassigned @${bot_login} from this issue.

This issue was auto-assigned via \`/assign\` more than **${STALE_DAYS} days** ago with no qualifying linked PR activity. Comment \`/assign\` again if you still plan to work on it (subject to eligibility and the 3-issue cap)." \
    --silent 2>/dev/null || true

  return 0
}

echo " Scanning open issues with label:${AUTO_ASSIGNED_LABEL}"

# Validate the canonical marker label definition before any discovery or
# mutation. A missing marker label means no automation-provenance issues can
# exist (discover_candidates would find none) — clean no-op. A conflicting
# definition or API error must fail closed with no mutation.
validate_marker_label || _marker_rc=$?
case ${_marker_rc:-0} in
  0) ;;  # correct definition — proceed
  1)
    echo "[OK] Marker label '${AUTO_ASSIGNED_LABEL}' is absent; nothing to clean"
    exit 0
    ;;
  2)
    echo "‼ Marker label '${AUTO_ASSIGNED_LABEL}' has a conflicting definition; aborting" >&2
    exit 1
    ;;
  *)
    echo "‼ Failed to validate marker label '${AUTO_ASSIGNED_LABEL}' (API error); aborting" >&2
    exit 1
    ;;
esac

THRESHOLD_ISO="$(threshold_iso)"
THRESHOLD_EPOCH="$(iso_to_epoch "${THRESHOLD_ISO}")"
echo "   Stale threshold: ${THRESHOLD_ISO} (epoch ${THRESHOLD_EPOCH})"

GLOBAL_FAIL=0

if ! CANDIDATES_RAW="$(discover_candidates)"; then
  echo "‼️ Candidate discovery failed" >&2
  exit 1
fi

if [[ -z "${CANDIDATES_RAW}" || "${CANDIDATES_RAW}" == $'\n' ]]; then
  echo "✅ No auto-assigned open issues found"
  exit 0
fi

CANDIDATES=()
while IFS= read -r _line; do
  [[ -n "${_line}" ]] && CANDIDATES+=("${_line}")
done <<<"${CANDIDATES_RAW}"

for row in "${CANDIDATES[@]}"; do
  [[ -z "${row}" ]] && continue
  issue_number="${row%%$'\t'*}"
  assignees_json="${row#*$'\t'}"

  if ! process_issue "${issue_number}" "${assignees_json}" "${THRESHOLD_EPOCH}"; then
    echo "   Warning: Error processing #${issue_number}; continuing" >&2
    GLOBAL_FAIL=1
  fi
done

if [[ "${GLOBAL_FAIL}" -ne 0 ]]; then
  echo "⚠️ Cleanup completed with errors (some issues preserved)" >&2
  exit 1
fi

echo "✅ Stale auto-assignment cleanup finished"
exit 0
