# Claude Code ↔ Codex CLI Skill Compatibility

Notes for making this repo's skills run under both Claude Code and Codex CLI. Both
harnesses read the [Agent Skills](https://agentskills.io/specification) format (a `SKILL.md`
with `name` + `description` frontmatter), so the base format is shared; the incompatibilities
are all in harness-specific extensions.

Everything below is sourced from the spec or first-party vendor docs — not community blogs.
Two things to keep in mind while reading:

- The **format is well-adopted** (Anthropic, OpenAI, Google, Microsoft all publish first-party
  docs), but the **spec deliberately leaves the hard parts unspecified** — tool references,
  skill-to-skill composition, and subagents are all harness-specific. Portability there is a
  design problem, not a lookup.
- `github.com/openai/skills` is **deprecated** in favor of
  [`github.com/openai/plugins`](https://github.com/openai/plugins) (skills wrapped in a
  `.codex-plugin/plugin.json`). The `agents/openai.yaml` sidecar convention below is still
  current per the live Codex docs; only the example repo moved.

## Path handling

**Problem:** two skills locate bundled scripts via `${CLAUDE_PLUGIN_ROOT}` —
`create-plan-dir/SKILL.md` and `codex-adversarial-review/SKILL.md`. That variable is
**not set for skill instructions under Codex**, so `bash "${CLAUDE_PLUGIN_ROOT}/scripts/foo.sh"`
does not resolve there.

**How each harness locates a skill's own files:**

