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
| Agent code | ✅ Phase 1 agent platform done on `feat/a-agent-runtime` (A2.1–A2.7). Phase 1 gate met on Person A's side: a simulated dose call runs end to end in text and every step shows through `GET /agent/runs/:id`; the Activity panel itself is Person B's. Next: A1 Phase 0 fixes |
| Person B | 🟡 Reports B1–B12 done (status shared 22 Nov), all on branch `origin/Anuj`, **not merged to `main`**. Left: B13 40-persona evaluation, B13.2 GrandGuard recall, B13.3 SUS form, B14 weekly review, B15 copilot (optional), B16 demo script and README |
| Phase 0 security fixes | 🟡 In progress on `feat/a-phase0-fixes`. A1.1 webhook signatures, A1.2 `PUBLIC_BASE_URL` / `TWILIO_ENABLED` and A1.3 per-dose escalation done (PRD gate passes in `cron:check`); A1.4 next |
| Person B onboarding | 🟡 Docs pushed; access and secrets still to be sent privately |

## In progress / next up
1. ✅ Docs pushed to `main`. Person B: pull and merge `main` into his branch.
2. **Send Person B their access:**
   - GitHub collaborator invite
   - PRD share
   - `.env` values, sent privately. Each person makes their own free Groq key
   - the research papers
   - their phone number added to Twilio
