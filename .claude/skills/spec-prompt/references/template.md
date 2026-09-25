# Skeletons

Fill in the brackets. Delete sections that genuinely don't apply — but delete deliberately,
because most of them apply more often than they look like they do. Keep the section order:
it is the order the agent reads in, and constraints have to arrive before the work they
constrain.

---

## A. New build

```markdown
# [Project name] — [one-line what and where it runs]

## Project

[What to build, in two sentences.]

The deliverable is [shape] — **not** [the default the agent would otherwise produce].
[Human usability test for the architecture: "someone else must be able to X without
touching Y."]

## Stack (do not substitute)

- [lang + version]
- `[dep]` — [what it is for, and any scope limit: "only for X, not Y"]
- `[dep]` — [named trap: "not the deprecated `other`"]

Pin versions in `requirements.txt`. Print the resolved versions at the top of every run log.

## Repo layout

[Tree. One line per file, with an inline comment stating each file's single
responsibility.]

**Hard architectural rule:** [file] must not [mechanically checkable violation, e.g. import
from X]. It only sees [the interface]. If [component] knows [the thing it must not know],
the design is wrong.

## [Component] spec — read this section carefully, it contains the [N] failure modes

[Precise spec: dimensions, defaults, config flags. Say which defaults are for this run and
which exist so a later variation is a config change rather than a rewrite.]

### FAILURE MODE 1 — [name]

[Mechanism: why it happens.] [Symptom: what you will *observe* if it happens — this is the
part that lets it be recognized mid-run.]

Fix: [literal code].

### FAILURE MODE 2 — [name]

[Mechanism.] [Say "silently" if the failure returns plausible numbers.]

[ASCII diagram, if the spec is about where something lives rather than what it does.]

### [Load-bearing detail]

This matters a lot and is easy to miss:

[literal code / exact values]

## Trainer / pipeline spec

[Standard components with exact values. Mark guesses as guesses.]

Every run writes `[path pattern]` with per-[unit]: [full column list, including the
parameters you will need to diagnose the failure modes above].

**Reproducibility:** [seeding requirements]. Same seed must give a byte-identical [output].

## Evaluation protocol

- **Success criterion:** [one definition]. Use this one definition everywhere.
- Report [X] and [Y], not just [the flattering summary statistic].
- Run [N] [seeds/trials] minimum. [Why a single run is not evidence here.]
- Aggregate with [median and IQR / etc.], not [the thing that hides a bad run].
- Final evaluation: [exact protocol].

## Baseline — make it fair

[Baseline] must be [matched on what], within [tolerance]. [The concrete numbers showing how
bad the naive comparison is, and why it proves nothing.] Find [the matching setting] and
report it in the README.

## Visualizations

Save every figure to `figures/` as both PNG (150 dpi) and PDF. Readable without color.

1. **[Name]** — [x-axis, y-axis, aggregation, reference lines, what's on the same axes]
2. **[Name]** — [...]. This figure is the direct visual evidence for Failure Mode [N]:
   [predicted direction].

## Performance — plan for this from the start

[What dominates runtime and roughly why.]

- [Fast path to use; slow path to avoid, and when the slow one is legitimate.]
- [Batching / vectorization requirement, stated as "do not loop".]
- Time [N] [steps] early and extrapolate before launching the full run. Print the projected
  wall-clock and **stop to tell me** if it exceeds [T] — we will cut [named lever] rather
  than let it run blind.

Leave a stub `[signature]` for [out-of-scope work]. Do not implement it yet — just the hook.

## References

| What to take from it | Reference |
|---|---|
| [specific thing — mark the primary API reference as primary] | [link] |
| [architecture only, do not port the framework] | [link] |

**Warning about [imperfect reference]:** it is [what's wrong: wrong algorithm / wrong
version / deprecated API]. [The specific API differences.] Take the [structure], not the
[details]. Also [the small thing that will silently cost the most].

## Build order

Work in this sequence and stop for my review at each checkpoint.

1. Scaffold, `requirements.txt`, venv, print versions. Confirm imports work.
2. [Riskiest isolated component] alone. Smoke test: [exact assertions]. **Do not proceed
   until this passes** — [the exact bug this catches].
3. [Everything except the expensive component], verified with [the cheap stand-in] first.
   If [the cheap path] does not work, the bug is in [the shared machinery], not
   [the expensive component] — this ordering saves hours.
4. Wire in [the expensive component]. Single [seed/case], watch [the specific quantity and
   its expected direction]. Checkpoint here.
5. [Full runs, figures.]
6. `README.md`: setup, how to reproduce each figure, [the fairness argument], reference
   tables.

## Working style

- Ask before installing anything outside `requirements.txt`.
- Commit at each checkpoint with a descriptive message.
- When a hyperparameter is a guess, say so in a comment rather than presenting it as
  settled. The values above are [source], not tuned results.
- If something is not [converging/passing], show me the diagnostic plot before changing
  hyperparameters.
```

---

## B. Change to an existing repo

