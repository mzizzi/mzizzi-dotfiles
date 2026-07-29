---
name: anti-slop-writing
description: "Write or de-slop prose so it reads as genuinely human rather than AI slop. Two modes: load the guidelines to write natural text, or fix a supplied document (a pasted draft, a file, or AI-generated text) to strip the tells. Use whenever the user is writing or editing articles, essays, blog posts, emails, newsletters, or social copy that must read naturally, or asks to humanize, de-slop, or de-AI writing, remove AI writing patterns, avoid AI detection, or make text sound authentic and less robotic, even if they don't name the skill."
argument-hint: "[target document to fix; omit to load references into context]"
disable-model-invocation: false
user-invocable: true
---

# Core Principle

AI writing fails because it optimizes for statistical probability: the most expected, safe, forgettable text. Human writing comes from a single mind with history, opinions, and specific context. Aim for the three things a machine misses, surprise (unexpected, specific word choice), rhythm (irregular sentence length, never a drone or a mechanical short/long seesaw), and voice (real opinions, shifting register, texture and imperfection).

The tells that give AI away are structural, not vocabulary. Individual words get trained out every model cycle, so a clean word list proves nothing; sentence rhythm, argument cadence, and paragraph shape are what persist.

# Modes

Identify the mode from the argument, then follow that mode only.

- **No argument** → `reference` mode (default).
- **A target document** (a file path or pasted text) → `fix` mode.

## Mode: `reference` (default)

Read all four reference files into context, then write or advise with their rules in mind:

- `references/structural-patterns.md` for the structural pattern catalog (with before/after) and the sentence and paragraph construction rules. The highest-value reference.
- `references/vocabulary-banlist.md` for every banned word and phrase by category, plus the replacement strategy (restructure, don't swap synonyms).
- `references/voice-and-content.md` for how to inject specificity, real positions, register shifts, and human texture.
- `references/model-era-tells.md` for patterns specific to current models (GPT-5.x / Claude 4.5-5 / Gemini reflexes). Dated, so re-check against the current model.

Draft with those rules in mind, then revise the draft against them and read the whole piece aloud: awkward machine rhythm is audible where it stays invisible on the screen.

## Mode: `fix`

First read the target document once through. Note its purpose, audience, and argument, and list the real specifics it already contains (names, numbers, quotes, sources). You are de-slopping it, not rewriting its meaning or inventing new facts.

Then work through the reference files one at a time, in the order below. For each file: load it, then apply its guidelines across the whole document before opening the next file. This one-at-a-time loop is deliberate. The combined rule set is large, and applied as a single sweep most of it gets skimmed and skipped; one file, one full pass catches far more.

1. `references/structural-patterns.md`. Structure has the highest impact, so it goes first: fix sentence rhythm (break cadence uniformity and the short/long seesaw), break any four-part Opening/Expansion/Contrast/Resolution arc, merge over-fragmented paragraphs, cut participial tack-ons and negative parallelisms, and remove every em and en dash.
2. `references/vocabulary-banlist.md`. Replace each banned word and phrase by rewriting the sentence to say what it means, not by swapping in a synonym.
3. `references/voice-and-content.md`. Where the draft is vague, add specificity, but only detail that is real (in the source, supplied by the user, or a clear hypothetical), never invented. Commit to positions, vary register, allow imperfection.
4. `references/model-era-tells.md`. Clear the reflexes of whatever model likely wrote it.

Finally, read the result aloud, fix any remaining awkward rhythm, and return the revised document. Note the main changes if the user asked or it would help.
