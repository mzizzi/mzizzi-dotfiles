# Sandbox issues

## Windows cannot assemble official workload and mixin kits

Status: blocked on a released Docker Sandboxes fix. Last checked: 2026-10-10.

The intended setup is one sandbox containing Docker's official shell workload and official Claude Code and Codex mixins, using Claude and ChatGPT subscriptions through the host authentication proxy. No third-party mixins or API keys are wanted.

On Windows with `sbx` 0.47.0 (`0411f50ee4700fe7bd37e6e7e3aced563e850ca9`), creating this composition fails before either agent starts. The CLI reports:

```text
error: failed to run sandbox container
```

The daemon log gives the underlying error:

```text
create sandbox container: assemble kit image: save kit images:
Error response from daemon: no manifest found for platform: not found
```

The test used only Docker-published v3 kits:

- `docker.io/docker/sbx-kit-shell:1.0.0`
- `docker.io/docker/sbx-kit-codex-mixin:0.159.2`
- `docker.io/docker/sbx-kit-claude-mixin:2.1.285`

Both image-index digest references and explicit Linux/amd64 mixin manifest references failed with the same error. The test sandbox was named `official-agents-check`, had no workspace mount, and did not alter the working `agent-lab` sandbox.

Docker tracks this exact Windows failure in [issue #677](https://github.com/docker/sbx-releases/issues/677). A Docker maintainer [confirmed on October 7](https://github.com/docker/sbx-releases/issues/677#issuecomment-6042654441) that it was fixed on `main` and would ship in **0.49.0**. The report also reproduces the failure on 0.48.0-rc3, so upgrading to that release candidate is not an established fix.

As of October 10, 0.49.0 is not released. Docker's [official nightly](https://github.com/docker/sbx-releases/releases/tag/nightly) is built from `main`; the October 10 build is `b171a17fc736bd197547f6952ccc4e0ffc91caec`. It is expected to include the fix but has not been installed or tested here. A host upgrade to a prerelease requires the user's approval.

Next steps:

1. Upgrade to stable 0.49.0 when available, or use Docker's official nightly after approval.
2. Create a separate test sandbox using only compatible Docker-published kits.
3. Verify real Claude and Codex subscription requests and confirm that both services use host-managed OAuth rather than passing real tokens into the sandbox.
4. Update the lab configuration and README after verification, preserving any work in the existing sandbox.

Docker [documents composing multiple mixins](https://docs.docker.com/ai/sandboxes/customize/use-kits/) and a maintainer [confirms that multiple OAuth agent mixins can compose in v3](https://github.com/docker/sbx-releases/issues/594#issuecomment-5873325354). Dual-proxy subscription authentication remains unverified locally because image assembly fails first. The README's current description of the custom lab's first-credential behavior records an observation from that lab, not a documented restriction on official v3 mixin compositions.

## Newer Claude mixin descriptor requires newer sbx

The official Claude mixin `2.1.292` also fails inspection on `sbx` 0.47.0:

```text
capability com.docker.sandbox/agent-context@1: json: unknown field "directory"
```

Docker tracks the same descriptor incompatibility for `2.1.291` in [issue #682](https://github.com/docker/sbx-releases/issues/682). The reporter confirmed that 0.48.0-rc4 resolves it. Claude mixin `2.1.285` successfully passes inspection on the installed 0.47.0, but still encounters the separate Windows assembly failure above.
