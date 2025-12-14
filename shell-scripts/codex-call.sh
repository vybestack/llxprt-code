#!/bin/bash
# codex-call.sh - Make a Codex-compatible Responses API call
# This is a toy/test script to validate the API request requirements
#
# Usage: ./codex-call.sh "write me a haiku"
#
# Prerequisites: curl, jq (optional, for pretty-printing)

set -e

# ============================================================================
# Configuration
# ============================================================================
# CRITICAL: Codex uses ChatGPT backend, NOT OpenAI Platform API
# Discovered via RUST_LOG=debug codex exec
API_BASE="https://chatgpt.com/backend-api/codex"
RESPONSES_ENDPOINT="${API_BASE}/responses"
MODEL="gpt-5.2"  # From Codex debug output: model=gpt-5.2
ORIGINATOR="codex_cli_rs"

AUTH_DIR="${HOME}/.llxprt/codex-auth"
AUTH_FILE="${AUTH_DIR}/auth.json"

# Codex's auth file location
CODEX_AUTH_FILE="${HOME}/.codex/auth.json"

# Load the prompt from tmp/codex
CODEX_REPO_DIR="$(dirname "$0")/../tmp/codex"

# ============================================================================
# Helper functions
# ============================================================================

generate_uuid() {
    python3 -c "import uuid; print(str(uuid.uuid4()))"
}

get_user_agent() {
    local version="0.1.0-llxprt-test"
    local os_info arch
    os_info=$(uname -s)
    arch=$(uname -m)
    echo "${ORIGINATOR}/${version} (${os_info}; ${arch})"
}

# ============================================================================
# Load auth tokens
# ============================================================================

# First try Codex's own auth file, then fall back to our auth file
if [[ -f "${CODEX_AUTH_FILE}" ]]; then
    echo "Loading auth from Codex's auth file: ${CODEX_AUTH_FILE}"
    AUTH_SOURCE="${CODEX_AUTH_FILE}"
    ACCESS_TOKEN=$(python3 -c "import sys, json; d=json.load(open('${CODEX_AUTH_FILE}')); print(d.get('tokens', {}).get('access_token', ''))")
    ACCOUNT_ID=$(python3 -c "import sys, json; d=json.load(open('${CODEX_AUTH_FILE}')); print(d.get('tokens', {}).get('account_id', ''))")
elif [[ -f "${AUTH_FILE}" ]]; then
    echo "Loading auth from ${AUTH_FILE}..."
    AUTH_SOURCE="${AUTH_FILE}"
    ACCESS_TOKEN=$(python3 -c "import sys, json; print(json.load(open('${AUTH_FILE}')).get('access_token', ''))")
    ACCOUNT_ID=$(python3 -c "import sys, json; print(json.load(open('${AUTH_FILE}')).get('account_id', ''))")
else
    echo "ERROR: No auth file found."
    echo "Either run 'codex auth login' or run codex-oauth.sh first."
    exit 1
fi

if [[ -z "${ACCESS_TOKEN}" ]]; then
    echo "ERROR: No access_token found in ${AUTH_SOURCE}"
    exit 1
fi

if [[ -z "${ACCOUNT_ID}" ]]; then
    echo "ERROR: No account_id found in ${AUTH_SOURCE}"
    echo "The ChatGPT-Account-ID header is required for the ChatGPT backend."
    exit 1
fi

AUTH_TOKEN="${ACCESS_TOKEN}"
echo "Using access_token from ${AUTH_SOURCE}"
echo "Account ID: ${ACCOUNT_ID}"

# ============================================================================
# Load the Codex system prompt
# ============================================================================

PROMPT_FILE="${CODEX_REPO_DIR}/codex-rs/core/prompt.md"
if [[ ! -f "${PROMPT_FILE}" ]]; then
    echo "ERROR: Codex prompt not found at ${PROMPT_FILE}"
    echo "Please ensure tmp/codex is cloned."
    exit 1
fi

echo "Loading system prompt from ${PROMPT_FILE}..."

# ============================================================================
# Build the tool schema (Codex-compatible)
# ============================================================================

