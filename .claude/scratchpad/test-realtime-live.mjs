// End-to-end probe for the one-session realtime translation route.
// Builds a Chinese utterance with qwen-audio TTS, resamples 24kHz -> 16kHz,
// pumps it into /v1/qwen/live?direction=zh-to-vi, and reports what comes back.
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import dotenv from "dotenv";

dotenv.config({ path: "C:/Users/ADMIN/workspace/translate/apps/backend/.env" });

const BASE = process.env.QWEN_BASE_URL;
const KEY = process.env.DASHSCOPE_API_KEY;
const BACKEND = "ws://127.0.0.1:8787/v1/qwen/live?direction=zh-to-vi";

const ttsUrl = (() => {
  const u = new URL(BASE);
  u.protocol = "wss:";
  if (u.pathname.includes("/compatible-mode/")) u.pathname = "/api-ws/v1/inference";
  u.search = ""; u.hash = "";
  return u.toString();
})();

function tts(text, voice, languageHints) {
  return new Promise((resolve, reject) => {
    const taskId = randomUUID().replaceAll("-", "");
    const socket = new WebSocket(ttsUrl, { headers: { Authorization: `Bearer ${KEY}` } });
    const pcm = [];
    let textSent = false;
    const timer = setTimeout(() => { socket.close(); reject(new Error("tts timeout")); }, 30000);
    socket.on("open", () => {
      socket.send(JSON.stringify({
        header: { action: "run-task", task_id: taskId, streaming: "duplex" },
        payload: {
          task_group: "audio", task: "tts", function: "SpeechSynthesizer",
          model: "qwen-audio-3.0-tts-plus",
          parameters: { text_type: "PlainText", voice, format: "pcm", sample_rate: 24000, volume: 50, rate: 1, pitch: 1, enable_ssml: false, ...(languageHints ? { language_hints: languageHints } : {}) },
          input: {},
        },
      }));
    });
    socket.on("message", (raw, isBinary) => {
      if (isBinary) { if (raw.length) pcm.push(Buffer.from(raw)); return; }
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.header?.event === "task-started" && !textSent) {
        textSent = true;
        socket.send(JSON.stringify({ header: { action: "continue-task", task_id: taskId, streaming: "duplex" }, payload: { input: { text } } }));
        socket.send(JSON.stringify({ header: { action: "finish-task", task_id: taskId, streaming: "duplex" }, payload: { input: {} } }));
      } else if (m.header?.event === "task-finished") {
        clearTimeout(timer); socket.close(); resolve(Buffer.concat(pcm));
      } else if (m.header?.event === "task-failed") {
        clearTimeout(timer); socket.close(); reject(new Error(m.header.error_message || m.header.error_code || "tts failed"));
      }
    });
    socket.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// 24kHz -> 16kHz mono PCM16 linear interpolation.
function resample24to16(pcm) {
  const ratio = 24000 / 16000;
  const outSamples = Math.floor(pcm.length / 2 / ratio);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src); const i1 = Math.min(i0 + 1, (pcm.length / 2) - 1);
    const frac = src - i0;
    const s0 = pcm.readInt16LE(i0 * 2); const s1 = pcm.readInt16LE(i1 * 2);
    const v = Math.round(s0 + (s1 - s0) * frac);
    out.writeInt16LE(v, i * 2);
  }
  return out;
}

function wav(pcm, rate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  header.writeUInt32LE(36 + pcm.length, 4);
  return Buffer.concat([header, pcm]);
}

async function run(text) {
  console.log(`\n--- nói (zh): ${text}`);
  const t0 = Date.now();
  const ttsPcm = await tts(text, "longanlingxin", ["zh"]);
  console.log(`  tts: ${ttsPcm.length} bytes 24kHz`);
  const pcm = resample24to16(ttsPcm);
  console.log(`  resampled: ${pcm.length} bytes 16kHz (~${(pcm.length / 2 / 16000).toFixed(2)}s)`);

  const socket = new WebSocket(BACKEND);
  const audio = [];
  const asr = [], trans = [], segments = [];
  let firstAudioAt = 0, finishedAt = 0, startedAt = 0, segStart = 0;
  let opened = false, setup = false;
  const FRAME = 3200; // 100ms @ 16kHz mono16

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("live timeout")); }, 40000);
    socket.on("open", () => {
      opened = true;
      socket.send(JSON.stringify({ type: "session.update" }));
      // stream audio in 100ms frames; the route will segment it
      let off = 0;
      const pump = () => {
        if (off >= pcm.length) {
          socket.send(JSON.stringify({ type: "session.finish" }));
          return;
        }
        const chunk = pcm.subarray(off, off + FRAME);
        off += FRAME;
        socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk.toString("base64") }));
        setTimeout(pump, 90); // slightly faster than realtime to fill the pipe
      };
      pump();
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      switch (m.type) {
        case "session.created": startedAt = Date.now(); break;
        case "session.updated": setup = true; break;
        case "conversation.item.input_audio_transcription.completed":
          asr.push(m.transcript); break;
        case "response.audio_transcript.done":
          trans.push(m.transcript); break;
        case "response.audio.delta":
          if (!firstAudioAt) firstAudioAt = Date.now();
          audio.push(Buffer.from(m.delta, "base64"));
          break;
        case "response.segment.done":
          segments.push({ asr: asr[asr.length - 1] || "", trans: trans[trans.length - 1] || "" });
          break;
        case "session.finished":
          finishedAt = Date.now();
          clearTimeout(timer); socket.close();
          resolve({ asr, trans, segments, audio: Buffer.concat(audio), firstAudioAt, finishedAt, startedAt });
          break;
        case "error":
          clearTimeout(timer); socket.close();
          reject(new Error(`error: ${m.error?.message || JSON.stringify(m)}`));
          break;
      }
    });
    socket.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

(async () => {
  for (const text of ["这个多少钱？两百五十块。", "我的房间是一五零八号。"]) {
    try {
      const r = await run(text);
      console.log(`  đoạn: ${r.segments.length}`);
      r.segments.forEach((s, i) => console.log(`    [${i + 1}] zh: ${s.asr} -> vi: ${s.trans}`));
      console.log(`  giọng nói: ${((r.finishedAt - r.startedAt) / 1000).toFixed(2)}s / ${r.audio.length} bytes (~${(r.audio.length / 2 / 16000).toFixed(2)}s)`);
      if (r.firstAudioAt) console.log(`  first-audio: ${((r.firstAudioAt - r.startedAt) / 1000).toFixed(2)}s kể từ session.created`);
      const idx = Math.random().toString(36).slice(2, 8);
      const out = `C:/Users/ADMIN/workspace/translate/.claude/scratchpad/out-${idx}.wav`;
      writeFileSync(out, wav(r.audio, 16000));
      console.log(`  wav: ${out}`);
    } catch (e) {
      console.log(`  LỖI: ${e.message}`);
    }
  }
})();