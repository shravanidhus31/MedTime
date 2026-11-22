"""MedTime voice server: the browser voice call (A3.1).

The patient's (or tester's) browser talks to this server over WebRTC. The agent itself runs in
the Express API; this server is only its ears and mouth (plan section 7):

    microphone → Silero VAD → Whisper (speech to text) → AgentBridge → Kokoro (neutral voice) → speaker
                                                              │
                                              POST /api/v1/agent/turn (contract C8)

- The browser first starts a dose call on the Express API (POST /simulate/call, channel "voice")
  and gets a call id. It then connects here (POST /api/offer) with that call id in requestData.
- Each finished sentence goes to /agent/turn. The reply's lines are spoken; the browser gets a
  live transcript through RTVI server messages.
- Barge-in: when the patient starts speaking, the agent stops talking at once.
- Whisper only transcribes after she stops speaking (no partial transcripts), so the emergency
  check in the API runs on each finished sentence.
- Until the family-voice phrase bank exists (A5), every line is spoken in the neutral voice.
- No speech is generated during a call where it can be avoided (plan section 7). Before the call,
  the page sends the call's lines to POST /api/prepare; each is rendered once with Kokoro and
  cached on disk; during the call they play from the cache. Found in the A3.1 check: Kokoro inside
  the live pipeline took 3-5x longer than on its own, Whisper with its default beam search took
  5 s per sentence, and rendering lines DURING a call held up Whisper by up to 30 s.

Run:  .venv\\Scripts\\python -I bot.py      (see README.md)
Settings (environment variables, all optional):
  AGENT_API_BASE   Express API base URL          default http://localhost:5000/api/v1
  VOICE_PORT       port of this server           default 7860
  WHISPER_MODEL    tiny | base | small | medium  default base
  KOKORO_VOICE     neutral voice                 default af_heart
  ALLOWED_ORIGINS  browser origins, comma-separated  default http://localhost:5173
"""

import asyncio
import functools
import hashlib
import os
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import aiohttp
import numpy as np
import uvicorn
from fastapi import BackgroundTasks, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    Frame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame
from pipecat.services.kokoro.tts import KokoroTTSService  # only used to fetch the model files
from pipecat.services.whisper.stt import WhisperSTTService
from pipecat.transcriptions.language import Language
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.workers.runner import WorkerRunner

