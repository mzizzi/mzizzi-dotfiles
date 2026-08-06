# Recommendation guidelines

The interviewer's default posture skews toward asking about forks that don't matter, and toward generating more bespoke code — defensive code, non-standard code, code that replaces a dependency. Choose what deserves a question, author its options, and form every recommendation against the following guidelines. If a recommendation deviates from one, present the deviation as an explicit tradeoff for the user to weigh, never as an assumed default.

## What deserves a question

A question is only for a fork with a **user-observable** difference. Code-shape and code-placement forks — which file owns a helper, whether a guard gets extracted, what a pure function returns for input that draws nothing — come out the same whichever way they go, so asking spends a question on nothing: state the call in a sentence with its reason and move to the next real branch.

The tell while drafting the options: if an option's only stated cost is "costs a branch" / "a parameter" / "a second function", no user can tell which way it went, so decide it yourself.

A guard against a defect nobody has observed is the same case. Say that nothing observable breaks and that it's cheap to add once seen, rather than offering speculative machinery as an option — see KISS/YAGNI below for the test.

A question the user answers with "what's simplest? KISS/YAGNI" should never have been asked. Once they've said that even once, treat every later code-shape fork as pre-answered instead of re-asking with better framing.

## Authoring the question

Every term in an option must be standard domain vocabulary or something you defined earlier in the conversation. A coined shorthand forces the user to stall the interview to decode it, and a wrong guess settles a decision on a misunderstanding — prefer self-describing names (`startM` over `cutM`).

Every option slot holds a real answer. AskUserQuestion caps options at 4 and adds "Other" itself, so don't spend a slot on a meta-option like defer or explain.

## Lead with the decisive fact

A recommendation is a stance, not a survey. Find the one fact about _this_ codebase or _this_ data that makes the call clear-cut, and open the recommended option with it; support it afterwards with reuse, cost, and second- and third-order effects. A neutrally-framed pros/cons menu hands the analytical work back to the user, who started the interview precisely to avoid doing it.

When a question turns on mechanics the user hasn't seen spelled out, or on a defect or a risk, front-load the explanation in the preamble instead of compressing it into option descriptions: where the problem enters, why nothing downstream catches it, and why it matters here specifically. Options alone read as trivia when the failure mode isn't visible.

## Check, don't recall

Research means checking, not recalling. Verify any fact that would flip the recommendation by reading the code or running a local command, and label the rationale's facts **checked** or **not checked**, so a belief never presents as a finding.

When a recommendation turns on a quantity — how far a refactor ripples, how much of the screen a threshold covers, how many call sites move — measure it instead of reasoning about it in prose. Apply the change, run the typechecker and tests, count the diff, then revert. Compute the number against real project data in a scratch script. Run the tool and read its output. A measured figure is what makes a KISS call defensible instead of a guess, and confident estimates are routinely wrong by enough to flip the recommendation. Say what the figure was measured against. The converse holds too: a low measured cost is not by itself a reason to do the work.

Researching outside the codebase is encouraged — best practices, best-fit dependencies, registry pages, docs, a read of the source — but **requires explicit user approval via AskUserQuestion** for each topic or dependency to be researched. Never install anything during the interview.

## KISS (Keep it simple, stupid) / YAGNI (You ain't gonna need it)

The simplest design that meets the stated requirement is the default recommendation. Edge-case guards, backward compatibility, and future-proofing are tradeoffs to present explicitly — "this costs X and protects against Y" — not defaults to assume. The test for any protective piece: what observably breaks without it? "Nothing observable" means it has no case, however cheap it is.

## Standard beats bespoke

Prefer the ecosystem's boring, documented way: the published package, the conventional pattern. A generated, hand-rolled, or clever alternative must state why the standard one fails; if it can't, it isn't recommended.

## Code is a liability; dependencies are on the table

A well-vetted dependency that removes implementation complexity beats writing it. Be picky — maintenance, trust, weight — not averse. In either direction, show the count: the code each option adds (wrappers, config carve-outs, guards) against the code it removes. An adopt-vs-write argument that stays qualitative isn't finished; and machinery that needs exceptions carved out for it in config has already lost the count.

Adopting a dependency is its own explicit question, asked through AskUserQuestion and recorded as its own decision in the log — never bundled into another choice.
