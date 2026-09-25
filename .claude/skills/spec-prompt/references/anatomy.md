# Anatomy of a spec-grade prompt

Worked examples for each move in `SKILL.md`. All quotes are verbatim from three real
prompts for the same project:

- **v1** — build the QDQN repo from nothing (Fundamental track deliverable)
- **v2** — swap the gradient estimator to SPSA and make it configurable
- **v3** — migrate the training backend after profiling showed a 91% framework overhead

Read v1 for new-build structure, v2 and v3 for change structure. The interesting thing
about v2 and v3 is how little they restate and how much they *interpret*.

---

## 1. Deliverable with a negative

> The deliverable is a small, clean, reproducible research repo — **not** a single script.
> Someone else on my team must be able to swap the model out for a different ansatz
> without touching the trainer.

Two sentences doing different jobs. The first sets shape and rules out the default
(one long `main.py`). The second is an *architecture acceptance test written as a human
scenario* — it is falsifiable without naming a single file, and it is the reason the
whole `models/base.py` ABC exists later.

Write the negative for whatever the agent's default output would be. If you don't, you get
the default.

---

## 2. Pinned stack with per-item scope

> ## Stack (do not substitute)
> - `torch` — training loop, optimizer, autograd
> - `qiskit`, `qiskit-machine-learning` — `EstimatorQNN` wrapped in `TorchConnector`
> - `qiskit-aer` — **only** for the finite-shot evaluation hook (not for training)
> - `gymnasium` — CartPole-v1 (**not** the deprecated `gym`)