# This is the minimal Codex tool set for testing
# Based on codex-rs/core/src/tools/spec.rs
read -r -d '' TOOLS_JSON << 'EOF' || true
[
    {
        "type": "function",
        "name": "shell_command",
        "description": "Runs a shell command and returns its output.\n- Always set the `workdir` param when using the shell_command function. Do not use `cd` unless absolutely necessary.",
        "strict": false,
        "parameters": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell script to execute in the user's default shell"
                },
                "workdir": {
                    "type": "string",
                    "description": "The working directory to execute the command in"
                },
                "login": {
                    "type": "boolean",
                    "description": "Whether to run the shell with login shell semantics. Defaults to false unless a shell snapshot is available."
                },
                "timeout_ms": {
                    "type": "number",
                    "description": "The timeout for the command in milliseconds"
                },
                "sandbox_permissions": {
                    "type": "string",
                    "description": "Sandbox permissions for the command. Set to \"require_escalated\" to request running without sandbox restrictions; defaults to \"use_default\"."
                },
                "justification": {
                    "type": "string",
                    "description": "Only set if sandbox_permissions is \"require_escalated\". 1-sentence explanation of why we want to run this command."
                }
            },
            "required": ["command"],
            "additionalProperties": false
        }
    },
    {
        "type": "function",
        "name": "update_plan",
        "description": "Create or update a plan with steps and their statuses.",
        "strict": false,
        "parameters": {
            "type": "object",
            "properties": {
                "plan": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "step": {
                                "type": "string"
                            },
                            "status": {
                                "type": "string"
                            }
                        }
                    },
                    "description": "List of plan steps with their statuses"
                },
                "explanation": {
                    "type": "string",
                    "description": "Optional explanation for plan changes"
                }
            },
            "required": ["plan"],
            "additionalProperties": false
        }
    },
    {
        "type": "function",
        "name": "list_mcp_resources",
        "description": "Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible.",
        "strict": false,
        "parameters": {
            "type": "object",
            "properties": {
                "server": {
                    "type": "string",
                    "description": "Optional MCP server name. When omitted, lists resources from every configured server."
                },
                "cursor": {
                    "type": "string",
                    "description": "Opaque cursor returned by a previous list_mcp_resources call for the same server."
                }
            },
            "additionalProperties": false
        }
    },
    {
        "type": "function",
        "name": "list_mcp_resource_templates",
        "description": "Lists resource templates provided by MCP servers.",
        "strict": false,
        "parameters": {
            "type": "object",
            "properties": {
                "server": {
                    "type": "string",
                    "description": "Optional MCP server name."
                },
                "cursor": {
                    "type": "string",
                    "description": "Opaque cursor returned by a previous call."
                }
            },
            "additionalProperties": false
        }
    },
    {
        "type": "function",
        "name": "read_mcp_resource",
        "description": "Read a specific resource from an MCP server given the server name and resource URI.",
        "strict": false,
        "parameters": {
            "type": "object",
            "properties": {
                "server": {
                    "type": "string",
                    "description": "MCP server name exactly as configured."
                },
                "uri": {
                    "type": "string",
                    "description": "Resource URI to read."
                }
            },
            "required": ["server", "uri"],
            "additionalProperties": false
        }
    },
    {
        "type": "function",
        "name": "view_image",
        "description": "Attach a local image (by filesystem path) to the conversation context for this turn.",
        "strict": false,
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Local filesystem path to an image file"
                }
            },
            "required": ["path"],
            "additionalProperties": false
        }
    }
]
EOF

# Save tools to temp file for proper JSON handling
TOOLS_TEMP_FILE="${AUTH_DIR}/tools_temp.json"
echo "${TOOLS_JSON}" > "${TOOLS_TEMP_FILE}"

# ============================================================================
# Build the request
# ============================================================================

USER_PROMPT="${1:-write me a haiku about coding}"
CONVERSATION_ID=$(generate_uuid)
SESSION_ID=$(generate_uuid)
USER_AGENT=$(get_user_agent)

echo ""
echo "=== Codex API Request ==="
echo "  Model: ${MODEL}"
echo "  Conversation ID: ${CONVERSATION_ID}"
echo "  Session ID: ${SESSION_ID}"
echo "  User Agent: ${USER_AGENT}"
echo "  Prompt: ${USER_PROMPT}"
echo ""

