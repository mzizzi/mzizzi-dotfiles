#!/usr/bin/env python3
"""UserPromptSubmit hook: load the deferred LSP tool so it can compete with grep.

LSP ships deferred — a bare name in the tool list, no schema, not callable until
something runs ToolSearch("select:LSP"). That step almost never happens on its own, so
lexical search wins by default even where a resolved reference is what the task needs.

Two earlier designs failed, both worth not repeating. `SessionStart` +
`initialUserMessage` works only in headless sessions: interactive ones run the hook, take
the payload, and drop it, because the REPL reads that value during bootstrap without
waiting for the hook to finish. `SessionStart` + `additionalContext` does land in both
modes, but measured 0 for 3 on a question that wanted symbol resolution — session context
is skimmed, which is the same reason a rules file didn't work either. Delivery has to be
on the prompt turn, so this is the event, cost and all.

That cost is a ~30 ms interpreter start on every prompt (hence `-S -E` in hooks.json). The
marker file keeps it to one injection per session; every later prompt pays only the start
and exits silently. The message lives in load-lsp-prompt.md because it is prose.
"""

import json
import os
import sys
from pathlib import Path

session_id = json.load(sys.stdin)["session_id"]
marker = Path(os.environ["CLAUDE_PLUGIN_DATA"]) / f"lsp-loaded-{session_id}"
if marker.exists():
    sys.exit(0)
marker.touch()

prompt = Path(__file__).with_name("load-lsp-prompt.md").read_text(encoding="utf-8").strip()

payload = {
    "hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": prompt,
    }
}

print(json.dumps(payload))
