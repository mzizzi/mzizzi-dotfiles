---
name: propose-simplifications
description: Review a PR's changes for reuse, simplification, efficiency, and altitude, then report ranked proposals with rationale — never editing the code. Reviews the current branch's PR by default; pass a PR number/URL to target another, or "local" for the working tree. Quality only, not correctness bugs. Use this whenever the user wants to know what could be simplified or cleaned up before merging, asks for simplification feedback, or wants proposed changes rather than applied ones — including phrasings like "what would you simplify here", "review this PR for cleanup", or "tell me what to change, don't change it".
argument-hint: "[<pr-number-or-url> | local]"
---

# Propose simplifications

Orchestrate a four-angle quality review of a change and report ranked proposals. Quality only — correctness bugs belong to `/code-review`, comment quality to `/review-comments`. Work the steps in order.

**Produce a proposal, not a commit.** Nothing in this skill edits files, and neither do the agents it launches. The report is the whole deliverable — a one-character fix still gets proposed, not made. That's what makes this safe to run on someone else's PR, and what keeps the author the one deciding.

Steps 3 onward pass file paths to sub-agents. Resolve the absolute path of this skill's directory first (the directory holding this `SKILL.md`) and use it wherever `<skill-dir>` appears below — sub-agents can't find these files from a relative path.

## 1. Resolve the target and read its changes

The **target** is the argument. Resolve it, state what you resolved, then get the diff:

- _(omitted — default)_ — the current branch's PR: `gh pr diff`. If there's no open PR or `gh` is unavailable, fall back to the branch's own changes (`git diff <base>...HEAD`, inferring the base from the upstream tracking branch or the repo's default branch) and say that's what you reviewed.
- a **PR number or URL** — that PR: `gh pr diff <number-or-url>`.
- `local` — uncommitted changes (`git diff HEAD`) plus untracked files (`git ls-files --others --exclude-standard`); treat a new file's whole content as added.

Use the three-dot form for branch diffs. Two dots drags in base-branch commits the author never wrote, and proposals against someone else's code are the fastest way to lose their attention.

Uncommitted changes aren't part of a PR — leave them out of a PR-target review and note the exclusion in one line at the end, so the author knows the report may not match their working tree. If the target has no changes, say so and stop rather than widening scope to find work.

Keep the exact command that produced the diff. Sub-agents re-run it themselves rather than receiving the diff through you, which keeps your context free and guarantees all of them see the same bytes.

Then read the PR title and body (`gh pr view`) — they carry the intent behind the change, which is what separates a deliberate choice from an accident.

## 2. Learn what this repo already decided

Do this once, here. Four agents independently reading the same config files wastes tokens and can reach different conclusions about the same rule.

- **CLAUDE.md** — the user-level `~/.claude/CLAUDE.md`, the repo root, and any `CLAUDE.md` or `CLAUDE.local.md` in a directory that is an ancestor of a changed file. A directory's file governs only what sits at or below it.
- **Tooling** — linter, formatter, and type-checker configs, plus rules already disabled in the changed files. A rule the repo has turned off is a decision, not an oversight.
- **The surrounding code** — how neighbouring modules name things, structure errors, and organize helpers. Local idiom beats a general best practice you'd apply on a blank page.

Write this up as a short brief you can hand to every agent verbatim. Quote rules rather than paraphrasing them, so an agent can cite one without re-reading the file.

## 3. Size the change and pick the fan-out shape

Run the diff command with `--stat` and look at file count and changed lines.

A single agent asked to scan a large diff for one pattern will find a few good examples early and let the rest blur — and that result is indistinguishable from a change that only had a few problems. Sharding is how you stop that, but it only works on angles whose findings are local to the files they're looking at:

- **Reuse, simplification, efficiency** shard cleanly. Split the changed files into groups small enough that one agent can read every file in its group _and_ the surrounding context carefully — roughly a handful of files, or a few hundred changed lines. Group by directory or module so each agent sees related code together; scattered files make reuse scanning much weaker.
- **Altitude never shards.** It's about how the whole change sits in the system, and its strongest signal — the same special case appearing in several places — is invisible to an agent holding one third of the diff. One agent, whole PR, always.

Small changes need no sharding: four agents, one per angle. Say what shape you chose and why, so a reader knows how much coverage stands behind the report.

If the split would produce a lot of agents, prefer fewer, larger shards over exhaustive coverage at any cost — and say plainly in the report that shards were sized up, rather than letting the number imply more thoroughness than there was.

## 4. Fan out

Launch every agent with the Agent tool at the `mzizzi:standard` tier, all in a single message so they run concurrently.

Each agent reviews from exactly one angle, reading its file from `references/angles/`: `reuse.md`, `simplification.md`, `efficiency.md`, or `altitude.md`.

Unsharded, that's four agents. A sharded angle gets one agent per shard, all reading the same angle file and differing only in scope — three shards of reuse means three agents on `reuse.md`.

Send each agent exactly this prompt, filling the bracketed slots and changing nothing else. It carries wiring only — which files to read, and the three inputs. What to do with them lives entirely in those files, which is what keeps it identical between runs; anything you add here is drift:

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

If the Agent tool isn't available, read the reference files yourself and work all four angles in one pass — dropping angles for lack of fan-out just hides findings. Say in the report that it was a single pass, so nobody reads it as broader coverage than it was.

## 5. Dedup, filter, and rank

Agents work their assigned files systematically and report only what they found — take their coverage as given rather than auditing it. If one says outright that something stopped it covering its scope, send another agent at what's left before continuing.

Merge every proposal and collapse duplicates. Two angles often reach the same problem from opposite directions and describe it in different words, so judge by what a proposal would actually change rather than how it's phrased, and keep the clearest framing. Sharded angles also produce near-identical proposals against parallel code in different files — merge those into one item listing every affected location.

Drop any proposal that:

- would change observable behavior — this report trades on being behavior-preserving, and one item that quietly isn't costs the author their trust in all of them
- reaches well outside the diff
- trades clarity for brevity, or dissolves an abstraction that was earning its keep
- you judge to be a false positive

Rank what survives by payoff — how much duplication, waste, or future maintenance it removes — breaking ties toward the smaller, more contained edit. Rank across all angles together; which agent found something is an implementation detail the author doesn't care about.

Be willing to come back with a short list. This lands on an open PR where every proposal costs a round trip, so a few high-confidence items beat a long tail of style preferences.

## 6. Report

Open with the resolved target, the fan-out shape, and a one-line assessment: how much cleanup the change wants, and which one or two proposals are worth doing if only a couple happen. Then, in ranked order:

- **`file:line` — one-line summary of the change**
  - _Why:_ what it costs today — the convention it breaks (quote it), the complexity it adds, the work it wastes, or the readability it loses.
  - _Proposed change:_ a before/after snippet, or a precise description when it's too large to quote. Enough that the author can accept or reject without re-deriving it.
  - _Behavior:_ confirm it preserves behavior, and name anything worth double-checking.
  - _Effort:_ trivial / contained / invasive.

Close with **Considered and rejected** — what the agents spotted but you didn't propose, one line each with the reason. In apply-mode review, restraint shows up as the absence of an edit; here it's invisible unless you say it, and naming it stops the author wondering whether you missed something.

Write for someone who knows this code better than you and chose the current form on purpose until shown otherwise. If the change is already clean, say so and stop — an empty report is a real result, and padding it to look thorough is how these reports stop getting read.
