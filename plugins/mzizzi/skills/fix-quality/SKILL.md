---
name: fix-quality
description: Review a change for reuse, simplification, proportionality, efficiency, altitude, and language, then apply the cleanups that are contained and defer the rest. Reviews the current branch's PR by default; pass a PR number/URL to target another, or "local" for the working tree. Pass a plan file and deferred findings are written into its Follow-ups section; pass --dry-run to review and report without changing anything. Quality only, not correctness bugs. Use this whenever the user wants a change cleaned up before merging, asks what could be simplified, or says things like "tidy this up", "what would you simplify here", or "clean up this PR".
argument-hint: "[<pr-number-or-url> | local] [--plan <path to plan.md>] [--dry-run]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Agent, Skill
disable-model-invocation: false
user-invocable: true
---

# Fix quality

Orchestrate a multi-angle quality review of a change, then act on what it finds: apply the contained cleanups, defer the invasive ones, and report both. Quality only — correctness bugs belong to `/mzizzi:fix-correctness`, comment quality to `/mzizzi:fix-comments`. Work the steps in order.

**You apply; the review agents don't.** The agents launched in step 4 are strictly read-only. Step 5 drops proposals that are duplicated, out of scope, or wrong, and an edit made by an agent is an edit that skipped that filter. Every change to the working tree happens in step 6, after the filtering, and by you.

Steps 3 onward pass file paths to sub-agents. Resolve the absolute path of this skill's directory first (the directory holding this `SKILL.md`) and use it wherever `<skill-dir>` appears below — sub-agents can't find these files from a relative path.

## 1. Resolve the target and read its changes

Parse `--plan` and `--dry-run` out of the arguments first; the **target** is the bare value left over, and there may not be one. Resolve it, state what you resolved, then get the diff:

- _(omitted — default)_ — the current branch's PR: `gh pr diff`. If there's no open PR or `gh` is unavailable, fall back to the branch's own changes (`git diff <base>...HEAD`, inferring the base from the upstream tracking branch or the repo's default branch) and say that's what you reviewed.
- a **PR number or URL** — that PR: `gh pr diff <number-or-url>`.
- `local` — uncommitted changes (`git diff HEAD`) plus untracked files (`git ls-files --others --exclude-standard`); treat a new file's whole content as added.

Use the three-dot form for branch diffs. Two dots drags in base-branch commits the author never wrote, producing proposals against code they did not write.

Uncommitted changes aren't part of a PR — leave them out of a PR-target review and note the exclusion in one line at the end, so the author knows the report may not match their working tree. If the target has no changes, say so and stop rather than widening scope to find work.

**`--plan <path>`** is optional and independent of the target. Given one, step 2 reads it and step 7 writes deferred findings into it instead of leaving them in the report.

**`--dry-run`** is optional: review and report, change nothing. Steps 6 and 7 are skipped, so nothing is applied and nothing is written — including to `--plan`, if both were passed.

**Whether you can apply anything depends on the target.** `local`, or a PR that is this branch, means the code is in front of you and step 6 runs. A PR you don't have checked out means there's nothing to edit — skip step 6, say so once, and report every surviving proposal instead.

Keep the exact command that produced the diff. Sub-agents re-run it themselves rather than receiving the diff through you, which keeps your context free and guarantees all of them see the same bytes.

Then read the PR title and body (`gh pr view`) — they carry the intent behind the change, which is what separates a deliberate choice from an accident.

## 2. Learn what's already been decided

Do this once, here. Every agent independently reading the same config files wastes tokens, and they can reach different conclusions about the same rule.

- **CLAUDE.md** — the user-level `~/.claude/CLAUDE.md`, the repo root, and any `CLAUDE.md` or `CLAUDE.local.md` in a directory that is an ancestor of a changed file. A directory's file governs only what sits at or below it.
- **Tooling** — linter, formatter, and type-checker configs, plus rules already disabled in the changed files. A rule the repo has turned off is a decision, not an oversight.
- **The surrounding code** — how neighbouring modules name things, structure errors, and organize helpers. Local idiom beats a general best practice you'd apply on a blank page.
- **The plan document, if `--plan` was given** — read it in full. It carries the intent behind the change and the design decisions taken before the code existed. A design the plan chose on purpose is not an accident, and an agent that hasn't read it can't tell the difference. Carry the decisions that bear on the changed files into the brief; leave the rest out.

Write this up as a short brief you can hand to every agent verbatim. Quote rules rather than paraphrasing them, so an agent can cite one without re-reading the file. Keep the verification commands it turns up — step 6 runs them.

## 3. Size the change and pick the fan-out shape

Run the diff command with `--stat` and look at file count and changed lines.

A single agent asked to scan a large diff for one pattern will find a few examples early and skim the rest, and that result is indistinguishable from a change that only had a few problems. Sharding is how you stop that, but it only works on angles whose findings are local to the files they're looking at:

- **Reuse, simplification, efficiency, language** shard cleanly. Split the changed files into groups small enough that one agent can read every file in its group _and_ the surrounding context carefully. Group by directory or module so each agent sees related code together; scattered files make reuse scanning much weaker.
- **Proportionality shards too, but wants smaller groups.** It works unit by unit rather than scanning, so it costs more per file than the scanning angles and degrades when overloaded. Size its shards down accordingly. It anchors on production code and follows each unit out to its own tests, so don't try to group test files with their subjects — that happens inside the agent.
- **Altitude never shards.** It's about how the whole change sits in the system, and its strongest signal — the same special case appearing in several places — is invisible to an agent holding part of the diff. One agent, whole PR, always.

