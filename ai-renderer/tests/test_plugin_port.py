import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import unittest

from test_pilot_skills import REPO, skill_document
from render_ai import Target, build


def renamed(name):
    return "adversarial-review" if name == "codex-adversarial-review" else name


def expected_claude_body(body):
    body = body.replace("codex-adversarial-review", "adversarial-review")
    replacements = {
        "Codex looks for what's missing, the pragmatic reviewer for what's excess. Start the pragmatic reviewer in the background, then run Codex:":
            "The adversarial reviewer looks for what's missing, the pragmatic reviewer for what's excess. Start the pragmatic reviewer in the background, then run adversarial review:",
        "tagged `[Codex]`": "tagged `[Adversarial]`",
        "and the fix Codex proposed where that holds up.": "and the fix the reviewer proposed where that holds up.",
        "Ask one question at a time, through the harness's interactive user-question tool (e.g. `AskUserQuestion` in Claude Code) if it has one. Otherwise, write the question as numbered options and stop.":
            "Ask one question at a time using a question tool if available. Otherwise, ask with numbered options and wait.",
        "Run the `mzizzi:brainstorm` skill with an agent answering in the user's place. Where this skill and brainstorm differ, this skill wins: questions go to the interviewee agent, never to the user or the harness's user-question tool, and you pick brainstorm's menu options yourself (see Ending). Load it with:":
            "Run the `mzizzi:brainstorm` skill with an interviewee agent instead of the user. This skill overrides brainstorm: send questions to the interviewee and choose menu options yourself (see Ending).",
        "It derives the branch name, gathers the git state, and prints `KEY=value` lines ending in a recommended `ACTION`. It only reports — it never switches, creates, or commits, because entering a worktree is a harness tool call rather than a shell command, and because a script that both decides and acts is harder to override when its recommendation is wrong.":
            "The script prints the branch and Git state as `KEY=value` lines ending in a recommended `ACTION`. It does not switch branches, create worktrees, or commit.",
        "The script hands you this call rather than making it because it can compare strings but can't tell that two differently-worded names describe the same effort. If it's genuinely ambiguous, ask the user — landing a plan's implementation on somebody else's in-progress branch is annoying to unpick.":
            "If the current branch's purpose is ambiguous, ask the user before switching.",
        "Two things worth passing on when a worktree is involved: the session cwd changed, so any path the caller resolved earlier (the plan document especially) should keep being referenced by its original absolute path; and the worktree persists after the session — on exit the harness offers to keep or remove it, and keeping it preserves the work for review.":
            "After worktree entry, keep plan paths absolute. Keep the worktree for review.",
        "Never pass `run_in_background: false` here. Batching the calls into one message is not enough on its own — a single synchronous agent blocks the whole fan-out until it returns, and you don't need any agent's result before step 5.":
            "Use `run_in_background: true` for every agent.",
        "Every item is knowable now, so build the list in **two messages**: one carrying every `TaskCreate`, one carrying every `TaskUpdate` that chains them. Two only because `TaskCreate` has no blocked-by field.":
            "Build the list in **two messages**: all `TaskCreate` calls, then all `TaskUpdate` calls that chain them.",
        "**Don't hand-write numbers into subjects.** The harness assigns each task an id, and that id is this run's task number. The plan's phase numbers are a different scheme that won't line up with it, since the tail items belong to no phase at all. Name the phase as text — its own title from the plan — and let the id do the numbering:":
            "**Use phase titles without hand-written task numbers.** `TaskCreate` assigns task ids:",
    }
    for original, replacement in replacements.items():
        body = body.replace(original, replacement)
    return body


class PluginPortTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ai-plugin-port-")
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        shutil.copytree(REPO / "ai", self.repo / "ai")
        build(self.repo)

    def package(self, target):
        kind = "plugins" if target == Target.CLAUDE else "packages"
        return self.repo / "generated" / target / kind / "mzizzi"

    def test_all_claude_frontmatter_and_skill_bodies_match_original(self):
        original = REPO / "plugins/mzizzi"
        for kind, pattern in (("skills", "*/SKILL.md"), ("agents", "*.md")):
            for source in sorted((original / kind).glob(pattern)):
                with self.subTest(resource=source.relative_to(original)):
                    relative = str(source.relative_to(original)).replace("codex-adversarial-review", "adversarial-review")
                    output = self.package(Target.CLAUDE) / relative
                    expected_metadata, expected_body = skill_document(source)
                    metadata, body = skill_document(output)
                    if source.parent.name == "codex-adversarial-review":
                        self.assertEqual(metadata["name"], "adversarial-review")
                        self.assertIn("600000", body)
                        self.assertIn("A `complete` review", body)
                        continue
                    self.assertEqual(metadata, expected_metadata)
                    if kind == "skills":
                        self.assertEqual(body, expected_claude_body(expected_body))
            expected = {renamed(path.name) for path in (original / kind).iterdir()}
            self.assertEqual({path.name for path in (self.package(Target.CLAUDE) / kind).iterdir()}, expected)

    def test_skill_resources_match_both_targets(self):
        for source in sorted((REPO / "plugins/mzizzi/skills").iterdir()):
            if source.name == "codex-adversarial-review":
                # This bundle deliberately changes transport, prompt delivery, and outcome handling.
                continue
            resources = {
                path.relative_to(source): path
                for path in source.rglob("*") if path.is_file() and path.name != "SKILL.md"
            }
            for target in Target:
                with self.subTest(skill=source.name, target=target):
                    output = self.package(target) / "skills" / source.name
                    self.assertEqual(
                        {path.relative_to(output) for path in output.rglob("*") if path.is_file()},
                        {Path("SKILL.md"), *resources},
                    )
                    for relative, original in resources.items():
                        staging = self.repo / "ai/mzizzi/skills" / source.name / relative
                        for copy in (staging, output / relative):
                            self.assertEqual(copy.read_bytes(), original.read_bytes())
                            if os.name != "nt":
                                self.assertEqual(stat.S_IMODE(copy.stat().st_mode), stat.S_IMODE(original.stat().st_mode))

    def test_pi_workflows_forward_arguments_without_claude_tool_calls(self):
        skills = self.package(Target.PI) / "skills"
        expected = {renamed(path.name) for path in (REPO / "plugins/mzizzi/skills").iterdir()}
        self.assertEqual({path.name for path in skills.iterdir()}, expected)
        for name in sorted(expected):
            with self.subTest(skill=name):
                metadata, body = skill_document(skills / name / "SKILL.md")
                original_name = "codex-adversarial-review" if name == "adversarial-review" else name
                original_metadata, original_body = skill_document(REPO / "plugins/mzizzi/skills" / original_name / "SKILL.md")
                description = original_metadata["description"]
                if name == "adversarial-review":
                    description = "Run an adversarial review of a plan, document, or code change. Challenge assumptions and report material findings with evidence, or explain why the review is unavailable."
                if name == "auto-brainstorm":
                    description = description.replace("mzizzi:complex", "mzizzi.complex")
                self.assertEqual(metadata, {
                    "name": name,
                    "description": description,
                    "disable-model-invocation": original_metadata["disable-model-invocation"],
                })
                forbidden = ["Skill(skill:", "Agent(subagent_type:", "SendMessage", "run_in_background:"]
                if name not in {"prepare-feature-branch", "review-pr"}:
                    forbidden.extend(["EnterWorktree(", "ExitWorktree("])
                if name != "implement-plan":
                    forbidden.extend(["TaskCreate", "TaskUpdate"])
                for token in forbidden:
                    self.assertNotIn(token, body)
                self.assertNotRegex(body, r"mzizzi:[a-z-]+")
                for args in re.findall(r'Skill\(skill: "[a-z-]+",\s*args: "([^"]*)"\)', original_body):
                    self.assertIn(args, body)

    def test_pi_adaptations_keep_live_interviews_review_order_and_stop_conditions(self):
        def body(name):
            return skill_document(self.package(Target.PI) / "skills" / name / "SKILL.md")[1]

        interview = body("auto-brainstorm")
        self.assertIn('async: true', interview)
        self.assertIn('contact_supervisor({ reason: "need_decision"', interview)
        self.assertIn('subagent_supervisor({ action: "reply", replyTo:', interview)
        self.assertIn("must not finish between questions", interview)
        self.assertIn("On `STOP`, finish and exit", interview)
        self.assertIn("Use supervisor replies for the interview", interview)
        self.assertIn("reply `STOP` to its pending request", interview)
        self.assertIn('action: "stop"', interview)
        self.assertNotIn('action: "resume"', interview)
        self.assertNotIn("latest interviewee run id", interview)
        self.assertNotIn("answer it and stop", interview)
        self.assertIn("It defaults to 2.", interview)
        self.assertIn("do not review again", interview)
        quality = body("fix-quality")
        self.assertIn("runs.all(", quality)
        self.assertIn('context: "fresh"', quality)
        self.assertIn("strictly read-only", quality)
        self.assertIn("including step 6", quality)
        self.assertIn("report its exact error and missing coverage", quality)
        sweep = body("fix-all")
        self.assertLess(sweep.index("../fix-correctness/SKILL.md"), sweep.index("../fix-quality/SKILL.md"))
        self.assertLess(sweep.index("../fix-quality/SKILL.md"), sweep.index("../fix-comments/SKILL.md"))
        self.assertIn("If fix-correctness stops without reviewing, stop", sweep)
        plan = body("create-plan")
        self.assertIn("never ask the user a question", plan)
        self.assertIn("If the decider fails, report the blocker and stop", plan)
        self.assertIn("/skill:implement-plan <target file path>", plan)
        self.assertNotIn("deferred until worktree support exists", plan)
        review = body("adversarial-review")
        self.assertIn('agent: "mzizzi.adversarial-reviewer"', review)
        self.assertIn('context: "fresh"', review)
        self.assertIn("outputSchema", review)
        self.assertIn("structured_output", review)
        self.assertNotIn("not Pi core", review)
        self.assertIn("Do not finish with prose", (self.package(Target.PI) / "skills/adversarial-review/scripts/lib/review.mjs").read_text())
        self.assertIn("ignore any partial artifact", review)
        self.assertNotIn("cross-model", body("fix-correctness"))
        self.assertNotIn("codex-adversarial-review", plan)

    def test_pi_worktree_workflows_preserve_order_scope_and_cleanup(self):
        def body(name):
            return skill_document(self.package(Target.PI) / "skills" / name / "SKILL.md")[1]

        prepare = body("prepare-feature-branch")
        for action in ("stay", "enter-worktree", "switch", "judge-current-branch-then-create", "create"):
            self.assertIn(f"**`{action}`**", prepare)
        self.assertIn('EnterWorktree({path: "<WORKTREE_PATH>"})', prepare)
        self.assertIn("alone in its message", prepare)
        self.assertIn("Wait for completed entry", prepare)
        self.assertIn("no outstanding child work", prepare)
        self.assertIn("stop for a transfer decision", prepare)
        self.assertIn("do not silently copy or commit elsewhere", prepare)
        self.assertNotIn("rerun the same command with elevated permissions", prepare)
        self.assertNotIn("the worktree's diff is clean either way", prepare)

        implementation = body("implement-plan")
        self.assertLess(implementation.index("../prepare-feature-branch/SKILL.md"), implementation.index("## Step 2"))
        self.assertLess(implementation.index("TaskCreate"), implementation.index("subagent({"))
        self.assertLess(implementation.index("subagent({"), implementation.index("../fix-all/SKILL.md"))
        self.assertIn("including completed worktree entry", implementation)
        self.assertIn("the `mzizzi.standard` agent: delegate at least one child per phase", implementation)
        self.assertIn('cwd:"<selected absolute cwd>"', implementation)
        self.assertIn('options:{context:"fresh"}', implementation)
        self.assertIn("--plan <plan document path> --strictness=high --apply=all", implementation)
        self.assertIn("same checkout and uncommitted diff", implementation)
        self.assertIn("Do not automatically exit", implementation)
        self.assertNotRegex(implementation, r"worktree\s*:\s*true")

        review = body("review-pr")
        self.assertIn("git worktree add --detach", review)
        self.assertIn("git worktree list --porcelain -z", review)
        self.assertIn("bindingWasActive", review)
        self.assertIn('EnterWorktree({path:"<start>"})', review)
        self.assertIn('ExitWorktree({action:"keep"})', review)
        self.assertIn("Wait for completed return", review)
        self.assertIn("--apply=none --base origin/<baseRefName>", review)
        self.assertIn("git worktree remove <path>", review)
        self.assertNotIn("git worktree remove --force", review)
        self.assertIn("Never force removal without approval", review)


if __name__ == "__main__":
    unittest.main()
