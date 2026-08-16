# mzizzi-ty-lsp

Python language server ([ty](https://github.com/astral-sh/ty)) for Claude Code, providing code intelligence to the LSP tool.

One language server answers for `.py`, so enable this or `pyright-lsp@claude-plugins-official`, not both. Pick this one where `ty` is the project's type checker, so the editor and the commit gate agree on what counts as an error.

## Supported extensions

`.py`, `.pyi`

## Installation

`ty` has to be on `PATH` in the environment Claude Code itself starts in, which a project venv is not unless that venv is already activated there:

```
uv tool install ty==0.0.72
```

A project pin covers it too wherever the venv's `bin`/`Scripts` is on `PATH` — a dev container that sets `PATH` in its image, or an activated shell — but the machine-wide copy is what makes the server start regardless of where Claude Code was launched.

Pin the version either way. `ty` is `0.0.x` and documents that diagnostics may change between any two releases, so keep it in step with whatever the project's type-check gate runs.
