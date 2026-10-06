const audioCache = new Map(); // cacheKey -> ArrayBuffer
let audioCtx = null;
let activeSource = null;

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

export function releaseAudio() {
  // Stop any playing source
  if (activeSource) {
    try { activeSource.stop(); } catch (e) {}
    activeSource = null;
  }
  window.speechSynthesis?.cancel();
  // Close audio context to release iOS audio session (fire-and-forget)
  if (audioCtx && audioCtx.state !== "closed") {
    const ctx = audioCtx;
    audioCtx = null;
    ctx.close().catch(() => {});
  }
}

export async function speak(text, lang = "es") {
  const clean = text.replace(/[¿¡…()]/g, "").trim();
  if (!clean) return;

  // Stop any currently playing audio
  if (activeSource) {
    try { activeSource.stop(); } catch (e) {}
    activeSource = null;
  }
  window.speechSynthesis?.cancel();

  const cacheKey = `${lang}:${clean}`;

  if (audioCache.has(cacheKey)) {
    return playBuffer(audioCache.get(cacheKey));
  }

  try {
    const res = await fetch("/.netlify/functions/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, lang }),
    });

    if (!res.ok) {
      fallbackSpeak(clean, lang);
      return;
    }

    const arrayBuffer = await res.arrayBuffer();
    audioCache.set(cacheKey, arrayBuffer);
    return playBuffer(arrayBuffer);
  } catch (err) {
    fallbackSpeak(clean, lang);
  }
}

async function playBuffer(arrayBuffer) {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.connect(ctx.destination);
    activeSource = source;
    return new Promise((resolve) => {
      source.onended = () => { activeSource = null; resolve(); };
      source.start(0);
    });
  } catch (err) {
    activeSource = null;
  }
}

const FALLBACK_LANGS = {
  es: { lang: "es-MX", prefix: "es", rate: 0.82 },
  jp: { lang: "ja-JP", prefix: "ja", rate: 0.85 },
};

function fallbackSpeak(text, lang = "es") {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const cfg = FALLBACK_LANGS[lang] || FALLBACK_LANGS.es;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = cfg.lang;
  u.rate = cfg.rate;
  const voices = window.speechSynthesis.getVoices();
  const v = voices.find((v) => v.lang === cfg.lang) || voices.find((v) => v.lang.startsWith(cfg.prefix));
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}
