# Start here: Person B

Welcome to MedTime. This page gets you from "just cloned the repo" to "working on my first task". Allow about half a day for reading and setup.

---

## 1. What we're building, in one minute

**MedTime** is a medication app that already works:
- patients and caregivers log in
- medicines get SMS reminders and phone calls ("press 1 if you've taken it")
- a missed dose alerts the caregiver

It's live at https://med-time-lemon.vercel.app. The frontend is on Vercel and the backend on Render.

**We're turning it into an AI agent for people with dementia,** for the **Intel AI for Future Workforce Agentic AI Bootcamp**. The bootcamp only accepts projects where an AI agent plans, decides, uses tools and runs multi-step workflows. Here's what the agent does:
- It calls the patient at dose time and speaks in a **family member's voice**, using lines that person recorded and approved.
- It understands spoken answers and checks the dose log so she never takes a dose twice.
- It guides her through taking her pills step by step.
- It remembers what she mentioned ("my knee hurts") and asks about it next time.
- It writes a daily journal for the caregiver.
- It turns a scanned prescription into a schedule.
- It asks a caregiver or doctor before anything risky.

**We split the work by area:**
- **Person A** builds what happens **during a call**: the agent "brain", voice, phone and family voice.
- **You (Person B)** build what **caregivers see and approve**, and the agents that work **outside calls**: schedules, approvals, safety screen, journal, call-in agent, prescription agent, and testing.

---

## 2. What you'll get from Person A (not in the repo)

These are private or too large for git. Ask for anything on this list you haven't received.

| Item | Why you need it | How it's shared |
|---|---|---|
| **GitHub collaborator access** to `shravanidhus31/MedTime` | So you can push branches and open PRs | GitHub invite: accept it in your email |
| **The PRD link** (a Claude Doc) | The full spec: every feature, requirement and acceptance test. It has a "Research notes" tab | Person A shares it from Claude |
| **Values for `server/.env`**: `MONGO_URI`, `JWT_SECRET`, `ENCRYPTION_KEY`, `EMAIL_*` | To run the server locally | **In person or through a password manager. Never over chat, email or screenshots** |
| **An Anthropic API key** (or a budget for your own) | Your agents use Claude: safety screen, journal, prescription reading, testing | Same as above |
| **The research papers** (`Medtime papers/` folder) | You'll use GrandGuard, DischargeBench and CHI 2025 | Google Drive or USB. They're copyrighted, so not in git |
| **Your phone number added in Twilio** as a verified recipient | So you can receive real test calls. The trial allows 5 numbers | Person A adds it; you enter the code Twilio texts you |
| *(Optional)* Render and Vercel access | To read server logs while testing calls | Person A invites you |

You **don't** need your own Twilio account. Locally you run in **simulation mode** (section 4).

---

## 3. Read these, in this order (about 3 hours)

1. **This file.**
   - Then **[docs/PROGRESS_LOG.md](PROGRESS_LOG.md)**: what's done, what's in progress, key decisions and open questions. It's updated after every change, so check it whenever you pull.
2. **[docs/MEDTIME_AGENT_PLAN.md](MEDTIME_AGENT_PLAN.md)**, the overview with diagrams. Read:
   - sections **1–4** (problem, users, features, what makes it agentic)
   - **5.1** (architecture)
   - **6.2** (call-in workflow)
   - **6.3** (prescription workflow)
   - **6.4** (journal)
   - **8** (safety)
   - **9** (evaluation)
3. **[docs/TASKS_PERSON_B.md](TASKS_PERSON_B.md)**, your task list:
   - **section 0** (who owns what, the 11 contracts between us, working rules)
   - **week 1** in detail
   - skim the rest
