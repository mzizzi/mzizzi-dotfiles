#!/usr/bin/env python3
"""SessionStart hook: load the deferred LSP tool so it can compete with grep.

LSP ships deferred — a bare name in the tool list, no schema, not callable until
something runs ToolSearch("select:LSP"). That step almost never happens on its own, so
lexical search wins by default even where a resolved reference is what the task needs.

`initialUserMessage` is what makes this work where a rules file didn't: Claude sees it as
if the user typed it, so loading LSP is a turn it has to take rather than advice it can
skim past. The message lives in load-lsp-prompt.md because it is prose.
"""

import json
from pathlib import Path

prompt = Path(__file__).with_name("load-lsp-prompt.md").read_text(encoding="utf-8").strip()

payload = {
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "initialUserMessage": prompt,
    }
}

print(json.dumps(payload))
