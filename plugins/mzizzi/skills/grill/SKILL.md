---
name: grill
description: Interview the user relentlessly about a plan, design, or idea. Use when the user wants to stress-test a plan, design, or concept before building, or uses any 'grill' trigger phrases.
disable-model-invocation: false
user-invocable: true
---

Interview me relentlessly about every aspect of the idea, design, or plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. Every single question should use the AskUserQuestion tool to gather responses.

- Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.
- Explore the codebase in search of an answer to the question you're asking. Provide a recommendation to each question based on your findings. Research means checking, not recalling — verify any fact that would flip the recommendation by reading the code or running a local command; researching outside the codebase (web fetches, vendor docs) requires explicit user approval via AskUserQuestion. Label the rationale's facts **checked** or **not checked**, so a belief never presents as a finding.
- If the answer to a question turns out to be trivially simple, then document your suggestion and move on to the next question.
- Consider the potential 2nd and 3rd order effect of the proposed change or idea in addition to the immediate ask.
- Provide a recommended answer to the question along with a short rationale. Your recommendation should be thoroughly researched and vetted. Read `${CLAUDE_PLUGIN_ROOT}/skills/grill/references/recommendation-guidelines.md` once at the start of the interview and form every recommendation against it.
- Surface the recommendation _through_ the AskUserQuestion tool, since that tool has no dedicated recommendation field: make the recommended option the **first** option in the list and append **"(Recommended)"** to its `label`. Put the rationale in that option's `description`. You may also state the recommendation and rationale in a short preamble line before the tool call.
- Every option slot holds a real answer — AskUserQuestion caps options at 4 and adds "Other" itself, so don't add meta-options like defer or explain to the list.
