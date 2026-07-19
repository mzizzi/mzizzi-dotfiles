# Task-list seeding for /implement-plan — Brainstorm

## The idea

The /implement-plan skill's review-and-triage tail (Codex review, triage, trivial fixes,
follow-ups, comment review) gets dropped in long runs. The root cause is mechanical: the
skill's "keep a running checklist" instruction is prose in the intro — it lives only in
early conversation context, gets summarized away during compaction, and nothing ever
re-surfaces it. The tail steps are never on any list the model builds, because the model
derives its checklist from the plan document and the tail lives in the skill.

The fix explored here: make the skill's very first action the creation of a tracked task
list using the harness's native task tools. Harness-tracked tasks are re-injected via
system reminders, survive compaction, and render in the terminal UI where the user can see
pending items. Seeding the skill's fixed steps *before even opening the plan* means the
tail exists as pending items from minute one and can't be forgotten; an "implement"
placeholder expands into plan-derived items once scope is resolved.

Alternatives considered and set aside for this round: a durable checklist file in the plan
directory (homemade, unenforced; only valuable for cross-session durability), a Stop hook
(hard enforcement but a small state machine with its own failure modes), and a full Agent
SDK reimplementation (deterministic orchestration, but sacrifices the interactive workflow
and shared session context that make the skill work).

## Decisions

### Scope of the change
- **Question:** Just the task-list instruction, or also the checklist file and/or Stop hook tiers?
- **Decision:** Task list only.
- **Why:** It's the smallest change that attacks the actual failure mechanism (the tail
  falling out of context) and uses only native harness features. The Stop hook is cheap to
  code but expensive to live with: it fires on every stop in the project, so it needs a
  marker/state file, staleness detection for abandoned runs, an abort escape hatch, and
  loop-guard handling — a state machine with its own failure modes. The checklist file is
  unenforced homemade scaffolding whose only advantage is cross-session durability. Both
  can layer on later without reworking the task-list tier if dropped steps persist.

### Placement in SKILL.md
- **Question:** Where does the instruction live — intro prose, a new step, or renumbering everything?
- **Decision:** New `## Step 0: Create the task list` section between the intro and Step 1;
  the intro's "keep a running checklist" sentence shrinks to a pointer at Step 0.
- **Why:** Numbered steps get executed; intro prose gets skimmed — prose placement is the
  weakness being fixed. An unconditional first action is more reliably followed than
  "after resolving scope, build the list", because it doesn't inherit the ways Step 1 can
  get complicated (ambiguous plan file, scope back-and-forth). Step 0 also leaves existing
  step numbers untouched.

### Tool naming
- **Question:** Name TodoWrite (classic builds), the Task* family (newer builds), or both?
- **Decision:** Explicitly the new Task* family — TaskCreate/TaskUpdate/TaskList — in both
  `allowed-tools` and prose. No TodoWrite compatibility.
- **Why:** User always runs the latest builds, so version-skew insurance isn't worth the
  hedged phrasing. (The both-families option was recommended for cross-version dotfiles
  portability; explicitly overridden.)

### Skeleton contents
- **Question:** Which items are seeded at skill start, before the plan is opened?
- **Decision:** One item per numbered skill step — resolve scope, prepare branch,
  implement (as expandable placeholder), Codex review, triage, apply trivial fixes,
  record follow-ups, review comments, summarize.
- **Why:** Mirrors the skill's structure one-to-one so every tail step is individually
  visible — collapsing review/triage/fix into one item would let a half-done tail look
  done. The early items cost nothing since they complete within minutes.

### Expansion granularity
- **Question:** After scope resolution, what does the "implement" placeholder expand into?
- **Decision:** Mirror the plan's own enumeration — one item per file entry listed by the
  in-scope `### Implementation Phase <N>` sections, in plan order, grouped only where the
  plan itself groups tightly-coupled files, with each entry's testing notes included.
- **Why:** The create-plan template already enumerates "specific files to create or
  modify, in order" — the plan is the source of granularity, making expansion mechanical
  rather than a judgment call re-made every run. Per-phase items would be opaque for
  hours; strict one-per-file fights plans that deliberately group a cluster.

### Legitimately-skipped steps
- **Question:** What happens to items for steps that become moot mid-run (Codex review
  unavailable makes triage/fixes/follow-ups empty; user aborts at a branch decision)?
- **Decision:** Annotate and complete — update the item's text with a brief reason
  (e.g. "skipped — review unavailable") and mark it completed. On a user-directed abort,
  remaining items stay pending.
- **Why:** Deleting erases the record that the step existed and was consciously skipped;
  leaving skipped items pending makes every review-unavailable run end looking half-done,
  which trains the user to ignore pending items. Pending-on-abort is accurate: the work
  genuinely is unfinished.

### The empty Step 9 placeholder
- **Question:** The working copy had inserted an empty `## Step 9:` heading (renumbering
  Summarize to Step 10) — keep or revert?
- **Decision:** Superseded — revert it; Summarize returns to Step 9.
- **Why:** The slot is no longer needed since the task list lives at Step 0. The file
  ships clean with Step 0 as the only structural addition.

### Status discipline (documented without grilling — trivial)
- Exactly one item in-progress at a time; mark in-progress when starting a step and
  completed immediately when done — never batch-complete at the end, and never end the
  turn with items pending unless the user has redirected or aborted.
- If the session already has unrelated tasks when the skill starts, add the skill's items
  and leave the unrelated ones alone.
- Frontmatter change: `allowed-tools` gains TaskCreate, TaskUpdate, TaskList.