# Build the request body using Python for proper JSON handling
REQUEST_BODY=$(python3 << PYEOF
import json
import sys

# Load system prompt from file
with open("${PROMPT_FILE}", "r") as f:
    system_prompt = f.read()

# Load tools from temp file
with open("${TOOLS_TEMP_FILE}", "r") as f:
    tools = json.load(f)

# Add apply_patch tool
apply_patch_tool = {
    "type": "function",
    "name": "apply_patch",
    "description": "Use the apply_patch tool to edit files. Your patch language is a stripped-down, file-oriented diff format.",
    "strict": False,
    "parameters": {
        "type": "object",
        "properties": {
            "input": {
                "type": "string",
                "description": "The entire contents of the apply_patch command"
            }
        },
        "required": ["input"],
        "additionalProperties": False
    }
}
tools.append(apply_patch_tool)

# CRITICAL: ChatGPT backend validates instructions - DO NOT MODIFY prompt.md content
# Environment context should go in input messages, not instructions
full_instructions = system_prompt

request = {
    "model": "${MODEL}",
    "instructions": full_instructions,
    "input": [
        {
            "type": "message",
            "role": "user",
            "content": "${USER_PROMPT}"
        }
    ],
    "tools": tools,
    "stream": True,
    "store": False,  # CRITICAL: Required by ChatGPT backend
    "parallel_tool_calls": False
}

print(json.dumps(request))
PYEOF
)

# Save request for debugging
echo "${REQUEST_BODY}" > "${AUTH_DIR}/last_request.json"
echo "Request saved to ${AUTH_DIR}/last_request.json"

# ============================================================================
# Make the API call
# ============================================================================

echo ""
echo "Making API call to ${RESPONSES_ENDPOINT}..."
echo ""
echo "--- Response Stream ---"

# Make the streaming request
# CRITICAL: ChatGPT backend requires ChatGPT-Account-ID header
curl -sS -X POST "${RESPONSES_ENDPOINT}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -H "ChatGPT-Account-ID: ${ACCOUNT_ID}" \
    -H "User-Agent: ${USER_AGENT}" \
    -H "originator: ${ORIGINATOR}" \
    -H "Accept: text/event-stream" \
    -H "x-openai-conversation-id: ${CONVERSATION_ID}" \
    -H "x-openai-session-id: ${SESSION_ID}" \
    -d "${REQUEST_BODY}" \
    2>&1 | while IFS= read -r line; do
        # Parse SSE events
        if [[ "${line}" == data:* ]]; then
            data="${line#data: }"
            if [[ "${data}" != "[DONE]" ]] && [[ -n "${data}" ]]; then
                # Try to extract and display text content
                event_type=$(echo "${data}" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('type', ''))" 2>/dev/null || echo "")

                case "${event_type}" in
                    "response.created")
                        echo "[Response created]"
                        ;;
                    "response.output_item.added")
                        item_type=$(echo "${data}" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('item', {}).get('type', ''))" 2>/dev/null || echo "")
                        echo "[Output item: ${item_type}]"
                        ;;
                    "response.output_text.delta")
                        delta=$(echo "${data}" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('delta', ''), end='')" 2>/dev/null || echo "")
                        printf "%s" "${delta}"
                        ;;
                    "response.output_text.done")
                        echo ""
                        ;;
                    "response.function_call_arguments.delta")
                        # Tool call in progress
                        ;;
                    "response.function_call_arguments.done")
                        func_name=$(echo "${data}" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('name', ''))" 2>/dev/null || echo "")
                        echo "[Tool call: ${func_name}]"
                        ;;
                    "response.completed")
                        echo ""
                        echo "[Response completed]"
                        # Extract usage info
                        usage=$(echo "${data}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
usage = d.get('response', {}).get('usage', {})
print(f\"Tokens - Input: {usage.get('input_tokens', 'N/A')}, Output: {usage.get('output_tokens', 'N/A')}\")
" 2>/dev/null || echo "")
                        echo "${usage}"
                        ;;
                    "error")
                        error_msg=$(echo "${data}" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('error', {}).get('message', 'Unknown error'))" 2>/dev/null || echo "Unknown error")
                        echo ""
                        echo "ERROR: ${error_msg}"
                        ;;
                    *)
                        # Other events - log for debugging
                        if [[ -n "${event_type}" ]]; then
                            : # echo "[Event: ${event_type}]"
                        fi
                        ;;
                esac
            fi
        elif [[ "${line}" == event:* ]]; then
            : # Ignore event type lines (we parse from data)
        fi
    done

echo ""
echo "--- End Response ---"
echo ""
echo "=== Request Complete ==="
