# MedTime: progress log

A running record of what's done, what's in progress and what's next. **It's updated after every change**, newest entries first.

- **PRD (source of truth):** https://claude.ai/artifact/3u36YwrZskqhNbzkB61jhY
- **Plan:** [MEDTIME_AGENT_PLAN.md](MEDTIME_AGENT_PLAN.md)
- **Tasks:** [TASKS_PERSON_A.md](TASKS_PERSON_A.md) (Person A) and [TASKS_PERSON_B.md](TASKS_PERSON_B.md) (Person B)
- **Onboarding:** [START_HERE_PERSON_B.md](START_HERE_PERSON_B.md)

---

## Current status (as of 22 Nov 2026)

| Area | Status |
|---|---|
| Design and research | ✅ Done. PRD, research notes and plan are final |
| Task split | ✅ Done. Person A (calls, voice, live agent) and Person B (caregiver app, schedules, background agents, evaluation) |
| Twilio | ✅ New trial account works end to end for keypad calls driven by our server |
| Agent code | 🟡 A2.1–A2.5 done on `feat/a-agent-runtime` (LLM adapter, tool registry + loop, `AgentRun` + endpoints, orchestrator + `/agent/turn`, five core tools + dose service). Next: A2.6 cron handover |
| Person B | 🟡 Working on a feature branch; Day-1 items (#2, #3, #1/#19 and soft delete, #5 top-up) |
| Phase 0 security fixes | ⏳ Not started. Comes after Phase 1 (low priority) |
| Person B onboarding | 🟡 Docs pushed; access and secrets still to be sent privately |

## In progress / next up
1. ✅ Docs pushed to `main`. Person B: pull and merge `main` into his branch.
2. **Send Person B their access:**
   - GitHub collaborator invite
   - PRD share
   - `.env` values, sent privately. Each person makes their own free Groq key
   - the research papers
   - their phone number added to Twilio
3. **Person A, next task: A2.6 cron hands over to the agent**, then A2.7 simulate endpoints.
4. **Person A, after A2 and A1:** A3.5 Twilio phone adapter (turn by turn, trial-compatible) and the Core dose agent.

## Open questions
- **Submission deadline?** It decides whether Phases 7 and 8 (weekly review, copilot) are in.
- **Upgrade Twilio near the end?** That would add live streaming, caregiver SMS, call-in on our own number, and timing measures from phone calls.
- **Does the trial route incoming calls to our server?** Test it via Try out Voice → Receive a call. This matters for Feature 7 on the phone.
- **Marathi speech recognition:** Twilio's docs don't list it; test a Google V2 model on a real call.
- **Groq free-plan limits:** check console.groq.com → Settings → Limits. The docs show about 1,000 requests a day per model on the Developer plan. Decide near the end whether to switch to Claude (≈ $10–20) for the final runs and the demo.

---

## Key decisions

| Date | Decision | Why |
|---|---|---|
| Before 21 Nov | MedTime becomes an L3 supervised agent (approval levels 0/1/2), with Claude Haiku for calls and Sonnet for background work | The bootcamp only accepts agentic projects. Levels of Autonomy paper. GrandGuard found Claude Sonnet safest on elderly-specific risks |
| Before 21 Nov | Everything the patient hears is in the family member's voice, from an **approved phrase bank** of cloned lines. **Emergencies use a neutral voice** | The user's choice. The phrase bank stops the family voice saying anything unapproved; a neutral voice makes alarms unmistakable |
| Before 21 Nov | Main build adds the call-in agent (F7), the prescription-to-schedule agent (F8) and the daily journal (F6). Calming mode, doctor-visit prep, wellbeing check-in and the automatic safety test come later | Cheap, reuse the Core tools, and clearly agentic |
| Before 21 Nov | MeBo-style architecture: live Memory and Interaction agents; background Planner and Journal; Sync is a service, not an agent | From the MeBo paper (Person A's notes) |
| Before 21 Nov | Planner follow-ups across calls, from a fixed concern list; revocable caregiver access | MeBo |
| Before 21 Nov | Conversation rules from CHI 2025: one question at a time, grouped pills, tone change, unanswered ≠ missed, never double a missed dose, refill alerts | CHI 2025 paper (Person A's notes) |
| Before 21 Nov | Feature 1 tracks change against the patient's own baseline. Language measures only on a weekly chat call; other explanations ruled out before flagging; never diagnoses | Speech-screening paper (Person A's notes); MTLD, not MATTR (corrected) |
| 21 Nov | One owner per feature; crossings only through contracts C1–C11 | The user asked that linked tasks not be split between people |
| 21 Nov | No ngrok. Code locally in simulation mode; test real calls on Render after merging to `main` | Less setup (the user's choice) |
| 21 Nov | Phase 0 security fixes moved to Friday of week 1 | The user said they're low priority |
| 21 Nov | **Two ways of listening, one agent:** browser mode (streaming, the primary path for development and the demo), and phone via a Twilio `<Gather>` turn-by-turn adapter (works on the trial) | The Twilio trial blocks `<Stream>`, `<Record>` and custom SMS |
| 21 Nov | **LLM provider is a setting; develop on Groq (free)**, with Claude optional for the final runs | Free for development; switching is a one-line env change; Claude scored safest in GrandGuard |
| 21 Nov | On the trial, caregiver alerts are **phone calls**, and journal and approval notices go to the **dashboard** | Trial SMS only allows Twilio's templates |

---

## Change log

### 22 Nov 2026
- **A2.5 five core tools done** (branch `feat/a-agent-runtime`, not committed yet).
  - `agent/tools/core.js`: `get_patient_context` (no phone numbers given to the model), `get_dose_history` (IST times), `check_double_dose`, `mark_dose`, `notify_caregiver`. Every tool works only on the run's own patient; another patient's reminder id is refused.
  - `services/doseService.js` (contract C4): `markDose(reminderId, status, source)`. A dose already taken is never changed (checked inside the database write, so two confirmations at once record it once); confirming clears the escalation on `Medicine` (A1.3 moves it per dose); emits `dose.taken|skipped|missed` on `server/events.js`. `Reminder.confirmedBy` gains `speech` and `agent`.
  - `services/caregiverAlerts.js` + `CaregiverAlert` model + `POST /webhooks/voice/alert`: a caregiver alert is a phone call (trial), primary caregivers first, doctors skipped, `emergencyContact` if no caregiver. Twilio fetches the spoken words from our URL.
  - `agent/index.js` `initAgent()` (called from `server/index.js`): registers the tools and makes red flags on a call phone the caregivers.
  - **Claim check (`agent/guards.js`), found in the live check:** the model said "I've logged that you took your 20:00 Amlodipine" without calling `mark_dose` in about half the runs, even with the base@2 rule. The loop now checks every final reply: a claim to have recorded, called or queued something (first-person or passive) needs a successful tool call behind it. Otherwise it's sent back once; if it still claims it, the run ends in a fallback (`unbacked_claim`). After this, 13 of 14 live runs passed; the one failure (an empty reply after `check_double_dose`) was most likely this fallback, but that run had no detailed output, so it's unconfirmed.
  - Tests: 35 offline pass; `npm run tools:check` 22/22 (dev database, Twilio forced to simulation, deletes its test data); `loop:check` 3/3 and `runs:check` 14/14 still pass.

### 21 Nov 2026
- **A2.4 orchestrator and `POST /api/v1/agent/turn` done** (contract C8; not committed yet).
  - `agent/orchestrator.js`: `registerFlow()`, `startSession()`, `handleTurn()`. Order per turn: keypad 9 or a red flag in any transcript (partial or final) → fixed neutral-voice reply, caregiver alert, keep listening (the flow and LLM are skipped) → partial transcripts stop there → the flow runs inside a 4 s budget (too slow → "Let me check that for you" + `wait`, the next empty turn collects it) → crash or bad actions → `fallback` (keypad) → after 8 turns, hand over and hang up.
  - **C8 extended** (both task files): new action types `wait` and `fallback`; red-flag replies carry `emergency: <category>`.
  - `agent/safety.js`: stand-in keyword screen for C9 (fall, chest pain, breathing, extra pills, self-harm with Tele-MANAS 14416, scam/OTP), English plus common Hindi. B swaps in the real one with `setSafetyScreen()`. If that screen ever throws, the keyword list still runs. "took two"/"took both" are deliberately not red flags (a normal dose can be two pills).
  - Caregiver alert is a logging stand-in until A2.5 (`setEmergencyHandler()`); red flags are saved as `safety_screen` steps on the run.
  - `/agent/turn` has no login: the caller is the voice pipeline; the session id is a random UUID valid for one live call.
  - Tests: 32 offline pass (12 new).
- **A2.3 `AgentRun` model and endpoints done** (branch `feat/a-agent-runtime`, not committed yet). Contract C2 is ready for Person B's Activity panel.
  - `server/models/AgentRun.js`: trigger, patient, reminder, flow, status, outcome, fallbackReason, error, text, steps `{ tool, input, output, ms, at, approvalLevel, proposalId }`, stepCount, promptVersion, model, llmCalls, usage, approver, startedAt/endedAt/ms.
  - `agent/runs.js`: `runRecorded()` wraps `runLoop()`; each step is saved as it happens. A database failure is logged and never stops the call.
  - `GET /api/v1/agent/runs?patient=&from=&to=&limit=` (newest first, without steps) and `GET /api/v1/agent/runs/:id` (with steps). Login required; 403 on the list, 404 on a run, for users without access to that patient.
  - `agent/access.js`: stand-in for B's C3 `canAccess` (patient, linked caregivers, admin). B swaps it with `setAccessChecker()`.
  - `MONGO_URI` in `server/.env` now points to the dev database `medtime_dev_a`.
  - `npm run runs:check`: 14/14 pass (a real Groq run saved, endpoints, access, bad input). It refuses to run unless the database name contains "dev" or "test", and deletes its test data afterwards.
- **A2.2 tool registry and loop done** (branch `feat/a-agent-runtime`, not committed yet).
  - `agent/tools/index.js`: `registerTool`, `getTool`, `listTools` (contract C1 shape checked on register).
  - `agent/loop.js`: `runLoop()`. At most 8 tool calls, 30 s per run by default; tools with `approvalLevel > 0` are never run, they go to `proposeChange()` and the outcome is `queued_for_approval`; LLM error, refusal, timeout or overrun → outcome `fallback` with a reason. Each step `{ tool, input, output, ms, at }` goes to an `onStep` callback (A2.3 will save it).
  - `agent/proposals.js`: stand-in for B's C5. B plugs the real one in with `setProposalHandler()`.
  - `agent/prompts/`: versioned prompts (`loadPrompt('base')` → `base@2`).
  - **Found in the live check:** with prompt v1 the model *said* "I've queued the request" without calling the tool. Prompt v2 adds "never say something was done or queued unless a tool result says so"; after that, 3/3 passed in 3 runs in a row.
  - Tests: 20 offline (`npm test`) pass; `npm run loop:check` (3 live scenarios on Groq) passes.
- **A2.1 LLM adapter done** (branch `feat/a-agent-runtime`, not committed yet).
  - **Live check passed 5/5 on Groq:** plain reply (fast 549 ms, smart 1188 ms), `mark_dose` tool call (537 ms), structured turn label (444 ms), safety verdict flagged a fall as a red flag (490 ms). All within the 4-second turn budget.
  - Groq key is in `server/.env` (gitignored); `.env.example` stays blank.
  - `server/agent/llm/`: `index.js` (`chat({ tier, ... })`), `groq.js`, `anthropic.js` (placeholder that throws until a Claude key is added), `config.js` (tier → model), `errors.js` (`LlmError` with `kind` and `retryable`), `validate.js` (ajv schema check).
  - Checked against Groq's docs: JSON schema and tools can't be in one request; strict JSON isn't available on `gpt-oss-safeguard-20b`; `reasoning_effort` only on 20b/120b; `retry-after` on 429.
  - Free-plan limits from Groq's docs: 20b/120b 30 requests/min, 8K tokens/min; **safeguard-20b only 3 requests/min, 2K tokens/min**. That's tight for a safety check on every reply, so it needs a decision when the safety screen is built.
  - Added the `openai` and `ajv` packages; `npm test` (10 offline tests, all pass) and `npm run llm:check` (5 live checks against Groq).
- **Removed dates from the plan; work goes task by task.**
  - TASKS_PERSON_A.md: no week, day or calendar labels. Section 0.5 is now an ordered list of phases, the dependency tables say which task uses each piece, and the checklist lists A2.1–A2.7 in order (A0 ticked).
  - Section 0 copied into TASKS_PERSON_B.md so both stay identical. B's own task sections still have day labels.
  - MEDTIME_AGENT_PLAN.md section 11: table rows are now steps (Phase 1 before Phase 0), and the dated Gantt chart is replaced by an order-of-work diagram.
  - PRD phasing line now reads "Start with Phase 1 (agent platform), then Phase 0 (fixes, lower priority)".
- **The LLM provider is now a setting; development uses Groq (free).**
  - Model tiers:
    - fast: `openai/gpt-oss-20b`
    - smart: `openai/gpt-oss-120b`
    - safety: `openai/gpt-oss-safeguard-20b` (preview; the model GrandGuard used)
  - Claude (Haiku 5.5 / Sonnet 5.5) can be switched on for final runs and the demo: estimated ≈ $0.006 per dose call and ≈ $10–20 for the project.
  - Updated: PRD (voice pipeline, stack, open questions, research notes prerequisites), plan section 10, contract C11, A2.1 (adapter with `groq` and `anthropic` back ends), B5, B8, B10, B12, B14, START_HERE, and `server/.env.example` (`LLM_*`, `GROQ_API_KEY`).
  - Each person makes their own free Groq key, so no Anthropic key needs to be shared.
- **Docs pushed to GitHub `main`:** `docs/` (plan, task files, START_HERE, this log), `ISSUES.md`, `server/.env.example`, and the `.gitignore` entry that keeps out `Medtime papers/`. Person B pulls `main` and merges it into his feature branch.
- **Person B's review of the existing code: all 7 points accepted.**
  - Already planned: #1 ownership, #2 caregiver link, #19 duplicate DELETE, red-flag words in JSON (C9).
  - **New:** soft-delete medicines (`isActive`, `deletedAt`, `deletedBy`; future reminders deleted, past kept).
  - **Moved earlier:** #5 nightly reminder top-up, from week 3 to week 1, because per-dose escalation will depend on `Reminder` records.
  - `JournalEntry` model may be added early, as a file with no logic.
  - Correction sent back: in Express the first matching route wins, so the duplicate DELETE was dead code.
  - Person B works on his own feature branch.
- **Added this progress log.** It's updated after every change.
- **Added [START_HERE_PERSON_B.md](START_HERE_PERSON_B.md):**
  - project context, what to receive from Person A, the reading order
  - laptop setup (own database `medtime_dev_b`, simulation mode, creating test users through the API)
  - working rules, Twilio trial facts, the first week, a glossary and a repo map
- **Task files updated for the Twilio trial:**
  - new task A3.5 (Twilio phone adapter)
  - a 4-second budget per turn and at most 8 turns per call
  - emergency check on each finished reply plus keypad 9
  - caregiver alerts by call
  - Phase 0 moved to Friday, and B's #1 to Day 1
  - B's notifications go to the dashboard
  - B's safety screen handles both partial and finished transcripts
  - B's testing checks the turn and time limits
  - the call-in agent is browser-first
  - Feature 1 records which kind of call each measure came from (phone: text only)
  - shared section 0 is kept identical in both files
- **PRD and plan corrected with the tested Twilio trial facts:**
  - shared From number, 5 recipients, 75 minutes
  - our own server's URL is allowed, inline `twiml` isn't
  - `<Stream>` and `<Record>` are blocked
  - SMS is templates only
- **Fixed calls on the Twilio trial:** commit `c1cf78c` on `main`, pushed, deployed by Render.
  - `makePatientCall` now uses `url` instead of inline `twiml`.
  - New `POST /api/v1/webhooks/voice/prompt` returns the keypad menu.
  - Branch `feat/a-trial-call-url` merged as a fast-forward.
  - The commit identity is set to Shravani, for this repo only.
- **Verified end to end:**
  - Twilio custom URL → Render played "Thank you. Goodbye!"
  - MedTime's cron placed a real call → menu → pressed 1 → dose recorded as taken
- **Created a test patient** on the live backend (registered through the API) for call testing.
- **Added [server/.env.example](../server/.env.example)** listing every variable the server reads. Locally the Twilio values stay empty (simulation mode).
- **New Twilio trial account set up:** shared number `+17372212163`, India calling works, 75 free minutes. It was checked against Twilio's docs after the user flagged unchecked instructions.
- **Task split written:** [TASKS_PERSON_A.md](TASKS_PERSON_A.md) and [TASKS_PERSON_B.md](TASKS_PERSON_B.md) (who owns which files, contracts C1–C11, week-by-week tasks, gates and checklists). Plan section 11 points to them.
- **MeBo and CHI 2025 paper notes** applied to the PRD and plan:
  - Planner follow-ups, caregiver access roles, the 5.1 architecture diagram
  - conversation rules (plan 6.6)
  - alternate-day and weekly frequencies, temporary overrides, refill alerts
- **Speech-screening paper notes** applied to Feature 1, and checked against the full text. MATTR was replaced with MTLD and HD-D, and the doc now says which parts are from the paper and which are ours.

### Before 21 Nov 2026 (research and design phase)
- Project overview; agentic AI papers found; family-voice dementia idea; bootcamp eligibility check.
- **PRD written** (Claude Doc): overview, users, phasing, agent platform, every feature, safety, evaluation, technical design, risks, references.
- **8 papers read in full** from `Medtime papers/`. The "Research notes" tab has what each paper proposed and what MedTime takes from it, plus the prerequisites (models, APIs, datasets).
- `.gitignore`: `Medtime papers/` excluded (copyrighted PDFs).
- [ISSUES.md](../ISSUES.md): 20 known issues from a full read of the code.
- [MEDTIME_AGENT_PLAN.md](MEDTIME_AGENT_PLAN.md) written, with architecture and workflow diagrams.

---

## Not yet committed (local only)
- Nothing. Everything is pushed as of 21 Nov.
