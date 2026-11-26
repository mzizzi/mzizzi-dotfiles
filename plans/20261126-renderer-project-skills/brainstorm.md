# Renderer project skills — Brainstorm

## The idea

Let a consumer repository render its own native Claude and Pi skills with the dotfiles renderer. SimRacing owns the source, the target choices, the renderer pin, and the hook. Dotfiles owns the render contract. Neither harness needs a SimRacing plugin, package, or settings entry. Rule loading and workflow ports are separate.

## Decisions

### Let the caller choose input and output

- **Question:** How does a consumer call the renderer without changing how dotfiles builds its own packages?
- **Decision:** Add a project skill invocation with `--input`, `--output`, and `--target`. If the caller supplies either path flag, require all three flags. The input points to the directory that contains the skill bundles. The output points to the exact generated directory. Each call renders one harness. Relative paths resolve from the caller's working directory. Use the same arguments with `--check` for a read-only check. Without the path flags, keep the existing script-relative package build.
- **Why:** SimRacing already knows where its source and outputs belong. Explicit paths remove checkout discovery and let each call show which tree it reads and which tree it replaces. Dotfiles still owns its own package layout.

Example calls from the SimRacing checkout, with `renderer` pointing to the pinned dotfiles script:

```bash
python "$renderer" --input ai/simracing/skills --output .claude/skills --target claude
python "$renderer" --input ai/simracing/skills --output .pi/skills --target pi
```

### Keep one render pipeline

- **Question:** What belongs to the layout, and what stays shared?
- **Decision:** Share Jinja, frontmatter, exclusions, resource copying, and collision checks. Read each project skill from `<input>/<name>/SKILL.md.j2` and emit it as `<output>/<name>/SKILL.md` with its supporting files. Resolve template includes from `--input`, never `--output`. For example, `rf2cast/_templates/pi.md.j2` resolves under `ai/simracing/skills/` in the Pi call above. A template can select the fragment with `{% include "rf2cast/_templates/" ~ target ~ ".md.j2" %}`. Do not emit `_templates/`.

  Project mode emits no agents or package manifests. Resolve `Skill()` references by bare name in the input catalog. Reject unknown references, references from included skills to excluded skills, and duplicate emitted names. Use target-specific text for installed external skills and agents; the renderer does not check their availability. Project mode passes an empty `models` mapping, so alias lookups still fail under strict template rendering. Package mode keeps its `ai/` template root, namespaced references, and model catalog.

- **Why:** `render_target` currently chooses paths, reference names, and manifests alongside template rendering. Those layout rules change for project mode. Template processing does not. Existing dotfiles includes continue to resolve from `ai/` without edits.

### Publish only owned skills trees

- **Question:** How does the renderer protect an existing checkout during migration and later renders?
- **Decision:** Own only the directory given by `--output`. Before writing, reject overlapping input and output trees, output paths that redirect through symlinks or directory junctions, and nonempty outputs without a project ownership marker. Reject an input with no discovered skill sources. If real sources exclude every skill for the requested target, clear its stale generated content in the normal owned-tree path. Reuse per-tree staging and recovery. Do not add `--force` or automatic adoption. A marked tree is wholly generated. An explicit render can remove any file without a source, including an untracked file.
- **Why:** `publish` swaps the whole destination. An output that overlaps the input could replace source files. `check_owned` checks the destination and its descendants but not its parents, so a linked parent could redirect writes. An empty input is different from an input with deliberate target exclusions. SimRacing owns its cutover: inventory tracked and local-only files, move maintained material to source, render from absent output roots in a disposable worktree, and review the replacement. Keep the script-only `rf2cast-jumps` code at a maintained path and update callers rather than creating a dummy skill.

### Leave hook and Git policy with the consumer

- **Question:** What does dotfiles ship, and what does SimRacing decide?
- **Decision:** Ship the script and its existing requirements. SimRacing pins the tool revision and provides the environment through its own setup. It runs the CLI from its own hook or CI and commits the generated skill trees. Support both explicit render and read-only check. Neither command stages files or defines Git candidate policy. No renderer downloader, Python distribution, or reusable hook package is needed for this use.
- **Why:** SimRacing already uses local system hooks. Dotfiles' `check_ai.py` checks paths and Git state for dotfiles, not for consumers. Document `--check` as the read-only check. If it reports drift, inspect the paths and preserve any manual files before rendering explicitly. An automatic repair can remove an untracked note before the hook reports failure. SimRacing can still choose a write hook; it owns any pre-write checks and the decision to stop the commit.

### Check layout, compatibility, and consumer use separately

- **Question:** What shows the new mode works without changing package builds?
- **Decision:** Run the real CLI from a separate consumer fixture. Check input-relative includes, native paths and names, target exclusions, support bytes and modes, and no package output. Check that one call leaves the other target alone. Check that drift fails without writes, including when an unexpected file exists in an owned tree. Check that render repairs drift without changing the Git index. Check that overlapping paths and unowned outputs fail without writes. Keep the existing package fixtures and add a native loader check in a trusted project or linked worktree. Keep SimRacing's live workflow tests out of the renderer.
- **Why:** The existing renderer tests check templates and ownership, while `ai-renderer/tests/check_ai_loaders.mjs` covers packages. Neither proves native discovery or CLI behavior from another checkout. Checked: the existing renderer unit tests pass. The default package `--check` passes in a clean clone with normal output permissions. Not checked: the proposed CLI, native discovery from its generated trees, and the consumer hook.
