import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

import yaml

RENDERER = Path(__file__).resolve().parent.parent
REPO = RENDERER.parent
sys.path.insert(0, str(RENDERER))
from render_ai import RenderError, Target, build


class AgentTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        shutil.copytree(REPO / "ai", self.repo / "ai")
        self.source = self.repo / "ai/mzizzi/agents/pragmatic-reviewer.md.j2"

    def output(self, target, name="pragmatic-reviewer"):
        packages = "plugins" if target == Target.CLAUDE else "packages"
        return self.repo / "generated" / target / packages / "mzizzi/agents" / f"{name}.md"

    def test_agents_preserve_instructions_and_target_settings(self):
        build(self.repo)
        cases = (
            ("pragmatic-reviewer", "chatgpt/gpt-6-astra", "medium"),
            ("standard", "chatgpt/gpt-6.1-sol", "high"),
            ("complex", "chatgpt/gpt-6-astra", "medium"),
            ("simple", "chatgpt/gpt-6.1-sol", "medium"),
        )
        for name, model, thinking in cases:
            original = (REPO / "plugins/mzizzi/agents" / f"{name}.md").read_text()
            _, metadata, body = original.split("---", 2)
            for target in Target:
                with self.subTest(agent=name, target=target):
                    _, rendered_metadata, rendered_body = self.output(target, name).read_text().split("---", 2)
                    actual = yaml.safe_load(rendered_metadata)
                    if target == Target.CLAUDE:
                        self.assertEqual(actual, yaml.safe_load(metadata))
                        reference = "the `mzizzi:development-preferences` skill"
                    else:
                        self.assertEqual(actual, {
                            "name": name, "package": "mzizzi",
                            "description": yaml.safe_load(metadata)["description"],
                            "model": model, "thinking": thinking,
                            "advertise": True, "defaultContext": "fresh",
                            "systemPromptMode": "replace", "inheritProjectContext": True,
                            "inheritGlobalContext": True, "inheritSkills": True,
                        })
                        reference = "the `development-preferences` skill"
                    self.assertEqual(rendered_body, body.replace("the mzizzi:development-preferences skill", reference))

    def test_delegator_has_portable_roles_and_native_nested_delegation(self):
        build(self.repo)
        for target in Target:
            with self.subTest(target=target):
                _, metadata, body = self.output(target, "delegator").read_text().split("---", 2)
                metadata = yaml.safe_load(metadata)
                self.assertEqual(metadata["model"], "opus" if target == Target.CLAUDE else "chatgpt/gpt-6.1-sol")
                if target == Target.PI:
                    self.assertNotIn("experimental", metadata)
                    self.assertIs(metadata["allowNestedSubagents"], True)
                    self.assertEqual(metadata["thinking"], "high")
                else:
                    original = (REPO / "plugins/mzizzi/agents/delegator.md").read_text().split("---", 2)[1]
                    self.assertEqual(metadata, yaml.safe_load(original))
                    self.assertNotIn("allowNestedSubagents", metadata)
                for role in ("standard", "simple", "complex"):
                    separator = ":" if target == Target.CLAUDE else "."
                    self.assertIn(f"the `mzizzi{separator}{role}` agent", body)
                self.assertIn("up to 10", body)
                self.assertIn("below 150k tokens", body)
                self.assertIn("not runtime-enforced caps", body)

    def test_agent_references_resolve_across_namespaces(self):
        folder = self.repo / "ai/other/agents"
        folder.mkdir(parents=True)
        (folder / "reviewer.md.j2").write_text('---\ndescription: Review.\n---\nReview.\n')
        self.source.write_text('---\ndescription: Review.\n---\n{{ Agent("other:reviewer") }}\n')
        build(self.repo)
        self.assertIn("the `other:reviewer` agent", self.output(Target.CLAUDE).read_text())
        self.assertIn("the `other.reviewer` agent", self.output(Target.PI).read_text())
        manifest = self.repo / "generated/pi/packages/other/package.json"
        self.assertEqual(json.loads(manifest.read_text())["pi"], {"subagents": {"agents": ["./agents"]}})
        self.source.write_text('---\ndescription: Review.\n---\n{{ Agent("development-preferences") }}\n')
        with self.assertRaisesRegex(RenderError, "unknown agent"):
            build(self.repo)

    def test_invalid_agent_metadata_leaves_previous_output(self):
        build(self.repo)
        before = self.output(Target.PI).read_bytes()
        for field in (
            "claude:\n  permissionMode: plan",
            "pi:\n  inheritGlobalContext: wrong",
            "pi:\n  allowNestedSubagents: wrong",
            "claude:\n  experimental:\n    unknown: 1h",
            "claude:\n  experimental:\n    cacheTtl: false",
            "pi:\n  model: |\n    First line.\n    Second line.",
        ):
            with self.subTest(field=field):
                self.source.write_text(f'---\ndescription: Review.\n{field}\n---\nReview.\n')
                with self.assertRaises(RenderError):
                    build(self.repo, targets=(Target.PI,))
                self.assertEqual(self.output(Target.PI).read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