AGENT_API_BASE = os.getenv("AGENT_API_BASE", "http://localhost:5000/api/v1").rstrip("/")
VOICE_PORT = int(os.getenv("VOICE_PORT", "7860"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")  # base + hint words: 2-2.5 s turns; small: 4-6 s (A3.1 check)
KOKORO_VOICE = os.getenv("KOKORO_VOICE", "af_heart")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

CACHE_DIR = Path(__file__).parent / ".cache" / "neutral"   # rendered lines (gitignored)
TURN_TIMEOUT_S = 10          # the API answers within its 4 s budget; this is a safety net
WAIT_RETRY_S = 1.2           # after a "wait" action, ask again for the answer
FALLBACK_LINE = "Sorry, I'm having trouble on this call. Someone from your family will call you soon. Goodbye."


# -- Whisper: one model for every call, greedy decoding --------------------------

_whisper_models: dict = {}
_whisper_lock = threading.Lock()


class FastWhisperSTT(WhisperSTTService):
    """WhisperSTTService with one shared model and beam size 1 (Pipecat uses the default, 5)."""

    def _load(self):
        key = (str(self._settings.model), self._device, self._compute_type)
        with _whisper_lock:
            if key not in _whisper_models:
                super()._load()
                model = self._model
                model.transcribe = functools.partial(model.transcribe, beam_size=1, condition_on_previous_text=False)
                _whisper_models[key] = model
            self._model = _whisper_models[key]


# -- the neutral voice: render once, cache on disk, play from the cache ----------

class NeutralVoice:
    """Kokoro, outside the live pipeline: 24 kHz 16-bit mono PCM per line of text."""

    SAMPLE_RATE = 24000

    def __init__(self, voice: str):
        self.voice = voice
        self._kokoro = None
        self._lock = threading.Lock()      # Kokoro renders one line at a time
        self._memory: dict[str, bytes] = {}
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def _load(self):
        if self._kokoro is None:
            import kokoro_onnx
            KokoroTTSService(settings=KokoroTTSService.Settings(voice=self.voice))  # downloads the model files once
            cache = Path.home() / ".cache" / "pipecat" / "kokoro-onnx"
            self._kokoro = kokoro_onnx.Kokoro(str(cache / "kokoro-v1.0.onnx"), str(cache / "voices-v1.0.bin"))

    def _path(self, text: str) -> Path:
        return CACHE_DIR / (hashlib.sha1(f"{self.voice}|{text}".encode()).hexdigest() + ".pcm")

    def cached(self, text: str) -> bytes | None:
        if text in self._memory:
            return self._memory[text]
        p = self._path(text)
        if p.exists():
            self._memory[text] = p.read_bytes()
            return self._memory[text]
        return None

    def render(self, text: str) -> bytes:
        """Blocking: the line's audio, from the cache or rendered now (call it in a thread)."""
        hit = self.cached(text)
        if hit is not None:
            return hit
        with self._lock:
            hit = self.cached(text)
            if hit is not None:
                return hit
            self._load()
            t0 = time.monotonic()
            audio, sr = self._kokoro.create(text, voice=self.voice, speed=1.0, lang="en-us")
            if sr != self.SAMPLE_RATE:
                n = int(len(audio) * self.SAMPLE_RATE / sr)
                audio = np.interp(np.linspace(0, len(audio), n, endpoint=False), np.arange(len(audio)), audio)
            pcm = (np.clip(audio, -1, 1) * 32000).astype(np.int16).tobytes()
            self._path(text).write_bytes(pcm)
            self._memory[text] = pcm
            logger.debug(f"rendered in {time.monotonic() - t0:.2f}s: {text[:60]}")
            return pcm

    def warm(self, texts: list[str]):
        """Blocking: renders every line not yet cached (run it in a background thread)."""
        for t in texts:
            if t and self.cached(t) is None:
                self.render(t)


neutral_voice = NeutralVoice(KOKORO_VOICE)


class AgentBridge(FrameProcessor):
    """Sends each finished sentence to the agent (POST /agent/turn) and speaks its reply."""

    def __init__(self, *, call_id: str, http: aiohttp.ClientSession, **kwargs):
        super().__init__(**kwargs)
        self._call_id = call_id
        self._http = http
        self._lock = asyncio.Lock()   # one agent turn at a time, in order
        self._ended = False
        # Timing for the weekly chat call's speech rate and time before answering (Feature 1, plan
        # 6.5): when the agent's audio ends, when she starts speaking, how long she speaks.
        self._speak_until = 0.0       # monotonic time the queued agent audio finishes playing
        self._latency_ms = None       # this answer's time before answering (None after a barge-in)
        self._seg_start = None
        self._speech_s = 0.0
        self._answer_started = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, VADUserStartedSpeakingFrame):
            now = time.monotonic()
            if not self._answer_started:
                self._answer_started = True
                # she spoke over the agent: no "time before answering" for this answer
                self._latency_ms = round((now - self._speak_until) * 1000) if self._speak_until and now >= self._speak_until else None
            self._seg_start = now
            self._speak_until = min(self._speak_until, now)
            # Barge-in: she started speaking, so the agent stops talking at once.
            await self.broadcast_interruption()
            await self.push_frame(frame, direction)
        elif isinstance(frame, VADUserStoppedSpeakingFrame):
            if self._seg_start is not None:
                self._speech_s += time.monotonic() - self._seg_start
                self._seg_start = None
            await self.push_frame(frame, direction)
        elif isinstance(frame, TranscriptionFrame):
            # Not passed on: her words go to the agent, not to the speaker.
            text = (frame.text or "").strip()
            if text and not self._ended:
                timing = {"speechMs": round(self._speech_s * 1000)}
                if self._latency_ms is not None:
                    timing["latencyMs"] = self._latency_ms
                self._latency_ms, self._speech_s, self._answer_started = None, 0.0, False
                self.create_task(self._turn(text, timing), name="agent-turn")
        else:
            await self.push_frame(frame, direction)

    async def _message(self, data: dict):
        await self.push_frame(RTVIServerMessageFrame(data=data))

    async def _post_turn(self, transcript: str, timing: dict | None = None) -> dict:
        # No flow name: the session knows its flow, and a call-in can switch to the dose flow mid-call.
        body = {"sessionId": self._call_id, "transcript": transcript, "isFinal": True}
        if timing:
            body["timing"] = timing
        async with self._http.post(f"{AGENT_API_BASE}/agent/turn", json=body, timeout=aiohttp.ClientTimeout(total=TURN_TIMEOUT_S)) as r:
            data = await r.json(content_type=None)
            if r.status != 200:
                raise RuntimeError(f"/agent/turn {r.status}: {data.get('message') if isinstance(data, dict) else data}")
            return data

    async def _turn(self, text: str, timing: dict | None = None):
        async with self._lock:
            if self._ended:
                return
            await self._message({"type": "patient", "text": text})
            t0 = time.monotonic()
            try:
                reply = await self._post_turn(text, timing)
                # "wait": the agent is still working; collect its answer with empty turns.
                while not self._ended and any(a.get("type") == "wait" for a in reply.get("actions", [])):
                    await self.speak_actions([a for a in reply["actions"] if a.get("type") != "wait"])
                    await asyncio.sleep(WAIT_RETRY_S)
                    reply = await self._post_turn("")
                logger.info(f"agent turn in {time.monotonic() - t0:.2f}s: {[a.get('lineId') or a.get('type') for a in reply.get('actions', [])]}")
                if reply.get("emergency"):
                    await self._message({"type": "emergency", "category": reply["emergency"]})
                await self.speak_actions(reply.get("actions", []))
            except Exception as err:  # the API is down or the call has ended: say so, end the call
                logger.error(f"agent turn failed: {err}")
                await self.speak_actions([{"type": "neutral", "text": FALLBACK_LINE}, {"type": "hangup"}])

    async def _say(self, text: str):
        """Plays one line in the neutral voice, from the cache (rendered now if it isn't cached)."""
        pcm = neutral_voice.cached(text)
        if pcm is None:
            pcm = await asyncio.to_thread(neutral_voice.render, text)
        ctx = str(uuid.uuid4())
        # when this line will have finished playing (16-bit mono): her "time before answering" starts then
        self._speak_until = max(self._speak_until, time.monotonic()) + len(pcm) / (NeutralVoice.SAMPLE_RATE * 2)
        await self.push_frame(TTSStartedFrame(context_id=ctx))
        step = NeutralVoice.SAMPLE_RATE // 5 * 2  # 200 ms chunks; barge-in flushes what is queued
        for i in range(0, len(pcm), step):
            await self.push_frame(TTSAudioRawFrame(audio=pcm[i:i + step], sample_rate=NeutralVoice.SAMPLE_RATE, num_channels=1, context_id=ctx))
        await self.push_frame(TTSStoppedFrame(context_id=ctx))

    async def speak_actions(self, actions: list):
        """Speaks an agent reply (contract C8 actions) and mirrors it to the browser."""
        for a in actions:
            kind = a.get("type")
            if kind in ("play", "neutral") and a.get("text"):
                # 'play' is a phrase-bank line: family voice from A5 on; neutral voice until then.
                await self._message({"type": "agent", "text": a["text"], "lineId": a.get("lineId"), "voice": "neutral"})
                await self._say(a["text"])
            elif kind == "fallback":
                await self._message({"type": "agent", "text": FALLBACK_LINE, "voice": "neutral"})
                await self._say(FALLBACK_LINE)
                kind = "hangup"
            if kind == "hangup" and not self._ended:
                self._ended = True
                await self._message({"type": "ended"})  # the browser hangs up once the agent stops talking


async def run_call(connection: SmallWebRTCConnection, request_data: dict):
    """One browser call: builds the pipeline for it and runs it until the browser hangs up."""
    call_id = str(request_data.get("callId") or "")
    opening = request_data.get("actions") or []      # the agent's opening turn, from POST /simulate/call
    hints = [str(h) for h in (request_data.get("hints") or [])][:5]
    lines = [str(t) for t in (request_data.get("lines") or [])][:80]   # every line the call can say
    logger.info(f"call {call_id}: starting (Whisper {WHISPER_MODEL}, hints {hints})")

    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )
    stt = FastWhisperSTT(
        device="cpu",
        compute_type="int8",
        settings=WhisperSTTService.Settings(
            model=WHISPER_MODEL,
            language=Language.EN,
            # Medicine and patient names: Whisper misheard "Amlodipine" without them (A3.1 test).
            hotwords=" ".join(hints) or None,
            initial_prompt=(", ".join(hints) + ".") if hints else None,
        ),
    )
    # The opening line must be ready before she hears anything. The rest should already be cached
    # (POST /api/prepare before the call); anything missing is rendered when it is first said.
    opening_texts = [a["text"] for a in opening if a.get("text")]
    await asyncio.to_thread(neutral_voice.warm, opening_texts)
    missing = [t for t in lines if neutral_voice.cached(t) is None]
    if missing:
        logger.warning(f"call {call_id}: {len(missing)} of {len(lines)} lines not prepared; they will be rendered when first said")

    async with aiohttp.ClientSession() as http:
        bridge = AgentBridge(call_id=call_id, http=http)
        pipeline = Pipeline([
            transport.input(),
            VADProcessor(vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.6))),
            stt,
            bridge,
            transport.output(),
        ])
        worker = PipelineWorker(pipeline, idle_timeout_secs=300)

        @transport.event_handler("on_client_connected")
        async def on_connected(_transport, _client):
            logger.info(f"call {call_id}: browser connected")
            await bridge.speak_actions(opening)

        @transport.event_handler("on_client_disconnected")
        async def on_disconnected(_transport, _client):
            logger.info(f"call {call_id}: browser disconnected")
            await worker.cancel()

        await WorkerRunner(handle_sigint=False).run(worker)
    logger.info(f"call {call_id}: ended")


