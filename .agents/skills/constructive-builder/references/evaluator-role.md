# Independent Evaluator Role

**Purpose:** acceptance is judged by a **separate evaluator sub-agent**, never by the agent that built
the app. The builder's job is to make the acceptance flows pass; the evaluator's job is to find out
whether they actually do. Keeping those two jobs in different agents is the whole point of this doc.

> **TL;DR for an agent-driven build flow:** after Phase 4, **spawn a fresh sub-agent** with the prompt in
> "The evaluator prompt" below. Give it **only** `build/app-brief.yaml`'s `acceptance.required_flows` and
> how to reach the running app. Do **not** give it the build transcript, your reasoning, your notes, the
> diff, or `run-state.json`. It drives the real app, returns **PASS/FAIL per flow**, and writes the
> verdict into `build/run-state.json` → `evaluator`. If it cannot run (no browser / app down) it returns
> `INCONCLUSIVE` — that is **not** a pass.

---

## Why a separate evaluator (the rationale)

Self-evaluation rationalizes shortcuts. An agent that just spent its context building the app has every
incentive — and every cognitive bias — to declare its own work done:

- **Motivated reasoning.** The builder "knows what it meant", so it reads the running app charitably:
  a half-wired form looks finished because the builder remembers the intent behind it.
- **Knowledge of the happy path.** The builder knows exactly which inputs it tested and avoids the ones
  it didn't. It signs off on the path it walked, not the flow a user would walk.
