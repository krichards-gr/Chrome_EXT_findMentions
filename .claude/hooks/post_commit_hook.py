#!/usr/bin/env python3
"""
PostToolUse hook for the Bash tool.

Fires after every Bash tool call. When it detects a successful git commit
(and the commit is not itself an auto-generated writeup commit), it outputs
an instruction that Claude Code injects back into the conversation, prompting
Claude to run the explain-diff skill and save the result to writeups/.
"""

import json
import re
import subprocess
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

if data.get("tool_name") != "Bash":
    sys.exit(0)

tool_result = data.get("tool_result") or data.get("tool_response") or {}
if tool_result.get("is_error") or tool_result.get("error"):
    sys.exit(0)

tool_input = data.get("tool_input") or data.get("input") or {}
command = tool_input.get("command", "")

if not re.search(r"\bgit commit\b", command):
    sys.exit(0)

# Prevent infinite recursion: skip writeup commits
skip_markers = ["[auto]", "[skip]", "[skip-explain]", "[setup]"]
if any(m in command for m in skip_markers):
    sys.exit(0)

try:
    full_hash = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    short_hash = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
except Exception:
    sys.exit(0)

print(
    f"Post-commit hook: commit {short_hash} ({full_hash}) just landed. "
    f"Invoke the explain-diff skill now for this commit. "
    f"Use `git show {full_hash}` to get the diff. "
    f"Save the final HTML to writeups/{full_hash}.html in the repository, "
    f"then stage and commit it with the message 'docs(writeup): {short_hash} [auto]'."
)