webrtc = SmallWebRTCRequestHandler()


def preload():
    """Loads Whisper and Kokoro once at start-up, so the first call doesn't wait for them."""
    t0 = time.monotonic()
    FastWhisperSTT(device="cpu", compute_type="int8", settings=FastWhisperSTT.Settings(model=WHISPER_MODEL, language=Language.EN))
    neutral_voice.render(FALLBACK_LINE)
    logger.info(f"models ready in {time.monotonic() - t0:.1f}s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await asyncio.to_thread(preload)
    yield
    await webrtc.close()


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    return {"ok": True, "agentApi": AGENT_API_BASE, "whisper": WHISPER_MODEL, "voice": KOKORO_VOICE}


_preparing = asyncio.Lock()


@app.post("/api/prepare")
async def prepare(body: dict):
    """Renders a call's lines before the call (the page calls this when a medicine is picked, and
    again to see progress). Returns { total, cached, preparing }."""
    lines = [str(t) for t in (body.get("lines") or []) if t][:80]
    lines.append(FALLBACK_LINE)
    missing = [t for t in lines if neutral_voice.cached(t) is None]
    if missing and not _preparing.locked():
        async def work():
            async with _preparing:
                await asyncio.to_thread(neutral_voice.warm, missing)
        asyncio.create_task(work())
    return {"total": len(lines), "cached": len(lines) - len(missing), "preparing": bool(missing)}


@app.post("/api/offer")
async def offer(request: Request, background_tasks: BackgroundTasks):
    """The browser's WebRTC offer. requestData: { callId, actions, hints } from POST /simulate/call."""
    body = await request.json()
    req = SmallWebRTCRequest.from_dict(body)
    request_data = req.request_data if isinstance(req.request_data, dict) else {}

    async def on_connection(connection: SmallWebRTCConnection):
        background_tasks.add_task(run_call, connection, request_data)

    return await webrtc.handle_web_request(request=req, webrtc_connection_callback=on_connection)


@app.patch("/api/offer")
async def ice_candidate(request: SmallWebRTCPatchRequest):
    """Trickled ICE candidates (FastAPI parses the nested candidates, as Pipecat's own runner does)."""
    await webrtc.handle_patch_request(request)
    return {"status": "success"}


if __name__ == "__main__":
    logger.info(f"MedTime voice server on http://localhost:{VOICE_PORT} (agent API {AGENT_API_BASE})")
    uvicorn.run(app, host="127.0.0.1", port=VOICE_PORT)
