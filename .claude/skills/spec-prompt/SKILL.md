---
name: spec-prompt
description: Write a specification-grade prompt for a coding agent — the kind that builds a whole research repo or lands a risky migration in one unattended pass. Use when the user asks to write, review, or sharpen a prompt / brief / spec for Claude Code or another coding agent; when kicking off a hackathon, experiment, or benchmark build; or when a previous agent run drifted and the next prompt has to prevent the same drift. Produces prompts with named failure modes, falsifiable acceptance criteria, a compute budget with stop-gates, and a build order that localizes bugs.
---

# Spec-grade prompts for coding agents

## The principle

Write for an agent that is **competent but not clairvoyant**. It will not fail on the hard
parts. It will take the locally-reasonable wrong turn: cache the thing that isn't the
bottleneck, compare against an unfair baseline, tune two knobs at once, launch a 60-hour
sweep without telling you, report "done" on something it never checked.

So the whole method reduces to two habits:

1. **Every requirement carries the cost of violating it.** A requirement with no stated
   consequence gets silently traded away the moment it conflicts with something else.
2. **Every requirement has an observable check.** A requirement with no check gets
   reported as done.

Everything below is machinery for those two.

## Pick the mode first

**New build** — nothing exists yet. Order: deliverable → stack → layout + architectural
rule → failure modes → measurement → artifacts → budget → references → build order →
working style.

**Change** — the repo exists and this prompt lands one specific change. Order: context and
what NOT to rebuild → evidence → the change → what it costs you elsewhere → validation →
references delta → working style. See `references/template.md`.

The most common mistake in change mode is omitting *"do not rewrite from scratch; locate
`X`, `Y`, `Z` and modify them in place."* Without it the agent regenerates the repo and
you lose everything that already worked.

## Elicit before drafting

Do not draft from a one-line request. Ask for whatever is missing — in one batch, not
serially:

- **The deliverable and its shape**, including the negative. Not "a QDQN" but "a small
  reproducible research repo, *not* a single script." Then a human usability test for the
  architecture: *"someone else on my team must be able to swap the model without touching
  the trainer."*
- **The stack, and what must not be substituted.** Include per-item scope where it matters
  ("`qiskit-aer` — evaluation hook only, never training").
- **Known failure modes.** Ask directly: what went wrong last time, what does the paper
  warn about, where would a reasonable person guess wrong? This is the highest-value
  question in the interview.
- **The one definition of success**, fixed before results exist.
- **The fair comparison**, if any claim is comparative.
- **The compute budget**, and which lever gets cut when it's blown.
- **References, and which ones are traps.**
- **What is explicitly out of scope** — becomes a stub, not silence.

If the user cannot answer "how will we know it worked," stop and settle that first. Nothing
downstream is checkable without it.

## The twelve moves

Each is expanded with verbatim source examples in `references/anatomy.md`. Read that file
when you want the full worked version; this list is the operational summary.

1. **State the deliverable with a negative.** "…a small, clean, reproducible research repo
   — *not* a single script." The negative is what does the work.

2. **Pin the stack; forbid substitution; scope each item.** Name the trap inline:
   "`gymnasium` — CartPole-v1 (**not** the deprecated `gym`)."

3. **Give the file tree, then one hard architectural rule with a grep-able test.**
   "`trainer.py` must not import anything from `qiskit`. If the trainer knows whether the
   model is quantum, the design is wrong." One rule, mechanically checkable, stated as an
   invariant rather than a preference.

4. **Pre-declare failure modes by number, with symptom → mechanism → fix.** The symptom is
   what lets the agent *recognize* the failure mid-run ("training flatlines at ~10
   reward"); the mechanism is what stops it from reaching for the wrong lever
   ("⟨Z⟩ ∈ [-1,1] but true Q-values reach ~100"); the fix is a literal line of code. Use an
   ASCII data-flow diagram when placement is the thing being specified.

5. **Flag the load-bearing detail as load-bearing.** "Three parameter groups, three
   learning rates. This matters a lot and is easy to miss" — then the literal code. Agents
   deprioritize what reads as incidental.

6. **Fix measurement before results exist.** One definition of solved, "use this one
   definition everywhere." Say what to report ("episodes-to-solve *and* env-steps-to-solve,
   not just final reward"). Pre-commit the statistics ("median and IQR, not mean ± std";
   "5 seeds minimum — single-run curves in this field are not evidence"). This is what
   makes post-hoc cherry-picking impossible rather than merely discouraged.

7. **Make the comparison fair, and say why the unfair one is worthless.** "A 2×128 MLP has
   ~17k parameters versus the VQC's ~40; comparing those and declaring quantum
   parameter-efficiency is not a real result." Then require the agent to *find* the fair
   setting and report it.

8. **Enumerate artifacts with acceptance criteria, and tie each to a hypothesis.** Not
   "plot the training curves" but axes, aggregation, reference line — plus, where it
   applies, the predicted direction: "this figure is the direct visual evidence for Failure
   Mode 1: `w` should climb from 1 toward the tens." A figure with a prediction attached is
   a test; without one it is decoration.

