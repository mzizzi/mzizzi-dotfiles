---
name: fix-quality
description: "Review a change for reuse, simplification, proportionality, efficiency, altitude, and language, then apply the contained cleanups and defer the rest. Quality only, not correctness bugs. Use when the user wants a change tidied up before merging or asks what could be simplified."
argument-hint: "[--apply=none|all] [--plan <path to plan.md>] [local | pr | <pr-number-or-url>]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Agent, Skill, AskUserQuestion
disable-model-invocation: false
user-invocable: true
---

# Fix quality

Orchestrate a multi-angle quality review of a change, then act on what it finds: apply the contained cleanups, defer the invasive ones, and report both.

**You apply; the review agents don't.** The agents launched in step 4 are strictly read-only. Every change to the working tree happens in step 6, after step 5's filtering, and by you.

Steps 3 onward pass file paths to sub-agents. Resolve the absolute path of this skill's directory first (the directory holding this `SKILL.md`) and use it wherever `<skill-dir>` appears below — sub-agents can't find these files from a relative path.

## 1. Resolve the target and read its changes

Parse `--plan` and `--apply` out of the arguments first; the **target** is the bare value left over, and there may not be one. Resolve it, state what you resolved, then get the diff:

- _(omitted — default)_ or `local` — uncommitted changes (`git diff HEAD`) plus untracked files (`git ls-files --others --exclude-standard`); treat a new file's whole content as added.
- `pr` — the current branch's PR: `gh pr diff`. If there's no open PR or `gh` is unavailable, fall back to the branch's own changes (`git diff <base>...HEAD`, inferring the base from the upstream tracking branch or the repo's default branch) and say that's what you reviewed.
- a **PR number or URL** — that PR: `gh pr diff <number-or-url>`.

Unrecognized value → say so and fall back to local.

Use the three-dot form for branch diffs. Two dots drags in base-branch commits the author never wrote.

Uncommitted changes aren't part of a PR — leave them out of a PR-target review and note the exclusion in one line at the end. If the target has no changes, say so and stop rather than widening scope to find work.

**`--plan <path>`** is optional and independent of the target. Given one, step 2 reads it and step 7 writes deferred findings into it instead of leaving them in the report.

**`--apply=all`** makes step 6 apply the invasive proposals too, instead of deferring them.

**This is a read-only run** when either `--apply=none` was passed or the target is a PR you don't have checked out. Steps 6 and 7 are skipped: nothing is applied, nothing is written — including to `--plan` — and everything surviving step 5 is reported as deferred. Say once which condition applied.

Write the diff to a file in a temp directory outside the repo — never the working tree, where it would land in the very diff under review — and keep the path. Sub-agents read it there rather than receiving it through you.

On a PR target, then read its title and body (`gh pr view`) — they carry the intent behind the change.

## 2. Learn what's already been decided

Do this once, here — agents that each read the config files duplicate the work and can reach different conclusions about the same rule.

- **CLAUDE.md** — the user-level `~/.claude/CLAUDE.md`, the repo root, and any `CLAUDE.md` or `CLAUDE.local.md` in a directory that is an ancestor of a changed file. A directory's file governs only what sits at or below it.
- **Tooling** — linter, formatter, and type-checker configs, plus rules already disabled in the changed files. A rule the repo has turned off is a decision, not an oversight.
- **The surrounding code** — how neighbouring modules name things, structure errors, and organize helpers. Local idiom beats a general best practice you'd apply on a blank page.
- **The plan document, if `--plan` was given** — read it in full. It says what the change is for and why. Put that intent in the brief, so agents judge the code against what it was meant to do. It is background, not a list of things that cannot change.

Write this up as a short brief, in a file next to the diff, and keep the path — every agent reads it there. Quote rules rather than paraphrasing them, so an agent can cite one without re-reading the file. Open it with the diff's `--stat` summary. Keep the verification commands it turns up — step 6 runs them.

## 3. Size the change and pick the fan-out shape

Look at the file count and changed lines in the brief's stat summary.

Sharding stops an agent skimming a large diff once it has found a few examples, but it only works on angles whose findings are local to the files they're looking at:

