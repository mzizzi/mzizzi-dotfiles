import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function expectedMzizziSkills(checkout) {
  return readdirSync(join(checkout, "plugins/mzizzi/skills"))
    .map((name) =>
      name === "codex-adversarial-review" ? "adversarial-review" : name,
    )
    .sort();
}

export function expectedMzizziAgents(checkout, target, parseFrontmatter) {
  const root = join(checkout, "ai/mzizzi/agents");
  return readdirSync(root)
    .filter((name) => {
      if (!name.endsWith(".md.j2")) return false;
      const { frontmatter } = parseFrontmatter(
        readFileSync(join(root, name), "utf8"),
      );
      return frontmatter[target] !== false;
    })
    .map((name) => name.slice(0, -".md.j2".length))
    .sort();
}
