# Pi port: remaining gaps

Audit baseline: `main` at `f5c6a8a`. All 15 skills, five shared agents, and the Pi-only adversarial reviewer exist. No fixes applied.

The November 7 port plan defines scope; the November 9 plan moves output from `generated/` to `ai-rendered/`. Neither missing files nor lost work explains the remaining gaps.

## Fix first: shared Git hazards

These defects also exist in the Claude workflows.

### [ ] Preserve feature commits when opening a PR

`pr` always creates a branch from `origin/<default-branch>`, leaving existing implementation and plan commits on the old branch.

**Fix:** reuse the intended feature branch and check its outgoing commit range.

Source: `ai/mzizzi/skills/pr/SKILL.md.j2:50–54`.

### [ ] Keep unrelated staged work out of the plan commit

`git add <plan dir> && git commit` also commits unrelated files already staged, even after the user chooses “Leave them.”

**Fix:** use a plan-only commit policy that preserves unrelated staging, or ask for an index-handling decision. Do not silently unstage or stash work.

Source: `ai/mzizzi/skills/prepare-feature-branch/SKILL.md.j2:92–100`.

### [ ] Settle the plan's content and write destination after branch selection

- Follow-ups retain the original absolute path and can change the source checkout instead of the implementation checkout.
- A clean committed plan can disappear when switching to an older feature branch.
- Ignored `.nocommit/plans/` files report `PLAN_DIR_DIRTY=no`, silently skipping the promised plan commit.

**Fix:** separate the original read reference from the writable destination. Check destination content regardless of source dirtiness. Decide whether ignored plans stay local; do not force-add them automatically.

Sources under `ai-rendered/pi/packages/mzizzi/skills/`: `implement-plan/SKILL.md:23,48–52`, `prepare-feature-branch/SKILL.md:85–95`, `record-follow-ups/SKILL.md:11–15,53`.

### [ ] Make branch inspection fail safely and parse real paths

A failed `git status` can return successful “clean” state. Quoted paths and renames can classify plan changes as unrelated edits.

**Fix:** check Git query results before parsing. Use NUL-delimited status/worktree records and handle rename paths.

Source: `ai/mzizzi/skills/prepare-feature-branch/scripts/inspect_branch_state.sh:75–105`.

### [ ] Bind PR metadata and Git fetches to the same repository

`gh` can resolve upstream while Git fetches `origin`, which may be a fork. Review can fail or use the wrong base.

**Fix:** resolve the matching remote before fetching, or explicitly reject unsupported repository URLs.

Sources under `ai-rendered/pi/packages/mzizzi/skills/`: `review-pr/SKILL.md:13,17–21`, `fix-all/SKILL.md:23`.

## Fix Pi runtime contracts

### [ ] Distinguish root and nested waits

Skills prohibit `bg_wait`, but installed child runtimes lack native completion notifications and need blocking collection of descendant results.

**Fix:** use native notifications at the root and blocking collection in child orchestrators. Preserve failure checks and the ban on polling.

Sources under `ai-rendered/pi/packages/mzizzi/skills/`: `brainstorm/SKILL.md:102`, `create-plan/SKILL.md:45,70`, `adversarial-review/SKILL.md:43`. Check quality's notification assumption too. Runtime: `pi-subagents/src/runs/background/wait-tool.js:6–13`.

### [ ] Keep auto-brainstorm coordination valid during slow reviews

The skill leaves a supervisor request unanswered during review. Requests expire after ten minutes by default; later questions or `STOP` cannot target an expired request. Renewal does not cover answers the parent already consumed.

**Fix:** define pause, deadline, and recovery behavior on the same child, including the overall run budget. Test slow review and `STOP` cleanup. Do not silently replace or resume the interviewee.

Source: `ai-rendered/pi/packages/mzizzi/skills/auto-brainstorm/SKILL.md:72`.

### [ ] Remove pragmatic review's competing acceptance contract

The reviewer requests findings only, but runtime defaults add acceptance attestation. Findings placed only in an acceptance fence disappear from the normal output.

**Fix:** set `acceptanceRole: read-only` or disable acceptance per call. Require findings or `No material findings.` Quality reviewers already do this.

Source: `ai/mzizzi/agents/pragmatic-reviewer.md.j2:6–14,29–41`; callers: rendered Pi `brainstorm/SKILL.md:99`, `create-plan/SKILL.md:42`.

