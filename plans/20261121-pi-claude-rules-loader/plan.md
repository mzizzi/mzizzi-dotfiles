# Load Claude rules from the mzizzi Pi package

## Context

Install the existing mzizzi skills and agent definitions plus one rules loader with one `pi install`. Keep `.claude/rules/` in each repo as the source of truth. The existing local Pi package supplies the rendered resources, but Pi does not install dependencies for a local path. The [brainstorm](brainstorm.md) chose a Git-installed package over a separate `pi-code` registration or a copy of its code.

A disposable Git package on Pi 1.5.2 demonstrated dependency installation, selection of one nested extension, and discovery of a nested skill. A separate check exercised the published `pi-code` matcher against the SimRacing rules. Neither check ran the real rules loader in a Pi session. Do not change consumer provisioning until that check passes.

## Design

Make the **repository root** the Git package. Pi checks for `package.json` there after cloning. Install with `pi install git:github.com/mzizzi/mzizzi-dotfiles@<commit>`; use a reachable commit SHA, not a moving branch. The root manifest is authored, not rendered:

```json
{
  "name": "mzizzi-ai",
  "private": true,
  "dependencies": { "pi-code": "1.10.2" },
  "pi": {
    "extensions": ["./node_modules/pi-code/extensions/claude-rules.ts"],
    "skills": ["./ai-rendered/pi/packages/mzizzi/skills"],
    "subagents": { "agents": ["./ai-rendered/pi/packages/mzizzi/agents"] }
  }
}
```

The dependency provides the loader and its sibling modules. Only the listed extension enters Pi. The renderer still owns the nested package; do not change its generated manifest or add an install script. Core Pi loads the skills. The already-managed `pi-subagents` extension discovers the agent definitions; the mzizzi package does not install that extension. Boot-time links under `config/pi/extensions/` remain separate.

Use upstream loading and trust without overrides. User rules and unscoped rules from approved projects can reach the initial model request. Scoped rules start as pointers. A successful matching native `read`, `edit`, or `write` attaches the body **after** the tool runs. Read an existing target before editing. For a new file or Bash operation, read the relevant rule explicitly. This is not pre-write enforcement. Do not port skills, rewrite rules, or enable other `pi-code` integrations.

## Implementation

### Implementation Phase 1: Make the Git package installable

1. Add the root `package.json` above. Commit a root `package-lock.json` generated with npm's `--legacy-peer-deps` policy, as Pi uses for Git installs with npm. Do not add Pi itself to runtime dependencies. Ignore `/node_modules/` in `.gitignore`; do not commit installed modules or hand-edit generated output.
2. In `config/pi/README.md`, document the Git install, the agent prerequisite, and when scoped rules take effect. Explain that approval persists as Pi project trust. A headless run does not grant approval to an undecided project. Distinguish the local skills/agents install from the Git package. Link these instructions from the root README. Keep current boot instructions until adoption.
3. Fix the test imports in `ai-renderer/tests/check_ai_loaders.mjs`. The managed `pi-subagents` Git checkout supplies TypeScript, not the compiled `.js` files the test expects under `npm/node_modules`. Resolve the configured installation and use its TypeScript-capable loader for Git sources; retain support for existing npm installs. Share that test-only import path with Phase 2. Check the rendered output with `python ai-renderer/render_ai.py --check` and run `node ai-renderer/tests/check_ai_loaders.mjs` on the pinned agent-lab host. This phase changes no managed registration.

### Implementation Phase 2: Check the real Git install and model context

1. Add an opt-in test at `config/pi/tests/claude-rules-package.test.mjs`. Use an explicit candidate Git ref and a disposable home, Pi profile, and project outside the source checkout. Install the package through the real `pi install` command. Use the actual pinned dependency, not a mock. A candidate may use a local Git URL rewrite to a committed checkout; use the canonical Git source in settings in either case. Skip ordinary offline runs; an explicitly requested check must fail on missing prerequisites or install errors.
2. Check the installed version and the active extension paths, not just `pi list`. Exactly one entrypoint from `pi-code` may load. Check skills from the installed Git checkout and `mzizzi.*` agent discovery with the managed `pi-subagents` revision. Reuse the Phase 1 test loader and the existing resource inventory. Do not repeat renderer or model-metadata tests here.
3. Reuse the scripted provider from `config/pi/tests/worktree-runtime.test.mjs`, not its forced SDK trust result. Isolate user rules and trust storage in disposable homes. Use a project with `.claude/rules/` but no Pi project resources. Answer the loader's actual confirmation in separate fresh profiles. On approval, check that user and unscoped project bodies reach the first request, while the scoped rule contributes only a pointer. Check that its body stays absent after a non-matching read and appears after a matching read. On denial, check that user rules remain and neither project bodies nor pointers reach any request, even after a matching read. Check the undecided headless case without granting trust. Use distinct markers and no live model.
4. Run the same check against the actual Pi CLI **and corresponding SDK** for agent-lab (1.6.0), the SimRacing devcontainer (1.6.0), and SimRacing sbx (1.5.0). Record the candidate SHA, host versions, and outcomes before adoption. A skip is not a pass. Hold adoption for any failing host; do not relax trust or silently enable other extensions to make it pass.

