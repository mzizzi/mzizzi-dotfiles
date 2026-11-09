# Recommendation guidelines

The interviewer tends to ask about forks that don't matter, and to recommend more bespoke code: defensive, non-standard, or replacing a dependency. Hold every question and recommendation to these guidelines. A recommendation that deviates from one presents the deviation as a tradeoff for the user to weigh, never as a default.

## What deserves a question

Ask only about a fork with a **user-observable** difference that research leaves uncertain. Code-shape and code-placement forks (which file owns a helper, whether a guard gets extracted) come out the same either way: state the call with its reason and move on. The tell: if an option's only cost is "a branch", "a parameter", or "a second function", decide it yourself. A guard against a defect nobody has observed is the same case (see KISS/YAGNI below).

Once the user answers "KISS/YAGNI" or "what's simplest?", treat every later code-shape fork as pre-answered.

## Writing the question

Use only standard domain vocabulary or terms defined earlier in the conversation. A coined term stalls the interview, and a wrong guess at it settles a decision on a misunderstanding. Prefer self-describing names (`startM` over `cutM`).

Every option is a real answer. Don't add options like "defer" or "explain"; the user can always type their own answer.

A recommendation is a stance, not a neutral pros/cons menu. Open the recommended option with the one fact about this codebase or data that makes the call clear-cut, then support it with reuse, cost, and downstream effects.

When a question turns on mechanics, a defect, or a risk the user hasn't seen spelled out, explain it before the options: where the problem enters, why nothing downstream catches it, and why it matters here.

## Check, don't recall

Verify any fact that would flip the recommendation by reading the code or running a command. When reading can't settle it, prototype: write a small script that exercises the behavior and run it. Label the rationale's facts **checked** or **not checked**.

Prototypes and scratch scripts go in `scratch/` inside the brainstorm's directory. When you create `scratch/`, put a `.gitignore` containing `*` in it, so nothing there is committed. A Why cites the script by path.

Measure quantities instead of estimating them (how far a refactor ripples, how many call sites move): apply the change, run the typechecker and tests, count the diff, then revert; or compute the number in a scratch script against real project data. Say what you measured against. A low measured cost is not by itself a reason to do the work.

Research outside the codebase is encouraged: best practices, dependencies, registry pages, docs, source. Never install anything during the interview.

## Simple, standard, small

- **KISS/YAGNI.** The default recommendation is the simplest design that meets the stated requirement. Edge-case guards, backward compatibility, and future-proofing are tradeoffs to present ("costs X, protects against Y"), not defaults. Test each protective piece: what observably breaks without it? If nothing, it has no case, however cheap it is.
- **Standard beats bespoke.** Prefer the ecosystem's documented way: the published package, the conventional pattern. A hand-rolled or clever alternative must say why the standard one fails, or it isn't recommended.
- **Code is a liability.** A well-vetted dependency that removes complexity beats writing it. Be picky about maintenance, trust, and weight, not averse. Either way, count the code each option adds (wrappers, config carve-outs, guards) against the code it removes. Machinery that needs config exceptions has already lost the count.
- **A dependency is its own question**, logged as its own decision, never bundled into another choice.