Small changes need no sharding: one agent per angle. Say what shape you chose and why, so a reader knows how much coverage stands behind the report.

If the split would produce a lot of agents, prefer fewer, larger shards over exhaustive coverage at any cost — and say plainly in the report that shards were sized up, rather than letting the number imply more thoroughness than there was.

## 4. Fan out

Launch every agent with the Agent tool at the `mzizzi:standard` tier, all in a single message so they run concurrently.

Each agent reviews from exactly one angle, reading its file from `references/angles/`: `reuse.md`, `simplification.md`, `proportionality.md`, `efficiency.md`, `altitude.md`, or `language.md`.

Unsharded, that's one agent per angle. A sharded angle gets one agent per shard, all reading the same angle file and differing only in scope — three shards of reuse means three agents on `reuse.md`.

Send each agent exactly this prompt, filling the bracketed slots and changing nothing else. It carries wiring only — which files to read, and the inputs. What to do with them lives entirely in those files, which is what keeps it identical between runs; anything you add here is drift:

```
Read <skill-dir>/references/reviewer.md and <skill-dir>/references/angles/<angle-file>, then
follow them.

Get the diff by running: <diff-command>

Your scope: <scope>

Repo conventions:
<conventions-brief>
```

- `<skill-dir>` — the absolute path you resolved at the top of this file
- `<angle-file>` — the bare filename for this agent's angle, e.g. `reuse.md`
- `<diff-command>` — the exact command from step 1, unmodified, so every agent sees the same bytes
- `<scope>` — `the whole change`, or the explicit list of files in this shard
- `<conventions-brief>` — the brief from step 2, pasted in full rather than summarized

## 5. Dedup, filter, and rank

Agents work their assigned files systematically and report only what they found — take their coverage as given rather than auditing it. If one says outright that something stopped it covering its scope, send another agent at what's left before continuing.

Count the proposals you received before merging anything, and keep that number — step 8 reconciles against it.

Merge every proposal and collapse duplicates. Two angles often reach the same problem from opposite directions and describe it in different words, so judge by what a proposal would actually change rather than how it's phrased, and keep the clearest framing. Sharded angles also produce near-identical proposals against parallel code in different files — merge those into one item listing every affected location.

**Merge only when two proposals would make the same edit _for the same reason_.** Two agents landing on the same lines from different premises are two findings, not one — the same edit that answers one can leave the other's problem standing, and merging them lets the weaker fix report as if it covered both. When you do merge, note which proposals went in; step 8 asks.

Drop any proposal that:

- would change observable behavior — everything downstream trades on this pass being behavior-preserving
- reaches well outside the diff
- trades clarity for brevity, or removes an abstraction that is organizing the code
- you judge to be a false positive

Rank what survives by payoff — how much duplication, waste, or future maintenance it removes — breaking ties toward the smaller, more contained edit. Rank across all angles together; which agent found something is an implementation detail the author doesn't care about.

A short list is a fine outcome: a few high-confidence items beat a long list of style preferences.

## 6. Apply what's contained

**Skip this step under `--dry-run`, or when the target is a PR you don't have checked out.** Either way nothing gets applied and everything that survived step 5 goes to the report as deferred.

Split the ranked list by the effort rating each proposal carries:

- **trivial** and **contained** — apply them now. Their whole value is that they're cheap; handing one back as a to-do costs the author more than making the edit did.
- **invasive** — defer. So does anything touching call sites well outside the diff, anything you're less than confident preserves behavior, and anything that's genuinely a judgment the author should own rather than a size call.

When merged proposals offer variants of the same fix at different strengths, **apply the strongest and let verification arbitrate** — it runs at the end of this step regardless, so a variant that doesn't hold up surfaces immediately. Your own risk estimate is not the arbiter, and an agent that already verified the thing you're hedging against (a runtime version, an API's availability, a behavior it traced case by case) has done work you'd be discarding. Downgrading to the safer variant anyway is a step 8 disclosure, not a free call.

Apply the edits, then run the verification the step 2 brief turned up — typecheck, tests, lint, formatter. A behavior-preserving cleanup that broke something has to surface here, not in the author's next run. If something fails and the fix isn't immediately obvious, revert that proposal and move it to the deferred list with the failure noted.

## 7. Record what you deferred

**Skip this step under `--dry-run`** — a dry run writes nothing, `--plan` or not. Say in the report that the plan was left untouched, so nobody goes looking for entries that aren't there.

**Without `--plan`** — deferred proposals stay in the report below. Nothing is written anywhere.

**With `--plan <path>`** — hand the deferred proposals to the skill that owns the format:

    Skill(skill: "record-follow-ups", args: "<plan path> <the deferred proposals>")

Give it each proposal's `file:line`, what the issue costs today, why you deferred it rather than applying it, and the fix you'd propose. It shapes and places the entries, dedups against what the plan already carries, and reports back what it wrote. That plan file is the only thing outside the change itself this pass writes.

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

Close with **Considered and rejected** — what the agents spotted but you dropped in step 5, one line each with the reason. Without it, a dropped proposal is indistinguishable from one nobody found.

Write for someone who knows this code better than you and chose the current form on purpose until shown otherwise. If the change is already clean, say so and stop — an empty result is a real one, and padding it to look thorough is how these reports stop getting read.

With `--plan`, close by naming the plan file and the follow-up titles `record-follow-ups` reported writing, so the author sees what landed there without opening it.