#### Phase 2 verification

Candidate `0f9b7a8682c6c1948ef3e709accd7110d0d0b9e3` was committed only in a disposable checkout. The test ran `pi install` with the canonical Git source and a local Git URL rewrite. It also installed managed `pi-subagents` at `52e68e9ef0e563d5c97b28519f9999f1b5fbbbea`.

| Target environment | Result |
| --- | --- |
| agent-lab, Pi 1.5.2 | Passed. Real CLI install, interactive terminal approval, and undecided print mode; matching SDK extension paths, skills, agents, and approve, deny, and undecided request context. |
| agent-lab, Pi 1.6.0 | Passed. Candidate `ce6e76e9b6356051e5cd604287a09a8ac5f4172f` from GitHub with the same `pi-subagents` revision; same opt-in test, all subtests passed. agent-lab now ships 1.6.0. |
| SimRacing devcontainer, Pi 1.6.0 | Not run — operator to verify. |
| SimRacing sbx, Pi 1.5.0 | Not run — operator to verify. |

Standalone npm installations of Pi 1.5.0 and 1.6.0 passed the Git install, SDK, interactive terminal approval, and print-mode checks. These fixture runs do not verify consumer environments. Hold adoption until the shipped checks pass and the checked commit is reachable upstream.

### Implementation Phase 3: Adopt the checked commit in managed profiles (separate rollout)

1. After the checked package commit is available upstream, add its full `git:github.com/mzizzi/mzizzi-dotfiles@<commit>` string to `sandbox/agent-lab/pi/settings.json`. This later commit can name the earlier package commit without a self-reference. Keep the `pi-code` version only in the root manifest. The shared `pi/setup.sh` already installs string entries; it needs no package-object support. **Coordinate this step with SimRacing:** its sbx boot reapplies these settings from the updated marketplace checkout. Do not merge the settings change as part of Phase 1.
2. Protect existing profiles at **both** setup entrypoints. In `sandbox/agent-lab/pi/setup.sh`, check the existing profile before copying managed settings. In `sandbox/agent-lab/bin/setup-pi.sh`, stop rendering at boot and use the exact Git source from the shared settings. Share the registration checks under `sandbox/agent-lab/pi/` so the image's `/opt/pi-setup/` copy includes them. Recognize this checkout's `generated/pi/packages/mzizzi` and `ai-rendered/pi/packages/mzizzi` paths, including settings-relative spellings; treat Git sources as identifiers. Stop before mutation if settings are malformed or a matching entry has restrictions. Report the entry: filters relative to the old package root need review before migration.
3. Save the pre-setup settings before a mutating install or cleanup. Install and check the Git package, remove obsolete unrestricted registrations, and check that exactly one intended source remains. On install, removal, or check failure, restore the previous settings (or their prior absence) before returning an error. Do not remove an existing working checkout. On success, base setup still owns the whole settings file; boot setup preserves unrelated settings, `PI_CODING_AGENT_DIR`, and custom extension links. Boot setup need not fetch again when the registration, checkout SHA, and dependency match.
4. Keep the migration cases in `sandbox/agent-lab/tests/setup-pi.test.mjs` only. Cover fresh and repeated starts, both old paths, relative entries, restricted filters, stale settings, and unrelated links. Simulate install and cleanup failures, including success exits that leave settings unchanged. Assert the usable registration immediately after failure and after retry. Exercise base setup followed by boot setup on a persisted profile with restrictions and with an install failure. Remove the migration loops from `ai-renderer/tests/check_ai_loaders.mjs`; point its resource checks directly at the local rendered package. Keep network access opt-in.
5. Check fresh and upgraded profiles through the actual SimRacing lifecycle: devcontainer post-create **then** post-start, and sbx boot through the shared base installer. Run `sbx/test_sandbox.py::test_pi_setup`; check one mzizzi registration and a matching repo rule. No second pin or rule edits are needed. Update the boot description in `sandbox/agent-lab/agent-lab.yaml` and workflow text in `README.md`, `sandbox/README.md`, `ai-renderer/README.md`, and `config/pi/README.md`. Document that future rendered skill and agent changes reach managed profiles only after the checked Git pin advances. If adoption fails, hold rollout and restore the previous provisioning revision and registration.

## Follow-ups

- _None yet._
