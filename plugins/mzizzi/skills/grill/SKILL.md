---
name: grill
description: Interview the user relentlessly about a plan, design, or idea. Use when the user wants to stress-test a plan, design, or concept before building, or uses any 'grill' trigger phrases.
disable-model-invocation: false
user-invocable: true
---

Interview me relentlessly about every aspect of the idea, design, or plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. Every single question should use the AskUserQuestion tool to gather responses.

Read `${CLAUDE_PLUGIN_ROOT}/skills/grill/references/recommendation-guidelines.md` once at the start of the interview. It governs which forks deserve a question, how to author the options, and what a recommendation has to be built on — hold every question and recommendation below to it.

- Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.
- Only ask about a fork with a **user-observable** difference. Decide code-shape and code-placement forks yourself, in a sentence with its reason, and move to the next real branch.
- Explore the codebase in search of an answer to the question you're asking, and provide a recommended answer with a short rationale based on what you find.
- If the answer to a question turns out to be trivially simple, then document your suggestion and move on to the next question.
- Don't push for a decision whose deciding facts are still unknown — final form, language, framework, where code lives. Name the specific fact that would settle it, ask instead what the investigation should capture, and record the deferral as an explicit decision with its rationale rather than leaving it silent.
- Surface the recommendation _through_ the AskUserQuestion tool, since that tool has no dedicated recommendation field: make the recommended option the **first** option in the list and append **"(Recommended)"** to its `label`. Put the rationale in that option's `description`. You may also state the recommendation and rationale in a short preamble line before the tool call.