- **Reuse, simplification, efficiency, language** shard cleanly. Split the changed files into groups small enough that one agent can read every file in its group _and_ the surrounding context carefully. Group by directory or module, so each agent sees related code together.
- **Proportionality shards too, but wants smaller groups.** It works unit by unit rather than scanning, so it costs more per file and degrades when overloaded — size its shards down. It anchors on production code and follows each unit out to its own tests, so don't try to group test files with their subjects; that happens inside the agent.
- **Altitude never shards.** Its strongest signal — the same special case appearing in several places — is invisible to an agent holding part of the diff. One agent, whole PR, always.
- **Organization never shards either.** It judges a file by its whole listing and a package by its whole directory, so a partial view hides the split or move it is looking for. One agent, whole PR, always.

Small changes need no sharding: one agent per angle. Say what shape you chose and why.

If the split would produce a lot of agents, prefer fewer, larger shards over exhaustive coverage at any cost — and say plainly in the report that shards were sized up.

## 4. Fan out

Launch every agent with the Agent tool at the `mzizzi:standard` tier, all in a single message and every one with `run_in_background: true`, so they run concurrently:

```
Agent(subagent_type: "mzizzi:standard", run_in_background: true, description: "reuse review",
      prompt: "<the prompt below>")
```

Never pass `run_in_background: false` here. Batching the calls into one message is not enough on its own — a single synchronous agent blocks the whole fan-out until it returns, and you don't need any agent's result before step 5.

Each agent reviews from exactly one angle, reading its file from `references/angles/`: `reuse.md`, `simplification.md`, `proportionality.md`, `efficiency.md`, `altitude.md`, `organization.md`, or `language.md`.

`idiomatic-python.md` is the one conditional angle: launch an agent on it only when the changed files are Python, and skip it entirely otherwise.

Unsharded, that's one agent per angle. A sharded angle gets one agent per shard, all reading the same angle file and differing only in scope — three shards of reuse means three agents on `reuse.md`.

Send each agent exactly this prompt, filling the bracketed slots and changing nothing else. It carries wiring only — which files to read, and the inputs; what to do with them lives entirely in those files:

```
Read <skill-dir>/references/reviewer.md and <skill-dir>/references/angles/<angle-file>, then
follow them.

The diff is in: <diff-path>

Your scope: <scope>

Repo conventions: <brief-path>
```

- `<skill-dir>` — the absolute path you resolved at the top of this file
- `<angle-file>` — the bare filename for this agent's angle, e.g. `reuse.md`
- `<diff-path>` — the diff file from step 1
- `<scope>` — `the whole change`, or the explicit list of files in this shard
- `<brief-path>` — the brief file from step 2

Launching returns as soon as the agents are running, so don't sit on the set — go to step 5 and work each report as it arrives.

## 5. Triage each report, then merge and rank

Do the per-report work as each result arrives; a loop that waits on the whole set is idle for the length of the slowest agent.

**As each report lands:**

- Read it and add its proposals to a running count of everything received — step 8 reconciles against that number.
- Judge each proposal on its own: what edit it would make, and whether it survives the drop criteria below. Understand it well enough to compare it against a proposal you haven't seen yet.
- Take the agent's coverage as given rather than auditing it. If one says outright that something stopped it covering its scope, send another agent at what's left the moment you read that, so it runs alongside the agents still going.

Drop any proposal that:

- would change observable behavior — everything downstream trades on this pass being behavior-preserving
- reaches well outside the diff
- trades clarity for brevity, or removes an abstraction that is organizing the code
- you judge to be a false positive

**Everything from here on waits for the last report — including step 6.** Two proposals can only be compared once both exist, and an edit applied while an agent is still reading can conflict with what it comes back with. The set you wait for includes any agent you sent at missed scope.

Merge every proposal and collapse duplicates. Two angles often reach the same problem from opposite directions and describe it in different words, so judge by what a proposal would actually change rather than how it's phrased, and keep the clearest framing. Sharded angles also produce near-identical proposals against parallel code in different files — merge those into one item listing every affected location.

**Merge only when two proposals would make the same edit _for the same reason_.** Two agents landing on the same lines from different premises are two findings, not one — the same edit that answers one can leave the other's problem standing. When you do merge, note which proposals went in; step 8 asks.

