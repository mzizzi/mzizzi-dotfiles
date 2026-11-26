# Shared Pi loader for Claude rules — Brainstorm

## The idea

Make Pi use existing `.claude/rules/` files in mzizzi-dotfiles and, later, SimRacing. Give consumers one mzizzi Pi package that supplies the existing rendered resources and the rules loader. The user accepts the full `pi-code` dependency on disk but wants only its rules extension active. New skill discovery and skill ports are out of scope.

## Decisions

### Use an upstream dependency with one enabled extension

- **Question:** How do we reuse `pi-code` without adding its whole suite to the harness?
- **Decision:** Declare `"pi-code": "1.10.2"` in the root `package.json` `dependencies`. List only `./node_modules/pi-code/extensions/claude-rules.ts` in `pi.extensions`. Do not copy, bundle, fork, or wrap the loader. Do not enable the `pi-code` skills bridge or any other entrypoint.
- **Why:** [Pi](https://docs.pi.dev/latest/packages) installs npm dependencies for Git packages and selects resources from the installed package's own manifest. A disposable Git fixture on Pi 1.5.2 installed its dependency, loaded only the listed extension, and found a nested rendered skill. There was no separate Pi registration for the dependency. The full dependency remains on disk, which the user accepts. The fixture did not exercise the real `pi-code` package at startup.

### Distribute one Git package

- **Question:** How do consumers get the existing rendered resources and the rules loader with one install?
- **Decision:** Make the dotfiles repo root a Git-installable Pi package. Point its `pi.skills` and `pi.subagents.agents` at the existing committed directories under `ai-rendered/pi/packages/mzizzi/`. Consumers install `git:github.com/mzizzi/mzizzi-dotfiles@<ref>`. Keep the rendered output and its current renderer; do not add a build step to the consumer install.
- **Why:** This replaces the earlier filtered `pi-code` entry in `sandbox/agent-lab/pi/settings.json`. That entry would work for the shared bootstrap, but consumers who install only the mzizzi package would not get the rules loader. Pi installs dependencies at the Git checkout root. The disposable fixture also checked that Pi's local-path install registers the package without installing dependencies. A Git install needs neither an npm publication nor a second install command.

### Keep upstream rule behavior

- **Question:** What compatibility does the shared loader promise?
- **Decision:** Leave `.claude/rules/` as the source of truth. Load user rules and approved project rules through upstream behavior. Unscoped bodies reach the initial prompt. Scoped rules start as pointers and attach their bodies after a successful matching native `read`, `edit`, or `write`. Read an existing target first. For a new file or Bash operation, read the rule itself first. Do not change project trust or promise enforcement before writes or Bash activation.
- **Why:** Checked `pi-code@1.10.2`'s published parser and matcher against all 20 current SimRacing rules. It found 13 unscoped and 7 scoped rules, and passed 24 matching and non-matching cases, including the `rf2-crlf.md` brace globs. For new rules, use quoted YAML list items and explicit `**/` for recursion. Inline comments, quoted comma-separated scalars, and bare `*.md` can behave differently from Claude. No existing rules need a rewrite.

### Check the install path and the rules the model receives

- **Question:** What evidence is enough before consumers switch to the Git package?
- **Decision:** Run an opt-in smoke in a disposable Pi profile. Install the dotfiles Git package at a candidate ref and check that Pi installs the real pinned `pi-code` dependency. Check that only its rules entrypoint starts and the existing rendered skills and agents still resolve. Use a scripted provider to check user rules, approved unscoped rules, scoped bodies after matching native reads, and the negative cases for non-matching reads and denied trust. No live model calls or network-dependent ordinary tests.
- **Why:** The Git fixture proved the installation and selection mechanism on Pi 1.5.2, not compatibility with the actual dependency. `config/pi/tests/worktree-runtime.test.mjs` provides a local scripted-provider pattern. Before rollout, check the shipped Pi versions: agent-lab 1.6.0, SimRacing devcontainer 1.6.0, and SimRacing sbx 1.5.0. If a shipped version fails, update that version through its normal owner or hold that rollout.

### Move consumers to the same package after the dotfiles change

- **Question:** How does SimRacing adopt the Git package without a separate `pi-code` configuration?
- **Decision:** First make the dotfiles Git package available at a checked ref. Later, use the same Git package registration in SimRacing's managed setup. Replace the old local mzizzi package registration where it exists; do not load both versions in the same profile. Keep the `pi-code` pin in dotfiles and leave SimRacing's rules and skills unchanged.
- **Why:** Checked `sandbox/agent-lab/bin/setup-pi.sh` and `SimRacing/.devcontainer/post-start.sh:46`: agent-lab and the devcontainer register the local rendered package on boot today. SimRacing sbx calls the shared base settings installer instead (`sbx/simracing/simracing.yaml:407–414`), so it needs the new mzizzi package registration at adoption. The earlier filtered settings proposal needed a SimRacing test change for object entries. The Git package uses a string entry, so that change is no longer needed.
