import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePiSdk } from "./pi-loader-support.mjs";

const renderer = fileURLToPath(new URL("../", import.meta.url));
const temporary = realpathSync(
  mkdtempSync(join(tmpdir(), "ai-project-loader-")),
);
const cwd = join(temporary, "checkout");
const skill = "renderer-native-example";
const claudeOnly = "renderer-claude-only";
try {
  cpSync(join(renderer, "tests/fixtures/project"), join(cwd, "ai"), {
    recursive: true,
  });
  execFileSync("git", ["init", "--quiet"], { cwd });
  for (const target of ["claude", "pi"]) {
    execFileSync(
      process.env.PYTHON ?? "python",
      [
        join(renderer, "render_ai.py"),
        "--input",
        "ai/skills",
        "--output",
        `.${target}/skills`,
        "--target",
        target,
      ],
      { cwd },
    );
  }

  const { entry } = resolvePiSdk();
  process.env.HOME = temporary;
  process.env.PI_OFFLINE = "1";
  const { DefaultResourceLoader, SettingsManager } = await import(entry);
  const agentDir = join(temporary, "pi-agent");
  const settingsManager = SettingsManager.create(cwd, agentDir);
  settingsManager.setProjectTrusted(true);
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
  await loader.reload();
  const { skills, diagnostics } = loader.getSkills();
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    skills.map(({ name }) => name),
    [skill],
  );
  assert.equal(skills[0].sourceInfo.scope, "project");
  assert.equal(
    skills[0].filePath,
    join(cwd, ".pi", "skills", skill, "SKILL.md"),
  );
  console.log("Pi native project skill discovery passed.");

  const config = join(temporary, "claude-config");
  mkdirSync(config);
  writeFileSync(
    join(config, ".claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      projects: { [cwd]: { hasTrustDialogAccepted: true } },
    }),
  );
  // The local initialize handshake lists commands without submitting a prompt.
  const request = {
    type: "control_request",
    request_id: "renderer-init",
    request: { subtype: "initialize", hooks: {} },
  };
  const stream = execFileSync(
    "claude",
    [
      "--print",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--setting-sources",
      "project",
      "--strict-mcp-config",
    ],
    {
      cwd,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: config,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
      input: `${JSON.stringify(request)}\n`,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  const initialization = stream
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find(
      ({ type, response }) =>
        type === "control_response" &&
        response.request_id === request.request_id,
    );
  assert.equal(initialization?.response.subtype, "success");
  const names = initialization.response.response.commands.map(
    ({ name }) => name,
  );
  assert.ok(names.includes(skill), `Claude did not discover ${skill}`);
  assert.ok(
    names.includes(claudeOnly),
    `Claude did not discover ${claudeOnly}`,
  );
  console.log("Claude native project skill discovery passed.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