### [ ] Restrict or support direct adversarial-reviewer calls

The advertised agent requires `structured_output`. Direct calls without `outputSchema` lack that tool; the skill supplies it correctly.

**Fix:** stop advertising the helper, or define a supported direct-call contract.

Source: `ai/mzizzi/agents/adversarial-reviewer.md.j2:7,19–21`.

### [ ] Remove unsupported PR permission escalation

`pr` tells Pi to retry Git permission errors with elevated permissions. Pi has no equivalent Claude escalation mechanism.

**Fix:** use the Pi stop-and-report behavior already in branch preparation. Keep Claude's instruction separate.

Source: `ai/mzizzi/skills/pr/SKILL.md.j2:16`.

## Finish workflow and deployment work

### [ ] Stop fix-all after any blocked pass

Quality marks failed or incomplete reviews unavailable. `fix-all` explicitly stops only for correctness, leaving later edits permitted after unavailable quality coverage.

**Fix:** stop dependent passes after any blocked pass or unresolved verification failure. Preserve partial results and PR cleanup after child settlement.

Sources under `ai-rendered/pi/packages/mzizzi/skills/`: `fix-all/SKILL.md:33–41`, `fix-quality/SKILL.md:75,113,122`. This is a shared caller gap exposed by Pi's stronger failure contract.

### [ ] Activate the current Pi package

At audit time, `/home/agent/.pi/agent/settings.json:8` still registered `generated/pi/packages/mzizzi`, including the retired Codex review. Dependency declarations used npm versions rather than the current kit's pinned Git revisions.

**Action:** use the existing registration migration, then reload or start a session. Reload alone does not change registration.

Source: `sandbox/agent-lab/bin/setup-pi.sh:8–68`. Migration implementation exists; this is deployment work.

### [ ] Complete the Claude loader/source migration

Production still loads `plugins/mzizzi/`, leaving duplicate originals beside shared sources and rendered Claude output.

**Action:** complete Phase 5 loader selection and duplicate-source removal under separate approval.

Source: `.claude-plugin/marketplace.json:11`, Windows setup, and sandbox Claude commands.

### [ ] Make rendered permissions reproducible

The renderer compares all POSIX mode bits; Git does not preserve group-write bits. Modes `0664` versus `0644` caused 38 freshness differences without content drift.

**Fix:** use canonical modes compatible with Git while preserving executable bits.

Source: `ai-renderer/render_ai.py:269,325–326` and resource tests.

## Intentional differences: not pending fixes

- **Questions and metadata:** plain-text questions replace absent question tools. Argument hints and allowed-tools preapproval do not carry over. All current skills are user-invocable; disable-model-invocation works.
- **Worktrees:** persisted interactive parent, settled children, existing-path entry, keep-only exit, and changed session identity. No child/headless switching, automatic shutdown cleanup, or universal child fence. Forced PR cleanup needs approval.
- **Review:** Pi uses native Astra with structured output; Claude uses Codex. Fresh context does not guarantee a different model. Pi Bash access is not Claude's requested read-only sandbox.
- **Context:** children inherit selected Pi context and skills, not the full Claude environment or automatic Attention Control. The delegator supports nested children; it is not a configured root persona.
- **Tasks and budgets:** tasks are session-local. Concurrency/context advice is not a hard universal cap. Eight children cover the unsharded quality angles including Python; larger fanouts need fewer shards or a budget decision.

New global instruction files, automatic `.claude/rules/` import, and native Windows/Git Bash remain outside scope.

## Checks and remaining proof

**Passed at audit time:** 81 Node tests; 70 Python tests in a clean Git export; helper suites Claude 15/15 and Pi 14/14. All 93 rendered file contents matched. The mixed-permission checkout had four Python permission failures.

Disposable tests reproduced branch/index/plan hazards, permission drift, acceptance-output stripping, supervisor expiry, and inspector errors. Other findings rely on source/runtime contracts, not new model-driven or remote tests. Temporary probes were removed.

Run these against the current registered package:

- [ ] Complete `implement-plan`, from branch preparation through every review pass.
- [ ] Complete detached `review-pr`, including return and cleanup.
- [ ] Complete uninterrupted auto-brainstorm, including slow review and `STOP` cleanup.
- [ ] Check nested orchestration and pragmatic-review report delivery.

Bounded Linux terminal/child/MCP checks do not establish arbitrary-host parity.
