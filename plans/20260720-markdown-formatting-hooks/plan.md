# Markdown formatting with Prettier, enforced by pre-commit

## Context

Most markdown in this repo was AI-written, and it carries whatever line wrapping the generating model happened to emit. The corpus shows it plainly: `README.md` wraps around column 72, `plugins/mzizzi/skills/review-comments/SKILL.md` wraps around 98, `plugins/mzizzi/skills/implement-plan/SKILL.md` does not wrap at all. Some files wrap mid-sentence in the middle of a list item. The result is that a one-word edit to a paragraph produces a multi-line diff as the wrap points shift, and no two files agree on what "formatted" means.

The fix is to stop encoding presentation in the file: reflow every paragraph to a single logical line and let editors soft-wrap. That is a rewrite, not a lint rule, which is why the seed settled on a formatter (Prettier) rather than a linter (markdownlint). The enforcement side is the pre-commit framework, so unformatted markdown is caught before it lands.

The starting state has no tooling of any kind — no `package.json`, no `.pre-commit-config.yaml`, no custom git hooks (`git config core.hooksPath` is unset and `.git/hooks/` holds only samples). Nothing competes for the git hook entry point.

**What the enforcement actually guarantees.** This is a client-side hook, and client-side hooks are best-effort by construction. A clone where `pre-commit install` never ran has no hook at all; `git commit --no-verify` skips it; a machine without Python skips it. There is no CI or server-side check in this repo, and none is being added — for a single-committer dotfiles repo, a GitHub Actions workflow is real ongoing surface (a second place the Prettier version pin lives, runner configuration to maintain) guarding a gap that only the repo owner can open. The honest claim is that this catches unformatted markdown on any machine that ran the installer, which is the machine doing the committing. A repo-level check is recorded in Follow-ups if that ever stops being true.

Two things make this more delicate than a normal "add Prettier" change, and they drive most of the plan:

**The files are load-bearing prompts.** `plugins/mzizzi/skills/*/SKILL.md` and `plugins/mzizzi/agents/*.md` are read by Claude Code as instructions. Their YAML frontmatter drives skill discovery and model selection; their body structure is what the model follows at runtime. Prettier rewrites more than paragraph wrapping — it normalizes emphasis markers, renumbers ordered lists, reindents nested list content, pads table cells, reformats frontmatter YAML, and recursively formats fenced code blocks whose language it recognizes. Several files in this repo trip every one of those. Because a frontmatter or template regression is silent — nothing errors, the skill just stops triggering or emits a subtly different template — verification here is mechanical rather than by eye.

**Line endings were inconsistent, now settled repo-wide.** `core.autocrlf` is `true` in the global git config and the repo had no `.gitattributes`. The committed blobs are all LF — `git ls-files --eol` reports every tracked file as `i/lf` — but `autocrlf` smudges some to CRLF in the working tree on checkout, so the tree is mixed and any formatter with a fixed `endOfLine` would fight git's own normalization. This is now fixed by a committed `.gitattributes` (`* text=auto eol=lf`) that pins every text file to LF in the repo and in the working tree on all platforms, replacing the per-machine `autocrlf`. See the `.gitattributes` section below.

## Design

### The four config files

`.prettierrc` is the canonical formatting contract. Both the pre-commit hook and any editor Prettier plugin read it, so format-on-save and commit-time enforcement agree by construction rather than by convention.

```json
{
  "proseWrap": "never",
  "embeddedLanguageFormatting": "off"
}
```

`proseWrap: "never"` is the entire point of the exercise — it collapses each paragraph to one line while preserving intentional hard breaks (trailing backslash or two trailing spaces), code fences, and tables.

