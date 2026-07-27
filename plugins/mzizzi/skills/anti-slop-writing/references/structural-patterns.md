# Structural Patterns

Most of this file is a catalog of structural patterns to avoid, each with a before/after. Every one has been documented on Wikipedia's "Signs of AI Writing" page and confirmed by academic research (Kobak et al. 2024, Russell et al. 2025, Fraser et al. 2025). The last section flips to the positive: the sentence and paragraph construction habits that produce human rhythm. Structure is the deepest layer, individual words get swapped out but a machine cadence persists, so this is the highest-value reference. For patterns specific to current models, see `references/model-era-tells.md`.

## Patterns to Avoid

### 1. Participial -ing Tack-Ons

The single most recognizable AI pattern. A comma followed by an -ing phrase appended to the end of a sentence to appear analytical.

**AI pattern:**

<!-- prettier-ignore -->
> The team launched the product, revolutionizing the industry.
> The temple was built in 1850, symbolizing the community's enduring faith.
> As of 2008, the population stood at 56,998, creating a lively community.

**Human alternative:**

<!-- prettier-ignore -->
> The team launched the product. The industry changed.
> The temple was built in 1850.
> As of 2008, the population was 56,998.

Rule: If the -ing clause adds no concrete information, delete it entirely. If it adds real information, make it a separate sentence.

### 2. The Rule of Three

AI defaults to grouping things in threes: three adjectives, three bullet points, three examples, three clauses.

**AI pattern:**

<!-- prettier-ignore -->
> The conference features keynote sessions, panel discussions, and networking opportunities.
> The design is bold, innovative, and timeless.

**Human alternative:**

<!-- prettier-ignore -->
> The conference runs keynote sessions and panels. There's time to meet people between talks.
> The design is bold. It'll still work in ten years.

Rule: List two things. Or four. Or one. Never three by default.

### 3. Negative Parallelisms

"Not just X, but also Y" / "It's not X, it's Y" / "Not only X, but Y"

**AI pattern:**

<!-- prettier-ignore -->
> This is not just a memoir — it's a love letter to the city.
> The painting represents not merely an artistic achievement, but a cultural milestone.

**Human alternative:**

<!-- prettier-ignore -->
> It's a memoir about growing up in the city. You can feel the author's affection for it on every page.
> The painting became a cultural reference point. People still argue about it.

Rule: State what something IS. Don't frame it as a correction of what someone might wrongly think.

### 4. False Ranges ("From X to Y")

Vague figurative spectrum using "from X to Y" where no real scale exists.

**AI pattern:**

<!-- prettier-ignore -->
> From intimate gatherings to global movements, the organization has made its mark.
> From beginners to experts, everyone can benefit.
> From the singularity of the Big Bang to the grand cosmic web...

**Human alternative:**

<!-- prettier-ignore -->
> The organization started with twelve people in a living room. Last year 40,000 showed up to their conference.
> Works whether you've been doing this for a week or a decade.

Rule: Only use "from X to Y" when there's a real, identifiable midpoint on a real scale.

### 5. "Despite Its... Faces Challenges" Formula

The formulaic challenges-and-future-prospects ending.

**AI pattern:**

> Despite its industrial prosperity, Korattur faces challenges typical of urban areas, including... With its strategic location and ongoing initiatives, Korattur continues to thrive.

**Human alternative:**

> Korattur's water supply can't keep up with the population. The pipes are from the 1970s.

Rule: If you mention problems, name specific ones with specific evidence. Never follow with vague optimism about "ongoing initiatives." Never include speculative "Future Outlook" paragraphs.

### 6. Copula Avoidance ("Serves As" / "Stands As")

AI substitutes elaborate verb phrases for simple "is/are/has."

**AI pattern:**

<!-- prettier-ignore -->
> Gallery 825 serves as LAAA's exhibition space for contemporary art.
> The gallery features four separate spaces.
> She holds the distinction of being the first female director.

**Human alternative:**

<!-- prettier-ignore -->
> Gallery 825 is LAAA's exhibition space.
> The gallery has four separate spaces.
> She was the first female director.

Rule: Use "is," "are," "has," "was." Simple copulas are not boring, they're clear. (Full copula-avoidance list in `references/vocabulary-banlist.md`.)

### 7. Superficial Analysis Padding

Generic commentary attached to facts that need no commentary.

**AI pattern:**

<!-- prettier-ignore -->
> The city has a population of 56,998, creating a lively community within its borders.
> The inscriptions offer valuable insights into the construction of the mosque.
> These citations illustrate the enduring relevance of his work.

**Human alternative:**

