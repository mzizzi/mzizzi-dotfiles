import json
from pathlib import Path
import unittest

KIT = Path(__file__).resolve().parents[1]
MODELS = json.loads((KIT.parents[1] / "ai/models.json").read_text(encoding="utf-8"))


class KitModelsTest(unittest.TestCase):
    """ai/models.json picks the OpenAI models; the kit's copies have to match it."""

    def test_pi_default_model_is_sol(self):
        settings = json.loads((KIT / "pi/settings.json").read_text(encoding="utf-8"))
        self.assertEqual(settings["defaultModel"], MODELS["sol"])

    def test_kit_defaults_and_catalog_use_the_map(self):
        kit = (KIT / "agent-lab.yaml").read_text(encoding="utf-8")
        self.assertIn(f'default = "openai_codex:{MODELS["sol"]}"', kit)
        self.assertIn(f'auto_classifier = "openai_codex:{MODELS["sol"]}"', kit)
        for model in MODELS.values():
            with self.subTest(model=model):
                self.assertIn(f'"id": "{model}"', kit, "add a Pi models.json catalog entry for it")


if __name__ == "__main__":
    unittest.main()