`embeddedLanguageFormatting: "off"` stops Prettier recursing into fenced code blocks. This is the single most important safety setting in the file. Prettier's default is `auto`, and **markdown is a language Prettier formats** — so by default it descends into the ` ```markdown ` blocks in `create-plan/SKILL.md`, `implement-plan/SKILL.md`, and `brainstorm/SKILL.md` and reformats their contents. Those blocks are output templates the skill instructs the model to emit verbatim; their bytes are an invariant, not a style preference. Turning recursion off globally costs nothing here, because no fenced block anywhere in this repo benefits from being auto-formatted — they are all illustrative or verbatim. Choosing this preemptively rather than reacting to damage also means the reformat diff has one less category of change to audit.

Everything else stays at Prettier defaults deliberately: the value of a formatter is that its output is not negotiable, and a repo-local style sheet re-opens exactly the arguments the tool exists to close. Notably `endOfLine` is left unset (default `lf`) and the line-ending problem is solved on the git side instead — see below.

`.pre-commit-config.yaml` is the enforcement entry point.

```yaml
repos:
  - repo: local
    hooks:
      - id: prettier
        name: prettier
        entry: prettier --write
        language: node
        types: [markdown]
        additional_dependencies: ["prettier@3.6.2"]
```

The `repo: local` + `language: node` pattern is what lets this work without a Node project. pre-commit builds an isolated node environment in its own cache and npm-installs the pinned Prettier into it; `additional_dependencies` is a literal npm spec, so the version pin lives here and nowhere else. No `package.json`, no lockfile, no `node_modules`, no husky. The archived state of the upstream `mirrors-prettier` repo is irrelevant under this pattern, since nothing upstream is being consumed.

`types: [markdown]` uses pre-commit's file-identification library rather than a glob, so the hook picks up markdown regardless of path. Widening to YAML and JSON later is a one-line change to `types_or`, deferred to keep this diff contained.

`.prettierignore` guards ad-hoc whole-repo runs.

```
.nocommit/
```

The hook itself only ever sees staged files, so `.nocommit/` (already gitignored) can never reach it. But `prettier --write .` run by hand would walk into it. One line now beats a confusing incident later. Nothing else in the repo warrants exclusion at file granularity — the remaining risky spots are handled with inline `<!-- prettier-ignore -->` comments instead, which are surgical and self-documenting.

`.gitattributes` is the line-ending decision, and it is already committed — ahead of the rest of this plan, as its own change — because it is a prerequisite the reformat depends on and it stands on its own.

```
* text=auto eol=lf
```

### Why `.gitattributes` and not `endOfLine`

With `core.autocrlf=true` and no `.gitattributes`, git smudges LF blobs to CRLF on checkout. Prettier's default `endOfLine: lf` then considers those working-tree files unformatted and rewrites them to LF, pre-commit detects the modification, and the commit aborts — on the first commit after every fresh clone or every checkout that touches a markdown file. The hook would be permanently at war with git's own working-tree normalization.

Two ways out:

1. Set `"endOfLine": "auto"` in `.prettierrc` so Prettier preserves whatever the file already has. This makes the symptom disappear but leaves the working tree machine-dependent and re-opens the question on every platform.
2. Declare the eol in `.gitattributes`. A path attribute overrides `core.autocrlf`, so text files are LF in the index _and_ LF in the working tree on every platform. Prettier's default is then correct with no config, and the question stops being machine-dependent.

Option 2 is the choice, applied repo-wide as `* text=auto eol=lf` rather than scoped to `*.md`. Two facts made the wider scope both correct and cheaper than the plan first assumed:

- **The index is already all-LF.** `git ls-files --eol` shows every tracked blob as `i/lf`; the CRLF is purely a working-tree artifact of `autocrlf` smudging. There is no stored content to rewrite — a `git add --renormalize` changes nothing in the index — so no renormalize commit is needed. The fix is the attribute file itself: it stops the smudge going forward and makes LF the durable, cross-platform default, moving a per-machine git setting into a tracked, reviewable repo file.
- **Repo-wide costs nothing here.** Because no blob is CRLF, `* text=auto` cannot introduce churn; it only prevents future drift for the `.ps1`, `.json`, and `.yaml` files that are equally subject to `autocrlf`. `.ps1` runs fine as LF under modern PowerShell, so there is no reason to special-case it, and `text=auto` auto-detects any binary and leaves it alone (the repo currently has none).