9. **Budget the compute and install a stop-gate with a named lever.** "Time 100 gradient
   steps early and extrapolate. Print the projected wall-clock for 5 seeds and **stop to
   tell me** if it exceeds ~6 hours — we will cut `n_layers` or seed count rather than let
   it run blind." Naming the lever in advance stops the agent from inventing a worse one.
   For risky changes, escalate to a numeric **stop-loss with branches**: ≥10× proceed;
   5–10× report and wait; <5× or install fails → switch to the named fallback, *"do not
   debug it — sunk cost is not a reason to continue."*

10. **Stub what is out of scope.** "Leave a stub `evaluate_finite_shot(model, shots)`. Do
    not implement the sweep yet — just the hook." Silence invites either scope creep or a
    design that can't accommodate the thing later.

11. **Annotate every reference with what to take — and warn about the traps.** Make the
    table column literally *"what to take from it."* Then pre-correct the misreads:
    *"it is A2C not DQN, it targets CartPole-v0, and it uses the old gym API… Take the
    structure, not the API calls. Also drop its `env.render()` inside the training loop —
    it makes training crawl."* An unannotated link is an instruction to copy it wholesale.

12. **Order the build so the first failure localizes itself.** "Verify the trainer solves
    CartPole with the MLP first. If the classical path does not solve it, the bug is in the
    trainer, not the quantum model — this ordering saves hours." Gate each step on a check
    that fails loudly: "assert gradients are non-`None` and non-zero for all three
    parameter groups. Do not proceed until this passes — a silently dead `lam` gradient is
    the exact bug this catches."

## Change mode adds three

13. **Lead with measured evidence, then forbid re-deriving it.** Put the profile in a
    table, then: *"Interpretation (do not re-derive this, act on it)."* Saves the agent a
    turn and stops it re-litigating a settled conclusion.

14. **Kill the wrong hypothesis by name.** "The 33,552 `_circuit_key` calls are **not** a
    caching bug… adding a cache will not help. Do not attempt micro-optimizations — the
    bottleneck is architectural." Whatever the obvious-but-wrong fix is, name it and rule
    it out, or the agent will spend hours there.

15. **Say what the change costs elsewhere, and promote what it makes load-bearing.** "SPSA
    gives a stochastic approximate gradient. Convergence will look noisier — this is
    expected, not a bug; do not 'fix' it by changing unrelated hyperparameters. And the
    seed-averaging requirement is now **load-bearing, not optional**." A change that
    invalidates an earlier assumption must say so explicitly.

    Guard the plausible-but-wrong optimization too: *"Do not change `n_layers` downward to
    save time — the paper reports greater depth gives faster convergence; cutting layers to
    buy wall-clock trades away the thing we are trying to measure."*

## Working-style block — put it at the end, always

Four rules, near-verbatim, that keep the expensive decisions with the human:

- Ask before installing anything outside `requirements.txt`.
- Commit at each checkpoint with a descriptive message.
- When a hyperparameter is a guess, say so in a comment rather than presenting it as
  settled.
- If something is not converging, show me the diagnostic plot before changing
  hyperparameters. (Changing two things at once wastes a run you cannot afford.)

## Pre-flight checklist

Run this against the draft before handing it over. Every "no" is a rewrite, not a note.

- [ ] Can I name a command, grep, or assertion that checks each **must**?
- [ ] Does every **don't** say what breaks if it's ignored?
- [ ] Is there exactly **one** definition of success, and does it appear before any
      discussion of results?
- [ ] Are the statistics pre-committed (n, aggregation, what counts as evidence)?
- [ ] Is the comparison fair, with the unfair version explicitly rejected?
- [ ] Does the compute budget have a **number**, a **gate**, and a **named lever**?
- [ ] Have I named the obvious-but-wrong fix the agent will reach for?
- [ ] Is every reference annotated with what to take *and* what to ignore?
- [ ] Does the build order make the first plausible failure self-localizing?
- [ ] Is every guessed hyperparameter marked as a guess?
- [ ] (Change mode) Does it say what not to rebuild, and name the files to edit in place?

## Anti-patterns

| Instead of | Write |
|---|---|
| "Make it robust / production-ready / clean" | The invariant plus its check |
| A requirement list with no consequences | Requirement → what breaks without it |
| A bare reference link | Link + what to take + what to ignore |
| "Compare against a classical baseline" | The fairness condition, and why the unfair one proves nothing |
| "Train it and report results" | The success definition, the n, the aggregation — fixed up front |
| "Let me know if it's slow" | Time N steps, extrapolate, stop at threshold T, cut lever L |
| "Also handle finite shots eventually" | A named stub signature and "do not implement yet" |

## Reviewing someone else's prompt

Same checklist, but report gaps as a short list ordered by expected cost: which omission
burns the most agent-hours or produces the most un-publishable result. Quote the line you
would add. Do not rewrite the whole prompt unless asked.

## Source

Method extracted from three prompts for a quantum-RL hackathon build (initial repo, a
gradient-estimator swap, and a framework migration). Verbatim examples in
`references/anatomy.md`; fill-in skeletons in `references/template.md`.
