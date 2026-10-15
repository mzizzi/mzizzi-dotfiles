# Sandbox issues

## Official workload and mixin kits fail to assemble on Windows

Goal: replace the custom `agent-lab` kit with Docker's official shell workload plus the official Claude Code and Codex mixins, both on subscription auth through the host proxy.

Status: blocked upstream. On Windows, creating the composition fails with `assemble kit image: save kit images: ... no manifest found for platform` (visible in the daemon log). Tracked in [docker/sbx-releases#677](https://github.com/docker/sbx-releases/issues/677); a maintainer [says it is fixed on `main`](https://github.com/docker/sbx-releases/issues/677#issuecomment-6042654441) for the next minor release. Newer Claude mixins also need a newer `sbx` to pass inspection ([#682](https://github.com/docker/sbx-releases/issues/682)).

Closes when: a released `sbx` (or the [nightly](https://github.com/docker/sbx-releases/releases/tag/nightly), with approval) creates a test sandbox from those kits, real Claude and Codex subscription requests succeed with tokens kept on the host, and `agent-lab` and the README are updated to match. Composing multiple OAuth mixins is [documented](https://docs.docker.com/ai/sandboxes/customize/use-kits/) and [confirmed by a maintainer](https://github.com/docker/sbx-releases/issues/594#issuecomment-5873325354), but has not been verified locally. The credential-order trap in the README was observed in the custom kit and may not apply to the official mixins.