- The **spec** defines the portable rule: *"When referencing other files in your skill, use
  relative paths from the skill root … Keep file references one level deep from `SKILL.md`."*
  It **never mentions an environment variable** — relative paths are the whole contract.
  ([Agent Skills spec](https://agentskills.io/specification) ·
  [client-implementation guide](https://agentskills.io/client-implementation/adding-skills-support.md),
  which tells harnesses to *"resolve them against the skill's directory (the parent of SKILL.md)"*)
- **Codex** sets **no** env var for skill execution. It injects each skill's absolute path
  into the system prompt and has the model resolve relative references (e.g. `scripts/foo.sh`)
  against the `SKILL.md` directory.
  ([Codex skills docs](https://learn.chatgpt.com/docs/build-skills) — note
  `developers.openai.com/codex/skills` now 308-redirects here)
- **Claude Code** offers a product-specific variable, **`${CLAUDE_SKILL_DIR}`** (*"the directory
  containing the skill's `SKILL.md` file … Use this in bash injection commands to reference
  scripts or files bundled with the skill, regardless of the current working directory"*). This
  is Claude-only and will not resolve elsewhere.
  ([Claude Code skills docs](https://code.claude.com/docs/en/skills))
- **On `${CLAUDE_PLUGIN_ROOT}` specifically:** it belongs to Claude Code's separate *plugins*
  system, not the skills system — this repo's skills use it because they ship as a plugin. The
  documented skill-scoped variable is `${CLAUDE_SKILL_DIR}`, and neither is portable.
  ([Claude Code plugins reference](https://docs.claude.com/en/docs/claude-code/plugins-reference))
- **Codex compat caveat:** Codex *does* set `CLAUDE_PLUGIN_ROOT` (and `PLUGIN_ROOT`) — but
  **only in the environment of plugin hook subprocesses**, for backward compat. This does not
  reach shell commands the model composes while following a `SKILL.md`, so it doesn't help here.
  ([Codex hooks docs](https://developers.openai.com/codex/hooks) ·
  [hooks discovery.rs](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/discovery.rs))

**Portable pattern:** instruct in terms of the skill root using a bare relative path, with any
Claude variable relegated to a parenthetical hint:

> Run `scripts/create_plan_dir.sh` from this skill's directory.
> (Under Claude Code that directory is `${CLAUDE_SKILL_DIR}` — or `${CLAUDE_PLUGIN_ROOT}/skills/create-plan-dir/` when installed as a plugin.)

Both harnesses tell the model where the `SKILL.md` lives, so a relative-path instruction
resolves in either. Keep the existing manual fallback in `create-plan-dir/SKILL.md` (build the
directory by hand if the script can't run) — it covers the case where neither form resolves.

## Frontmatter

**Portable core is two fields: `name` + `description`.** Codex requires exactly these (*"The
SKILL.md file must include name and description"* —
[Codex docs](https://learn.chatgpt.com/docs/build-skills)); the spec adds a few optional fields.

- **Spec optional fields:** `license`, `compatibility` (e.g. `Requires git, jq`), and `metadata`
  (an arbitrary map — the sanctioned place for non-standard data; use unique key names).
  `allowed-tools` exists but is explicitly marked *"Experimental. Support for this field may vary
  between agent implementations."* ([spec](https://agentskills.io/specification))
- **The spec does not say "no other fields."** Unknown keys aren't forbidden — `metadata` is just
  the blessed home for extras. (The oft-repeated "runtimes ignore unknown keys" line is not spec
  text; don't rely on it as a guarantee.)
- **Claude-only fields this repo uses** — `argument-hint`, `disable-model-invocation`,
  `user-invocable`, `allowed-tools`, plus others like `context`, `agent`, `model`, `effort`
  ([Claude Code skills docs](https://code.claude.com/docs/en/skills)). These carry no cross-harness
  meaning; other harnesses simply ignore them, so they're safe to leave in but do nothing under
  Codex.

**Two vendor philosophies for host-specific config:**

- **Claude Code** extends the *frontmatter itself* with product keys (the list above).
- **OpenAI/Codex** keeps `SKILL.md` frontmatter minimal and pushes UI/policy/tool-dependency
  config into a **sidecar file, `agents/openai.yaml`** (*"Add `agents/openai.yaml` to configure UI
  metadata … set invocation policy, and … declare tool dependencies"* —
  [Codex docs](https://learn.chatgpt.com/docs/build-skills); verified against a real file,
  [`skills/.curated/pdf/agents/openai.yaml`](https://github.com/openai/skills/blob/main/skills/.curated/pdf/agents/openai.yaml)).

Both are spec-compatible because each harness ignores the other's channel. **Portable guidance:**
keep the shared frontmatter to `name`/`description` (+ `compatibility`/`metadata` as needed), and
put anything host-specific in that host's channel rather than the shared body.

## Tools, composition, and subagents — unspecified, therefore not portable

The spec **does not standardize** any of these, so they can't be relied on cross-harness:

- **Tool references:** the only tool field is the experimental `allowed-tools`, and tool
  *names* aren't standardized — the spec's own example (`Bash(git:*) Read`) is Claude-flavored and
  meaningless in Codex. Portable skills should **describe the action**, not name a tool. This is
  why our `AskUserQuestion`-driven skills (`grill`, and the interview loops in `create-plan` /
  `brainstorm` / `implement-plan`) need generic "ask one question at a time" phrasing instead.
- **Skill-to-skill invocation:** **no mechanism in the spec.** Best practices only discuss
  composition at the design level. Our `Skill(skill: …)` calls (in `brainstorm`, `create-plan`,
  `implement-plan`) have no portable equivalent — they'd become "read `<path>/SKILL.md` and follow
  it." ([spec best practices](https://agentskills.io/skill-creation/best-practices.md))
- **Subagents:** the implementation guide flags subagent delegation as *"an advanced pattern only
  supported by some clients."* Claude Code implements it via `context: fork` / `agent:` frontmatter;
  Codex has its own primitives. Our `Agent`/`subagent_type: "Plan"` call with pinned Anthropic
  model aliases (`create-plan` Step 4) is entirely Claude-specific.
  ([client-implementation guide](https://agentskills.io/client-implementation/adding-skills-support.md))

**Design implication:** there is no authoritative "portable composition" recipe. For skills that
compose (`brainstorm`, `create-plan`, `implement-plan`) the realistic options are to inline the
logic, or branch on host capability ("if the host can spawn subagents, …; otherwise do it inline")
— a design decision to settle deliberately, not a spec lookup.

### Cross-model review direction

Separate from the mechanics: the plan/implement workflow's value is **cross-model** adversarial
review (Claude drafts → Codex challenges). Run *under* Codex, "have Codex review it" collapses to a
same-model review. A portable version must make the review direction **relative to the host** — farm
review to Codex when running under Claude, and to Claude (e.g. `claude -p`) when running under Codex.
This is a design change, not a porting mechanic.

## Pinning a skill's model (defaulting to a specific model)

**Problem:** you want a skill to run on a chosen model rather than whatever the session happens to
be on — e.g. a review or planning skill that should always default to a stronger (or cheaper)
model. This is a specific case of the "subagents are unspecified" problem above: **model selection
is not in the Agent Skills spec at all**, so there is no portable frontmatter key for it. The
intent ports; the mechanism does not.

**How each harness pins a model:**

- **Claude Code — in the skill's own frontmatter.** It extends the frontmatter with model keys
  ([Claude Code skills docs](https://code.claude.com/docs/en/skills)):
  - `model` — sets the model while the skill is active. It's a **turn-scoped inline override**
    (applies for the rest of the current turn, then the session model resumes; not saved to
    settings). Accepts the same values as `/model`, or `inherit`. No forking required.
  - `effort` — overrides the reasoning-effort level for the skill's run.
  - `context: fork` + `agent:` + `model:` — runs the skill as an isolated subagent on a pinned
    model. This is the heavier variant; use it when the work also wants a clean context.
- **Codex — outside the skill, on a custom agent.** Codex skills have **no** model field, and the
  `agents/openai.yaml` sidecar covers UI/policy/tool-deps only — **not** the model. Model selection
  lives on **custom agents (subagents)**: standalone TOML files under `~/.codex/agents/` (personal)
  or `.codex/agents/` (project), each setting `model` and `model_reasoning_effort` (omitted →
  inherit from the parent session)
  ([Codex subagents docs](https://learn.chatgpt.com/docs/agent-configuration/subagents)). The Codex
  equivalent of "this skill defaults to model X" is therefore: pin the model in a custom-agent TOML
  and have the skill body **delegate the work to that agent**. The pin cannot be expressed inside
  `SKILL.md`.

**This repo already relies on the Claude-only form:** `create-plan` Step 4 spawns an
`Agent`/`subagent_type: "Plan"` with a pinned Anthropic model alias (default `opus`, configurable
via `--model`). That is entirely Claude-specific — under Codex the `model:`/`--model` alias, the
`Agent` call, and the alias names themselves all have no meaning.

**Portable guidance — put the *decision* in the body, the *enforcement* in each host's channel:**

1. State the model *intent* in the harness-neutral body as guidance ("this work benefits from a
   stronger model; run it on the host's most capable model unless told otherwise"). That much
   ports, because it's just instructions.
2. Enforce it per host in that host's native mechanism, each of which the other safely ignores:
   - Claude Code → `model:` (and `effort:`, or `context: fork` + `agent:` + `model:`) in frontmatter.
   - Codex → a companion custom-agent TOML that pins `model`/`model_reasoning_effort`, plus a
     body instruction to delegate to it.
3. Expect **graceful degradation, not equivalence.** A `model:` frontmatter key is honored by
   Claude Code and dropped by Codex; a Codex custom agent is invisible to Claude Code. Where a
   host's mechanism is absent, the skill runs on the session model — no error, but no pin either.
   Decide per skill whether that unpinned fallback is acceptable.
4. **Model aliases don't cross harnesses.** `opus`/`sonnet`/`haiku` mean nothing to Codex;
   `gpt-5.6`/`gpt-5.3-codex-spark` mean nothing to Claude Code. Never share a literal model name
   across the two channels — keep each host's model value in that host's config.

**Rule of thumb:** there is no single field that pins a skill's model everywhere. Treat the two
mechanisms as independent and maintain both; don't assume one frontmatter key enforces the pin
cross-harness — it doesn't.

## Portability checklist (spec + vendor-sourced)

1. Shared frontmatter = `name` + `description` (+ `license`/`compatibility`/`metadata` if needed).
2. Reference bundled files by **bare relative path**, one level deep. No `${CLAUDE_*}` vars in the body.
3. **Describe actions**, don't name harness tools; treat `allowed-tools` as optional/experimental.
4. Put host-specific config in the host's channel (Codex → `agents/openai.yaml`; Claude → its
   extended frontmatter), never in the shared body.
5. For composition/subagents/review-direction: no portable spec exists — inline, or branch on host
   capability, with an explicit fallback.
6. To pin a skill's model: no portable key exists — put the model *intent* in the body, and enforce
   per host (Claude → `model:`/`context: fork` frontmatter; Codex → a custom-agent TOML it delegates
   to). Never share a literal model name across the two channels.