Rank what survives by payoff — how much duplication, waste, or future maintenance it removes — breaking ties toward the smaller, more contained edit. Rank across all angles together, not per angle.

A short list is a fine outcome: a few high-confidence items beat a long list of style preferences.

## 6. Apply what's contained

**Skip on a read-only run (`--apply=none`, or an unchecked-out PR target)**

Split the ranked list by the effort rating each proposal carries:

- **trivial** and **contained** — apply them now. Handing one back as a to-do costs the author more than making the edit did.
- **invasive** — first find the smallest edit that resolves the _problem_, which is often not the remedy the agent proposed. If that edit is contained, apply it. Defer only when the smallest edit still reaches well outside the diff or changes behavior, and record that smallest edit, not the agent's.
- **a judgment only the author can make** — ask with AskUserQuestion now, while the code is uncommitted and the author is reading. A plan choice that pins a placement or a test is this case, not a reason to defer.

Under `--apply=all`, apply the invasive ones too — it raises the size ceiling, never the bar.

When merged proposals offer variants of the same fix at different strengths, **apply the strongest and let verification arbitrate** — it runs at the end of this step regardless. Your own risk estimate is not the arbiter, and an agent that already verified the thing you're hedging against has done work you'd be discarding. Downgrading to the safer variant anyway is a step 8 disclosure, not a free call.

Apply the edits, then run the verification the step 2 brief turned up — typecheck, tests, lint, formatter. If something fails and the fix isn't immediately obvious, revert that proposal and move it to the deferred list with the failure noted.

## 7. Record what you deferred

**Skip on a read-only run (`--apply=none`, or an unchecked-out PR target)**

**Without `--plan`** — deferred proposals stay in the report below. Nothing is written anywhere.

**With `--plan <path>`** — hand the deferred proposals to the skill that owns the format:

    Skill(skill: "record-follow-ups", args: "<plan path> <the deferred proposals>")

Give it each proposal's `file:line`, what the issue costs today, why you deferred it rather than applying it, and the fix you'd propose. It shapes and places the entries, dedups against what the plan already carries, and reports back what it wrote.

## 8. Report

Open with the resolved target, the fan-out shape, and a one-line assessment: how much cleanup the change wanted, and what you did about it.

Every proposal the agents returned appears exactly once across the sections below — **Applied**, **Applied in weaker form**, **Deferred**, or **Considered and rejected**. Open by stating the count you received in step 5, so the four sections visibly reconcile against it. A proposal that reaches the author in none of these states is one you dropped without deciding to.

**Applied** — ranked, one line each: `file:line`, what changed, why it was worth doing. The diff carries the detail; don't restate it. Name the verification you ran and its result, quoting any failure.

**Applied in weaker form** — fires whenever the edit you made is not one the proposing agent would recognize as its proposal: a variant it rated trivial that you applied as something smaller, half of a two-part fix, or a merged item where only one input's problem actually got solved. One line each: what was proposed, what you applied instead, and why — the same justification a rejection owes. If you merged proposals in step 5, name which ones merged and confirm the applied edit answers each of them; a merge that answers only one belongs here rather than under **Applied**.

**Deferred** — ranked, with enough for the author to act without re-deriving anything:

- **`file:line` — one-line summary of the change**
  - _Why:_ what it costs today — the convention it breaks (quote it), the complexity it adds, the work it wastes, or the readability it loses.
  - _Proposed change:_ a before/after snippet, or a precise description when it's too large to quote.
  - _Behavior:_ confirm it preserves behavior, and name anything worth double-checking.
  - _Effort:_ contained / invasive, and why it was deferred rather than applied.

If something was deferred because it broke verification, say that rather than filing it as a size call.

Close with **Considered and rejected** — what the agents spotted but you dropped in step 5, one line each with the reason.

Write for someone who knows this code better than you and chose the current form on purpose until shown otherwise. If the change is already clean, say so and stop; an empty result is a real one.

With `--plan`, close by naming the plan file and the follow-up titles `record-follow-ups` reported writing — or, on a read-only run, that the plan was left untouched.
