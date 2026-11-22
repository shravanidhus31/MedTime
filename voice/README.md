# Voice server (browser voice call, A3.1–A3.2)

The agent's ears and mouth for a spoken dose call in the browser. The agent itself runs in the
Express API; this server turns the patient's voice into text and the agent's lines into speech.

```
browser mic ─WebRTC─▶ Silero VAD ─▶ Whisper (speech to text) ─▶ POST /api/v1/agent/turn ─▶ dose flow
browser speaker ◀─WebRTC─ neutral voice (Kokoro, pre-rendered and cached) ◀─ the agent's lines
```

Runs on the laptop next to the browser (plan section 5.2). The Express API can be local or on Render.

## One-time setup (Windows)
1. Python 3.11–3.14. In this folder:
   ```
   python -m venv .venv
   .venv\Scripts\python -m pip install -r requirements.txt
   ```
2. **Smart App Control must be off.** It blocks some of the packages' unsigned files at random
   ("An Application Control policy has blocked this file"). See `docs/PROGRESS_LOG.md`, 22 Nov.
3. The first start downloads the speech models (Whisper base ~150 MB, Kokoro ~340 MB) into your
   user cache folder.

## Run a voice call
Three terminals:
```
cd server && npm run dev                      # the API on http://localhost:5000
cd voice  && .venv\Scripts\python -I bot.py   # this server on http://localhost:7860
cd client && npm run dev                      # the web app on http://localhost:5173
```
Log in as a patient or a caregiver and open **http://localhost:5173/call**. Pick the medicine and
wait for "Voice ready" (the first time for a patient takes about 2 minutes while the lines are
rendered; after that it's instant), then **Start call** and talk. You can interrupt the agent.

A voice call records **real** doses for that patient, like the text simulator. On Render
(production) simulated calls are off unless `SIMULATE_ENABLED=true`.

## Settings (environment variables, all optional)
| Variable | Default | |
|---|---|---|
| `AGENT_API_BASE` | `http://localhost:5000/api/v1` | the Express API (use the Render URL + `/api/v1` to talk to Render) |
| `VOICE_PORT` | `7860` | |
| `WHISPER_MODEL` | `base` | `small` is a little more accurate and about twice as slow on this laptop |
| `KOKORO_VOICE` | `af_heart` | the neutral voice |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | the web app's address |

The web app finds this server through `VITE_VOICE_URL` (default `http://localhost:7860`).

## Check it end to end
`cd server && npm run voice:check` starts the API and this server, and a scripted patient
(`check_client.py`) talks to the agent over WebRTC: greeting, three turns, a recorded dose, and a
barge-in. Uses your dev database and deletes its test data.

## Measured on this laptop (Core Ultra 5 225H, 22 Nov 2026)
- Greeting: 0.4 s after connecting (from the cache).
- Reply: 2.2–3.2 s from the end of her speech to the agent's voice (Whisper base ~1 s, agent ~1 s).
- Barge-in: the agent stops 0.6 s after she starts speaking.
- Whisper only transcribes after she stops speaking (no partial transcripts), so the emergency
  check runs on each finished sentence.