4. **The PRD** (link from Person A). Read the sections for your features: Users, Agent platform (tools and approval levels), Feature 6 (journal), Feature 7 (call-in), Feature 8 (prescription), Safety, Evaluation, Voice pipeline (the Twilio trial notes).
5. **[ISSUES.md](../ISSUES.md)**: the known bugs. Yours on Day 1 are **#1, #2, #3**, plus **#8** and **#9**, which are in the same files.
6. **Papers,** when you reach those tasks:
   - **GrandGuard**, Appendix D1 (the safety policy you'll adapt in week 1)
   - **DischargeBench** (how to build simulated patients for testing, in week 2)
   - **CHI 2025 voice assistant study** (rules for how the agent talks, in weeks 2–3)

---

## 4. Set up your laptop (about 30 minutes)

**Needs:** Node.js 20 or newer (`node -v`), Git, and VS Code or any editor.

```bash
git pull                      # get the latest, including this docs/ folder
cd server && npm install
cd ../client && npm install
```

**Create `server/.env`:**
1. Copy `server/.env.example` to `server/.env`. It's gitignored, so it won't be committed.
2. Fill in the values Person A gives you.
3. **Use your own database name.** In `MONGO_URI`, change the database part to `medtime_dev_b`, as in `…mongodb.net/medtime_dev_b?…`. Then you never overwrite Person A's or the live data.
4. **Leave every `TWILIO_*` value and `NGROK_URL` empty.** The server then runs in **simulation mode**: calls and SMS are only printed in the terminal (`[SIMULATION] Voice Call → …`). Your laptop will never call a real phone.
5. `ENCRYPTION_KEY` must be 64 hex characters. Use the one Person A gives you, so data stays readable.

**Run it** in two terminals:

```bash
# Terminal 1
cd server && npm run dev        # → "Successfully connected to MongoDB Atlas", "Server is running on port 5000"

# Terminal 2
cd client && npm run dev        # → open http://localhost:5173
```

The client calls `http://localhost:5000/api/v1` by default, so it needs no `.env`.

**Create test users.** There's no sign-up page yet; building it is your task #12. Use the API instead, with the server running:

PowerShell (Windows):
```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:5000/api/v1/auth/register" -ContentType "application/json" -Body '{"name":"Test Patient","phone":"9000000001","password":"test1234","role":"patient"}'
Invoke-RestMethod -Method Post -Uri "http://localhost:5000/api/v1/auth/register" -ContentType "application/json" -Body '{"name":"Test Caregiver","phone":"9000000002","password":"test1234","role":"caregiver"}'
```

macOS or Linux:
```bash
curl -X POST http://localhost:5000/api/v1/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Test Patient","phone":"9000000001","password":"test1234","role":"patient"}'
```

Log in at http://localhost:5173 with phone `9000000001` and password `test1234`, then add a medicine. You should see the reminder job log it in Terminal 1.

**Things that look broken but aren't:**
- **The add-medicine form defaults to SMS.** Choose **Call** in the "Notification type" dropdown if you want the call job to pick it up.
- **Real calls only happen on Render,** after a change is merged to `main`, which Render deploys automatically. Locally everything is simulated.

---

## 5. How we work together

- **One feature, one owner.** You own your features end to end: model, routes, tools, prompts, UI, tests. Where we meet, there's a written **contract** (C1–C11 in section 0 of your task file). Change a contract only after talking to Person A.
- **Branches:** `feat/b-<topic>` off `main`. Small PRs, under about 400 lines. **Person A reviews every PR you open, and you review theirs.** Never merge your own.
- **Files you don't edit:** anything in Person A's column of the ownership table (section 0.1). If you need a change there, ask.
- **Secrets:** only in `server/.env` and Render. Never in code, commits, issues or chat.
- **Daily 15-minute sync:** what's merged, what's blocked, any contract changes.
- **Done means:** merged, the gate test in your task file passes, and the setup notes are updated if you added an env var.

### Twilio facts you should know (we're on a free trial)
- **Allowed:** real phone calls that our server drives turn by turn. That's how Person A's agent talks on the phone.
- **Not allowed until an upgrade:**
  - SMS other than Twilio's templates. So your journal and approval notifications show on the **dashboard**, not by SMS.
  - Live audio streaming over the phone.
  - Call recording.
- **Limits:** 5 verified phone numbers, 75 free minutes, and at most about **8 turns** per phone call with **4 seconds** to answer each. Your testing harness checks those limits.

---

## 6. Your first week at a glance

Full steps are in [TASKS_PERSON_B.md](TASKS_PERSON_B.md).

| Day | What | Gives Person A |
|---|---|---|
| Mon | #2 caregiver access (+#8), #3 monthly report (+#9), #1 medicine route ownership. **Monday's first hour:** agree the contracts with Person A | `requirePatientAccess` helper (C3) by Tuesday |
| Tue | #11 token refresh, #12 sign-up page | |
| Wed | Medicine fields for step-by-step guidance (`pillDescription`, `pillboxSlot`, `locationHint`) | C10 |
| Wed–Thu | Approval gate: `ProposedChange`, `propose_change`, `ask_caregiver`, approvals UI | C5, C6 |
| Thu–Fri | Safety screen and red-flag word lists (English, Hindi, Marathi); Agent Activity panel; seed script | C9, the panel |

---

## 7. Words you'll see a lot

| Term | Meaning |
|---|---|
| **Agent run** (`AgentRun`) | One job the AI does, such as a dose call or writing a journal. Every step is logged and shown in the Activity panel |
| **Tool** | A function the AI can call, such as `get_dose_history`, `propose_change` or `ask_caregiver` |
| **Flow** | The plan for one kind of run: `dose`, `callin` or `chat` |
| **Approval levels** | 0 = the agent acts alone; 1 = a caregiver approves; 2 = a doctor approves |
| **Phrase bank** | Pre-recorded lines in the family member's (cloned) voice. The agent only ever says approved lines |
| **Simulation mode** | The server with no Twilio values: calls and SMS are printed, not placed |
| **Browser mode** | Talking to the agent through the web app's microphone. Free, and every feature works there |
| **Gate** | The test that says a phase is done |

---

## 8. Repo map

```
client/                 React app (Vite, Redux, Tailwind)
  src/pages/            PatientDashboard, CaregiverDashBoard, Login, Vitals: you own these pages
  src/components/       shared UI; Person A's voice UI will live in components/voice/
server/
  routes/               Express routes; yours: medicine, caregiver, auth, report, ocr (+ new ones)
  models/               Mongoose models
  jobs/                 reminderJob (SMS), missedDoseCron (calls, Person A)
  utils/                twilioClient (Person A), monthlyReportCron (yours), emailClient, encryptionUtil
docs/                   plan, task files, this file
ISSUES.md               known bugs with numbers (#1 … #20)
```

Questions about the plan, a contract or an ownership boundary go to Person A. When in doubt, the PRD wins.
