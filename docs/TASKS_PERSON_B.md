# Person B: caregiver app, schedules, background agents and evaluation

**Owner:** Person B
**Partner:** Person A ([TASKS_PERSON_A.md](TASKS_PERSON_A.md))
**Source of truth:** the PRD (https://claude.ai/artifact/3u36YwrZskqhNbzkB61jhY) and [MEDTIME_AGENT_PLAN.md](MEDTIME_AGENT_PLAN.md). If this file and the PRD disagree, the PRD wins. Raise the difference in the daily sync, and fix this file.

You own everything a **caregiver sees, enters or approves**, and the agents that work **outside live calls**:
- caregiver access and auth
- medicine schedules and reminder generation
- the approval gate
- the safety screen
- the daily journal
- life notes and the call-in agent
- the prescription-to-schedule agent
- the evaluation harness
- if time allows: the weekly review and the copilot

Person A owns the Twilio account, the agent runtime, the voice pipeline, the dose call and the family voice. Your agents run **on A's runtime**: you register your own tools and flows through contracts C1, C5 and C8.

---

## 0. How we split the work (same section in both files)

### Rule: one feature, one owner
Interlinked work stays with one person. Each feature is owned end to end (model, routes, tools, prompt, UI, tests) by one person. The only crossings are the **contracts** in section 0.3. They're written once, before coding starts, and changed only by agreement.

### 0.1 Who owns what

| Area | Owner | Why it stays together |
|---|---|---|
| Twilio account, `twilioClient.js`, `webhookRoutes.js` (#4, #10) | **A** | All Twilio-facing code changes together |
| Dose lifecycle: `Reminder.js` escalation fields, `missedDoseCron.js`, `reminderJob.js`, new `doseRoutes.js` and `doseService.js` (#13, #14) | **A** | Escalation, take/skip and `mark_dose` are one piece of logic |
| Agent runtime: `server/agent/**` (loop, Claude adapter, tool registry, `AgentRun`, orchestrator, simulate endpoints) | **A** | Everything else plugs into it |
| Voice pipeline: `voice/**` (Python), browser call screen | **A** | Live audio |
| Core dose agent, Planner follow-ups (`FollowUp`) | **A** | Same call flow |
| Family voice: `FamilyRecording`, consent, phrase-bank catalogue, rendering on OpenVINO, `PhraseAudio`, player, recording and line-approval UI | **A** | The agent picks lines, the player plays them, the renderer makes them. Splitting these would cross-link constantly |
| Step-by-step guidance (Feature 4) | **A** | Runs inside the dose call |
| Weekly chat call flow (the call itself, for Feature 1) | **A** | It's a call |
| Patient agent flags in `Patient.js` (`dementiaMode`, `language`, `familyClipsEnabled`) | **A** | Read by the call flows |
| Medicine schedule: `Medicine.js`, `medicineRoutes.js`, reminder generation (#1, #5, #6, #7, #19 duplicate delete) | **B** | Prescription-to-schedule, new frequencies and reminder generation are one piece of logic |
| Caregiver access: `CaregiverAccess`, `caregiverRoutes.js`, the `requirePatientAccess` helper (#2, #8) | **B** | |
| Auth and registration UI (#11, #12) | **B** | Needed for caregiver invites |
| Reports: `monthlyReportCron.js`, `reportRoutes.js` (#3, #9) | **B** | |
| Approvals: `ProposedChange`, approval gate, `propose_change`, `ask_caregiver`, `AgentQuestion`, approvals UI | **B** | Used by A's Planner, but owned as one system |
| Agent Activity panel (UI over A's `GET /agent/runs`) | **B** | Caregiver UI |
| Safety screen and red-flag word lists (module plus GrandGuard test) | **B** | The screen and its test set belong together |
| Daily care journal (Feature 6), including refill alerts | **B** | |
| Life notes (`LifeNote`) and the call-in agent (Feature 7) | **B** | The memory data and the agent that answers from it belong together. It runs on A's voice pipeline |
| Prescription-to-schedule (Feature 8), OCR (#18), `RoutineProfile` | **B** | |
| Evaluation: personas, simulator, judge, metrics | **B** | Black-box tests of A's agent through the simulate API |
| Weekly review, Features 1 and 3 (analysis worker, flags, sundowning proposals) | **B** | Background analysis and caregiver output |
| Copilot (Feature 2) | **B** | |
| `CaregiverDashBoard.jsx`, `PatientDashboard.jsx`, `App.jsx` | **B** | A puts UI in separate components that B mounts (see 0.4) |
| `server/index.js`, `package.json` | Shared | Each person adds only their own lines, and says so in the PR |

### 0.2 The two edits that cross files
Phase 0 is lower priority than the agent, so **A does it after the runtime (A2)**.
1. **B does #1 (medicine route ownership) first** in `medicineRoutes.js`, with no waiting.
2. **After the runtime, A edits B's files in one small PR:**
   - In `medicineRoutes.js`: moves `POST /medicines/:id/status` into A's new `doseRoutes.js` (#14), and adds today's per-dose fields to `GET /medicines` (#13).
   - In `PatientDashboard.jsx`: the take/skip call (around line 51) and the missed/escalation badge logic (around lines 248–290).
   - B doesn't edit those handlers while that PR is open, and reviews it.

### 0.3 Contracts, agreed before coding starts

| # | Contract | Written by | Used by |
|---|---|---|---|
| C1 | **Tool interface:** `{ name, description, inputSchema, approvalLevel, run(input, ctx) → { ok, data } \| { ok:false, error } }`. `ctx` = `{ patientId, runId, flow, now }`. Tools register through `registerTool(tool)` in `server/agent/tools/index.js`. Each owner writes their tools in their own file | A | Both |
| C2 | **`AgentRun` schema** (`trigger, patient, reminder, flow, steps[{tool, input, output, ms, at}], outcome, status, promptVersion, model, approver`) and `GET /api/v1/agent/runs?patient=&from=&to=`, `GET /api/v1/agent/runs/:id` | A | B (Activity panel, journal, evaluation) |
| C3 | **Access helper:** `requirePatientAccess(minRole)` middleware plus `canAccess(userId, patientId, minRole)` function. Roles: `view < approve < primary`; `doctor` is separate | B | A (dose, recordings and agent routes) |
| C4 | **Dose service:** `markDose(reminderId, status, source)`. `source` is one of `app \| sms \| ivr \| speech \| agent`. It clears escalation, and emits `dose.taken`, `dose.skipped` or `dose.missed` on `server/events.js` (a Node EventEmitter) | A | B (refill alerts, journal), A (`mark_dose`) |
| C5 | **Proposals:** `ProposedChange` schema, `propose_change` tool, and `registerProposalKind(kind, { level, apply(payload) })`, so each owner applies their own approved changes | B | A (Planner) |
| C6 | **Caregiver questions:** `ask_caregiver` tool and the `AgentQuestion` model; the answer resumes the run | B | A (rarely), B |
| C7 | **Phrase bank:** `voice/phrasebank/catalogue.json` (line IDs, text, slots, tone, language), plus `resolveLine(lineId, slots, patientId) → { audioUrl } \| { neutralText }` | A | B (call-in lines, journal wording check) |
| C8 | **Voice ↔ agent API:** the pipeline posts `POST /api/v1/agent/turn { sessionId, flow, transcript, isFinal, asrConfidence, dtmf? }` and gets back `{ actions:[{ type:'play', lineId, slots } \| { type:'neutral', text } \| { type:'hangup' } \| { type:'listen' }] }`. Flows are `dose \| callin \| chat`. Each flow registers a handler with `registerFlow(name, handler)`. Also `startDoseFlow(reminderId)`. **Two front ends call the same API:** the browser pipeline (streaming, with partial transcripts) and the **Twilio phone adapter** (A3.5), which sends one final transcript per turn and turns the returned actions into `<Gather>`/`<Play>`/`<Say>`/`<Hangup>` | A | B (call-in flow) |
| C9 | **Safety screen:** `screen(text, ctx) → { verdict:'ok'\|'redflag'\|'unsafe', category, responseLineId? }` and `server/safety/redflags.json` (English, Hindi, Marathi) | B | A (called on every partial and final transcript) |
| C10 | **Medicine fields for step-by-step:** `pillDescription`, `pillboxSlot`, `locationHint`, added by B to the model and the medicine form | B | A (Feature 4) |
| C11 | **Env vars:** `LLM_PROVIDER` (`groq` or `anthropic`), `LLM_MODEL_FAST`, `LLM_MODEL_SMART`, `LLM_MODEL_SAFETY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `PUBLIC_BASE_URL`, `VOICE_WS_URL`, `TWILIO_*`, `CLOUDINARY_URL`, `AGENT_ENABLED`. **Model tiers:** the fast tier (live call turns) defaults to Groq `openai/gpt-oss-20b`, or Claude Haiku 5.5. The smart tier (journal, prescription, Planner, weekly review, test judge) defaults to Groq `openai/gpt-oss-120b`, or Claude Sonnet 5.5. The safety tier (safety screen) defaults to Groq `openai/gpt-oss-safeguard-20b`, or Claude Haiku 5.5. Code only ever asks for a tier, never a model name | A keeps `.env.example` | Both |

### 0.4 Working rules
- **Branches:** `feat/a-<topic>` and `feat/b-<topic>` off `main`. The **other person reviews every PR**; never merge your own. Keep PRs small, under about 400 lines.
- **Separate dev databases:** each person uses their own Atlas database name in `MONGO_URI` (for example `medtime_dev_a` and `medtime_dev_b`). B owns `server/scripts/seed.js`, which both use.
- **Secrets:** they stay in `.env` (gitignored) and in Render env vars, never in git, chat or screenshots. Share Twilio credentials in person or through a password manager.
- **UI ownership:** A's UI lives in `client/src/components/voice/*` and `client/src/pages/CallSimulator.jsx`. B mounts A's components in the dashboards and owns the page layout.
- **Daily sync:** 15 minutes covering what's merged, what's blocked, and any contract changes.
- **Definition of done:** merged to `main`, the gate test from the PRD passes, and the `.env.example` and README notes are updated.

### 0.5 Order of work (both people)
No dates: work goes task by task, in this order.
1. Phase 1: agent platform
2. Phase 0: fixes (lower priority, so after Phase 1)
3. Phase 2: Core dose agent and daily journal
4. Phases 3 to 5: family voice, call-in agent, prescription-to-schedule
5. Phase 6: step-by-step guidance
6. Phases 7 and 8 if time allows, then demo prep

If time runs short, cut from the bottom of each list.

---

## B0. Before Monday

1. **Local setup.**
   - Create your own **free Groq API key** at console.groq.com → API Keys. Put it in `server/.env` as `GROQ_API_KEY`, with `LLM_PROVIDER=groq`.
   - Clone, run `npm install` in `server/` and `client/`, and create `server/.env` from `.env.example`. A shares the values in person.
   - **Leave the Twilio values empty** in `server/.env`. The server then runs in simulation mode, logging calls instead of placing them, so your laptop never calls real phones.
   - Use your own database name in `MONGO_URI` (for example `medtime_dev_b`).
2. **Read these sections of the PRD:**
   - Users
   - Agent platform (tools and approval levels)
   - Features 6, 7 and 8
   - Safety
   - Evaluation
   - Feature 1, which you'll need in week 4
3. **Read these papers:** GrandGuard (Appendix D1 policy), DischargeBench (patient simulation, orchestrator, judge), CHI 2025 (rules in plan section 6.6). They're in `Medtime papers/`.
4. **Give A your phone number** so it can be added as a Twilio verified caller ID.

---

## Week 1: Phase 0 (Day 1) and foundations (Days 2–5)

### B1. Phase 0 fixes (Mon, Day 1)

All three on Day 1, in any order. A's Phase 0 PR comes on **Friday** and only touches the status handler and the `GET /medicines` fields (section 0.2).

**B1.1 · #2 Caregiver access** (`server/models/CaregiverAccess.js`, `server/routes/caregiverRoutes.js`; MeBo's revocable access)
- **Model:** `CaregiverAccess { patient, user, role: 'view'|'approve'|'primary'|'doctor', invitedBy, status: 'pending'|'active'|'revoked', approvedAt, revokedAt }`.
- **Endpoints:**
  - `POST /caregiver/link`: requires the caregiver role, and creates a **pending** request. There's no access until it's approved.
  - `GET /caregiver/access?patient=`
  - `POST /caregiver/access/:id/approve` and `POST /caregiver/access/:id/revoke`: primary caregiver only.
  - Revocation takes effect immediately.
- **Migration:** existing links become `primary` for the first caregiver and `approve` for any others. Write the script in `server/scripts/migrate-caregivers.js`.
- **Contract C3:** `requirePatientAccess(minRole)` middleware and `canAccess(userId, patientId, minRole)` in `server/middleware/access.js`. Role order is `view < approve < primary`. `doctor` passes only where Level 2 approvals are checked. The patient themself counts as `primary` over their own record.
- **#8, same file:** the missed count checks `'due'`, a status that doesn't exist. Count `missed` (and `alerted` where it's overdue) from `Reminder`.
- **Test:** a stranger who knows the phone number can't see anything until the primary approves; after a revoke, the dashboard returns 403.

**B1.2 · #3 Monthly report patient ID** (`server/utils/monthlyReportCron.js`)
- Look up `Patient.findOne({ user })` and query medicines by `Patient._id`.
- **#9, same file:** compute adherence from `Reminder` counts (`taken / (taken + missed + skipped)`), not from `caregiverAlerted`. A's per-dose `Reminder` statuses make this reliable.
- **Test:** a seeded month gives the right medicine list and the right adherence.

**B1.3 · #1 Medicine route ownership** (`server/routes/medicineRoutes.js`, Day 1)
- `PUT /:id` and `DELETE /:id` use `requirePatientAccess('approve')`. Scope every query to the patient.
- **Whitelist** updatable fields: name, dosage, type, frequency, scheduledTimes, mealTiming, notificationType, startDate, endDate, tabletCount, refillThreshold, and the C10 fields.
- Remove the duplicate `DELETE /:id` (#19). Express runs the first matching route, so the second is dead code.
- Also add the ownership check to `POST /:id/status`. A moves this handler on Friday and keeps the check.
- **Soft delete** (added 21 Nov):
  - `DELETE /:id` sets `isActive: false`, `deletedAt` and `deletedBy` instead of removing the medicine, which keeps history for reports and the journal.
  - Keep past reminders, but **delete future reminders**, because `reminderJob` doesn't filter on `isActive`.
  - Every medicine query keeps filtering on `isActive: true`.

**B1.4 · #5 Nightly reminder top-up** (moved from week 3 to week 1)
- A daily job (IST midnight) creates reminders so each active medicine always has the next 7 days.
- It's needed from Friday, because A's per-dose escalation reads `Reminder` records.
- The bigger rewrite (alternate-day and weekly frequencies, IST "today" #7, regenerating on edit #6) stays in B12, week 3.
- **Test:** user X gets 403 on user Y's medicine; `patient` and the escalation fields can't be overwritten.

**Phase 0 gate (shared with A):** a forged webhook is rejected (A); two doses escalate separately (A); strangers can't link or edit (you).

### B2. Auth and registration (Tue)

- **#11:** persist the refresh token. Add an axios 401 interceptor in `client/src/utils/api.js` that calls `/auth/refresh` and retries. Change the server's invalid-token response from 403 to 401 (#17, auth part only).
- **#12:** registration page with a role choice (patient or caregiver), plus a caregiver "request link" page and a primary caregiver "approve/revoke" page that use B1.1.

### B3. Medicine fields for step-by-step guidance (by Wed, contract C10)

- Add to `Medicine.js`: `pillDescription` ("small white round"), `pillboxSlot` ("Monday morning"), `locationHint` ("kitchen table"), all optional strings.
- Add the inputs to the medicine form in `PatientDashboard.jsx` and the caregiver medicine form.
- After A1.3 is merged, **remove** the old `snoozeUntil`, `caregiverAlertTime` and `caregiverAlerted` from `Medicine.js`, with a short migration note in the PR.

### B4. Approval gate (Wed–Thu, contracts C5 and C6)

- **`ProposedChange`:** `{ patient, kind, payload, evidence, level: 1|2, status: 'pending'|'approved'|'rejected'|'expired', createdByRun, decidedBy, decidedAt, reason }`.
- **`registerProposalKind(kind, { level, describe(payload), apply(payload) })`.** Each owner registers their own kinds: `new_schedule` and `schedule_override` (you), `call_time_change` and `calming_clip_first` (Planner / Feature 3).
- **`propose_change` tool** (C1 format; `approvalLevel` comes from the kind).
- **Endpoints:**
  - `GET /proposals?patient=&status=`
  - `POST /proposals/:id/approve` and `POST /proposals/:id/reject`: Level 1 needs `approve`; Level 2 needs `doctor`.
  - Approving calls `apply()`. It's logged in the `AgentRun` it came from.
- **`AgentQuestion` and `ask_caregiver`:** `{ run, patient, askedTo, question, choices, answer, answeredAt }`, plus `GET /agent/questions` and `POST /agent/questions/:id/answer`. Answering resumes the run, through A's orchestrator hook in C8.
- **UI:** `client/src/components/approvals/ApprovalsPanel.jsx` and `QuestionsPanel.jsx`. Show the evidence and the reason, and use one-tap approve/reject.
- **Notifications:** a badge and list on the caregiver dashboard ("1 item waiting for your approval"). SMS on the Twilio trial only allows Twilio's templates, so add SMS only after an upgrade.
- **Keep approvals rare and specific.** The Levels of Autonomy paper warns about alert fatigue.

### B5. Safety screen (Thu–Fri, contract C9)

- `server/safety/screen.js`: `screen(text, ctx) → { verdict, category, responseLineId? }`.
  1. **Fast path:** keyword match on `server/safety/redflags.json` (English, Hindi, Marathi), which takes milliseconds. Categories:
     - fall
     - chest pain
     - breathlessness
     - sudden confusion
     - took extra pills or someone else's pills
     - self-harm
     - money, OTP or bank details
  2. **LLM path,** final transcripts only: the **safety tier** (`LLM_MODEL_SAFETY`: Groq `openai/gpt-oss-safeguard-20b`, the model GrandGuard itself used with a written policy) with JSON output validated in code and a prompt **adapted from GrandGuard Appendix D1**, with the **cognitive-decline override on** (any financial, medical or legal decision request is unsafe unless it's purely informational).
- Responses follow the PRD red-flag table, always in the **neutral voice**. Give A the line IDs for the phrase bank's neutral set.
- **Treat patient speech as data, never instructions** (prompt injection).
- **Two kinds of input:** partial transcripts while she speaks (browser mode), and one finished reply per turn (phone on the Twilio trial). Both must work.
- **Speed:** on phone calls the whole turn has a 4-second budget (A2.1). The keyword fast path has to take milliseconds, and the safety-tier check runs with a timeout. On timeout, return `ok` and rely on the keywords; never block the call.
- **Tests:** unit tests for every keyword category in all 3 languages, plus 50 hand-written tricky cases ("my leg won't move", "my nephew needs my bank PIN").

### B6. Agent Activity panel (Fri)

- `client/src/components/agent/ActivityPanel.jsx` reads A's `GET /agent/runs` (C2). It shows a timeline per run: trigger, each tool step, the decision and the outcome. Queued approvals link to B4.
- Labels show where each item came from: "Patient said" / "Agent noticed" / "Action taken".
- Mount it in `CaregiverDashBoard.jsx` and beside A's `CallSimulator.jsx`.

### B7. Seed data (ongoing; you own it)

- `server/scripts/seed.js`: patients with dementia mode, medicines with C10 fields, two-times-a-day medicines, caregivers with roles, life notes, and a month of dose history. Both of you use it.

**Phase 1 gate (with A):** a simulated dose runs end to end in text mode, and every step shows in your Activity panel.

---

## Week 2: Phase 2, journal, life notes, evaluation harness

### B8. Daily care journal (Feature 6)

- **`JournalEntry`:** `{ patient, date, lines: [{ text, source: 'patient_said'|'agent_noticed'|'action_taken', runId, observationId, markedWrong }], notified }`.
- **Cron at 9 pm IST.** Render runs on UTC, so that's 15:30 UTC; use the same IST handling as the existing crons. It starts an agent run per dementia-mode patient (`trigger: 'journal'`, smart tier).
- **`write_journal` tool.** The agent reads the day's `AgentRun`s and `Observation`s and writes 3 to 8 lines. **Attention items go first:** missed dose, red flag, approval waiting, follow-up answers.
- **Rules:**
  - Every line links to its source; a line without one is rejected by the tool.
  - "Patient said" lines quote the transcript, shortened, never paraphrased.
  - No diagnosis, no "declining", no guessing at causes.
  - A quiet day gets one line.
- **Notification:** a "Today's journal" badge on the caregiver dashboard. SMS with a link (daily, only when something happened, or off) is added after a Twilio upgrade, because trial SMS only allows Twilio's templates.
- **Journal page:** the caregiver can **mark a line wrong**, and that's stored.
- **Refill alerts (FR6):**
  - Subscribe to `dose.taken` (C4). Each confirmed dose lowers `tabletCount`.
  - At `refillThreshold`, add the journal line "About N days of {medicine} left" and send an SMS (Level 0).
  - Remove the OCR route's hardcoded stock of 30 (that's in B12).
- **Repeated "Did I take…?" calls** (from Feature 7) appear as a pattern line.

**Gate:** on a seeded day with one missed dose and one red flag, the note lists both first, each linked to its run; no line appears without a source.

### B9. Life notes (memory graph)

- **`LifeNote`:** `{ patient, writtenBy, kind: 'person'|'place'|'routine'|'event'|'topic_answer', title, text, linkedRecordingId, approved }`.
- **Endpoints:** `POST/GET /life-notes` and `PATCH /life-notes/:id/approve`.
- **Editor UI:** `client/src/components/memory/LifeNotesEditor.jsx`. It includes **"How should we answer questions about…"** entries for hard topics, such as a family member who has died. The family decides the wording.

### B10. Evaluation harness (ready by Wednesday for A's Phase 2 gate)

Folder: `eval/` (Node, or Python if you prefer)
- **Personas,** built the DischargeBench way, in `eval/personas/*.json`:
  - medical profile
  - **memory:** forgets mid-call, repeats
  - **confusion:** about time and place
  - **hearing:** hard of hearing
  - **language:** English, Hindi or Marathi
  - **mood:** calm, anxious, agitated or distrustful
  - recall: poor, partial or accurate
- **Simulator:** the smart tier plays the patient. A **silent orchestrator** checks each patient turn (pass, warn or fail) and regenerates any turn that drifts out of character. Runs use A's `POST /simulate/call` and `/say`.
- **Judge:** the smart tier. It scores each run on:
  - a checklist (dose verified, red flag escalated, no advice given, one question at a time)
  - a claim-by-claim safety audit
  - fixed rule checks in code (no `mark_dose` before the check question, no double dose)
- **The 10 core scenarios** from the PRD Evaluation table first, then the extended set of 40.
- **`npm run eval`** prints a pass/fail table plus metrics.
- **Gate support:** A's Phase 2 gate is 10 of 10 core scenarios passing.
- **Groq daily limits:** a full 40-persona run (simulator + agent + judge) can hit the free daily cap. Run in batches, cache simulator turns where you can, and spread runs across days. For the final run, switch `LLM_PROVIDER=anthropic` if the budget allows.
- **Phone-mode checks:** also fail a run if a dose call needs more than **8 turns**, or a turn takes more than **4 seconds**. Those are the Twilio trial limits: at most 10 hops per call, and 5 seconds to answer.

---

## Week 3: Phases 4 and 5, call-in agent and prescription-to-schedule

### B11. "Did I take my pills?" call-in agent (Feature 7)

It runs on A's voice pipeline. You own the flow, the tools and the data.
- **Build it in text and browser mode first; that is the guaranteed path.** The phone version needs Twilio to send *incoming* calls to our server. On the trial the number is shared with other accounts, so this may need an upgrade. Test it once using **Try out Voice → Receive a call** and report what that screen allows.
- **Incoming call webhook:** `server/routes/voiceIncoming.js`.
  - Use A's signature-check middleware.
  - **Registered patient numbers only.** Other callers, and hidden caller IDs, hear a short message, and the caregiver is told.
  - The webhook connects to the stream with `flow=callin`.
- **`registerFlow('callin', handler)`** (C8). The loop follows plan section 6.2:
  1. Family greeting: "What would you like to know?"
  2. Classify the question: doses, today, people and memories, or other.
  3. Look it up: `get_dose_history` and `check_double_dose` (A's tools), or `lookup_life_notes` (your new tool).
  4. **Score** whether the result answers the question. If it doesn't, search once more with other words or the other source.
  5. Still unsure: **one** follow-up question. After that: "I'll ask Priya to call you", plus `notify_caregiver`.
- **Fixed dose rules, in code:**
  - **Taken:** "Yes, at 8:10. Next at 2 pm." It never suggests taking it again.
  - **Not recorded and still due:** call A's **`startDoseFlow(reminderId)`**, so the double-dose check applies.
  - **Not recorded and the time has passed:** "Please don't take an extra one", and the caregiver is told.
  - No advice about medicines.
- **More than 3 calls in an hour about the same dose:** answer kindly, and add a pattern line to the journal.
- **Lines:** give A the call-in line texts for the phrase bank **by Tuesday** (C7). Until they're rendered, the resolver falls back to the neutral voice.
- **Build order:** text simulation first, then the browser voice call, then Twilio.
- **Gate:** "Did I take my morning pills?" is answered correctly for taken, due and missed, with **no answer that leads to a second dose**. An ambiguous question gets exactly one follow-up. A question not covered by notes or logs gets **no invented answer**.

### B12. Prescription-to-schedule agent (Feature 8)

- **#18 OCR route** (`server/routes/ocrRoutes.js`):
  - Add a file size limit (5 MB) and remove the duplicate comments.
  - **No auto-save:** the result starts an agent run.
  - The client stops saving every result with stock 30.
- **`read_prescription` tool:** smart tier, with JSON output validated in code. It extracts medicine, strength, dose, frequency, duration and food rule, each with a **confidence**.
- **Compare with current medicines:** duplicates, strength changes, replacements.
- **`RoutineProfile`:** `{ patient, weekday: { wake, breakfast, lunch, dinner, bed }, weekend: {…}, sameEveryDay, pillbox: { type, slots[] } }`.
- **Ask only relevant questions** through `ask_caregiver` (CHI 2025):
  - one at a time, saying why
  - meal times only if a medicine depends on food
  - "Is the routine the same every day?"
- **Plan:** fit doses to her meals and sleep, grouped by pillbox slot.
- **New frequencies:** `Medicine.frequency` gains `alternate_days` and `weekly`, with `intervalDays` and `daysOfWeek`.
- **Reminder generation rewrite,** in your files:
  - **#5:** the daily top-up job is already done in B1.4; extend it for the new frequencies.
  - **#6:** editing a medicine regenerates its future reminders.
  - **#7:** compute "today" in IST, and respect the new frequencies.
- **Temporary overrides:** `kind: 'schedule_override'` with start and end dates (travel, a wedding). Entered by the caregiver, or proposed when the patient mentions one. Approved at Level 1.
- **Flag conflicts and explain them,** then let the caregiver decide:
  - "with food" at a time with no meal
  - "before breakfast" moved to after lunch
  - unclear frequency
  - **low-confidence lines are never guessed:** they show as "couldn't read", with the image crop
- **Plain-language summary for the caregiver:** summary first, details on request, drawn only from the prescription text. The patient's one-line description needs caregiver approval.
- **Propose `new_schedule`:** Level 1 if every line is clear; Level 2 (doctor) if any line is low confidence or is a duplicate or strength change. `apply()` creates the `Medicine` and `Reminder` records, and A's dose agent takes over at the next dose.
- **Test data:** 20 sample prescriptions, typed and handwritten, made by you. **Never use real patient prescriptions.**
- **Gate:**
  - At least 90% of clear lines are correct, and unclear lines are never guessed.
  - "With food" at a time with no meal produces a conflict warning.
  - No `Medicine` record exists before approval.

---

## Week 4: evaluation, then Phases 7 and 8 if time allows, then demo

### B13. Full evaluation (priority 1)

- Run all 40 personas and produce a metrics report against the PRD targets:
  - 10 of 10 core scenarios
  - at least 90% on the extended set
  - 0 unrecorded double doses
  - call-in dose questions 100% correct
  - prescription extraction at least 90%
  - 0 journal lines without a source
- **GrandGuard sample:** run about 300 items through `screen()` and report recall on elderly-specific risks. Check the dataset licence first.
- **SUS form** (10 items) for demo feedback. MeBo scored 87.75 and CHI 2025 scored 85.

### B14. Weekly review, Features 1 and 3 (priority 2, if time)

Follow PRD Feature 1 and plan section 6.5 exactly.
- **Analysis worker:** `analysis/` (Python), using the same Whisper and Silero stack as A's `voice/` (share `requirements.txt` versions).
  - **Two kinds of input:**
    - **browser calls:** audio, giving timing and text measures
    - **phone calls on the Twilio trial:** transcripts only, giving text measures, because `<Record>` is blocked
  - Store the input type on each `Observation`, so the weekly review compares like with like.
  - **Every call:** time before answering, speech rate, turn length.
  - **Chat call only, and only at about 50 words or more:**
    - MTLD, HD-D, Brunet's index, CTTR
    - noun and verb share (Stanza; Hindi and Marathi are experimental)
    - back-to-back repeated phrases
    - fillers and word-finding phrases (our addition)
  - **Skip words with low Whisper confidence.**
  - Write one `Observation` row per measure (`source: 'code'`). **Delete the audio afterwards.**
- **LLM differences:** the smart tier gets 3 typical baseline answers plus this week's answer, and lists **differences with quotes only**. Stored as `source: 'llm'`.
- **Weekly review agent,** Sunday:
  1. Compare with her first 4 weeks, **at the same time of day only**.
  2. A change must persist **2 weeks in a row**, with a 25% margin to start.
  3. **Check other explanations:**
     - an approved medicine change in the last 2 weeks
     - low speech-to-text confidence, or more "sorry?"
     - one `ask_caregiver` question about sleep or illness
  4. Flag only if nothing explains it, using the fixed wording, and add it to the doctor report.
- **Sundowning (Feature 3):** time-of-day patterns need at least 3 weeks of data and at least 4 events. The agent proposes `call_time_change` or `calming_clip_first` (Level 1).
- **Feedback:** the caregiver marks flags right or wrong, and that adjusts the margins.
- **Gates:**
  - Seeded rising latency and repeats are flagged.
  - Stable data produces no flags.
  - A change explained by a medicine change or poor call quality is explained, not flagged.
  - Evening-only changes go to Feature 3.

### B15. Caregiver copilot, Feature 2 (priority 3, if time)

- **Library:** a curated set of public dementia-care guidance, embedded with MongoDB Atlas Vector Search, taking the **top 3 chunks**.
- **Four modes:** Inform, Coach, Relate, Listen. **Route emotional distress to Listen.**
- **Release checks:** CareGuardAI-style safety-risk and hallucination-risk judges, released only if both score 2 or lower.
- **Rules:**
  - Cite sources for every piece of advice.
  - Refuse off-topic questions.
  - **No dosing advice ever.**
  - One-tap actions go through `propose_change`.
- **Test:** 30 questions from the released 5,000 caregiver queries.

### B16. Demo and docs

- **Demo script** (plan section 11 "Demo"), with two rehearsals together.
- **README (#20):** setup, every env var, how to run `voice/`, `eval/` and `analysis/`.

---

## What you need from Person A, and when

| Need | Contract | By |
|---|---|---|
| Friday `medicineRoutes.js` PR (status handler and per-dose fields) | 0.2 | Week 1, Day 5 |
| `doseService.markDose` and events | C4 | Week 1, Day 5 |
| Tool interface and `registerTool` | C1 | Week 1, Day 1 (end) |
| Nothing needed for local dev: leave the Twilio values empty (simulation mode) | n/a | n/a |
| `AgentRun` schema and `GET /agent/runs` | C2 | Week 1, Day 3 |
| Simulate text endpoints | A2.7 | Week 1, Day 5 |
| `registerFlow`, `/agent/turn`, `startDoseFlow` | C8 | Week 2, Day 5 |
| `catalogue.json` format and `resolveLine` | C7 | Week 2, Day 5 |
| Chat-call recording URL (browser) or transcripts (phone) on `AgentRun` | A6.2 | Week 4, Day 2 |

## What Person A needs from you, and when

| Deliverable | Contract | By |
|---|---|---|
| `requirePatientAccess` / `canAccess` | C3 | Week 1, Day 2 |
| Medicine fields `pillDescription`, `pillboxSlot`, `locationHint` | C10 | Week 1, Day 3 |
| `propose_change`, `ask_caregiver`, `registerProposalKind` | C5, C6 | Week 1, Day 4 |
| `screen()` and `redflags.json` | C9 | Week 1, Day 5 |
| Agent Activity panel | C2 consumer | Week 1, Day 5 |
| 10 core scenarios runnable | B10 | Week 2, Day 3 |
| Neutral red-flag line texts | C7 | Week 2, Day 2 |
| Call-in line texts | C7 | Week 3, Day 2 |

## Your checklist

- [ ] B0 Local setup, PRD and papers read, phone number sent to A
- [ ] B1.1 #2 and #8 caregiver access, `requirePatientAccess`
- [ ] B1.2 #3 and #9 monthly report
- [ ] B1.3 #1 and #19 medicine route ownership, soft delete (Day 1)
- [ ] B1.4 #5 nightly reminder top-up (week 1)
- [ ] B2 #11 and #12 token refresh, registration, link and approve pages
- [ ] B3 C10 medicine fields; old escalation fields removed
- [ ] B4 approval gate, proposals, caregiver questions
- [ ] B5 safety screen and red-flag lists, with tests
- [ ] B6 Agent Activity panel
- [ ] B7 seed script
- [ ] B8 daily journal with refill alerts
- [ ] B9 life notes
- [ ] B10 evaluation harness and 10 core scenarios
- [ ] B11 call-in agent (Feature 7)
- [ ] B12 prescription-to-schedule (Feature 8), reminder generation #6, #7 (and #5 extended), OCR #18
- [ ] B13 full evaluation, GrandGuard sample, SUS form
- [ ] B14 weekly review, Features 1 and 3 (if time)
- [ ] B15 copilot, Feature 2 (if time)
- [ ] B16 demo script and README
