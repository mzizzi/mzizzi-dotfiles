#!/usr/bin/env python3
"""PreToolUse hook: give every spawned subagent the same LSP guidance the main session gets.

`UserPromptSubmit` fires only on a real user turn, so the sibling `load_lsp.py` injection
never reaches a subagent. That leaves `Explore` and `general-purpose` -- the two doing most
of the code navigation -- running at the untreated baseline, and their answers come back as
conclusions, so a wrong binding from a name match arrives without the evidence to catch it.

Hooking the spawn covers every agent type, built-ins included, from one copy of the wording.
Editing the agent definitions instead would reach only the ones we ship.

`PreToolUse` accepts `updatedInput`, so this rewrites `prompt` in place and returns no
permission decision, leaving the normal flow alone.
"""

import json
import sys
from pathlib import Path

tool_input = json.load(sys.stdin)["tool_input"]
guidance = Path(__file__).with_name("load-lsp-prompt.md").read_text(encoding="utf-8").strip()

payload = {
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "updatedInput": {**tool_input, "prompt": f"{guidance}\n\n{tool_input['prompt']}"},
    }
}

print(json.dumps(payload))