### Bootstrap: how pre-commit gets onto the machine

`pre-commit` is not installed, and neither is `pipx`. Python 3.11 is on PATH at `C:\Program Files\Python311\python`. The options were: install pipx first and then `pipx install pre-commit`; `pip install pre-commit` into the system Python; or `python -m pip install --user pre-commit`.

**Decision: `python -m pip install --user pre-commit`.**

It introduces no new tool to learn or maintain, and `--user` keeps it out of the system Python's site-packages (which lives under `C:\Program Files` and would need an elevated shell). pipx's isolation benefit is real but small for a single pure-Python CLI with no conflicting dependencies, and it doubles the bootstrap chain — a plan step that says "first install a tool installer" is one more thing to get wrong on a fresh machine.

The one wrinkle: `--user` installs the `pre-commit.exe` shim into `%APPDATA%\Python\Python311\Scripts`, which is not necessarily on PATH. This does not break the git hook — the hook script pre-commit generates embeds the absolute path of the Python that installed it and invokes `python -m pre_commit`, so the hook fires whether or not the shim is reachable. It only affects manual invocation, and `python -m pre_commit run --all-files` works unconditionally. Documented commands should use the `python -m pre_commit` form for that reason.

The verification work in Phase 3 also needs a YAML parser, so install PyYAML in the same step: `python -m pip install --user pre-commit pyyaml`.

### Where the per-clone step lives

`scripts/windows/install.ps1` is already the per-machine setup script. It wires the `claude` CLI to this checkout via a PowerShell profile shim, it is idempotent and self-healing, and it already has a precedent for reaching outside itself to satisfy a dependency (`Ensure-CodexDependency` adds a marketplace and installs a plugin). `pre-commit install` is exactly the same shape of concern: a per-clone side effect that has to be re-applied after moving or re-cloning the repo, which is precisely the failure mode that script exists to absorb.

So `install.ps1` gains an `Ensure-PreCommitHook` function following the existing pattern, and `-Uninstall` gains the symmetric teardown. The script warns rather than failing when pre-commit or Python is missing: its primary job is the plugin shim, and a machine without Python should still be able to run it. That is consistent with the best-effort enforcement model described in Context — the installer makes the hook likely, not guaranteed, and pretending otherwise by hard-failing would block the script's actual purpose.

### The reformat risk surface

This is the part that needs verification, so it is worth naming exactly what is at risk. Ranked:

**`plugins/mzizzi/skills/review-comments/SKILL.md` — highest risk, though two of its hazards were defused up front (see "Pre-normalization" in Phase 3).**

- Its `description:` frontmatter — the field Claude Code matches against for skill triggering — was a multi-line YAML plain scalar. Prettier reformats frontmatter with its own YAML printer, which neither `proseWrap` nor `embeddedLanguageFormatting` governs (both are Markdown-scoped, and frontmatter is not a fenced code block), and it would fold that scalar to one line. Rather than trust YAML folding to yield a byte-identical parsed value and verify it only after the fact, the scalar has been collapsed to a single line by hand ahead of the reformat, so the reformat is a no-op on it by construction.
- The four-backtick inline code span (near the end of the file) has content of three backticks, with the surrounding spaces that CommonMark requires to disambiguate. If Prettier renormalizes the delimiter run or strips the padding spaces, the rendered content changes. This is the single most fragile line in the repo, and it is inline content, so `embeddedLanguageFormatting` does not protect it.
- The former GFM table (mode → description) has been rewritten as a `mode: description` bullet list, so the cell-padding hazard is gone — bullet prose is left alone under `proseWrap: "never"`, and no `<!-- prettier-ignore -->` is needed.
- Lines 51–52 nest emphasis inside strong. Prettier prefers `_` for emphasis and `**` for strong, so this becomes a mixed-delimiter construction. Adjacent-delimiter edge cases are where markdown formatters historically get things subtly wrong.
- Lines 99–101 and 106–114 are fenced code blocks nested inside an ordered list at three-space indent, one of them containing backslash line continuations. The list indentation may shift even though the fence contents will not.

