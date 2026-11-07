import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import yaml

RENDERER = Path(__file__).resolve().parent.parent
REPO = RENDERER.parent
sys.path.insert(0, str(RENDERER))
from render_ai import MARKER, RenderError, Target, build


class RendererTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name)
        shutil.copytree(REPO / "ai", self.repo / "ai")
        self.source = self.repo / "ai/mzizzi/skills/renderer-example"
        self.template = self.source / "SKILL.md.j2"

    def skill_output(self, target=Target.PI):
        if target == Target.PI:
            return self.repo / "generated/pi/packages/mzizzi/skills/renderer-example"
        return self.repo / "generated/claude/plugins/mzizzi/skills/renderer-example"

    def snapshot(self):
        return {
            path.relative_to(self.repo): (path.read_bytes(), stat.S_IMODE(path.stat().st_mode))
            for path in (self.repo / "generated").rglob("*") if path.is_file()
        }

    def test_both_targets_match_expected_skill_and_manifests(self):
        build(self.repo)
        for target in Target:
            with self.subTest(target=target):
                output = (self.skill_output(target) / "SKILL.md").read_text()
                expected = (RENDERER / "tests/fixtures/expected" / target / "SKILL.md").read_text()
                self.assertEqual(output, expected)
                self.assertEqual(
                    (self.skill_output(target) / "references/example.txt").read_bytes(),
                    (self.source / "references/example.txt").read_bytes(),
                )
        pi_manifest = self.repo / "generated/pi/packages/mzizzi/package.json"
        self.assertEqual(json.loads(pi_manifest.read_text()), {
            "name": "mzizzi-ai", "pi": {"skills": ["./skills"]},
        })
        claude_manifest = self.repo / "generated/claude/plugins/mzizzi/.claude-plugin/plugin.json"
        self.assertEqual(json.loads(claude_manifest.read_text()), {"name": "mzizzi"})

    def test_qualified_references_and_resource_templates(self):
        other = self.repo / "ai/other/skills/other-example"
        other.mkdir(parents=True)
        (other / "SKILL.md.j2").write_text(
            '---\ndescription: Another example.\n---\nLoad {{ Skill("mzizzi:renderer-example") }}.\n'
        )
        (self.source / "references/link.md.j2").write_text('See {{ Skill("other:other-example") }}.\n')
        build(self.repo)
        self.assertEqual(
            (self.skill_output() / "references/link.md").read_text(),
            'See the `other-example` skill.\n',
        )
        other_output = self.repo / "generated/claude/plugins/other/skills/other-example/SKILL.md"
        self.assertIn("the `mzizzi:renderer-example` skill", other_output.read_text())

    def test_nested_skill_template_is_a_resource_not_an_entrypoint(self):
        nested = self.source / "references/SKILL.md.j2"
        nested.write_text('# Example skill document\n\nSee {{ Skill("renderer-example") }}.\n')
        build(self.repo)
        self.assertEqual(
            (self.skill_output() / "references/SKILL.md").read_text(),
            '# Example skill document\n\nSee the `renderer-example` skill.\n',
        )

    def test_literal_resources_binary_and_script_mode(self):
        (self.source / "asset.bin").write_bytes(b"\x00\xff{{ untouched }}\r\n")
        script = self.source / "run.sh"
        script.write_bytes(b"#!/bin/sh\nprintf '{{ literal }}\\n'\n")
        script.chmod(0o755)
        build(self.repo)
        for name in ("asset.bin", "run.sh"):
            self.assertEqual((self.skill_output() / name).read_bytes(), (self.source / name).read_bytes())
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE((self.skill_output() / "run.sh").stat().st_mode), 0o755)

    def test_invalid_templates_preserve_previous_output(self):
        cases = (
            ('---\ndescription: Example.\n---\n{{ missing }}', "undefined"),
            ('---\ndescription: Example.\n---\n{{ Skill("missing") }}', "unknown skill"),
            ('---\ndescription: Example.\n---\n{{ Skill(12) }}', "string identity"),
            ('---\ndescription: [broken\n---\n', "renderer-example"),
            ('---\ndescription: Example.\nname: wrong\n---\n', "unsupported shared"),
            ('---\ndescription: Example.\npi:\n  allowed-tools: read\n---\n', "unsupported pi"),
            ('---\ndescription: Example.\nclaude:\n  allowed-tools: [Bash]\n---\n', "must be str"),
            ('---\ndescription: Example.\nclaude:\n  user-invocable: text\n---\n', "must be bool"),
            ('---\ndescription: one\ndescription: two\n---\n', "duplicate metadata"),
            ('---\n- not-a-mapping\n---\n', "must be a mapping"),
            ('---\ndescription: Example.\npi: null\n---\n', "must be a mapping"),
            ('---\ndescription: ""\n---\n', "description must"),
            ('---\ndescription: Example.\n', "closing frontmatter"),
            ('No frontmatter.\n', "expected YAML"),
        )
        build(self.repo)
        before = self.snapshot()
        for text, message in cases:
            with self.subTest(message=message):
                self.template.write_text(text)
                with self.assertRaisesRegex(RenderError, message) as raised:
                    build(self.repo)
                self.assertIn(str(self.template), str(raised.exception))
                self.assertIn("claude:", str(raised.exception))
                self.assertEqual(self.snapshot(), before)

    def test_collisions_and_names_fail_before_publication(self):
        build(self.repo)
        before = self.snapshot()
        (self.source / "references/example.txt.j2").write_text("Collision.\n")
        with self.assertRaisesRegex(RenderError, "duplicate output"):
            build(self.repo)
        self.assertEqual(self.snapshot(), before)
        (self.source / "references/example.txt.j2").unlink()
        for namespace, name in (("a", "review"), ("b", "review")):
            folder = self.repo / "ai" / namespace / "skills" / name
            folder.mkdir(parents=True)
            (folder / "SKILL.md.j2").write_text('---\ndescription: Collision.\n---\n')
        with self.assertRaisesRegex(RenderError, "output name collision"):
            build(self.repo)
        self.assertEqual(self.snapshot(), before)

    def test_name_limits_and_missing_entrypoint(self):
        longest = self.source.with_name("x" * 64)
        self.source.rename(longest)
        (longest / "SKILL.md.j2").write_text('---\ndescription: Name limit example.\n---\n')
        try:
            build(self.repo)
            output = self.repo / "generated/pi/packages/mzizzi/skills" / longest.name / "SKILL.md"
            self.assertEqual(yaml.safe_load(output.read_text().split("---")[1])["name"], longest.name)
        finally:
            longest.rename(self.source)
        for name, message in (("bad--name", "invalid skill"), ("x" * 65, "invalid skill")):
            with self.subTest(name=name):
                new = self.source.with_name(name)
                self.source.rename(new)
                (new / "SKILL.md.j2").write_text('---\ndescription: Name limit example.\n---\n')
                try:
                    with self.assertRaisesRegex(RenderError, message):
                        build(self.repo)
                finally:
                    new.rename(self.source)
        self.template.unlink()
        with self.assertRaisesRegex(RenderError, "missing SKILL"):
            build(self.repo)

    def test_check_mode_reports_drift_without_writes(self):
        changes = build(self.repo, check=True)
        self.assertTrue(any("missing:" in change for change in changes))
        self.assertFalse((self.repo / "generated").exists())
        build(self.repo)
        self.assertEqual(build(self.repo, check=True), [])
        output = self.skill_output() / "SKILL.md"
        output.write_text("Changed.\n")
        stale = self.skill_output() / "old.txt"
        stale.write_text("Stale.\n")
        (self.skill_output() / "references/example.txt").unlink()
        before = self.snapshot()
        changes = build(self.repo, check=True)
        self.assertEqual({change.split(":", 1)[0] for change in changes}, {"changed", "missing", "stale"})
        self.assertEqual(self.snapshot(), before)

    def test_selected_target_removes_stale_files_and_preserves_other_target(self):
        build(self.repo)
        claude = {path: value for path, value in self.snapshot().items() if path.parts[1] == "claude"}
        self.template.write_text('---\ndescription: Changed example.\n---\nChanged.\n')
        stale = self.skill_output() / "stale.txt"
        stale.write_text("Stale.\n")
        build(self.repo, targets=(Target.PI,))
        self.assertFalse(stale.exists())
        self.assertEqual({path: value for path, value in self.snapshot().items() if path.parts[1] == "claude"}, claude)
        shutil.rmtree(self.repo / "ai/mzizzi")
        build(self.repo, targets=(Target.PI,))
        self.assertEqual(list((self.repo / "generated/pi").iterdir()), [self.repo / "generated/pi" / MARKER])

    def test_unowned_output_is_not_replaced(self):
        unowned = self.repo / "generated/pi"
        unowned.mkdir(parents=True)
        (unowned / "keep.txt").write_text("Keep.\n")
        with self.assertRaisesRegex(RenderError, "unowned output"):
            build(self.repo)
        self.assertEqual((unowned / "keep.txt").read_text(), "Keep.\n")
        self.assertFalse((self.repo / "generated/claude").exists())

    @unittest.skipIf(os.name == "nt", "Symlink creation needs privileges on Windows")
    def test_source_and_output_symlinks_are_rejected(self):
        link = self.source / "link"
        link.symlink_to(self.template)
        with self.assertRaisesRegex(RenderError, "source symlinks"):
            build(self.repo)
        link.unlink()
        build(self.repo)
        link = self.skill_output() / "link"
        link.symlink_to(self.template)
        with self.assertRaisesRegex(RenderError, "output symlinks"):
            build(self.repo)
        link.unlink()
        shutil.rmtree(self.repo / "generated")
        external = self.repo / "external"
        external.mkdir()
        (self.repo / "generated").symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(RenderError, "output symlinks"):
            build(self.repo)
        self.assertEqual(list(external.iterdir()), [])

    def test_publish_failure_restores_previous_target(self):
        build(self.repo)
        before = self.snapshot()
        self.template.write_text('---\ndescription: Changed.\n---\nChanged.\n')
        rename = Path.rename

        def fail_staging(path, destination):
            if path.name == "new":
                raise OSError("Simulated replacement failure")
            return rename(path, destination)

        with patch.object(Path, "rename", fail_staging):
            with self.assertRaisesRegex(OSError, "replacement failure"):
                build(self.repo)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(list((self.repo / "generated").glob(".ai-render-*")))

    def test_failed_recovery_preserves_backup_and_reports_its_path(self):
        build(self.repo)
        before = {
            Path(*relative.parts[2:]): value
            for relative, value in self.snapshot().items()
            if relative.parts[1] == "claude"
        }
        self.template.write_text('---\ndescription: Changed.\n---\nChanged.\n')
        rename = Path.rename

        def fail_replacement_and_recovery(path, destination):
            if path.name in ("new", "old"):
                raise OSError("Simulated replacement and recovery failure")
            return rename(path, destination)

        with patch.object(Path, "rename", fail_replacement_and_recovery):
            with self.assertRaisesRegex(RenderError, "previous output remains at") as raised:
                build(self.repo)
        backup, = (self.repo / "generated").glob(".ai-render-*/old")
        self.assertIn(str(backup), str(raised.exception))
        self.assertEqual(
            {
                path.relative_to(backup): (path.read_bytes(), stat.S_IMODE(path.stat().st_mode))
                for path in backup.rglob("*") if path.is_file()
            },
            before,
        )

    def test_cli_resolves_repo_from_script_and_reports_check_status(self):
        renderer = self.repo / "ai-renderer"
        renderer.mkdir()
        shutil.copy2(RENDERER / "render_ai.py", renderer / "render_ai.py")
        command = [sys.executable, str(renderer / "render_ai.py")]
        missing = subprocess.run(command + ["--check"], cwd=renderer, capture_output=True, text=True)
        self.assertEqual(missing.returncode, 1)
        self.assertIn("missing:", missing.stdout)
        first = subprocess.run(command, cwd=renderer, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        before = self.snapshot()
        second = subprocess.run(command, cwd=renderer, capture_output=True, text=True)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(self.snapshot(), before)
        checked = subprocess.run(command + ["--check"], cwd=renderer, capture_output=True, text=True)
        self.assertEqual(checked.returncode, 0, checked.stderr)


if __name__ == "__main__":
    unittest.main()