<!-- prettier-ignore -->
> The city has a population of 56,998.
> The inscriptions name the craftsmen who built the mosque.
> His work keeps getting cited.

Rule: If the analytical statement could apply to literally any subject, it adds nothing. Delete it.

### 8. Elegant Variation (Synonym Cycling)

AI avoids repeating the same word by cycling through synonyms, even when repetition would be clearer.

**AI pattern:**

> Soviet artistic constraints... non-conformist artists... their creativity... the confines of state-imposed artistic norms... the artistic aspirations...

**Human alternative:**

> The Soviet government told artists what they could and couldn't paint. Yankilevsky painted what he wanted anyway.

Rule: Repeat words when clarity demands it. Don't cycle through "constraints / confines / norms / limitations" to avoid saying the same word twice.

### 9. Dash, Colon, and Semicolon Overuse

AI uses em dashes (—) where humans use commas, parentheses, periods, or nothing. Newer Claude also overuses colons (to introduce almost any follow-up idea) and semicolons.

**AI pattern:**

> The article complies with policies — including WP:V, WP:RS, and WP:BLP — with all claims supported by multiple sources.

**Human alternative:**

> The article complies with WP:V, WP:RS, and WP:BLP. All claims have sources.

Rule: Zero em dashes and en dashes, ever; this is the single worst current Claude tell, so treat it as a hard ban, not a "use sparingly" guideline. Replace a dash with, in order of preference: a period (split into two sentences, the default), a comma (if the thought flows), or parentheses (for information the reader could skip). Use a colon only to point to a definition or explanation that follows, and ration it, since Claude overuses colons. Use a semicolon only as a last resort, and never in non-academic prose (most contemporary writers rarely use them outside academic writing). Plain hyphens are fine only for number/date ranges ("2020-2025") and compound adjectives ("long-term"), never as a sentence-level pause.

### 10. Vertical Lists with Bold Inline Headers

Formatting everything as bullet points with **Bold Header:** description.

**AI pattern:**

> - **SEO:** Traditional methods for improving visibility...
> - **AEO:** Techniques focused on optimizing content...
> - **GIO:** Strategies for ensuring businesses are cited...

**Human alternative:** Write it as prose. If a list is genuinely needed, keep it simple without bold headers and colon separators.

### 11. Undue Emphasis on Notability/Media Coverage

Painstakingly listing every source that covered the topic to prove it matters.

**AI pattern:**

<!-- prettier-ignore -->
> Her views have been cited in The New York Times, BBC, Financial Times, and The Hindu.
> The mall maintains a strong digital presence, particularly on Instagram.

**Human alternative:**

> She wrote a piece for the Times about it. [cite the actual piece]

Rule: Cite sources inline as references. Don't make the existence of coverage into content.

### 12. Overuse of Boldface

Mechanically bolding every key term, proper noun, or concept.

**AI pattern:**

> A **leveraged buyout (LBO)** uses **debt financing** to let **private equity firms** control businesses using the company's **assets and future cash flows** as collateral.

**Human alternative:**

> A leveraged buyout uses debt to buy a company. The company's own assets and cash flow back the loans.

Rule: Bold sparingly. In most prose, bold nothing at all.

### 13. No Compulsive Summaries

Starting or ending sections with "Overall," "In conclusion," "In summary," "To recap."

Rule: If the piece needs a conclusion, make it say something new. Don't restate what the reader just read. The same tic shows up at paragraph scale: AI often ends a paragraph by restating its own point in different words. Cut that redundant last sentence too.

### 14. Staccato Triplets

Three punchy parallel sentences in a row: "No meetings. No bureaucracy. Just results." A recognized AI social-media pattern.

Rule: If you want emphasis, use a single short sentence, not three. (Related: the "No X. No Y. Just Z." template in `references/vocabulary-banlist.md`.)

### 15. Agentless Passive Strings

Older AI overused passive voice for perceived neutrality: "The decision was made," "It was determined that."

Rule: Avoid strings of agentless passives; if three appear in a row, rewrite at least two. But don't over-correct, newer models use LESS passive voice than humans. A draft with zero passives and relentlessly active, punchy declaratives reads like a machine too. Humans use passives naturally when the object matters more than the agent ("the file got corrupted," "the venue was booked months ago"). Keep some.

### 16. The Four-Part Sentence DNA

Across current models, the overwhelming majority of AI text follows one argument cadence regardless of topic: Opening (context/claim) → Expansion (detail) → Contrast (complication) → Resolution (conclude/transition). A reader feels it within three or four sentences. Prompt instructions swap the vocabulary but cannot remove this cadence.

