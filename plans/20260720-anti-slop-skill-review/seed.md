# Seed: anti-slop-writing-guidelines skill review

Findings from a review of `plugins/mzizzi/skills/anti-slop-writing-guidelines/` (SKILL.md, `references/vocabulary-banlist.md`, `references/structural-patterns.md`, README.md), ranked by ease of integration + impact.

## Overall assessment

The structural advice is the strongest part of the skill: participial tack-ons, copula avoidance, the four-part argument arc, the bimodal seesaw, paragraph over-fragmentation. The before/after examples in `structural-patterns.md` teach more than the ban list does and should be kept at full fidelity. The vocabulary ban list is the weakest part, and the skill half-knows it — it says vocabulary tells get trained out while structure persists, yet the ban list is the largest block in SKILL.md.

## Tier 1 — small edits, big payoff

### 1. Fabrication guardrail (highest impact overall)

"Specificity Over Generality" says to replace "many companies" with "three startups in Austin" and "experts agree" with a named person. Combined with "Reference Specific Touchstones" ("Last Tuesday," "Back when I worked at...") and the first-person guidance, this instructs a model to fabricate facts, sources, and personal history whenever it doesn't actually have specifics. For the skill's stated use cases (articles, essays, blog posts) that's confident hallucination presented as the fix for vagueness.

Fix: add ~3 sentences to "Specificity Over Generality": specifics must be true — researched, provided by the user, or clearly hypothetical. If you don't have a real specific, keep the general claim or flag the gap rather than inventing detail.

### 2. Dash-policy conflict

- SKILL.md Rule 10: zero em dashes, ever. `structural-patterns.md` #9: "Maximum one em dash per 500 words." Direct conflict between two files the skill loads together.
- Rule 10 also recommends colons and semicolons as dash replacements in the same rule that reports Claude overusing colons (4.1x) and semicolons (3.1x); EN-2 separately says avoid semicolons.

Fix: align the reference to the zero-dash rule; reorder Rule 10's replacement list so period/comma come first and colon/semicolon are flagged as rationed.

### 3. Verbatim duplication (pure deletion, zero risk)

- "Vary Syntactic Depth" appears twice in SKILL.md, word for word (Rule 13, and again under Voice and Texture).
- "underscore" is listed twice in the banlist's analytical-verbs section.

## Tier 2 — an hour of focused editing, high payoff

### 4. Stale burstiness story

The Core Principle and the reference's "Detection Metrics" section say AI has *low* burstiness (sentences cluster 10-25 words). Rule 1 and pattern #18 say current AI has *higher* length variation than humans (bimodal, CV 137% vs 70%). The legacy passages were never updated and now push a model toward exactly the seesaw artifact Rule 1 warns against — the contradiction most likely to degrade actual output.

Related tension: "Never 3+ consecutive sentences of similar length" vs. "50% of human sentences are 11-25 words." If half of human sentences sit in one band, runs of three similar-length sentences are common in human prose; the mechanical prohibition creates the metronome/seesaw artifact.

Fix: rewrite the two legacy passages so the whole skill tells the current story (AI over-varies bimodally; humans cluster medium with occasional swings), and soften the "never 3+" rule accordingly.

### 5. Cut the 36-item post-generation checklist to ~10

No model will make 36 verification passes; in practice it skims once, so ordering is the de facto prioritization. Keep the highest-signal checks (sentence-opener test, 17-23 word band runs, dash/colon count, participial tack-ons, ending resolution, "not just X" count, paragraph fragmentation, register uniformity) and drop or demote the rest.

## Tier 3 — structural work, invest when ready

### 6. Fix the SKILL.md/references duplication

SKILL.md (~400 lines) says "Before writing anything, load references/..." but already contains nearly everything in both references — loading them roughly doubles token cost for little new information, and the duplication is the drift mechanism that produced findings 2 and 4. Pick one shape: lean SKILL.md (core principle, top rules, load instruction) with detail only in references, or self-contained SKILL.md with references deleted.

### 7. Split evergreen core from dated model-era tells

The skill is saturated with model-version-specific claims (GPT-5.1 dash suppression, Opus 4.5 colon rates, "the #1 tell of 2026") with a shelf life of months — the skill itself documents how tells migrated between 2024 and 2026. Split into an evergreen core (specificity beats vagueness, copula directness, irregular rhythm, commit to positions, real endings) and a dated "current-era tells" reference expected to be replaced wholesale. Pairs naturally with #6 — do them together.

### 8. Detector-evasion framing (needs a product decision)

Two products fight inside the skill: "write prose that isn't slop" (evergreen, broadly useful) and "beat Turnitin/GPTZero/Originality.ai" (the T-1..T-5 section, detection-rate stats, "passes human detection" in the description). The evasion framing mostly matters in academic-integrity contexts — where this tool least wants to be pointed — and may make models balk at loading the skill. The quality rules stand on their own without it. Cheap to execute; the decision about the skill's purpose is the real work.

## Low priority

- The content violates its own vague-attribution rule: "a Jan 2026 corpus analysis," "a 2026 study of 1,000+ URLs," "humanizer corpus data (80k+ pairs)" — none named — alongside implausibly precise unverifiable stats (4.3x, 16.9x, 24.5x, 82%). Cite real sources in the references or round the numbers and present them as directional.
- "state-of-the-art" is the example of a legitimate compound-adjective hyphen in Rule 10 and also on the puffery ban list.
- The connective bans (thus, hence, moreover, nonetheless → "so"/"also"/"still") narrow function-word distribution, undercutting Rules 14-15 (diversify function words, increase lexical diversity) — arguably a new fingerprint.
- `structural-patterns.md` numbering jumps from 12 to 16; the "Detection Metrics" section is stranded mid-file.
- README says content was "pulled from" a pinned upstream commit, but the 2026 additions mean it has diverged — note the divergence so a re-sync doesn't wipe local edits.
- Several prescriptions are mechanical enough to become their own fingerprint (never three items, exactly 2-3 register shifts, "at least one question and one fragment," break the arc "at least twice"). Add a short preamble: these are pressures to apply with judgment, not quotas to hit.

## Recommended minimum pass

Findings 1, 2, and 4. Two are near-trivial, and together they remove the fabrication incentive and both contradictions a model actually trips over while writing.
