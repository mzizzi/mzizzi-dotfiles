---
name: auto-brainstorm
description: 'Run a brainstorm with no human in the loop: one long-lived agent, `mzizzi.complex` by default, answers the interview questions in the user''s place, and the decisions are saved as brainstorm.md. Use when the user asks for an auto-brainstorm, an unattended brainstorm, or to brainstorm against a reviewer agent instead of answering the questions themselves.'
disable-model-invocation: false
---

Resolve `<skill-dir>` to this skill's absolute directory.

# Auto-brainstorm

Run the `brainstorm` skill with an interviewee agent instead of the user. This skill overrides brainstorm: send questions to the interviewee and choose menu options yourself (see Ending).

Read and follow the `brainstorm` skill from `<skill-dir>/../brainstorm/SKILL.md` with arguments `<the arguments this skill was given, without --agent or --max-reviews>`.

`--agent=<name>` is the agent type of the interviewee. It defaults to the `mzizzi.complex` agent.

`--max-reviews=<n>` is the **review limit**: the most reviews by the `mzizzi.pragmatic-reviewer` agent the saved document gets. It defaults to 2.

Everything below is what changes when no human answers.

## The interviewee

Enable `subagent` if needed. Start one interviewee with the briefing, first question, and protocol below:

```js
subagent({ agent: "<resolved interviewee agent>", task: "<briefing and first question; include the live interview protocol below>", async: true, options: { context: "fresh" } })
```

Keep its run id separate from reviewers. Send each answer with:

```js
contact_supervisor({ reason: "need_decision", message: "<answer and request for the next question or STOP>" })
```

The interviewee must not finish between questions. On `STOP`, finish and exit. Reply to each pending request with the previous decision, recommendation, and next question:

```js
subagent_supervisor({ action: "reply", replyTo: "<pending interviewee request id>", message: "<previous decision, recommendation, and next question>" })
```

Use supervisor replies for the interview. Use `steer` only for extra guidance; do not resume or replace the interviewee between questions.

If launch or coordination fails, or the interviewee exits early, report the reason and stop. Do not silently replace its conversation. If the interviewee remains live on failure, stop that exact run with `subagent({ action: "stop", id: "<interviewee run id>" })`.

Before the first question, read the code the idea touches. The briefing passes on what you found as facts with `file:line`, and says:

- what is being designed
- one question per message: send the answer through blocking `contact_supervisor`, then wait for the next supervisor reply without finishing
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

Leave the interviewee waiting on its pending supervisor request while you save and review. Reuse it if findings reopen the interview. When the workflow ends, reply `STOP` to its pending request and wait for native completion before the final sign-off. If it fails to exit, report the error and stop that exact interviewee run; never leave it waiting after the workflow ends.