**Rule:** Break the arc at least twice per piece. Open on the complication. Expand without contrasting. End sections on unresolved tension or an abrupt fact. Put conclusions first. Humans leave arguments lopsided; resolution-closers ("At the end of the day...," "The key takeaway here is...") are training artifacts, real endings take a position and stop.

### 17. Cadence Uniformity

Sentences landing at 18-24 words, one after another. It survives every cosmetic rewrite and is the single thing that most makes writing read as machine-written.

**30-second tests:**

- First word of each sentence in a paragraph: if >50% start with "The/This/It/In" → LLM-assisted
- 3+ consecutive sentences in the 17-23 word band → same conclusion

**Rule:** Vary lengths irregularly AND vary sentence openers. Start sentences with verbs, names, numbers, subordinate clauses, questions, not just "The/This/It/In."

### 18. The Bimodal Seesaw

Newer models fake variety by mechanically alternating punchy fragments with very long sentences. The variation is real but mechanical: AI swings between very short and very long more than humans do, while humans cluster around medium length (about half of human sentences land in the 11-25 word range). A run of three medium sentences is normal, not a defect to break up.

**Rule:** Don't seesaw. Most sentences medium, with occasional genuine swings in both directions. A medium sentence, another medium one, a fragment, a long one, two mediums. Not a metronome, and not a seesaw either.

### 19. Paragraph Over-Fragmentation

Older models wrote uniform 3-4 sentence paragraphs. Newer models fragment into many 1-2 sentence paragraphs plus bullet lists (AI tends toward many short paragraphs and frequent bullet lists; humans write fewer, longer paragraphs and rarely bullet plain prose).

**Rule:** Combine related ideas. Let paragraphs run to 7-8 sentences when the argument needs it. Convert bullets to prose. Use irregular paragraph lengths, a one-sentence paragraph for emphasis, a long one for sustained argument, never metronomic.

### 20. The Symmetric Two-Clause Hook

**AI pattern:**

<!-- prettier-ignore -->
> Most people think X. The reality is Y.
> Forget X. Focus on Y.
> It is not about X. It is about Y.

Fine once. A fingerprint when it opens most pieces or appears three times in one post. (A GPT-5.x social pattern, see `references/model-era-tells.md`.)

**Rule:** Open with a specific fact, scene, number, or name instead.

### 21. The Sanitized Texture

A self-correction pass that scrubs obvious AI-isms, leaving prose that feels "cleaned": no awkward transitions, no odd word choices, no rough edges anywhere. Perfect smoothness is itself the residue. (A GPT-5-era pattern, see `references/model-era-tells.md`.)

**Rule:** Keep one or two genuinely rough moments per piece: an abrupt topic shift that earns context later, a slightly odd but committed metaphor, a self-correction mid-paragraph.

## Sentence and Paragraph Construction (do this, don't just avoid)

### Vary Sentence Type

Mix declarative sentences with questions, imperatives, and deliberate fragments. A genuine question mid-paragraph ("Why does this matter?") signals a thinking mind. An imperative ("Think about that.") shifts the register. A fragment for emphasis. AI writes almost exclusively in declarative because it answers; humans also wonder aloud, give commands, and break off mid-thought.

### Use Sentence Fragments

AI avoids grammatically incomplete sentences. Humans use fragments constantly: "Not ideal." "Big difference." "Every. Single. Time." "Which is saying something." Deploy fragments for emphasis and rhythm.

### Vary Syntactic Depth

Mix shallow and deep sentence structures. A shallow sentence: subject-verb-object, one clause. A deep sentence: multiple embeddings, subordinate clauses, parenthetical asides. AI produces medium-depth sentences with boring consistency. Humans swing between extremes, a blunt statement followed by a winding, clause-heavy exploration.

### Break Paragraph-Level Predictability

Don't open every paragraph with its thesis sentence. Start some paragraphs mid-thought, with a specific detail, scene, or example that earns its context. End some paragraphs before completing the expected "so what." AI writes clean arcs: claim → evidence → implication. Break that arc at least twice per piece.

### Diversify Function Words

Narrow function-word choice reads mechanical. AI leans on a smaller set of conjunctions, prepositions, and articles. Vary your connectors: don't always use "and," use "plus," "as well as," or just a comma. Don't always use "but," use "though," "still," "yet," "except." Vary prepositions. Diverse function words are a strong human signal.

### Increase Lexical Diversity

AI produces text with a low type-token ratio (fewer unique words). Humans use more words that appear only once. To increase it: use domain-specific terms, mix registers, include proper nouns and specific references, use figurative language that's specific rather than generic. Don't cycle through synonyms to avoid repetition (that's the tell in #8), use MORE unique words overall by being more specific.