Three separate techniques in four lines: the header forbids substitution; each entry says
what the dependency is *for* (so the agent doesn't reach for `aer` during training); and
the known trap is named inline (`gym` vs `gymnasium` — the failure mode being the
4-tuple/5-tuple API difference that silently half-works).

Closing line, worth copying verbatim:

> Set up a venv and pin versions in `requirements.txt`. Print the resolved versions at the
> top of every run log.

Resolved versions in every log is how you find out six hours later why two runs disagree.

---

## 3. One hard architectural rule, grep-able

> **Hard architectural rule:** `trainer.py` must not import anything from `qiskit`. It only
> sees an object satisfying `models/base.py`. If the trainer knows whether the model is
> quantum, the design is wrong.

Note the three sentences: the mechanical rule (`grep qiskit src/trainer.py` → empty), the
positive form (what it *does* see), and the principle that generalizes to cases the rule
didn't anticipate. The agent can apply the third when it hits something the first doesn't
literally cover.

**One** hard rule. A list of five hard rules has no hard rules.

v3 re-asserts it under pressure, which is when invariants actually get tested:

> `trainer.py` **still** must not import from `qiskit` or `qiskit_torch_module`. It only
> sees the `QFunction` ABC. Backend choice is entirely internal to `models/vqc.py`.

---

## 4. Failure modes, pre-declared and numbered

The section is titled — this matters — *"Model spec — read this section carefully, it
contains the two failure modes."*

> **FAILURE MODE 1 — output scaling**
> `⟨Z⟩ ∈ [-1, 1]`, but true CartPole Q-values at γ=0.99 reach ~100. Without a trainable
> output scaling the model literally cannot represent the value function and training
> flatlines at ~10 reward.
> Add `self.w = nn.Parameter(torch.ones(n_actions))` and return `raw_out * self.w`.

Structure: **mechanism** (range mismatch) → **symptom** (flatlines at ~10) → **fix**
(literal code). The symptom is the load-bearing part — it is what lets the agent
*recognize* the failure at hour two instead of blaming exploration, learning rate, or
replay capacity.

> **FAILURE MODE 2 — do not put the scalings inside the circuit**
> `λ_i · x_i` is a product of an input parameter and a weight parameter. Parameter-shift
> requires parameters to enter gates linearly, so this **silently breaks gradients**.

"Silently" is the word to steal. Failures that announce themselves don't need a prompt
section; failures that return plausible numbers do.

Then, because the fix is about *placement* and prose is bad at placement:

```
s ──atan──► λ ⊙ s ──► TorchConnector(EstimatorQNN) ──► [⟨Z₀⟩, ⟨Z₁⟩] ──► ⊙ w ──► Q(s,·)
                ↑ nn.Parameter                                            ↑ nn.Parameter
```

An ASCII diagram removes an ambiguity that three paragraphs would not. Use one whenever
the spec is about *where a thing lives* rather than what it does.

---

## 5. Marking the load-bearing detail

> ### Three parameter groups, three learning rates
> This matters a lot and is easy to miss:
> ```python
> optimizer = torch.optim.Adam([
>     {"params": [model.lam],            "lr": 1e-3},  # input scaling
>     {"params": model.vqc.parameters(), "lr": 1e-3},  # variational
>     {"params": [model.w],              "lr": 1e-1},  # output scaling — much larger
> ])
> ```

"This matters a lot and is easy to miss" is not filler. An agent triaging a long spec
deprioritizes anything that reads as incidental, and a single-`lr` optimizer looks
perfectly reasonable. The explicit flag moves it out of the incidental pile. Use it
sparingly — two or three per prompt — or it stops meaning anything.

Same technique in the normalization section, where the trap is a plausible alternative:

> Cart position and pole angle: divide by their termination bounds (2.4 and 0.2095). Both
> velocities are **unbounded** — use `arctan` (or `tanh`), never raw division. Do the
> normalization inside `forward()`; the replay buffer stores **raw** observations.

Raw division by a guessed constant is exactly what an agent would do unprompted, and it
half-works, which is worse.

---

## 6. Measurement fixed before results exist

> - **Solve criterion:** mean reward ≥ 475 over 100 consecutive episodes. Use this one
>   definition everywhere.
> - Report **episodes-to-solve** and **env-steps-to-solve**, not just final reward.
> - Run **5 seeds minimum**, 10 if runtime allows. Single-run curves in this field are not
>   evidence — the variance is enormous.
> - Aggregate with median and interquartile range, not mean ± std.
> - Final greedy evaluation: 100 episodes with ε = 0.

Every line closes a specific escape hatch:

| Line | What it prevents |
|---|---|
| "use this one definition everywhere" | Two criteria in the repo, then quoting whichever is kinder |
| "not just final reward" | Reporting the flattering summary statistic |
| "single-run curves are not evidence" | A lucky seed presented as a result |
| "median and IQR, not mean ± std" | One catastrophic seed hidden inside a mean |
| "100 episodes with ε = 0" | Evaluating with exploration still on, then calling it greedy |

The point is not rigor for its own sake. Fixing measurement *before* results exist is what
makes cherry-picking structurally impossible rather than merely discouraged — including by
you, later, at 3am.

Logging spec belongs here too, and this one is unusually complete:

> Every run writes `results/{config}_{seed}.csv` with per-episode: episode index, total env
> steps, episode reward, 100-episode moving average, epsilon, mean loss, wall-clock
> seconds, and the current values of `w` and `lam`.
> **Reproducibility:** seed python/numpy/torch and pass `seed=` to `env.reset()`. Same seed
> must give a byte-identical CSV.

"Byte-identical" is a testable claim. "Should be reproducible" is not.

Logging the *parameters* per episode is what makes Failure Mode 1 diagnosable from the CSV
alone, without re-running anything. v2 extends the same logic to timing:

> now also log `gradient_method` and `wall_clock_seconds` per episode (not just total) so
> the timing comparison can be reconstructed from logs alone if the figure script breaks.

Design the log so the result survives the analysis code.

---

## 7. Fairness, with the unfair version rejected out loud

> `mlp.py` must be **parameter-count matched** to the VQC (roughly ±20%). A 2×128 MLP has
> ~17k parameters versus the VQC's ~40; comparing those and declaring quantum
> parameter-efficiency is not a real result. Find the hidden width that matches and say
> what it is in the README.

Three moves: the constraint with a tolerance, the concrete number showing how bad the
default is, and a *task* — the agent must find the matching width and publish it.

Naming the unfair comparison explicitly is what stops it. "Make it a fair comparison" would
not have; the agent's default 2×128 is a perfectly normal MLP.

---

## 8. Artifacts with acceptance criteria and a predicted direction

> 1. **Learning curves** — episode reward vs episode, median across seeds, IQR shaded,
>    QDQN and MLP baseline on the same axes, horizontal line at 475.
> 3. **Scaling parameter evolution** — `w[0]`, `w[1]`, and each `lam[i]` vs training step.
>    This figure is the direct visual evidence for Failure Mode 1: `w` should climb from 1
>    toward the tens.
> 5. **Q-value landscape** — fix cart position and both velocities at 0, sweep pole angle ×
>    angular velocity on a 100×100 grid, plot `Q(s,0) - Q(s,1)` as a heatmap with the
>    decision boundary overlaid. Untrained and trained side by side.

Figure 3 is the model to copy: it is tied to a named failure mode and carries a
**prediction with a direction** (`w`: 1 → tens). That converts a plot into a test — you can
be wrong. Figure 5 specifies the slice, the grid, the quantity, and the comparison, so
there is nothing left to guess.

Format is stated once, globally:

> Save every figure to `figures/` as both PNG (150 dpi) and PDF. Consistent styling,
> readable without color.

---

## 9. Compute budget, stop-gate, named lever

v1, before any code exists:

> Training is dominated by circuit simulation. Rough budget: batch 16 × 2 observables × a
> few thousand gradient steps × 5 seeds.
> - Use Qiskit's **statevector** path for training, never a shot-based estimator.
> - Batch all 16 states into a single `TorchConnector` call. Do **not** loop.
> - Time 100 gradient steps early and extrapolate before launching the full sweep. Print
>   the projected wall-clock for 5 seeds and **stop to tell me** if it exceeds ~6 hours —
>   we will cut `n_layers` or seed count rather than let it run blind.

Measure-then-extrapolate-then-gate, with the lever chosen *in advance*. Without the named
lever, an agent that hits the wall picks its own — and the natural choice (fewer layers)
was later shown to be exactly wrong for this problem.

v3 escalates it to a branching stop-loss, which is the form to use when the change itself
might fail:

> After the migration, run a 10-episode smoke test and report seconds per gradient step,
> speedup factor vs the 2.16 s/step baseline, and projected wall-clock for 1000 episodes ×
> 5 seeds. Then stop and report to me. Decision rule:
> - **≥ 10×** (≤ 0.2 s/step) → proceed to Task 3.
> - **5–10×** → report and wait for my decision.
> - **< 5×, or it fails to install / fails the smoke test** → **do not debug it.** Switch
>   to the PennyLane fallback below. We have a hard time budget; sunk cost is not a reason
>   to continue.

Every branch is resolved in advance, including the one where the plan fails. "Do not debug
it" is the instruction agents most need and least expect: debugging the broken new thing
always looks like progress.

The fallback comes with its own reference implementation and hyperparameters, so failure
has a path rather than a question.

---

## 10. Stubs for out-of-scope work

> Leave a stub `evaluate_finite_shot(model, shots)` that swaps in an Aer estimator with a
> given shot count. Do not implement the sweep yet — just the hook.

Silence about future work produces either scope creep or a design that can't accommodate
it later. A named signature costs one line and constrains the architecture correctly.

---

## 11. Annotated references, and the anti-reference warning

The table's column header is literally **"What to take from it"** — not "reference":

| What to take from it | Link |
|---|---|
| `TorchConnector` + `EstimatorQNN` usage — **primary API reference** | qiskit-ml tutorial |
| PyTorch RL loop structure on CartPole (episode loop, optimizer pattern) | Actor-Critic-pytorch |
| VQC-RL reference implementation in TF (**architecture only, do not port the framework**) | TFQ tutorial |

Then the move that separates this from ordinary prompt-writing:

> **Warning about the Actor-Critic-pytorch reference:** it is a useful shape for the torch
> training loop, but it is A2C not DQN, it targets `CartPole-v0`, and it uses the old gym
> API (`state = env.reset()`, 4-tuple `env.step()`). Gymnasium returns `(obs, info)` from
> `reset()` and a 5-tuple from `step()`. Take the structure, not the API calls. Also drop
> its `env.render()` inside the training loop — it makes training crawl.

Four distinct misreads, each pre-corrected. An unannotated link is an instruction to copy
it wholesale — so if you link something imperfect, say precisely which parts are wrong and
what to take anyway. The `env.render()` note is the smallest item and would have cost the
most: silent, plausible, and a 10× slowdown.

v3 does the inverse — sourcing hyperparameters to an authority instead of to taste:

> | Setting | Ours | Skolik reference | Why it matters |
> | `reuploading` | `false` | **`True`** | Single encoding gives the circuit only
>   base-frequency expressivity. It is a convergence requirement here, not an ablation
>   extra. |
> | target update | every 30 grad steps | **every 1** | Our target is far too stale. |
> | episodes | 300–2000 | **5000** | Our budget was never enough to observe convergence. |

Ours / theirs / why — a table an agent can act on without a judgment call.

---

## 12. Build order that localizes failure

> 2. `models/vqc.py` alone. Smoke test: random batch of 8 states in, assert output shape
>    `[8, 2]`, assert gradients are non-`None` and non-zero for **all three** parameter
>    groups. **Do not proceed until this passes** — a silently dead `lam` gradient is the
>    exact bug this catches.
> 3. `replay.py` + `trainer.py` + `models/mlp.py`. Verify the trainer solves CartPole with
>    the MLP **first**. If the classical path does not solve it, the bug is in the trainer,
>    not the quantum model — this ordering saves hours.
> 4. Wire the VQC into the trainer. Single seed, watch `w` grow. Checkpoint here.

This is bisection built into the schedule. By the time the expensive, hard-to-debug
component runs, everything it depends on has been independently verified — so the first
failure after step 4 has exactly one plausible cause.

Each step's gate states *what bug it catches*, which is what makes the agent take the gate
seriously instead of treating it as ceremony.

---

## 13. Evidence first, re-derivation forbidden (change mode)

> Profiling of a 10-episode / 191-step run (413 s total, **2.16 s per gradient step**):
>
> | Component | Time | Share |
> | VQC backward (gradient) | 376.6 s | 91.2% |
> | `thread.lock` wait | 402.8 s | ~97% of wall-clock |
> | `_circuit_key` calls | 33,552 | — |
>
> Interpretation (do not re-derive this, act on it): …

"Do not re-derive this, act on it" saves an agent-hour and, more importantly, stops the
agent from reaching a *different* conclusion from the same data and quietly acting on that
instead.

Give the measurement and the interpretation. The measurement alone invites reinterpretation.

---

## 14. Killing the wrong hypothesis by name

> - The `thread.lock` figure is ~97% of wall-clock, which means threads are **waiting**,
>   not computing.
> - The 33,552 `_circuit_key` calls are **not** a caching bug. That count is the real
>   number of circuit evaluations SPSA requires at this batch size. Adding a circuit cache
>   will not help; the cache already exists and those calls are lookups.
> - Therefore: **do not attempt micro-optimizations** (more `max_workers`, circuit caching,
>   reducing backward frequency). The bottleneck is architectural — the framework layer,
>   not our code. It needs a framework change, not tuning.

33,552 calls to something named `_circuit_key` *screams* caching bug. Any competent agent
would investigate it, and would be wrong. Three candidate fixes are named and killed
individually, then the class of fix is ruled out.

Ask before writing any change prompt: **what is the obvious fix here that doesn't work?**
Then write it down and rule it out. This is usually the single highest-value paragraph in
a change prompt.

Paired with a numeric definition of failure:

> Target: **≤ 0.2 s per gradient step** (a 10× improvement). At 2.16 s/step a 1000-episode
> run is ~60 hours. At 0.2 s/step it is ~6 hours, which is workable across seeds. Anything
> less than 5× means the migration failed.

And with ordering justified by dependency, not preference:

> Fix them in the order given, because the speed fix must land before the config fix can be
> validated (right now a single run takes too long to tell whether a config change helped).

---

## 15. What the change costs elsewhere

> **Why this matters — do not silently accept a worse result**
> SPSA gives a **stochastic approximate gradient**, not an exact one. This has two
> consequences you must account for, not just note in passing:
> 1. **Convergence will look noisier.** Loss and reward curves will have more step-to-step
>    variance than an exact-gradient run. This is expected, not a bug. Do not "fix" it by
>    changing unrelated hyperparameters before confirming via the ablation below that the
>    noise is actually coming from SPSA.
> 2. **The seed-averaging requirement in the original spec is now load-bearing, not
>    optional.** A single SPSA run proves nothing about whether the model is learning vs.
>    getting lucky.

Both halves matter. (1) tells the agent which surprising observation is *not* a bug —
without it, the next four hours go into chasing expected noise. (2) promotes an earlier
"nice to have" to a requirement, because the change is what made it necessary.

Guarding the plausible-but-wrong optimization, from v3:

> Do not change `n_layers` downward to save time. The paper reports that **greater circuit
> depth gives faster convergence** in this environment — cutting layers to buy wall-clock
> trades away the thing we are trying to measure.

Note this contradicts v1's own named lever. When new evidence retires an earlier
instruction, say so explicitly; otherwise the agent follows the older prompt's logic.

And the reframe that turns necessary plumbing into a result:

> This produces a genuinely useful figure: "faster but noisier vs. slower but exact" —
> frame it as a practical tradeoff finding, which is a legitimate result on its own, not
> just an implementation detail to bury in a footnote.

An engineering workaround, measured properly and reported honestly, is a finding. Say that
in the prompt or it ends up in a footnote.

Also from v2, a small sensitivity check with an escalation rule attached:

> Before running the full seed sweep, do a short sweep of `spsa_epsilon` in
> `[0.01, 0.05, 0.1]` for 1 seed, 100 episodes each. If reward is flat or NaN appears,
> epsilon is likely miscalibrated for this circuit's parameter scale — flag this to me
> rather than silently picking a value. If all three look reasonable, default to `0.01` and
> note in the README that this wasn't heavily tuned.

Both outcomes are pre-resolved, and the honest-documentation requirement rides along with
the success branch.

---

## Working style, verbatim

Present in all three prompts, essentially unchanged:

> - Ask before installing anything outside `requirements.txt`.
> - Commit at each checkpoint with a descriptive message.
> - When a hyperparameter is a guess, say so in a comment rather than presenting it as
>   settled. The values above are starting points from the Skolik et al. recipe, not tuned
>   results.
> - If something is not converging, show me the diagnostic plot before changing
>   hyperparameters. Changing two things at once here wastes a run we cannot afford.

Every one of these keeps an expensive, hard-to-reverse decision with the human: dependency
changes, git history, epistemic status of the numbers, and the decision to touch
hyperparameters at all.

The third is the one people skip and shouldn't. Without it, guessed defaults get written up
as tuned results — and by the time the report is being written, nobody remembers which was
which.
