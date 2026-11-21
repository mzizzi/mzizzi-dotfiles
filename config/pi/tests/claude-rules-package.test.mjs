import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  constants,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  matchingRead,
  modelId,
  reads,
} from "./fixtures/claude-rules-provider.mjs";
import { piPackageRoot } from "./pi-host.mjs";

const candidate = process.env.PI_CLAUDE_RULES_CANDIDATE;
const checkout = process.env.PI_CLAUDE_RULES_CHECKOUT;
const repo = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));
const githubPath = "github.com/mzizzi/mzizzi-dotfiles";
const provider = fileURLToPath(
  new URL("./fixtures/claude-rules-provider.mjs", import.meta.url),
);
const sdkProbe = fileURLToPath(
  new URL("./fixtures/claude-rules-sdk.mjs", import.meta.url),
);
const terminalProbe = fileURLToPath(
  new URL("./fixtures/claude-rules-terminal.py", import.meta.url),
);
const probeArgs = [
  "--no-session",
  "--extension",
  provider,
  "--model",
  modelId,
  "--tools",
  "read",
  "Run the scripted rules reads.",
];
const unscopedFile = ".claude/rules/project.md";
const scopedFile = ".claude/rules/project-scoped.md";
const glob = "matching/**/*.txt";
const markers = {
  user: "CLAUDE_RULES_USER_BODY_MARKER",
  unscoped: "CLAUDE_RULES_PROJECT_BODY_MARKER",
  scoped: "CLAUDE_RULES_SCOPED_BODY_MARKER",
};
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const inside = (path, root) => path.startsWith(root + sep);

