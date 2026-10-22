---
name: auto-brainstorm
description: "Run a brainstorm with no human in the loop: one long-lived `mzizzi:complex` agent answers the interview questions in the user's place, and the decisions are saved as brainstorm.md. Use when the user asks for an auto-brainstorm, an unattended brainstorm, or to brainstorm against a reviewer agent instead of answering the questions themselves."
argument-hint: "[--max-reviews=<n>] [existing brainstorm.md or plan dir] <idea, design, or plan to brainstorm>"
disable-model-invocation: false
user-invocable: true
---

# Auto-brainstorm

Run the `mzizzi:brainstorm` skill with an agent answering in the user's place. Where this skill and brainstorm differ, this skill wins: questions go to the interviewee agent, never to the user or the harness's user-question tool, and you pick brainstorm's menu options yourself (see Ending). Load it with:

    Skill(skill: "brainstorm", args: "<the arguments this skill was given, without --max-reviews>")

`--max-reviews=<n>` is the **review limit**: the most `mzizzi:pragmatic-reviewer` reviews the saved document gets. It defaults to 2.

Everything below is what changes when no human answers.

## The interviewee

Every question brainstorm asks the user goes to a single `mzizzi:complex` agent instead. Spawn it once, with a briefing and the first question. Send each later question to that same agent with SendMessage, so every answer builds on what it has already read and decided.

Before the first question, read the code the idea touches. The briefing passes on what you found as facts with `file:line`, and says:

- what is being designed
- one question per message: answer it and stop
- give a pick and the fact that decides it
- disagree when the code says so

Each question says how the previous one was settled and carries your recommendation with its reason.

## Standing in for a human's pushback

A human interviewee challenges the premise. An agent interviewee looks for less change, so "leave it where it is" is always its cheapest answer.

- Ask the structural questions too: where code lives, what it depends on, which module owns a rule. The interview decides those itself to spare a human, and that leaves them unchallenged here.
- Treat nothing as settled because the user's phrasing assumes it. Say in the briefing which decisions are open and that least change is not a merit on its own: an answer of "leave it there" has to say why that place is right for a reader.
- When an answer rests on a precedent in the code, check the precedent before accepting it.

## Ending

Brainstorm's menus have nobody to answer them. Keep interviewing until no branch is open, then take **Save & Review**. The review is a fresh agent, not the interviewee, which wrote the decisions. When it comes back clean, exit with brainstorm's sign-off.

A fresh reviewer finds something on nearly every pass, so the review loop does not end on its own. The review limit ends it:

- Each Save & Review counts as one review.
- A review under the limit that has findings goes back to the interview, as brainstorm says.
- When the review that reaches the limit has findings, do not go back to the interview and do not review again. Decide each finding yourself, log it as a decision with its why, save, and exit with brainstorm's sign-off.