**Nested markdown fences — mitigated by config, not left to review.** `implement-plan/SKILL.md` (line 147), `create-plan/SKILL.md` (line 140), and `brainstorm/SKILL.md` (line 54) each contain a ` ```markdown ` block holding a template the skill emits verbatim. `embeddedLanguageFormatting: "off"` is what protects these; Phase 3 verifies the protection held rather than trusting it.

**Frontmatter comment alignment — removed up front.** `implement-plan/SKILL.md`, `create-plan/SKILL.md`, and `codex-adversarial-review/SKILL.md` each had hand-aligned trailing comments (`key: value  # comment`) on their `disable-model-invocation`/`user-invocable` lines, which Prettier's YAML printer would collapse to a single space. Those comments have been dropped: the field names are self-describing, so the comments carried nothing the frontmatter doesn't already say. This removes both the cosmetic churn and a blind spot in the scripted check — YAML comments don't survive `safe_load`, so a change to one couldn't be compared before/after anyway.

**`create-plan/SKILL.md` and `implement-plan/SKILL.md` — mixed bullet markers.** These are the only two files using both `*` and `-` at top level (24/27 and 12/20 respectively). Prettier normalizes to `-`, which is a large but entirely mechanical diff.

**`anti-slop-writing-guidelines/SKILL.md` — escaping and renumbering.** Its body is a catalogue of punctuation and formatting patterns written as literal prose, which is exactly the content most likely to attract Prettier escape backslashes. It also carries a 26-item ordered list (lines 360–393) interrupted by headings; Prettier renumbers ordered lists, and where a heading splits a list, the second half may restart at 1. Check that the numbering the prose refers to survives. Its two `references/*.md` files carry 207 and 61 emphasis/bullet constructs respectively — high churn, low semantic risk.

**Corpus-wide, low risk:** single-asterisk emphasis appears in all 17 files that use emphasis at all and will uniformly become `_underscore_`. Four-space indented code blocks appear in `README.md` and several SKILL.md files (the `Skill(skill: "...")` invocation examples); Prettier preserves indented code blocks as indented code blocks, but confirm they did not get absorbed into surrounding paragraphs after unwrapping.

**How the diff gets audited.** Two mechanical checks first (parsed-frontmatter comparison and fenced-block byte comparison, both scripted in Phase 3), which cover the two silent-failure categories. Then a human read of what remains, where the expected signal is _only_ unwrapping, bullet-marker normalization, list renumbering, and emphasis-delimiter changes. Anything outside those four categories is a finding.

## Implementation

### Implementation Phase 1 — Bootstrap pre-commit on this machine

No repo files change. This is a prerequisite, done once per machine.

```bash
python -m pip install --user pre-commit pyyaml
python -m pre_commit --version
```

Do **not** run `pre-commit install` yet — the hook must not exist while the repo is still unformatted, or Phase 3's own commit will trip it.

**How to verify:** `python -m pre_commit --version` prints a version. Confirm `git config core.hooksPath` is still unset and `.git/hooks/` still contains only `.sample` files, so nothing has been installed prematurely.

### Implementation Phase 2 — Author the configs

Create four files at the repo root, exactly as given in the Design section: `.prettierrc`, `.prettierignore`, `.pre-commit-config.yaml`, `.gitattributes`.

Commit these on their own, before any reformatting. A config-only commit is trivially reviewable, and it means the reformat commit in Phase 3 contains nothing but mechanical churn.

