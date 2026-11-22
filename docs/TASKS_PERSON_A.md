# Person A: calls, voice and the live agent

**Owner:** Person A
**Partner:** Person B ([TASKS_PERSON_B.md](TASKS_PERSON_B.md))
**Source of truth:** the PRD (https://claude.ai/artifact/3u36YwrZskqhNbzkB61jhY) and [MEDTIME_AGENT_PLAN.md](MEDTIME_AGENT_PLAN.md). If this file and the PRD disagree, the PRD wins. Raise the difference in the daily sync, and fix this file.

You own everything that happens **during a call**:
- the Twilio account
- the agent runtime that every agent runs on
- the voice pipeline
- the dose agent and step-by-step guidance
- the Planner's follow-ups
- the whole family voice feature: real recordings, consent, the phrase bank, cloned audio and the player

Person B owns everything a **caregiver sees or approves**, and the agents that work **outside live calls**.

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
| C4 | **Dose service:** `markDose(reminderId, status, source)`. `source` is one of `app \| sms \| ivr \| speech \| agent \| scheduler` (`scheduler` = the escalation cron marking a dose missed; added in A1.3). It clears escalation, and emits `dose.taken`, `dose.skipped` or `dose.missed` on `server/events.js` (a Node EventEmitter) | A | B (refill alerts, journal), A (`mark_dose`) |
| C5 | **Proposals:** `ProposedChange` schema, `propose_change` tool, and `registerProposalKind(kind, { level, apply(payload) })`, so each owner applies their own approved changes | B | A (Planner) |
| C6 | **Caregiver questions:** `ask_caregiver` tool and the `AgentQuestion` model; the answer resumes the run | B | A (rarely), B |
| C7 | **Phrase bank:** `voice/phrasebank/catalogue.json` (line IDs, text, slots, tone, language), plus `resolveLine(lineId, slots, patientId) → { audioUrl } \| { neutralText }` | A | B (call-in lines, journal wording check) |
| C8 | **Voice ↔ agent API:** the pipeline posts `POST /api/v1/agent/turn { sessionId, flow, transcript, isFinal, asrConfidence, dtmf? }` and gets back `{ actions:[{ type:'play', lineId, slots } \| { type:'neutral', text } \| { type:'hangup' } \| { type:'listen' } \| { type:'wait' } \| { type:'fallback', reason }] }`. `wait` = still working: pause, then send an empty turn to collect the answer; `fallback` = the agent failed: use the keypad menu. A red flag adds `emergency: <category>` to the reply. Flows are `dose \| callin \| chat`. Each flow registers a handler with `registerFlow(name, handler)`. Also `startDoseFlow(reminderId)`. **Two front ends call the same API:** the browser pipeline (streaming, with partial transcripts) and the **Twilio phone adapter** (A3.5), which sends one final transcript per turn and turns the returned actions into `<Gather>`/`<Play>`/`<Say>`/`<Hangup>` | A | B (call-in flow) |
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

## A0a. LLM key (provider decided: Groq)
- Create a **free Groq API key** at console.groq.com → API Keys, and put it in `server/.env` and on Render as `GROQ_API_KEY`, with `LLM_PROVIDER=groq`. Person B makes their own.
- Optional later: an Anthropic key (console.anthropic.com → Billing → API Keys) with a monthly spend limit, for the final runs and the demo.

## A0. New Twilio account ✅ done

What we found when testing the new trial account (Twilio's current trial, from the "1console"):
- **There's no number of our own.** Calls come from a **shared trial number** shown as **From** in **Communications → Voice → Overview → Try out Voice** (it was `+17372212163`). It "can vary by product and by recipient", so if calls start failing on the From number, check that screen again and update `TWILIO_PHONE_NUMBER`.
- **Verified recipients:** add them in **Try out Voice** (up to **5**).
- **Limits:** 75 free minutes, 10 minutes per call, a trial notice plays before each call.
- **Call instructions must be a URL.** Our own server works (Custom TwiML URL, and `client.calls.create({ url })`). The inline `twiml` parameter is **rejected** ("trial accounts have limited parameter access"). Fixed in commit `c1cf78c`: calls now fetch their menu from `POST /webhooks/voice/prompt`.
- **`<Stream>` is blocked on the trial** (Twilio's try-out-voice page). Live streaming over a real phone call needs an upgraded account. Browser mode is unaffected.
- **SMS accepts only Twilio's predefined templates on the trial** ("Invalid template name"). Custom SMS reminders and **caregiver alert SMS fail** until upgrade. Use Call for testing.
- **Testing setup:** no ngrok. Code is developed on the laptop in simulation mode (Twilio values left empty in `server/.env`). Real calls are tested on Render after merging to `main`, which Render auto-deploys.
- **Verified end to end:** MedTime placed the call, Twilio fetched the menu from Render, key 1 was pressed, and the dose was recorded as taken.

## Phase 1: agent platform, then Phase 0 fixes

### A2. Agent runtime (first task)

Folder: `server/agent/`

**A2.1 · LLM adapter, provider as a setting** (`agent/llm/index.js`, `agent/llm/groq.js`, `agent/llm/anthropic.js`)
- **One interface:** `chat({ tier: 'fast'|'smart'|'safety', system, messages, tools, jsonSchema?, timeoutMs })` returns `{ text, toolCalls[], stopReason, usage }`. Flows and tools never name a provider or a model.
- **Groq (default, free for development):** use the `openai` npm package with `baseURL: 'https://api.groq.com/openai/v1'` and `GROQ_API_KEY`.
  - Models: `openai/gpt-oss-20b` (fast), `openai/gpt-oss-120b` (smart), `openai/gpt-oss-safeguard-20b` (safety). Groq's docs list tool use for all three.
  - **`gpt-oss-safeguard-20b` is a *preview* model** that "may be discontinued at short notice". If it's gone, the safety tier falls back to the fast model with the GrandGuard prompt.
  - Groq's docs show **no parallel tool calls** for the gpt-oss models, so the loop sends one tool call at a time.
  - **Check the free-plan limits** in console.groq.com → Settings → Limits. The docs page shows Developer-plan figures (about 1,000 requests a day per model). On a 429, read `retry-after`, back off, and fall back to the keypad flow during a call.
- **Anthropic (optional, for final runs and the demo):** `@anthropic-ai/sdk`.
  - Models: `claude-haiku-5-5` (fast and safety), `claude-sonnet-5-5` (smart).
  - API notes:
    - use `tool_choice: { type: "auto" }` with `strict: true`, because Sonnet 5.5 rejects forcing a particular tool
    - use structured outputs through `output_config.format`
    - don't send `temperature`, `top_p` or `top_k`
    - no assistant prefill
    - check `stop_reason` (including `"refusal"`)
    - return every `tool_result` from one turn in one user message
    - set effort explicitly: `low` for live calls
  - Cost estimate: about $0.006 per dose call, roughly $10–20 for the whole project (plan section 10).
- **Both providers:**
  - parse tool arguments with `JSON.parse` and **validate them against the tool's schema in our code**, because JSON mode alone doesn't guarantee the schema
  - the per-turn label (`intent`, `pill_mentioned`, `matches_expected`, `confidence`) is JSON validated the same way
- **Why we host the loop ourselves:** we need our own limit of 8 tool calls, approval gates and `AgentRun` logging around each call, and our tools run against our database and Twilio.
- Catch SDK errors most-specific-first (rate limit → API status → connection). On any failure, **fall back to the keypad flow**.
- **Speed budget for phone calls:** Twilio waits at most **5 seconds** for our next instruction. Each turn (database, safety screen, fast-tier model) gets **4 seconds**. If it runs over, return a fixed line ("Let me check that for you, Amma") with a short `<Pause>` and `<Redirect>` back to the same run, and finish the work meanwhile.

**A2.2 · Tool registry and loop** (`agent/tools/index.js`, `agent/loop.js`)
- `registerTool()` follows contract C1.
- The loop has guardrails:
  - at most 8 tool calls per run
  - 30 s per call turn
  - on overrun, LLM error or refusal: rule-based fallback
- Before running a tool with `approvalLevel > 0`, the loop routes it through `propose_change` (C5). The run records `outcome: 'queued_for_approval'`.
- Prompt versions live in `agent/prompts/*.md`. Each `AgentRun` stores `promptVersion`.

**A2.3 · `AgentRun` model and endpoints** (contract C2)
- Every step stores tool, input, output, time and milliseconds. Endpoints: `GET /agent/runs`, `GET /agent/runs/:id`, both access-checked.

**A2.4 · Orchestrator** (`agent/orchestrator.js`)
- `registerFlow(name, handler)` and `POST /agent/turn` (contract C8). It runs the safety screen (C9) **before** the LLM on every final transcript.
- Until B's screen exists, use a stub that returns `ok`, and keep the keyword red flags in A's code.

**A2.5 · Five core tools** (`agent/tools/core.js`)
- `get_patient_context`: profile, conditions, caregivers, language, mode flags, pending follow-ups.
- `get_dose_history`: doses taken, missed or skipped, with times, for a date range.
- `check_double_dose`: whether this dose is already recorded today.
- `mark_dose`: calls `doseService.markDose(..., 'agent')`.
- `notify_caregiver`: a **phone call** to linked caregivers with a short spoken summary (`<Say>`), because SMS on the Twilio trial only allows Twilio's templates. After an upgrade, SMS is added. It respects each caregiver's role (C3).

**A2.6 · Cron hands over to the agent**
- `missedDoseCron` stops deciding. For patients with `dementiaMode` it creates an agent run (`trigger: 'dose_due'`). Other patients keep today's keypad flow.
- Add to `Patient.js`: `dementiaMode` (default false), `language` (`en | hi | mr`), `familyClipsEnabled`.

**A2.7 · Text simulate endpoints**
- `POST /api/v1/simulate/call { reminderId }` and `POST /api/v1/simulate/call/:id/say { text }`. They run the same flow and tools with Twilio replaced by text. B's evaluation harness uses these.

**Phase 1 gate (PRD):** a simulated dose runs end to end in text mode, and every step shows in the Agent Activity panel (B's panel, reading your endpoint).

---

### A1. Phase 0 fixes (after A2, because it is lower priority)

**A1.1 · #4 Verify Twilio webhooks** (`server/routes/webhookRoutes.js`)
- Validate `X-Twilio-Signature` on `/webhooks/sms` and `/webhooks/voice`, using `twilio.validateRequest(authToken, signature, url, params)` or `twilio.webhook()` middleware.
- The URL must be the **exact public URL Twilio called**: build it from `PUBLIC_BASE_URL` plus `req.originalUrl`. On Render behind a proxy, `req.protocol` and `host` can't be trusted.
- Add guards: `req.body.Body` may be missing; the user may have no `Patient` profile.
- **Test:** a forged `curl -X POST .../webhooks/voice -d Digits=1` returns 403; a real call still works.

**A1.2 · #10 Replace the ngrok fallback** (`server/utils/twilioClient.js`)
- Use `PUBLIC_BASE_URL` for every callback URL. If it's missing in production, **fail at startup** with a clear message.
- Add `TWILIO_ENABLED=false` for local development: calls and SMS are logged instead of sent, so Person B can run the server without Twilio credentials.
- Delete the unused `makeCall` (#19, twilioClient part only).
- **Quiet the logs:** the SMS job retries failed SMS every 10 seconds and logs a "Skipping" line per call medicine. Retry a failed SMS at most 3 times, then mark it failed; drop the "Skipping" log line.
- **Test:** the server refuses to start in production without `PUBLIC_BASE_URL`; local development runs with Twilio disabled.

**A1.3 · #13 Escalation per dose** (`Reminder.js`, `missedDoseCron.js`)
- Move `snoozeUntil`, `caregiverAlertTime`, `caregiverAlerted` from `Medicine` to `Reminder`. Add `attempts` and `lastCallAt`.
- `missedDoseCron` loops over **due `Reminder` documents**, not medicines. Each dose is armed, snoozed and alerted on its own.
- **The missed-dose alert is a phone call** (decided 22 Nov), made through A2.5's `services/caregiverAlerts.js`, because trial SMS only allows Twilio's templates and every custom SMS fails. SMS can be added back after an upgrade.
- A failed alert is not swallowed. If no call could be placed, mark the reminder `alertFailed: true`, log it, and retry on the next tick, up to 3 times. `caregiverNotified` is set only once a call was actually placed. (Whether the caregiver answered needs Twilio status callbacks, which aren't part of this task.)
- Leave the old `Medicine` fields in the schema for now, unused. B removes them later with a migration note.
- Write `server/services/doseService.js` with `markDose(reminderId, status, source)` (contract C4). It sets the status and `confirmedAt`/`confirmedBy`, clears the escalation fields, and emits the event.
- **Test:** a medicine with two times a day escalates each dose separately (PRD gate); a confirmed dose stops all calls for that dose.

**A1.4 · #14 Take/skip clears escalation** (new `server/routes/doseRoutes.js`)
- New endpoint `POST /api/v1/doses/:reminderId/status { status }`. It checks access with B's `requirePatientAccess('primary')`. It then calls `markDose(..., 'app')`.
- Remove `POST /medicines/:id/status` from `medicineRoutes.js`. Add `todayReminderId` and per-dose `status`/`caregiverAlerted` to each medicine in `GET /medicines` (see 0.2).
- Update `PatientDashboard.jsx`: take/skip calls the new endpoint, and the badges read the per-dose fields.
- **Test:** confirming in the app means no caregiver alert 10 minutes later.

**Phase 0 gate (PRD):** a forged webhook is rejected, and two doses of one medicine escalate independently.

## Phase 2: the Core dose agent with follow-ups

### A3. Voice pipeline

Folder: `voice/` (Python 3.11, with its own `requirements.txt`, run with `python -I`)

**A3.1 · Pipecat pipeline, browser first**
- Pipecat with the WebRTC transport, Silero VAD and faster-whisper (start with `small`; try `medium` or OpenVINO Whisper on your Intel laptop).
- Partial transcripts go to the safety screen; final transcripts go to `POST /agent/turn` (C8).
- **Barge-in:** when VAD detects speech, stop playback at once.
- Language comes from `Patient.language`. If Hindi or Marathi accuracy is poor, test an AI4Bharat Indic speech model.

**A3.2 · Browser call screen** (`client/src/pages/CallSimulator.jsx`)
- Microphone in, audio out, transcript shown live. Person B mounts the Agent Activity panel beside it for the demo.

**A3.3 · Twilio Media Streams (only after a Twilio upgrade)**
- TwiML `<Connect><Stream url="wss://VOICE_WS_URL/twilio">`. Convert between 8 kHz μ-law and Whisper's input format.
- Send audio back through the stream. To interrupt, send Twilio's `clear` message.
- Keypad presses (DTMF) arrive as stream events: 1 = taken, 2 = snooze, 9 = help.
- Hosting: run the voice server on your laptop behind **cloudflared** or **ngrok**; `VOICE_WS_URL` points at the tunnel. The Express API stays on Render.
- **Trial note:** `<Stream>` is blocked on the Twilio trial, so this step needs an upgraded account. Build and demo in browser mode (A3.1–A3.2) first; do this step only if the account is upgraded. On the trial, real calls can use the turn-based flow (`<Gather input="speech dtmf">` pointing at our URL).

**A3.4 · Emergency reflex**
- **Browser mode:** call `screen()` (C9) on **every partial transcript**.
- **Phone on the trial:** the partial-transcript callback isn't on the trial's allowed list, so call `screen()` on each **finished** reply (`SpeechResult`). Every `<Gather>` uses `input="dtmf speech"`, so **pressing 9 means help** at any moment. On `redflag`:
  - stop playback
  - play the neutral emergency line
  - `notify_caregiver` (call plus SMS) to the primary caregiver, then the second caregiver if there's no answer
  - keep listening; if she goes silent, escalate anyway
- Keypad 9 does the same.

**A3.5 · Twilio phone adapter (turn by turn; works on the free trial)** (`server/routes/voiceAgentRoutes.js`)
- The cron places the call with `calls.create({ url: PUBLIC_BASE_URL + '/api/v1/voice/agent?runId=…' })`. The trial accepts a URL to our server but rejects inline `twiml` (confirmed in testing).
- `POST /voice/agent?runId=` takes Twilio's `SpeechResult`, `Confidence` and `Digits`, calls `/agent/turn` (C8), and converts the returned actions into TwiML:
  - `play` → `<Play>` (the family-voice URL from `resolveLine`)
  - `neutral` → `<Say>`
  - `listen` → `<Gather input="dtmf speech" speechTimeout="auto" language="en-IN" actionOnEmptyResult="true" action="/voice/agent?runId=…">`, with the prompt nested inside
  - `hangup` → `<Hangup/>`
- **Language:** `en-IN` by default. Hindi uses `speechModel="experimental_conversations"` with `language="hi-IN"`; Twilio's docs list Hindi for that model. Twilio requires a numeric `speechTimeout` when `speechModel` is set, so use `2`. **Marathi isn't listed:** test a Google V2 model on a real call before promising it.
- **Trial limits to respect:**
  - at most **10 action/redirect hops per call**, so flows must finish in **about 8 turns**
  - **5 seconds** to answer (see A2.1)
  - `<Record>` and `<Stream>` are blocked
  - 10 minutes per call
- Signature-check this route like the others once A1.1 is in.
- **Test:** one real call to your verified phone. Say "I already took it", and confirm the agent checks the log and answers.

### A4. Core dose agent

**A4.1 · Dose flow** (`agent/flows/dose.js`, prompt `agent/prompts/dose.md`)
Implement the PRD call flow and section 6.1 of the plan:
- `get_patient_context`, `get_dose_history`, then `check_double_dose`. If the dose is already taken: no call, logged.
- `place_call`, family greeting, steps (simple version until Feature 4), then the **check question** ("Which one did you take first?") matched against the medicine record, then `mark_dose`, then praise.
- **CHI 2025 rules** (plan section 6.6):
  - one question at a time, nothing after a question
  - group by pillbox slot and read out each name
  - one precaution only
  - answer interruptions, then come back to the step
  - stop once acknowledged
- **Retries:** at most 2, 10 minutes apart, with tone moving from calm to firmer to concerned, then the caregiver. **An unanswered call is not a missed dose:** the next contact checks the log and asks. **Never double up a missed dose.**
- **"I already took it" with nothing recorded:** "Please don't take another one", then `ask_caregiver`.
- **Red flags:** the PRD's red-flag table, with neutral voice for every one.
- **Keypad fallback** on any agent failure.
- **Turn budget:** the whole flow (greeting, steps, check question, praise, one follow-up) must fit in **8 turns** for phone mode (A3.5).

**A4.2 · Call tools** (`agent/tools/call.js`)
- `place_call`, `play_clip`, `speak`/`listen`, and `log_observation` (fields per the PRD's Observation model: `metric, value, method, version, source, timeBlock, asrConfidence, wordCount`).

**A4.3 · Planner follow-ups** (`FollowUp` model, `plan_followup` tool, `agent/flows/planner.js`)
- After each call, a smart-tier run reads the transcript and pulls out concerns from the **fixed list**: knee, back, headache, stomach, sleep, appetite, feeling low, a visit.
- It saves a `FollowUp` (`patient, concern, sourceRun, quote, status, nextAsk`).
- On the next dose call, **after the dose**, it asks **once**: "Amma, yesterday you said your knee was hurting. Is it better today?" The answer goes to the journal (B reads `AgentRun`).
- A concern closes when she says it's better, after 3 asks, or when the caregiver closes it. Concerns not on the list are noted for the journal only.
- Health answers are never advised on. Red flags follow the red-flag rules.

**A4.4 · Real family recordings (Core)**
- `FamilyRecording` model (`patient, recordedBy, relation, type, medicine, audioUrl, transcript, approved, active, consentAt`).
- `POST/GET /recordings` and `PATCH /recordings/:id/approve`. Upload to Cloudinary, 30 s maximum, MP3 or WAV.
- UI component `client/src/components/voice/RecordingsPanel.jsx`, which B mounts.
- `play_clip` plays only approved clips.

**Phase 2 gate (PRD):** the 10 core simulated scenarios pass (B's harness runs them against your simulate API). Follow-up acceptance: a seeded "my knee hurts" produces exactly one follow-up on the next call, after the dose.

---

## Phase 3: family voice (phrase bank)

**A5.1 · Phrase-bank catalogue** (`voice/phrasebank/catalogue.json`, contract C7)
- About 150 to 200 line IDs covering:
  - greetings
  - grouped reminders in **calm, firmer and concerned** versions
  - steps
  - check questions
  - hints
  - praise
  - follow-ups for each concern
  - call-in answers (B supplies those line texts)
  - weekly chat prompts
  - handovers
- Slots: `{name}`, `{medicine}`, `{colour}`, `{time}`, `{slot}`. Every value is pre-rendered from a short list per patient.
- Each line also has a Hindi version, and Marathi if time allows.
- Review every line against the CHI 2025 rules.

**A5.2 · Consent** (`VoiceConsent` model, UI `components/voice/ConsentRecorder.jsx`)
- The speaker reads the consent statement aloud; it's stored with the date. Living people only.
- **Withdrawal** deletes the samples and all rendered audio, within 1 minute.

**A5.3 · Rendering** (`voice/render/render_lines.py`, offline on your laptop)
- OpenVoice through **OpenVINO** (Intel's notebook): a base TTS plus a tone-colour converter. For Hindi and Marathi, an Indic base TTS (IndicF5 or svara-TTS) plus the converter.
- Upload to Cloudinary, and create a `PhraseAudio { lineId, slotsKey, language, speaker, url, approved }` record.
- **Delete the reference sample and the voice embedding after rendering.** The licence is CC BY-NC-SA, which is fine for the bootcamp.

**A5.4 · Line approval UI** (`components/voice/LineApproval.jsx`)
- The speaker listens to and approves each line. Unapproved lines never play.

**A5.5 · Player and resolver**
- `resolveLine()` returns the approved family-voice audio, otherwise the neutral voice.
- **Red-flag replies are always neutral.**
- **Disclosure on the first call:** "These are Priya's recorded messages for you."
- The agent never sends free text to the cloning model.

**Phase 3 gate (PRD):** on a simulated call, every non-emergency line plays in the family voice and every red-flag reply plays in the neutral voice. A situation with no matching line produces a neutral-voice handover to the caregiver.

---

## Phase 6: step-by-step guidance; the chat call; live tests

**A6.1 · Step planner** (`agent/flows/steps.js`)
- From `pillDescription`, `pillboxSlot`, `locationHint` and `mealTiming` (C10), build 3 to 5 steps: open the box, take these pills, water, food if needed.
- **Loop:** say the step, wait, confirm, then praise or correct and repeat (from the egg-task paper).
- "I can't find it" gets a simpler hint from the bank. **Two failures on a step mean a handover:** "Priya will call you", plus `notify_caregiver`.
- Log time per step and whether a correction was needed (`log_observation`).

**A6.2 · Weekly chat call flow** (`agent/flows/chat.js`)
- 2 to 3 minutes in the family voice, using one of 3 or 4 fixed prompts ("Amma, tell me how you make your morning tea"). Follow-ups come from the bank.
- **Browser mode:** the audio is kept only if the caregiver opted in, and the URL is handed to B's analysis worker (a field on `AgentRun`).
- **Phone on the trial:** `<Record>` is blocked, so only the transcripts (`SpeechResult`) go to B. Timing measures come from browser calls, or from phone calls after an upgrade.

**A6.3 · Live Twilio tests and backup**
- Run real calls to verified numbers for scenarios 1, 2, 5 and a red flag. On the trial this uses the turn-based flow; caregiver SMS alerts can't be tested until upgrade.
- **Record a backup demo call.**

**A6.4 · Demo support**
- Help B rehearse the demo script; freeze `main` before the demo.

**Phase 6 gate (PRD):** the agent adapts when the patient says "I can't find it", and hands over after 2 failed steps.

---

## What you need from Person B

Until B's piece exists, use a stand-in and swap it in later.

| Need | Contract | Used in |
|---|---|---|
| `requirePatientAccess` helper | C3 | A2.3, A2.5 `notify_caregiver`, A1.4 |
| `propose_change`, `ask_caregiver`, `registerProposalKind` | C5, C6 | A2.2, A4.1, A4.3 |
| Safety screen and `redflags.json` | C9 | A2.4 (stub returns `ok`), A3.4 |
| Medicine fields for steps | C10 | A6.1 |
| Agent Activity panel | (C2 consumer) | Phase 1 gate |
| 10 core persona scenarios runnable | (uses A2.7) | Phase 2 gate |
| Call-in line texts for the phrase bank | C7 | A5.1 |

## What Person B needs from you

| Deliverable | Contract | Comes from |
|---|---|---|
| Tool interface and `registerTool` | C1 | A2.2 |
| `AgentRun` schema and `GET /agent/runs` | C2 | A2.3 |
| `doseService.markDose` and events | C4 | A2.5 (basic), A1.3 (full) |
| `medicineRoutes.js` PR (status handler and per-dose fields) | 0.2 | A1.4 |
| Simulate text endpoints | A2.7 | A2.7 |
| `registerFlow`, `/agent/turn`, `startDoseFlow` (for the call-in flow) | C8 | A2.4, A4.1 |
| `catalogue.json` format and `resolveLine` | C7 | A5.1, A5.5 |
| Chat-call recording URL (browser) or transcripts (phone) on `AgentRun` | A6.2 | A6.2 |

## Your checklist

In order, top to bottom:

- [x] A0 New Twilio account, credentials swapped, smoke test passed
- [x] A0a Free Groq key in `server/.env` (`GROQ_API_KEY`, `LLM_PROVIDER=groq`)
- [x] A2.1 LLM adapter (first coding task)
- [x] A2.2 tool registry and loop
- [x] A2.3 `AgentRun` model and endpoints
- [x] A2.4 orchestrator and `/agent/turn`
- [x] A2.5 five core tools
- [x] A2.6 cron hands over to the agent
- [x] A2.7 text simulate endpoints (with a basic dose flow; A4.1 replaces it)
- [x] A1.1 #4 webhook signatures
- [x] A1.2 #10 `PUBLIC_BASE_URL` and `TWILIO_ENABLED`
- [x] A1.3 #13 per-dose escalation and `doseService`
- [ ] A1.4 #14 dose endpoint and dashboard update
- [ ] A3.1–A3.4 voice pipeline, browser call screen, emergency reflex (Media Streams only after an upgrade)
- [ ] A3.5 Twilio phone adapter (turn by turn, trial-compatible)
- [ ] A4.1–A4.4 dose flow, call tools, Planner follow-ups, real recordings
- [ ] A5.1–A5.5 phrase bank, consent, rendering, approval, player
- [ ] A6.1–A6.4 step-by-step guidance, chat call, live tests, backup recording