function run(command, args, env, cwd, timeout = 30_000) {
  const result = spawnSync(command, args, {
    env,
    cwd,
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
  });
  assert.equal(
    result.status,
    0,
    [
      [command, ...args].join(" "),
      result.error?.message,
      result.signal,
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return result.stdout.trim();
}

function cleanEnv(home, agentDir) {
  const passthrough = [
    "PATH",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
    "NODE_USE_ENV_PROXY",
  ];
  return {
    ...Object.fromEntries(
      passthrough
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_STATE_HOME: join(home, ".local/state"),
    TMPDIR: join(home, "tmp"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
  };
}

function makeProfile(dir) {
  const home = join(dir, "home");
  const agentDir = join(dir, "profile");
  const cwd = join(dir, "project");
  const env = cleanEnv(home, agentDir);
  for (const path of [agentDir, cwd, env.TMPDIR])
    mkdirSync(path, { recursive: true });
  return { agentDir, cwd, env };
}

function makeRulesProject({ cwd, env }) {
  for (const path of [
    join(env.HOME, ".claude/rules"),
    join(cwd, ".claude/rules"),
    join(cwd, "matching"),
  ]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(join(env.HOME, ".claude/rules/user.md"), `${markers.user}\n`);
  writeFileSync(join(cwd, unscopedFile), `${markers.unscoped}\n`);
  writeFileSync(
    join(cwd, scopedFile),
    `---\npaths:\n  - "${glob}"\n---\n${markers.scoped}\n`,
  );
  for (const { path, text } of reads)
    writeFileSync(join(cwd, path), `${text}\n`);
}

function assertRequests(log, approved) {
  let requests = [];
  try {
    requests = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  assert.equal(
    requests.length,
    1 + reads.length,
    "expected one initial request and one follow-up per scripted read",
  );
  for (const [index, request] of requests.entries()) {
    const text = JSON.stringify(request);
    const read = reads[index - 1];
    const label = read ? `request after reading ${read.path}` : "first request";
    const expectScopedBody = approved && read === matchingRead;
    assert.ok(text.includes(markers.user), `${label}: missing user rule body`);
    assert.equal(
      text.includes(markers.unscoped),
      approved,
      `${label}: unscoped project rule body`,
    );
    if (!approved)
      assert.ok(
        !text.includes(unscopedFile),
        `${label}: unexpected unscoped project rule path`,
      );
    assert.equal(
      text.includes(scopedFile),
      approved,
      `${label}: scoped project rule pointer`,
    );
    assert.equal(
      text.includes(glob),
      approved,
      `${label}: scoped project rule path glob`,
    );
    if (!expectScopedBody)
      assert.ok(
        !text.includes(markers.scoped),
        `${label}: unexpected scoped rule body`,
      );
    if (read) {
      const result = request.messages.findLast(
        (message) => message.role === "toolResult",
      );
      assert.equal(result?.toolName, "read", label);
      assert.equal(result.isError, false, JSON.stringify(result));
      const content = JSON.stringify(result.content);
      assert.ok(
        content.includes(read.text),
        `${label}: missing native read result`,
      );
      if (expectScopedBody)
        assert.ok(
          content.includes(markers.scoped),
          `${label}: missing scoped body in read result`,
        );
    }
  }
}

const opts = {
  skip:
    candidate === undefined &&
    checkout === undefined &&
    "Set PI_CLAUDE_RULES_CANDIDATE to run the Git package check",
  timeout: 300_000,
};

test(
  "real Pi installs and runs the mzizzi Claude rules package",
  opts,
  async (t) => {
    assert.match(
      candidate ?? "",
      /^[0-9a-f]{40}$/,
      "PI_CLAUDE_RULES_CANDIDATE must be a full commit SHA",
    );
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-claude-rules-")));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    assert.ok(
      !inside(dir, repo),
      "The disposable project and profiles must be outside the source checkout",
    );
    const { env, cwd, agentDir } = makeProfile(join(dir, "install"));
    const source = `git:${githubPath}@${candidate}`;
    const subagentsSource = json(
      join(repo, "sandbox/agent-lab/pi/settings.json"),
    ).packages.find(
      (entry) =>
        typeof entry === "string" &&
        /^git:github\.com\/nicobailon\/pi-subagents@[0-9a-f]{40}$/.test(entry),
    );
    assert.ok(
      subagentsSource,
      "Managed settings must pin the pi-subagents Git package",
    );
    if (checkout !== undefined) {
      const root = realpathSync(checkout);
      assert.ok(
        root !== repo && !inside(root, repo),
        "Use a separate committed candidate checkout",
      );
      assert.equal(
        run("git", ["rev-parse", "HEAD"], env, root),
        candidate,
        "Candidate checkout HEAD",
      );
      // Pi must save the canonical source even when the commit is unpublished.
      run(
        "git",
        [
          "config",
          "--global",
          `url.${pathToFileURL(root).href}.insteadOf`,
          `https://${githubPath}`,
        ],
        env,
        cwd,
      );
    }
    const cli = realpathSync(run("which", ["pi"], env, cwd));
    const hostRoot = piPackageRoot(cli);
    const hostManifest = json(join(hostRoot, "package.json"));
    const version = run(cli, ["--version"], env, cwd);
    assert.equal(hostManifest.name, "@earendil-works/pi-coding-agent");
    assert.equal(
      realpathSync(join(hostRoot, hostManifest.bin.pi)),
      cli,
      "Use the SDK from the selected Pi CLI installation",
    );
    assert.equal(
      version,
      hostManifest.version,
      "CLI and SDK versions must match",
    );
    t.diagnostic(
      `Pi ${version} (${cli}), candidate ${candidate}, managed ${subagentsSource}`,
    );

    const settingsPath = join(agentDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        enableInstallTelemetry: false,
        cacheWarming: "off",
        compaction: { enabled: false },
      }),
    );
    for (const entry of [source, subagentsSource])
      run(cli, ["install", entry], env, cwd, 90_000);
    assert.deepEqual(json(settingsPath).packages, [source, subagentsSource]);

    function copyProfile(name) {
      const profile = makeProfile(join(dir, name));
      cpSync(agentDir, profile.agentDir, {
        recursive: true,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE,
      });
      profile.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT = hostRoot;
      return profile;
    }

    await t.test(
      "real SDK loads the single pinned pi-code extension and discovers package skills and agents",
      () => {
        const { env, cwd } = copyProfile("inventory");
        run(
          process.execPath,
          [sdkProbe, "inventory", source, subagentsSource],
          env,
          cwd,
        );
      },
    );

    function freshProject(name) {
      const profile = copyProfile(name);
      profile.env.PI_CLAUDE_RULES_REQUEST_LOG = join(
        dir,
        name,
        "requests.jsonl",
      );
      makeRulesProject(profile);
      return profile;
    }

    for (const name of ["approve", "deny", "headless"]) {
      await t.test(`real SDK rules context: ${name}`, () => {
        const { env, cwd } = freshProject(`sdk-${name}`);
        run(process.execPath, [sdkProbe, name], env, cwd);
        assertRequests(env.PI_CLAUDE_RULES_REQUEST_LOG, name === "approve");
      });
    }

    await t.test("real CLI activates project rules after approval", () => {
      const { env, cwd } = freshProject("cli-approve");
      run(
        "python3",
        ["-B", terminalProbe, cli, "--tui-mode", "regular", ...probeArgs],
        env,
        cwd,
        35_000,
      );
      assertRequests(env.PI_CLAUDE_RULES_REQUEST_LOG, true);
    });

    await t.test(
      "real CLI leaves an undecided project unapproved in print mode",
      () => {
        const { env, cwd } = freshProject("cli-headless");
        run(cli, ["--print", ...probeArgs], env, cwd);
        assertRequests(env.PI_CLAUDE_RULES_REQUEST_LOG, false);
        run(process.execPath, [sdkProbe, "undecided"], env, cwd);
      },
    );
  },
);
