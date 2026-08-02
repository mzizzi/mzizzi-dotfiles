---
name: fix-all
description: Wrapper skill for fix-correctness, fix-quality, and fix-comments.
argument-hint: "[--dry-run] [--strictness=high|low] [pr | <pr-number-or-url>]"
allowed-tools: Read, Grep, Glob, Bash, Edit
disable-model-invocation: false
user-invocable: true
---

# Instructions

Use Task tools to set up tasks for the following. They should be run in order with Task dependencies between them. Then execute them:

- mzizzi:fix-correctness
- mzizzi:fix-quality
- mzizzi:fix-comments
- Run the project's tests and linters to ensure that nothing was broken