**How to verify:** the goal is to prove the Node environment bootstraps on Windows _before_ committing to a reformat, because that is the step most likely to fail on this platform.

```bash
python -m pre_commit run --all-files --verbose
```

The first run builds a nodeenv in `%USERPROFILE%\.cache\pre-commit` and npm-installs the pinned Prettier. It needs network access and will take a minute or two; subsequent runs are cached. Expect it to _fail_ — every markdown file will be rewritten and pre-commit will report "files were modified by this hook." That failure is the success condition for this phase: it proves the toolchain works end to end.

If the node bootstrap fails outright (a genuine Windows risk with nodeenv), the contingency is `npm install -g prettier@3.6.2` and switching the hook to `language: system` with the same `entry`. That trades the self-contained environment for a global dependency, so treat it as a fallback and not a first choice.

Then discard the changes (`git checkout -- .`) — Phase 3 does the reformat deliberately, as its own commit.

### Implementation Phase 3 — The one-time reformat commit

Two mechanical changes land together here, because separating them would mean reformatting twice.

**Pre-normalization — lands as its own commit before the reformat.** A few hand-maintained constructs were normalized by hand first, so the mechanical reformat commit stays purely mechanical and the silent-failure surface shrinks before Prettier ever runs: `review-comments/SKILL.md`'s multi-line `description:` scalar was collapsed to a single line (removing the trigger-string folding risk by construction), the hand-aligned frontmatter comments in `implement-plan`, `create-plan`, and `codex-adversarial-review` were deleted (the fields are self-describing), and the GFM table in `review-comments` was rewritten as a bullet list. These are deliberate content edits, not mechanical churn, so they belong in their own commit ahead of the reformat rather than buried in it.

**Stage everything first.** `pre-commit run --all-files` operates on git-tracked files, and this plan directory is currently untracked — `plans/20260720-markdown-formatting-hooks/plan.md` and `seed.md` are both new. Running the formatter and then `git add -A` would stage those two files without ever formatting them, landing unformatted markdown in the very commit that is supposed to establish the baseline. The hook is not installed yet (Phase 4), so nothing would catch it. Stage first, then format:

```bash
git add -A                       # make every intended file known to git, including new ones
python -m pre_commit run --all-files
git add -A                       # restage the formatter's rewrites
python -m pre_commit run --all-files    # must now pass clean
```

The second run is the real check: it must exit zero with nothing modified. If it still reports changes, the formatter is not idempotent on some file, which is a finding worth understanding before committing rather than a step to repeat until it settles.

No `git add --renormalize` is needed here: `.gitattributes` (`* text=auto eol=lf`) is already committed and the index was already all-LF, so line endings are a settled precondition rather than part of this commit. Prettier writes LF, `.gitattributes` keeps the working tree LF, and the two no longer fight.

**Capture the before-state for verification before running any of the above.** From a clean tree:

```bash
mkdir -p /tmp/fmt-check
git ls-files '*.md' > /tmp/fmt-check/files.txt
# Snapshot parsed frontmatter (semantic, not textual) and raw fenced-block bodies.
python scripts/check-format-safety.py --snapshot /tmp/fmt-check/before.json
```

`scripts/check-format-safety.py` is a throwaway verification script — it does not need to be committed. It walks the tracked markdown files and emits, per file, the frontmatter parsed with `yaml.safe_load` and the list of fenced-code-block bodies extracted verbatim:

```python
# For each tracked .md file, record two things that must survive formatting:
#   frontmatter: the PARSED yaml object, so reflowing a plain scalar is a
#     no-op but a changed value, type, or dropped key is not
#   fences: raw text between ``` delimiters, byte-for-byte, since
#     embeddedLanguageFormatting=off should leave these untouched entirely
def snapshot(paths: list[str]) -> dict[str, dict]: ...