- **Narrative lock-in.** The build transcript is a story that ends in success. Anything that read that
  story will tend to confirm it ("the create mutation returns 200, so create works") instead of
  independently checking the user-visible outcome ("did a row actually appear in the list and survive a
  reload?").
- **Sunk cost.** After a long build, "it works" is the cheap conclusion and "it doesn't" means more work.

The fix is structural, not motivational: the judge must not have seen how the sausage was made. An
evaluator that sees **only the acceptance criteria and the running app** has nothing to rationalize from —
it can only report what the app does.

---

## Hard rules

1. **Distinct agent.** The evaluator is a *new* sub-agent with a clean context. It is not the builder
   "switching hats". If your build flow cannot spawn a sub-agent, the human (or CI) plays the evaluator —
   but the builder still does not grade itself.
2. **No build transcript.** The evaluator must NOT receive: the build conversation, the builder's
   chain-of-thought, the code diff, commit messages, `run-state.json`, `self-improvement.md` notes, or any
   "here's what I did / here's what to check" summary from the builder. Those leak the happy path and the
   narrative. The evaluator infers what to test from the **acceptance flows alone**.
3. **Inputs are exactly two things:**
   - `build/app-brief.yaml` → `acceptance.required_flows` (the flows to prove) plus the brief's
     `data_model`/`ui` sections *only* insofar as they name the entities/routes a flow touches.
   - How to reach the running app (base URL, e.g. `http://localhost:3081`) and a way to drive it
     (`agent-browser` or Playwright — see "Driving the app").
4. **Judge the running app, not the code.** Reading source to decide pass/fail is forbidden — that is how
   the builder's intent leaks back in. The evaluator clicks/drives the real UI (or calls the real API)
   and observes outcomes.
5. **Per-flow verdict.** For each flow in `required_flows`, return exactly one of `pass` / `fail` /
   `inconclusive`, with one line of evidence (what it did, what it observed). The phase passes only if
   **every** required flow is `pass`.
6. **`inconclusive` ≠ `pass`.** If the app can't be reached or no browser is available, the verdict is
   `inconclusive` and the gate is **not** satisfied — report it as blocked, do not wave it through.

---

## What the evaluator receives (and does not)

| Give the evaluator | Withhold from the evaluator |
|---|---|
| `acceptance.required_flows` from `build/app-brief.yaml` | The build transcript / conversation |
| Entity + route names a flow references (from the brief's `data_model` / `ui`) | The builder's reasoning, plan, or self-assessment |
| The running app's base URL | The code diff / file contents / generated SDK |
| Test credentials *only if* the brief defines them; otherwise the evaluator signs up its own user | `build/run-state.json` (the builder filled it; it is the builder's claim, not evidence) |
| The driver (`agent-browser` / Playwright) and how to launch the app | Any "things to watch out for" / known-issue list from the builder |

---

## Driving the app

The evaluator uses the same tools the build flow already references — it does **not** need new infrastructure:

- **`agent-browser`** (the npm CLI from SKILL.md "Agent Browser") for a headless accessibility-tree +
  screenshot drive, or
- **Playwright** if the repo already has it.

It should also watch the **network**: a flow is not "pass" just because a button was clickable — the
underlying request must return 2xx and the persisted effect must be observable (e.g. the new row is in the
list after a reload). This mirrors the live-QA gate in `scripts/verify-phase.sh` (`LIVE_QA=1`), which the
evaluator's findings should agree with.

> The live-QA gate (`verify-phase.sh`, Phase 4) is an **automated** smoke of signup → login → CRUD.
> The evaluator is the **judgment** layer on top: it covers every flow in `required_flows` (not just the
> canonical CRUD round-trip) and renders the pass/fail the build flow reports. Run the gate first; if it is
> red, fix the build before spending an evaluator pass.

---

## The evaluator prompt (spawn a fresh sub-agent with exactly this)

Copy this verbatim into a new sub-agent. Fill the two placeholders. Paste **nothing else** — no build
notes, no diff, no transcript.

```text
You are an INDEPENDENT acceptance evaluator. You did NOT build this app and you must not assume anything
about how it was built. You have not seen its code, its commit history, or any build notes — and you must
not go looking for them. Judge ONLY the running application's observable behavior.

Running app: <BASE_URL>            # e.g. http://localhost:3081

Acceptance flows to prove (from build/app-brief.yaml → acceptance.required_flows):
<PASTE required_flows HERE, one per line>

Rules:
- Drive the REAL app with agent-browser (or Playwright if present). Do NOT read source code to decide
  pass/fail — only what the app actually does counts.
- For a flow that needs an account: if the brief gave you credentials, use them; otherwise sign up a fresh
  user through the UI and continue.
- A flow PASSES only if its user-visible outcome is real AND persisted: the network request(s) return 2xx
  AND the effect survives a reload (e.g. a created row still appears in the list after refresh). A 200 with
  no persisted/visible effect is a FAIL.
- If you cannot reach the app or cannot launch a browser, the verdict for affected flows is "inconclusive"
  (NOT pass).

For EACH flow, report one line:
  <flow_name>: pass|fail|inconclusive — <one sentence of evidence: what you did + what you observed>

End with a single overall line:
  OVERALL: pass   (only if every flow is pass)
  OVERALL: fail   (if any flow is fail)
  OVERALL: inconclusive   (if any flow is inconclusive and none failed)

Return ONLY these lines. No preamble, no code, no advice to the builder.
```

---

## Recording the verdict

The evaluator (not the builder) writes its result into `build/run-state.json` → `evaluator`:

```json
"evaluator": {
  "verdict": "pass",
  "flows": [
    { "flow": "signup_and_signin", "result": "pass", "evidence": "Signed up a@b.com, landed on /items authenticated shell." },
    { "flow": "create_item",       "result": "pass", "evidence": "Created 'Buy milk'; POST 200; row present after reload." }
  ]
}
```

`verdict` is `pass` only when every entry in `flows` is `pass`. The builder must **not** set
`evaluator.verdict` to satisfy a gate — that re-introduces self-grading, which is exactly what this role
exists to prevent.

---

## Where this fits

- **SKILL.md → Phase 4 verify step** points here: after the CRUD body and the `verify-phase.sh 3` gate,
  spawn the evaluator before declaring the build done.
- **AGENTS.md → Entry Point / verify** names the evaluator as the final, independent acceptance gate.
- The brief's `acceptance.required_flows` (`build/app-brief.template.yaml`) is the evaluator's only spec —
  keep it filled in for any app you intend to call "done".
