# MedTime: progress log

A running record of what's done, what's in progress and what's next. **It's updated after every change**, newest entries first.

- **PRD (source of truth):** https://claude.ai/artifact/3u36YwrZskqhNbzkB61jhY
- **Plan:** [MEDTIME_AGENT_PLAN.md](MEDTIME_AGENT_PLAN.md)
- **Tasks:** [TASKS_PERSON_A.md](TASKS_PERSON_A.md) (Person A) and [TASKS_PERSON_B.md](TASKS_PERSON_B.md) (Person B)
- **Onboarding:** [START_HERE_PERSON_B.md](START_HERE_PERSON_B.md)

---

## Current status (as of 21 Nov 2026)

| Area | Status |
|---|---|
| Design and research | ✅ Done. PRD, research notes and plan are final |
| Task split | ✅ Done. Person A (calls, voice, live agent) and Person B (caregiver app, schedules, background agents, evaluation) |
| Twilio | ✅ New trial account works end to end for keypad calls driven by our server |
| Agent code | ⏳ Not started. Next: A2 agent runtime |
| Person B | 🟡 Working on a feature branch; Day-1 items (#2, #3, #1/#19 and soft delete, #5 top-up) |
| Phase 0 security fixes | ⏳ Not started. Scheduled for Friday of week 1 (low priority) |
| Person B onboarding | 🟡 Docs pushed; access and secrets still to be sent privately |

## In progress / next up
1. ✅ Docs pushed to `main`. Person B: pull and merge `main` into his branch.
2. **Send Person B their access:**
   - GitHub collaborator invite
   - PRD share
   - `.env` values and the Anthropic key, sent privately
   - the research papers
   - their phone number added to Twilio
3. **Person A, week 1:** A2 agent runtime (Claude adapter, tool registry, loop, `AgentRun`, orchestrator, 5 core tools, simulate endpoints).
4. **Person A, week 2:** A3.5 Twilio phone adapter (turn by turn, trial-compatible) and the Core dose agent.

## Open questions
- **Submission deadline?** It decides whether Phases 7 and 8 (weekly review, copilot) are in.
- **Upgrade Twilio near the end?** That would add live streaming, caregiver SMS, call-in on our own number, and timing measures from phone calls.
- **Does the trial route incoming calls to our server?** Test it via Try out Voice → Receive a call. This matters for Feature 7 on the phone.
- **Marathi speech recognition:** Twilio's docs don't list it; test a Google V2 model on a real call.
- **Anthropic API key and budget:** not set up yet.

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
| 21 Nov | On the trial, caregiver alerts are **phone calls**, and journal and approval notices go to the **dashboard** | Trial SMS only allows Twilio's templates |

---

## Change log

### 21 Nov 2026
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