# Compare two snapshots; report per-file frontmatter diffs (as parsed objects)
# and any fence whose bytes changed. Exit non-zero if anything differs.
def compare(before: dict, after: dict) -> int: ...
```

After the reformat, run `--snapshot after.json` and compare. Both categories should be empty: parsed frontmatter identical for all files, fenced bodies byte-identical for all files. This is what makes the load-bearing-prompt risk tractable — spot-checking a few hand-picked constructs across a 26-file mechanical diff cannot establish that no skill's trigger text or output template changed, and those failures are silent.

**Then review what the scripts do not cover** and commit as a single dedicated commit whose message says plainly that it is mechanical (`chore: reformat all markdown with prettier (proseWrap: never)`). A future `git blame` on any of these files lands here, so the message is the only signal a reader gets that the change carried no intent.

**How to verify:**

- The two snapshot comparisons come back clean. A frontmatter difference is a hard stop; investigate before committing. A fence difference means `embeddedLanguageFormatting: "off"` is not doing what it should — also a hard stop.
- Confirm the four-backtick span in `review-comments/SKILL.md` (near the end of the file) is unchanged, including its interior spaces. This is inline code, so it is outside the fence check.
- Check the ordered list in `anti-slop-writing-guidelines/SKILL.md` still numbers 1–26 across the heading breaks.
- Scan the diff for stray escape backslashes — Prettier adds these where it reads prose punctuation as markdown syntax, and they render as literal backslashes in some viewers.
- Read the GFM table in `plans/20260719-workflow-implement-plan/workflow-script-api.md` (the `review-comments` table was converted to a bullet list in pre-normalization). If cell padding made it materially worse, add `<!-- prettier-ignore -->` above the table and re-run.
- Behavioral check, not just textual: after committing, start a fresh Claude Code session and confirm the `mzizzi` skills still load and trigger. This is the backstop for anything the snapshots missed.

The escape hatch if the diff is unacceptable in some corner: `<!-- prettier-ignore -->` immediately above the offending block, which exempts the next node only. Prefer that over a `.prettierignore` entry, which would exempt the whole file forever.

### Implementation Phase 4 — Activate the hook

Now that the tree is clean, install the git hook:

```bash
python -m pre_commit install
```

Then wire it into `scripts/windows/install.ps1` so a fresh clone gets it without anyone remembering. Follow the existing `Ensure-CodexDependency` shape — a function called from the install path, with a matching teardown in the `-Uninstall` branch alongside the profile-line removal.

```powershell
function Ensure-PreCommitHook {
    $hookPath = Join-Path $RepoRoot '.git\hooks\pre-commit'
    if (Test-Path $hookPath) {
        Write-Host "pre-commit hook already installed."
        return
    }
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        Write-Warning "python not found on PATH -- skipping pre-commit hook install."
        Write-Warning "Install it manually: python -m pip install --user pre-commit; python -m pre_commit install"
        return
    }
    Write-Host "Installing the pre-commit git hook..."
    & python -m pre_commit install
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "pre-commit hook install failed. Is pre-commit installed? (python -m pip install --user pre-commit)"
    }
}
```

The function is a no-op when the hook is already present, matching the script's existing self-healing character. It warns rather than calling `Fail` when Python or pre-commit is absent, for the reason given in Design: the script's primary job is the plugin shim.

**How to verify:** the point is to prove the hook actually blocks, not just that it exists.

- Confirm `.git/hooks/pre-commit` now exists and is a pre-commit-generated script.
- Deliberately break a file — hard-wrap a paragraph in `README.md` across two lines — then `git add README.md && git commit -m "test"`. The commit must abort with "files were modified by this hook," and the file must be reflowed in the working tree. Re-stage and commit to confirm the second attempt succeeds. Then revert the test commit.
- Repeat that test with a **newly created** markdown file, not just a modified one. New files are the case Phase 3 had to work around, and it is worth confirming the installed hook covers them (it does — the hook sees the staged set, not the tracked set — but the asymmetry with `--all-files` is exactly the kind of thing that bites twice).
- Confirm a commit touching only non-markdown files is not slowed down or blocked, proving `types: [markdown]` scopes correctly.
- Run `install.ps1` a second time and confirm it reports the hook as already installed rather than reinstalling. Run `install.ps1 -Uninstall` and confirm the hook is removed alongside the profile line, then reinstall.

The bypass, for the cases where it is genuinely warranted (an emergency commit, or bisecting through unformatted history): `git commit --no-verify` skips all hooks, and `SKIP=prettier git commit` skips just this one while leaving room for future hooks to still run. Prefer `SKIP` — it is narrower and it stays correct as more hooks are added.

### Implementation Phase 5 — Documentation and editor setup

Update `README.md`. The Windows setup section already describes `install.ps1` and points readers at the script itself for options — extend the same section to mention that it also installs the pre-commit hook, and add the one-time per-machine bootstrap (`python -m pip install --user pre-commit`) as a prerequisite. Follow the repo's own documentation rule in `.claude/rules/documentation.md`: reference `.prettierrc` and `.pre-commit-config.yaml` by path rather than restating what they contain, and give the ad-hoc reformat invocation (`python -m pre_commit run --all-files`) as an example rather than enumerating flags. Note that enforcement is local and best-effort, so the bootstrap step is not optional on a new machine.

Editor side, so the unwrapped files stay readable. For VS Code, `"[markdown]": { "editor.wordWrap": "on" }`. The repo has a `.idea/` directory, so IntelliJ is also in play — its markdown soft-wrap lives under Editor → General → Soft Wraps, and adding `md` to the soft-wrap file mask is the equivalent setting. Neither is a tracked repo file, so this is a per-developer step to document rather than to commit.

**How to verify:** open a reformatted SKILL.md and confirm long paragraphs wrap visually without horizontal scrolling. Then, with the editor's Prettier plugin active, save an unmodified markdown file and confirm it produces zero changes — that proves the editor and the hook are reading the same `.prettierrc` and will not fight.

## Resolved Questions

- **Formatter, not linter.** Unwrapping hard-wrapped paragraphs is a rewrite, and linters only flag. markdownlint cannot do this job regardless of configuration.
- **Prettier over mdformat.** The user already uses Prettier in other projects and wants one formatter everywhere. Prettier also handles YAML frontmatter natively, where mdformat needs `mdformat-frontmatter` plus `mdformat-gfm`. mdformat's advantage — an officially maintained pre-commit hook, against Prettier's archived `mirrors-prettier` — is neutralized by the `repo: local` pattern, which consumes nothing upstream.
- **pre-commit framework over husky + lint-staged.** This is a polyglot dotfiles repo, not a Node project. A `package.json` plus lockfile plus `node_modules` purely to format markdown is more moving parts than one YAML file. pre-commit builds the node environment itself and the version pin lives in `additional_dependencies`. If husky ever appears, the two frameworks fight over the git entry point (husky sets `core.hooksPath`, which makes git ignore `.git/hooks/`, and `pre-commit install` refuses to run when it detects that) — one must be the runner, and here it is pre-commit.
- **Markdown-only scope to start.** Widening to YAML and JSON is a one-line change to `types_or`, deferred to keep the initial diff contained.
- **Rollout order: configs → reformat → install → editor.** The hook is installed only after the tree is already clean, so it never fights pre-existing formatting.
- **`python -m pip install --user pre-commit` for bootstrap.** No pipx dependency chain, no elevated shell needed for the `Program Files` Python. The `--user` scripts directory may not be on PATH, but the generated git hook embeds an absolute Python path, so the hook works regardless; documented manual commands use `python -m pre_commit` for the same reason.
- **`.gitattributes` with `eol=lf` rather than `endOfLine: "auto"`.** `core.autocrlf=true` (global config) smudges LF blobs to CRLF on checkout, which would make Prettier rewrite them after every checkout. A path attribute overrides `autocrlf` and fixes the cause; `endOfLine: "auto"` only suppresses the symptom and leaves the working tree machine-dependent.
- **`.gitattributes` applied repo-wide (`* text=auto eol=lf`), not scoped to `*.md`, and committed up front.** The index is already all-LF (`git ls-files --eol`), so there is no stored content to renormalize and the wide scope introduces zero churn — it only stops future `autocrlf` drift for `.ps1`/`.json`/`.yaml` too. `.ps1` runs fine as LF under modern PowerShell, and `text=auto` leaves any binary alone (none exist today). Landed as its own change, since it is a standalone prerequisite the reformat depends on.
- **`embeddedLanguageFormatting: "off"`, set preemptively.** Prettier formats markdown, so by default it recurses into the ` ```markdown ` template blocks in three SKILL.md files — blocks whose bytes are an invariant because the model emits them verbatim. Disabling recursion globally costs nothing, since no fenced block in this repo benefits from auto-formatting, and it removes an entire category of change from the reformat diff. Reacting after the fact would have relied on catching every regression by eye. The GFM tables and the four-backtick inline span are still handled reactively, since `embeddedLanguageFormatting` does not cover them.
- **Enforcement is local and best-effort; no CI check.** A client-side hook is bypassable by `--no-verify`, absent on a clone that never ran the installer, and skipped on a machine without Python. For a single-committer dotfiles repo, a GitHub Actions workflow is ongoing surface — a second home for the Prettier version pin, runner config to maintain — guarding a gap only the repo owner can open. The plan's wording was narrowed to match reality instead. Recorded in Follow-ups if that changes.
- **`install.ps1` owns the per-clone `pre-commit install`, and warns rather than failing when prerequisites are missing.** It is already the idempotent, self-healing, per-machine setup script with precedent for satisfying external dependencies. Hard-failing would block the plugin shim (its actual purpose) over a formatter, and would misrepresent an enforcement model that is best-effort by design.
- **Verification is scripted, not visual, for the two silent-failure categories.** Parsed-frontmatter comparison and fenced-block byte comparison run before and after the reformat. A changed skill trigger string or a mangled output template produces no error — the skill just stops matching or emits something subtly different — so eyeballing a 26-file mechanical diff cannot establish their preservation.
- **Stage before formatting in Phase 3.** `pre-commit run --all-files` covers tracked files only, and this plan directory is untracked; formatting first and then `git add -A` would land `plan.md` and `seed.md` unformatted in the baseline commit, with no hook installed yet to catch it.
- **Pre-normalize hand-maintained frontmatter and the one table before reformatting.** `review-comments`'s multi-line `description:` scalar was collapsed to a single line, the aligned frontmatter comments in `implement-plan`, `create-plan`, and `codex-adversarial-review` were dropped as redundant with the self-describing field names, and the `review-comments` mode table became a bullet list — all as a separate content commit ahead of the mechanical reformat. This removes the trigger-string folding risk and the table-padding hazard by construction rather than leaning on post-hoc verification to catch them, and keeps the reformat commit purely mechanical. Frontmatter is reformatted by Prettier's YAML printer, which is governed by neither `proseWrap` nor `embeddedLanguageFormatting` (both Markdown-scoped) — so those settings were never a guard for it, and the scripted parsed-frontmatter check remains as a backstop rather than the primary defense.

## Follow-ups

- **Repo-level format check.** If this repo ever gains a second committer or CI for another reason, add `pre-commit run --all-files` as a required check. The local hook is best-effort by construction.
- **Widen the hook to YAML and JSON** via `types_or` in `.pre-commit-config.yaml`, once the markdown case has proven stable.
- **markdownlint-cli2 as a second layer.** Catches structural issues formatting cannot (heading hierarchy, bare URLs). Would need MD013 (line length) disabled, since one-line-per-paragraph deliberately violates it. Deferred until formatting alone proves insufficient.
