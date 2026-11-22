"""A scripted patient for the voice call check (A3.1). Used by server/scripts/voice-check.js.

Connects to the voice server over WebRTC like a browser, waits for the agent to finish speaking,
then says the next line (synthesised with a different Kokoro voice), and so on. Prints one JSON
line per event, so the Node script can check timings:
  {"event": "agent_audio", "start": s, "end": s}   the agent spoke (seconds since connect)
  {"event": "said", "text": ..., "start": s, "end": s}
  {"event": "done", ...}

Usage: python -I check_client.py <voice_url> <request_data_json> <line> [<line> ...]
"""

import asyncio
import fractions
import json
import os
import sys
import time
from pathlib import Path

import aiohttp
import numpy as np
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription
from av import AudioFrame

RATE = 48000
FRAME = 960  # 20 ms
SILENCE_AFTER_AGENT_S = 1.2   # the agent has finished its turn after this much quiet
MAX_WAIT_S = 45


def emit(**kw):
    print(json.dumps(kw), flush=True)


class SpeakerTrack(MediaStreamTrack):
    """Outgoing microphone: silence, or the queued patient speech."""

    kind = "audio"

    def __init__(self):
        super().__init__()
        self._queue = np.zeros(0, dtype=np.int16)
        self._pts = 0
        self._t0 = None

    def say(self, pcm: np.ndarray):
        self._queue = np.concatenate([self._queue, pcm])

    @property
    def speaking(self):
        return len(self._queue) > 0

    async def recv(self):
        if self._t0 is None:
            self._t0 = time.monotonic()
        # pace frames in real time
        target = self._t0 + self._pts / RATE
        delay = target - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)
        chunk = self._queue[:FRAME]
        self._queue = self._queue[FRAME:]
        if len(chunk) < FRAME:
            chunk = np.concatenate([chunk, np.zeros(FRAME - len(chunk), dtype=np.int16)])
        frame = AudioFrame.from_ndarray(chunk.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = RATE
        frame.pts = self._pts
        frame.time_base = fractions.Fraction(1, RATE)
        self._pts += FRAME
        return frame


def synth(lines):
    """Patient lines as 48 kHz int16 PCM, in a different voice from the agent's."""
    import kokoro_onnx
    cache = Path.home() / ".cache" / "pipecat" / "kokoro-onnx"
    k = kokoro_onnx.Kokoro(str(cache / "kokoro-v1.0.onnx"), str(cache / "voices-v1.0.bin"))
    out = []
    for text in lines:
        audio, sr = k.create(text, voice="bf_emma", speed=0.95, lang="en-gb")
        n = int(len(audio) * RATE / sr)
        up = np.interp(np.linspace(0, len(audio), n, endpoint=False), np.arange(len(audio)), audio)
        out.append((np.clip(up, -1, 1) * 30000).astype(np.int16))
    return out


async def main(voice_url, request_data, lines):
    speech = synth(lines)
    pc = RTCPeerConnection()
    mic = SpeakerTrack()
    pc.addTrack(mic)
    pc.createDataChannel("chat")  # like the browser client (RTVI messages)
    t0 = time.monotonic()
    state = {"agent_on": False, "agent_start": 0.0, "last_loud": 0.0, "agent_turns": 0}

    @pc.on("track")
    def on_track(track):
        async def listen():
            while True:
                try:
                    frame = await track.recv()
                except Exception:
                    return
                pcm = frame.to_ndarray().astype(np.float32)
                loud = np.sqrt(np.mean(pcm * pcm)) > 300
                now = time.monotonic() - t0
                if loud:
                    if not state["agent_on"]:
                        state.update(agent_on=True, agent_start=now)
                    state["last_loud"] = now
                elif state["agent_on"] and now - state["last_loud"] > SILENCE_AFTER_AGENT_S:
                    state["agent_on"] = False
                    state["agent_turns"] += 1
                    emit(event="agent_audio", start=round(state["agent_start"], 2), end=round(state["last_loud"], 2))
        asyncio.ensure_future(listen())

    await pc.setLocalDescription(await pc.createOffer())
    async with aiohttp.ClientSession() as http:
        body = {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type, "requestData": request_data}
        async with http.post(f"{voice_url}/api/offer", json=body) as r:
            answer = await r.json()
    await pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))

    async def wait_agent_turn(n):
        start = time.monotonic()
        while state["agent_turns"] < n and time.monotonic() - start < MAX_WAIT_S:
            await asyncio.sleep(0.1)
        return state["agent_turns"] >= n

    barge_after = float(os.environ.get("BARGE_AFTER_S", "0"))
    if barge_after:
        # Barge-in: start speaking while the agent is still greeting her.
        start = time.monotonic()
        while not state["agent_on"] and time.monotonic() - start < MAX_WAIT_S:
            await asyncio.sleep(0.05)
        await asyncio.sleep(barge_after)
        ok = True
    else:
        ok = await wait_agent_turn(1)  # the greeting
    for i, (text, pcm) in enumerate(zip(lines, speech)):
        if not ok:
            break
        start = time.monotonic() - t0
        mic.say(pcm)
        while mic.speaking:
            await asyncio.sleep(0.05)
        emit(event="said", text=text, start=round(start, 2), end=round(time.monotonic() - t0, 2))
        ok = await wait_agent_turn(i + 2)
    emit(event="done", agent_turns=state["agent_turns"], completed=ok)
    await asyncio.sleep(1)
    await pc.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], json.loads(sys.argv[2]), sys.argv[3:]))