```markdown
# [Project] — [vN: what this round changes]

## Context — read this first

We have [working state]. [What's wrong with it, in one sentence, with a number if you have
one.] This prompt fixes [that]. **Do not rebuild the repo** — modify `[file]`, `[file]`,
and `[file]` in place.

[If there are multiple problems: state how many, and why the order is forced —
"fix them in the order given, because X must land before Y can be validated."]

### Problem 1 — [name]

[Measured evidence, in a table. Numbers, not impressions.]

| Component | Measurement | Share |
|---|---|---|
| | | |

Interpretation (do not re-derive this, act on it):

- [What the numbers mean.]
- [The obvious hypothesis, killed by name.] It is **not** [X]. [Why not.] [The fix it
  suggests] will not help.
- Therefore: **do not** [the class of fix that won't work]. The problem is [the real
  level], which needs [a different class of fix].

Target: [numeric target] ([speedup/improvement factor]). [What that means in wall-clock or
other terms the user cares about.] Anything less than [floor] means [this approach] failed
— see the stop-loss rule below.

### Problem 2 — [name]

[Table diffing ours vs. the authoritative reference, with a "why it matters" column.]

| Setting | Ours | Reference | Why it matters |
|---|---|---|---|

## Task 1 — [the change]

[What replaces what, and the mechanism by which it helps — tied back to the profiled
bottleneck, not asserted.]

[Literal code for the new construction.]

Notes:

- [Non-obvious required argument, and what silently breaks without it.]
- [What stays unchanged, especially invariants that the change might tempt someone to
  break.]
- **[Now-obsolete thing] is obsolete.** Remove it from [the path]. Keep [the config key]
  with [new default], and leave the old path runnable behind [a flag] for [the comparison
  figure].
- **[The hard architectural rule] still holds.** [Restate it against the new component.]

### Limitations to design around

[What the new approach cannot do, and how the repo accommodates that — which path handles
what.]

## Task 2 — stop-loss rule (do this before any long run)

Run a [small] smoke test and report:

- [metric 1]
- [metric 2, vs. the measured baseline]
- projected wall-clock for the full run

Then stop and report to me. Decision rule:

- **≥ [good]** → proceed to Task 3.
- **[marginal range]** → report and wait for my decision.
- **< [floor], or it fails to install / fails the smoke test** → **do not debug it.**
  Switch to [the fallback] below. We have a hard time budget; sunk cost is not a reason to
  continue.

### Fallback: [name]

[Minimal construction + a reference implementation link + its published hyperparameters.]

Take its [structure]. Do not port its [training loop] wholesale — ours is already correct
and [model-agnostic].

## Task 3 — [config / follow-on changes]

Only after [the gate] is met.

[Literal config block, with `# was X` comments on every changed line.]

Do not [the plausible-but-wrong optimization]. [Why it trades away the thing being
measured.] [Note explicitly if this retires an instruction from an earlier prompt.]

## Why this matters — do not silently accept a worse result

[If the change alters how results should be *interpreted*:]

1. **[What will look wrong but isn't.]** This is expected, not a bug. Do not "fix" it by
   changing unrelated hyperparameters before confirming [via the ablation] that it comes
   from [the change].
2. **[Previously optional requirement] is now load-bearing, not optional.** [Why the change
   makes it necessary.]

## Task 4 — validation, in this order

1. **Smoke test**: [exact assertions]. [The exact bug this catches, and why the change is a
   likely place to introduce it.]
2. **[Cheap path] first**: confirm [the stand-in] still works through the same [shared
   machinery]. If it regressed, the bug is in [the shared machinery].
3. **Single [seed/case]**, watch [quantity] — [expected direction, and what it means if it
   doesn't move]. Checkpoint here and show me [the curves] before launching the sweep.
4. **[Full sweep]**: [N] minimum. Report median and IQR, never mean ± std, never a single
   curve.

Success criterion, used everywhere: [unchanged definition].

## Task 5 — new figure: `figures/[name].png`

[Panels, axes, what's compared.] Log the exact numbers in the README, not just the plot —
someone should be able to read [the tradeoff] without opening a figure.

Keep all previously specified figures. [List them briefly so none get dropped.]

## Everything else stays as specified

(Restate briefly for continuity — do not rebuild these, just confirm they still hold after
the change.)

- [Invariant]
- [Invariant]
- [Logging spec, plus any new columns this change requires]

## References — update README.md

[Full table, including the new entries for this change. Restate the old rows; a delta-only
table gets half-applied.]

## Working style

- Ask before installing anything not already in `requirements.txt`.
- Commit at each checkpoint with a descriptive message.
- Report the smoke-test timing and **stop** before any long run. Do not launch a multi-hour
  sweep without showing me the projection first.
- If [the change] doesn't work at any of the values tried, say so plainly and fall back to
  [the alternative] — don't keep tuning silently past the point where [the check] was
  supposed to give you an answer.
- If something is not converging, show me the diagnostic plot before changing
  hyperparameters. Changing two things at once here wastes a run we cannot afford.
```
