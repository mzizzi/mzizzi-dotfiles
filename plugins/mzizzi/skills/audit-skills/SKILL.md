---
name: audit-skills
description: "Audit the skills in this repo against real session transcripts to find the ones that are inefficient, ignored, or actively causing rework, then produce a document of ranked issues and fixes. Use this whenever the user wants to know which skills are wasting tokens or not working, asks for a skill audit or efficiency review, or says things like 'which of my skills are broken', 'what's burning tokens', or 'audit my skills against the session history'."
argument-hint: "[time window, e.g. 'past 2 weeks'] [number of issues to keep]"
allowed-tools: Read, Grep, Glob, Bash, Agent, Skill, Write, Edit
disable-model-invocation: false
user-invocable: true
---

# Audit Skills

Measure the skills in this repo against what actually happened in session transcripts, then write a document of ranked issues and fixes.

The audit's value is entirely in its evidence. Opinions about prompt text are what produced the problems being audited.

Steps 4 onward pass file paths to sub-agents. Resolve the absolute path of this skill's directory first (the directory holding this `SKILL.md`) and use it wherever `<skill-dir>` appears below — sub-agents can't find these files from a relative path.

## 1. Resolve the scope

- **Window** — default the past 2 weeks; use whatever the user named instead.
- **Corpus** — the top-level `*.jsonl` transcripts under `~/.claude/projects/`, across all projects, not just this repo. Skills fail differently in codebases they weren't written against.
- **Cap** — how many issues survive into the document, default 10.

**A session is a top-level transcript.** The `<session-id>/subagents/agent-*.jsonl` files are parts of their parent run, so counting them as rows inflates the corpus and double-counts one run's behavior. Read them as evidence about their parent session, never as sessions.

Count the sessions in the window and how many invoked a skill at all; both go in the header. Every other rate names its own population — "13 of the 23 sessions that ran `inspect_branch_state.sh`" — because a family's failure rate over a corpus-wide denominator is not a rate of anything.

## 2. Create the output directory

    Skill(skill: "create-plan-dir", args: "skill efficiency audit")

Write the document at `<dir>/audit.md`. Not `plan.md` — that name is a contract the planning chain consumes, and an audit has no `### Implementation Phase <N>` sections for `/mzizzi:implement-plan` to seed a task list from.

## 3. Partition the corpus by skill family

Group sessions by which skill family they exercise, reading `plugins/mzizzi/skills/` for the current inventory. One analyst per family, so each holds a coherent slice instead of a random sample.

Build the session list for each family first, by grepping for the skill's invocation markers. An analyst handed a file list works; an analyst told to "find relevant sessions" spends its context searching.

## 4. Fan out the analysts

Get the dates each skill file changed in **one** history query over `plugins/mzizzi/skills/`, not one per file — there are dozens of files and every result lands in your context.

Spawn one `mzizzi:standard` or `mzizzi:simple` agent per family, all in a single message so they run concurrently, up to 10 at a time. If the partition yields more families than that, batch them rather than merging families into slices too broad to hold.

Send each agent exactly this prompt, filling the bracketed slots and changing nothing else. It carries wiring only — what to do with the inputs lives in the reference file, which is what keeps it identical between runs and between analysts:

```
Read <skill-dir>/references/analyst.md, then follow it.

Your family: <family>

Sessions to audit:
<session-list>

Skill files this family covers, with the dates each last changed:
<skill-files-with-dates>
```

## 5. Look for a failure common to every family

Read the analyst reports together and look for one failure repeating across families. Say plainly when there isn't one — an audit whose families fail for unrelated reasons still has to report that, and a header field with no empty case is an invitation to invent one.

Where it holds, it goes in the document header as the finding that frames everything below it.

## 6. Rank, then design the fixes

Rank by evidence first — frequency, severity, and denominator are already determined by the analyst reports and need no design pass. Cut to a shortlist a little above the cap.

Only then spawn `mzizzi:complex` agents against the shortlist, batched rather than one per finding. Designing fixes for findings that are about to be cut buys work on the slowest tier and throws it away.

A fix must delete text, delete machinery, or move a decision into code, with a hard bias toward **less** prompt text and machinery. Rewriting a rule that has already failed is not a fix — it's another copy of it. Where a rule is genuinely absent rather than ignored, adding one is defensible, but say why this one will hold when the earlier ones didn't.

Apply the final rank across the shortlist, keep the cap, and move the rest under **Below the cut** rather than deleting them.

## 7. Write the document

Follow the template below. Then read it end-to-end once, checking that every fix traces to a finding above it.

## 8. Hand off the document

The document is a worklist, not a report. State to the user:

- **Numbers are stable identifiers.** A deleted item leaves a gap; don't close it. Renumbering means "issue 5" refers to different things in different conversations.
- **Completed items leave the document.** Git history holds what was done; the file holds what's left.
- **A rejected item leaves too.** If the user disputes a finding, remove it rather than arguing it — the evidence is a sample of one machine's transcripts, and they know their own usage.

## Document Template

<!-- prettier-ignore -->
```markdown
# Skill efficiency audit — top issues and fixes

**Window:** <start> → <end>. **Corpus:** <N> sessions (~<size>) across <projects>; <N> invoked at least one skill.

**Failure common to every family:** <the one failure repeating across families, with the clearest single case as evidence. Omit this line when the families failed for unrelated reasons.>

**Working conventions:** issue numbers are stable identifiers — finished and rejected items are deleted and their numbers left as gaps; git history holds what was done.

---

## 1. <skill>: <what to do about it, imperative>

**Issue.** <One paragraph, dense with counts and percentages. What the model did, how often, and the structural reason it keeps happening.>

**Fix.** <Optional lead line — a claim that governs the whole list rather than one item.>

- **(a) <Imperative summary>.** <1-2 sentences. What changes, and the reason it works.>
- **(b) ...**

<Optional trailing line: expected saving, or an ordering dependency on another issue.>

## 2. ...

---

## Guardrails — verified working; do not cut

<What the analysts checked and found healthy, with the measurement that says so. Then deliberate no-actions: things too new to judge, or whose one use is what "reserved" looks like.>

## Below the cut

<Smaller fixes that didn't make the cap, as one-liners, so they aren't re-derived by the next audit.>

## Method note

<How the audit ran — analyst and solution agent counts and tiers — and where the evidence lives, so a finding can be re-opened after the working artifacts are gone.>
```