3. **Person A, now: A1 Phase 0 fixes.** A1.1 ✅, A1.2 ✅, A1.3 per-dose escalation ✅. Next: A1.4 dose endpoint and dashboard (its own small PR; it edits Person B's `medicineRoutes.js` and `PatientDashboard.jsx`, rule 0.2). Then Phase 2 (A3 voice pipeline, A4 dose agent).
   - **Merge A1.3 and A1.4 to `main` together.** After A1.3 the escalation state is on each Reminder, but the dashboard badges still read the old Medicine fields until A1.4, so on their own the red "missed" and amber "snoozed" badges would stop showing.
   - ✅ **Render → Environment: `PUBLIC_BASE_URL` added (22 Nov)**, same value as `NGROK_URL`. Keep `NGROK_URL` until the new code is deployed and a real call works (today's `main` still reads it), then delete it. Also check that `TWILIO_AUTH_TOKEN` on Render is the trial account's token, or Twilio's webhooks will get 403.
4. **Person A, after A2 and A1:** A3.5 Twilio phone adapter (turn by turn, trial-compatible) and the Core dose agent.

## Open questions
- **Person B's branch `origin/Anuj` overlaps ours (found 22 Nov, before starting A1.4).** 12 commits, about 9,700 lines, not merged to `main`. Same 5 files changed on both sides: `events.js`, `index.js`, `models/AgentRun.js`, `models/Patient.js`, `package.json`. B wrote their own `AgentRun` model and `GET /agent/runs` routes (C2 is Person A's, done in A2.3), and B's `Patient.js` defaults `dementiaMode` and `familyClipsEnabled` to **true** (A2.6 uses false, so every patient would go to the agent). A1.4 edits `medicineRoutes.js` and `PatientDashboard.jsx`, which B's branch also rewrote (ownership checks, `requirePatientAccess`, soft delete). B's reminder top-up skips slots that already exist, so it fits A1.3's stand-in. **Needs a decision on how and when to integrate before A1.4.**
- **Tell Person B (A1.3):** (1) contract C4 gained a `source` value, `scheduler` (the cron marking a dose missed); `dose.missed` events now really fire. (2) `reportRoutes.js` and `monthlyReportCron.js` still read `Medicine.caregiverAlerted`, which is no longer updated; they should read the per-dose `Reminder` fields (`status`, `caregiverAlerted`). (3) The nightly reminder top-up (#5) should upsert on medicine + time, because the cron now creates a missing call-type Reminder itself.
- **Submission deadline?** Person B's status (22 Nov) says only one week is left, so roughly the end of November 2026. Exact date still to confirm. It decides what gets cut from both task lists.
- **B's call-in agent (B11) doesn't use Person A's runtime:** `callinFlow.js` and `routes/voiceIncoming.js` don't go through `registerFlow` / `/agent/turn` (C8), and they write to B's own `AgentRun` model. To sort out during integration.
- **Upgrade Twilio near the end?** That would add live streaming, caregiver SMS, call-in on our own number, and timing measures from phone calls.
- **Does the trial route incoming calls to our server?** Test it via Try out Voice → Receive a call. This matters for Feature 7 on the phone.
- **Marathi speech recognition:** Twilio's docs don't list it; test a Google V2 model on a real call.
- **Groq free-plan limits (now measured):** gpt-oss-20b allows 8,000 input tokens a minute, and one simulated dose call uses about 4,000 to 7,000 (each model call re-sends the prompt, tool descriptions and conversation, about 1,400 tokens). So the free plan allows roughly **one agent call a minute**, and a long call can hit the limit mid-call (it then falls back safely to the keypad). This matters for Person B's 40-persona evaluation and the demo. Options: Groq's paid Developer tier, Claude for evaluation and demo runs, or shorter prompts. **Needs a decision.**

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
| 22 Nov | **Phase 0 fixes go on their own branch, `feat/a-phase0-fixes`, started from `feat/a-agent-runtime`.** PRs in order: agent platform → Phase 0 (A1.1–A1.3) → A1.4 as its own small PR (it edits Person B's files, rule 0.2) | Smaller PRs for Person B to review (rule 0.4); A1 builds on A2 code; a broken real call on Render points at one change |
| 22 Nov | **Missed-dose alerts are phone calls** (A2.5's `caregiverAlerts`), not SMS. A failed call is marked `alertFailed` and retried up to 3 times; "caregiver notified" is set only when a call was placed | Every custom SMS fails on the trial, and the old code swallowed the error, so no one heard about missed doses while the database said they had |

---

## Change log

### 22 Nov 2026
- **Render:** `PUBLIC_BASE_URL` added with the same value as `NGROK_URL` (the `onrender.com` address). `NGROK_URL` stays until the A1.2 code is live and a real call works.
- **A1.3 per-dose escalation (PRD #13)** (branch `feat/a-phase0-fixes`, not committed yet).
  - `Reminder` now holds the escalation for its own dose: `snoozeUntil`, `caregiverAlertTime`, `caregiverAlerted`, plus `attempts`, `lastCallAt`, `callError`, and for the caregiver alert `alertAttempts`, `alertFailed`, `alertError`. The old `Medicine` fields stay in the schema, unused.
  - `jobs/missedDoseCron.js` rewritten to loop over **due Reminders**: [C] first call for a dose due in the last 15 minutes and never called (a dose from longer ago isn't called late, so a deploy can't set off a burst of old calls); [B] call again when the snooze is over; [A] after 10 unconfirmed minutes, `markDose(missed, 'scheduler')`, then **phone the caregivers** through `services/caregiverAlerts.js` (decision of 22 Nov). An alert that couldn't be placed sets `alertFailed` and is retried on the next ticks, 3 tries in all; `caregiverNotified`/`caregiverAlerted` are set only when a call was placed. Each step "claims" the dose in the database first, so an overlapping tick can't double-call.
  - **Stand-in for Person B's top-up (#5):** if a call-type medicine is due this minute and has no Reminder, the cron creates one (upsert on medicine + minute). Without it, calls would have stopped 7 days after a medicine was added.
  - `services/doseService.js` (C4, now full): confirming clears that one dose's fields in the same database write; other doses of the medicine aren't touched. New source `scheduler`.
  - Keypad calls carry `reminderId` (`makePatientCall(..., reminderId)`), so 1/2 change exactly that dose. Calls placed before the deploy (medicineId only) fall back to the medicine's latest open dose. Keypad 1 now goes through `markDose(..., 'ivr')`; keypad 2 on an already-taken dose says so and doesn't snooze. The SMS reply webhook also goes through `markDose(..., 'sms')`.
  - Agent hand-off (`agent/doseDue.js`): the cron passes the due Reminder itself.
  - Docs: C4 in both task files, ISSUES #5 note and #13 marked fixed.
  - **Checks:** `npm run cron:check` rewritten, **20/20** on the dev database. It includes the **PRD gate** (a twice-a-day medicine: the 1st dose escalates and the caregiver is phoned, while the 2nd stays untouched and later gets its own call), snooze through the real keypad webhook, an old-style call, a failed caregiver call retried 3 times, and "a confirmed dose stops all calls" (app and keypad). `tools:check` 23/23 (new: confirming one dose leaves the other dose alone). `simulate:check` 11/11 (agent calls unchanged). 58/58 offline tests.
- **A1.2 `PUBLIC_BASE_URL` only, `TWILIO_ENABLED`, quieter SMS job (PRD #10, #19 twilioClient part)** (branch `feat/a-phase0-fixes`, committed in `0070f8b`).
  - `PUBLIC_BASE_URL` is the only callback setting. The hard-coded ngrok tunnel and `NGROK_URL` are gone. Twilio on with no URL → the call fails with a clear error instead of pointing at a dead tunnel.
  - **Startup check** (`utils/publicUrl.js` `checkPublicBaseUrl()`, first thing in `server/index.js`): in production the server exits with a clear message if `PUBLIC_BASE_URL` is missing or isn't an http(s) URL. On Render the message names the right value (from Render's `RENDER_EXTERNAL_URL`), and it says when an old `NGROK_URL` is set. Locally it's only a warning, and only if Twilio is on.
  - "Production" (`utils/runtime.js`) = `NODE_ENV=production` or `RENDER=true`. Checked against Render's docs: Render sets `NODE_ENV=production` for Node services at runtime, and `RENDER=true` on every service.
  - `TWILIO_ENABLED=false` (also `0`/`no`/`off`): simulation mode even with Twilio credentials filled in. Unset = on if credentials exist, so Render needs no new variable. The webhook signature check follows the same switch (skipped locally when Twilio is off; 403 in production).
  - Deleted the unused `makeCall`.
  - SMS job (`jobs/reminderJob.js`): a failed SMS is tried at most 3 times, then the reminder gets `smsFailed: true` (+ `smsFailReason`) and is no longer picked up. A reminder with no phone number is given up once instead of warning every 10 seconds. The "Skipping … voice calls owned by escalation cron" line is gone. New `Reminder` fields: `smsAttempts`, `smsFailed`, `smsFailReason`. The tick is now an exported `runReminderTick()`.
  - Docs: `.env.example` (`TWILIO_ENABLED`, `PUBLIC_BASE_URL` required on Render, `NGROK_URL` removed), START_HERE_PERSON_B step 4, ISSUES.md #4, #10, #19 and #20 marked fixed.
  - Tests: 14 new offline tests (`utils/publicUrl.test.js`, `jobs/reminderJob.test.js`, one more in `twilioSignature.test.js`), including starting the real `index.js` with `NODE_ENV=production` and no URL → exits with code 1 before connecting to MongoDB. `npm test` now also runs `utils/` and `jobs/`: **58/58 pass**. `cron:check` 9/9 and `tools:check` 22/22 still pass.
- **Two decisions:** Phase 0 work moves to a new branch `feat/a-phase0-fixes` (from `feat/a-agent-runtime`), and missed-dose alerts become phone calls instead of SMS. A1.3 in TASKS_PERSON_A.md updated to match. Found while re-reading the plan: on the trial the old escalation SMS always failed silently.
- **A1.1 Twilio webhook signatures checked (PRD #4)** (branch `feat/a-phase0-fixes`, committed in `1b288ad`).
  - New `middleware/twilioSignature.js`, mounted on the whole webhooks router, so `/sms`, `/voice`, `/voice/prompt` and `/voice/alert` all need a valid `X-Twilio-Signature`; otherwise 403. The URL checked is `PUBLIC_BASE_URL` + `req.originalUrl` (not `req.protocol`/host, which Render's proxy changes).
  - No `TWILIO_AUTH_TOKEN` (local simulation mode): the check is skipped. In production (`NODE_ENV=production`) a missing token or a missing `PUBLIC_BASE_URL` rejects every webhook instead of leaving them open.
  - New `utils/publicUrl.js`: one base URL for the callback URLs we give Twilio and the URL we verify, so they can't drift apart. It still falls back to `NGROK_URL` until A1.2.
  - `/sms` guards: a missing `Body` or `From`, and a user with no `Patient` profile, now get a polite reply instead of a crash.
  - `middleware/twilioSignature.test.js`: 7 offline tests on the real router (forged `/voice` with `Digits=1` → 403; made-up signature → 403 on all four routes; correctly signed → 200; changed params or wrong host → 403; trailing slash OK; no token → skipped locally, 403 in production). `npm test` now also runs `middleware/**/*.test.js`: 44/44 pass.
  - **Still to check on Render after merging:** a real call still works (the signed-request half of the PRD test).
- Commits on `feat/a-agent-runtime` so far: `0210cc1` (A2.1–A2.3), `8ebf9d0` (A2.4), `db0c635` (A2.5), `426e0e0` (A2.6), `872766c` (A2.7). The branch isn't pushed yet.
- **A2.7 text simulate endpoints done; Phase 1 complete on Person A's side** (branch `feat/a-agent-runtime`, committed in `872766c`).
  - `POST /api/v1/simulate/call { reminderId }` → `{ callId, runId, actions, ended }`; `POST /api/v1/simulate/call/:callId/say { text | dtmf }`. Login and access to the patient required; off in production unless `SIMULATE_ENABLED=true`, because a simulated call records real doses.
  - `agent/flows/dose.js` + prompt `dose@2`: a **basic** dose flow (A4.1 replaces it). One `AgentRun` per call with `patient_said` / `agent_said` steps between the tool calls. New `end_call` tool.
  - Orchestrator: `startSession({ init })`, `onEnd(session)` hook (runs once on hang-up, fallback, turn limit or expiry); a fallback now also ends the session.
  - **Found in the live check and fixed in code:** (1) offered every tool on the opening turn, the model recorded the dose as taken before the patient had said anything. `mark_dose` and `notify_caregiver` now only exist after she has spoken. (2) The model often said "Goodbye" without `end_call`, so calls stayed open and the family was called twice. The call now ends by itself once the dose is settled (recorded, family contacted, or already taken at the start).
  - **Known gaps for A4.1:** the agent sometimes records on "I am taking it now" without the check question; on an already-taken dose it doesn't always say "don't take another one". A4.1 should enforce the check question in code and use fixed phrase-bank lines for these moments.
  - `npm run simulate:check`: 11/11 (4 calls: takes it → recorded; already taken → nothing recorded; "I already took it" with no record → not recorded, family asked to check; "I fell" → emergency). Paced a minute apart for Groq's free-plan limit (`CHECK_PACE_MS=0` to turn off). 37 offline tests pass; `cron:check` 9/9 and `runs:check` 14/14 still pass.
- **A2.6 the scheduler hands dose calls to the agent** (branch `feat/a-agent-runtime`, committed in `426e0e0`).
  - `Patient.js`: `dementiaMode` (default false), `language` (`en|hi|mr`, default `en`), `familyClipsEnabled` (default false).
  - `agent/doseDue.js` `handleDoseDue()`: starts an `AgentRun` (`trigger: 'dose_due'`), runs `check_double_dose` on the due Reminder; already taken → no call; otherwise places the call and logs it as a `place_call` step. If anything fails, it calls anyway.
  - `jobs/missedDoseCron.js`: for dementiaMode patients the first call [C] and the re-call after a snooze [B] go through `handleDoseDue()`; everyone else is unchanged; escalation [A] is unchanged. The tick is now an exported `runTick(now)`, with the timer exported as `task`.
  - The call is still today's keypad call. The phone adapter (A3.5) and dose flow (A4.1) replace it at this point. The decision is a rule in code, not an LLM call (it would add nothing yet and cost a request per dose).
  - `npm run cron:check`: 9/9 (dev database, Twilio simulated, timer stopped, no Groq requests): due → check → call; regular patient untouched; already taken in the app → no call; no reminder record → calls anyway; re-call after snooze checks again; confirmed meanwhile → no re-call.
- **A2.5 five core tools done** (branch `feat/a-agent-runtime`, committed in `db0c635`).
  - `agent/tools/core.js`: `get_patient_context` (no phone numbers given to the model), `get_dose_history` (IST times), `check_double_dose`, `mark_dose`, `notify_caregiver`. Every tool works only on the run's own patient; another patient's reminder id is refused.
  - `services/doseService.js` (contract C4): `markDose(reminderId, status, source)`. A dose already taken is never changed (checked inside the database write, so two confirmations at once record it once); confirming clears the escalation on `Medicine` (A1.3 moves it per dose); emits `dose.taken|skipped|missed` on `server/events.js`. `Reminder.confirmedBy` gains `speech` and `agent`.
  - `services/caregiverAlerts.js` + `CaregiverAlert` model + `POST /webhooks/voice/alert`: a caregiver alert is a phone call (trial), primary caregivers first, doctors skipped, `emergencyContact` if no caregiver. Twilio fetches the spoken words from our URL.
  - `agent/index.js` `initAgent()` (called from `server/index.js`): registers the tools and makes red flags on a call phone the caregivers.
  - **Claim check (`agent/guards.js`), found in the live check:** the model said "I've logged that you took your 20:00 Amlodipine" without calling `mark_dose` in about half the runs, even with the base@2 rule. The loop now checks every final reply: a claim to have recorded, called or queued something (first-person or passive) needs a successful tool call behind it. Otherwise it's sent back once; if it still claims it, the run ends in a fallback (`unbacked_claim`). After this, 13 of 14 live runs passed; the one failure (an empty reply after `check_double_dose`) was most likely this fallback, but that run had no detailed output, so it's unconfirmed.
  - Tests: 35 offline pass; `npm run tools:check` 22/22 (dev database, Twilio forced to simulation, deletes its test data); `loop:check` 3/3 and `runs:check` 14/14 still pass.

### 21 Nov 2026
- **A2.4 orchestrator and `POST /api/v1/agent/turn` done** (contract C8; committed in `8ebf9d0`).
  - `agent/orchestrator.js`: `registerFlow()`, `startSession()`, `handleTurn()`. Order per turn: keypad 9 or a red flag in any transcript (partial or final) → fixed neutral-voice reply, caregiver alert, keep listening (the flow and LLM are skipped) → partial transcripts stop there → the flow runs inside a 4 s budget (too slow → "Let me check that for you" + `wait`, the next empty turn collects it) → crash or bad actions → `fallback` (keypad) → after 8 turns, hand over and hang up.
  - **C8 extended** (both task files): new action types `wait` and `fallback`; red-flag replies carry `emergency: <category>`.
  - `agent/safety.js`: stand-in keyword screen for C9 (fall, chest pain, breathing, extra pills, self-harm with Tele-MANAS 14416, scam/OTP), English plus common Hindi. B swaps in the real one with `setSafetyScreen()`. If that screen ever throws, the keyword list still runs. "took two"/"took both" are deliberately not red flags (a normal dose can be two pills).
  - Caregiver alert is a logging stand-in until A2.5 (`setEmergencyHandler()`); red flags are saved as `safety_screen` steps on the run.
  - `/agent/turn` has no login: the caller is the voice pipeline; the session id is a random UUID valid for one live call.
  - Tests: 32 offline pass (12 new).
- **A2.3 `AgentRun` model and endpoints done** (branch `feat/a-agent-runtime`, committed in `0210cc1`). Contract C2 is ready for Person B's Activity panel.
  - `server/models/AgentRun.js`: trigger, patient, reminder, flow, status, outcome, fallbackReason, error, text, steps `{ tool, input, output, ms, at, approvalLevel, proposalId }`, stepCount, promptVersion, model, llmCalls, usage, approver, startedAt/endedAt/ms.
  - `agent/runs.js`: `runRecorded()` wraps `runLoop()`; each step is saved as it happens. A database failure is logged and never stops the call.
  - `GET /api/v1/agent/runs?patient=&from=&to=&limit=` (newest first, without steps) and `GET /api/v1/agent/runs/:id` (with steps). Login required; 403 on the list, 404 on a run, for users without access to that patient.
  - `agent/access.js`: stand-in for B's C3 `canAccess` (patient, linked caregivers, admin). B swaps it with `setAccessChecker()`.
  - `MONGO_URI` in `server/.env` now points to the dev database `medtime_dev_a`.
  - `npm run runs:check`: 14/14 pass (a real Groq run saved, endpoints, access, bad input). It refuses to run unless the database name contains "dev" or "test", and deletes its test data afterwards.
- **A2.2 tool registry and loop done** (branch `feat/a-agent-runtime`, committed in `0210cc1`).
  - `agent/tools/index.js`: `registerTool`, `getTool`, `listTools` (contract C1 shape checked on register).
  - `agent/loop.js`: `runLoop()`. At most 8 tool calls, 30 s per run by default; tools with `approvalLevel > 0` are never run, they go to `proposeChange()` and the outcome is `queued_for_approval`; LLM error, refusal, timeout or overrun → outcome `fallback` with a reason. Each step `{ tool, input, output, ms, at }` goes to an `onStep` callback (A2.3 will save it).
  - `agent/proposals.js`: stand-in for B's C5. B plugs the real one in with `setProposalHandler()`.
  - `agent/prompts/`: versioned prompts (`loadPrompt('base')` → `base@2`).
  - **Found in the live check:** with prompt v1 the model *said* "I've queued the request" without calling the tool. Prompt v2 adds "never say something was done or queued unless a tool result says so"; after that, 3/3 passed in 3 runs in a row.
  - Tests: 20 offline (`npm test`) pass; `npm run loop:check` (3 live scenarios on Groq) passes.
- **A2.1 LLM adapter done** (branch `feat/a-agent-runtime`, committed in `0210cc1`).
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
- Nothing uncommitted. No branch is pushed yet: `feat/a-agent-runtime` (A2.1–A2.7), `feat/a-phase0-fixes` on top of it (A1.1 `1b288ad`, A1.2 `0070f8b`, A1.3 `ca84733`), and `feat/a-dose-endpoint` on top of that (A1.4, not started).
