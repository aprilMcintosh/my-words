import { useState, useEffect, useRef, useCallback } from "react";
import { WORDS, CAT_ICONS, ALL_WORDS_FLAT, TOTAL } from "../data/words";
import { WORDS_JP, CAT_ICONS_JP, ALL_WORDS_FLAT_JP, TOTAL_JP } from "../data/japanese";
import { speak, releaseAudio } from "../lib/tts";
import { useAuth } from "../hooks/useAuth";
import { useProgress } from "../hooks/useProgress";
import AuthButton from "./AuthButton";

const LANGS = {
  es: {
    words: WORDS, icons: CAT_ICONS, allFlat: ALL_WORDS_FLAT, total: TOTAL,
    flag: "\u{1F1F2}\u{1F1FD}", name: "Spanish", native: "espa\u00f1ol",
    speechLang: "es-MX", dirCode: "es",
    dirLabels: ["ES \u2192 EN", "EN \u2192 ES"],
    quizQ: ["\u00bfQu\u00e9 significa?", "\u00bfC\u00f3mo se dice?"],
    speakPrompt: "Say this in Spanish",
    done: ["\u00a1Incre\u00edble!", "\u00a1Buen trabajo!", "\u00a1Sigue practicando!"],
    dirProfile: ["ES\u2192EN", "EN\u2192ES"],
  },
  jp: {
    words: WORDS_JP, icons: CAT_ICONS_JP, allFlat: ALL_WORDS_FLAT_JP, total: TOTAL_JP,
    flag: "\u{1F1EF}\u{1F1F5}", name: "Japanese", native: "\u65E5\u672C\u8A9E",
    speechLang: "ja-JP", dirCode: "jp",
    dirLabels: ["JP \u2192 EN", "EN \u2192 JP"],
    quizQ: ["\u4F55\u3068\u3044\u3046\u610F\u5473\uFF1F", "\u65E5\u672C\u8A9E\u3067\u4F55\u3068\u8A00\u3046\uFF1F"],
    speakPrompt: "Say this in Japanese",
    done: ["\u3059\u3054\u3044\uFF01", "\u3088\u304F\u3067\u304D\u307E\u3057\u305F\uFF01", "\u3082\u3063\u3068\u7DF4\u7FD2\u3057\u3088\u3046\uFF01"],
    dirProfile: ["JP\u2192EN", "EN\u2192JP"],
  },
};

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿¡…()\/]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const m = na.length, n = nb.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = na[i-1] === nb[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return 1 - dp[m][n] / Math.max(m, n);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function App() {
  const { user, signIn, signUp, signOut } = useAuth();
  const { mastered, stats, toggleStar, saveQuizScore } = useProgress(user);

  const [lang, setLang] = useState(null); // null = language picker, "es" or "jp"
  const [view, setView] = useState("home");
  const [catKey, setCatKey] = useState(null);
  const [catLabel, setCatLabel] = useState("");
  const [deck, setDeck] = useState([]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [mode, setMode] = useState("flash");
  const [dir, setDir] = useState("target"); // "target" = target lang shown, "en" = english shown
  const [opts, setOpts] = useState([]);
  const [pick, setPick] = useState(null);
  const [score, setScore] = useState({ hit: 0, miss: 0 });
  const [streak, setStreak] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [spResult, setSpResult] = useState(null);
  const touchRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => { window.speechSynthesis?.getVoices(); }, []);

  const L = lang ? LANGS[lang] : null;
  const WORDS_CUR = L?.words || {};
  const CAT_ICONS_CUR = L?.icons || {};
  const ALL_FLAT = L?.allFlat || [];
  const TOTAL_CUR = L?.total || 0;

  const cardRef = useRef(null);
  cardRef.current = deck[i] || null;

  const langRef = useRef(lang);
  langRef.current = lang;

  const gotResultRef = useRef(false);
  const retryCountRef = useRef(0);

  const launchRecognition = useCallback((isRetry = false) => {
    const currentCard = cardRef.current;
    const currentLang = langRef.current;
    if (!currentCard || !currentLang) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpResult({ heard: "", score: 0, correct: currentCard[0], error: "Speech recognition not supported in this browser. Try Chrome on Android or desktop." });
      return;
    }

    if (!isRetry) retryCountRef.current = 0;
    gotResultRef.current = false;
    let bestInterimScore = 0;
    let bestInterimHeard = "";
    let startTime = Date.now();
    let hadError = false;

    const recognition = new SpeechRecognition();
    recognition.lang = LANGS[currentLang].speechLang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    recognitionRef.current = recognition;

    recognition.onstart = () => { startTime = Date.now(); setListening(true); };

    const processResult = (heard, score) => {
      const expected = cardRef.current[0];
      setSpResult({ heard, score, correct: expected });
      setListening(false);

      if (score >= 0.7) {
        setScore(s => ({ ...s, hit: s.hit + 1 }));
        setStreak(s => s + 1);
      } else {
        setScore(s => ({ ...s, miss: s.miss + 1 }));
        setStreak(0);
      }
    };

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const expected = cardRef.current[0];

      for (let j = 0; j < result.length; j++) {
        const transcript = result[j].transcript;
        const s = similarity(transcript, expected);
        if (s > bestInterimScore) {
          bestInterimScore = s;
          bestInterimHeard = transcript;
        }
      }

      if (!result.isFinal) return;

      gotResultRef.current = true;
      processResult(bestInterimHeard, bestInterimScore);
    };

    recognition.onerror = (event) => {
      hadError = true;
      if (event.error === "not-allowed" || event.error === "audio-capture") {
        setListening(false);
        setSpResult({ heard: "", score: 0, correct: cardRef.current?.[0] || "", error: "Microphone access denied. Check your browser settings and allow mic access." });
      } else if (event.error === "aborted") {
        // User stopped manually — handled by onend
      }
      // no-speech and other errors: let onend handle retry logic
    };

    recognition.onend = () => {
      if (gotResultRef.current) return; // already processed

      // If ended very quickly (< 2s) with no results, auto-retry up to 2 times
      const elapsed = Date.now() - startTime;
      if (!bestInterimHeard && !hadError && elapsed < 2000 && retryCountRef.current < 2) {
        retryCountRef.current++;
        try { launchRecognition(true); } catch (e) { /* ignore */ }
        return;
      }

      setListening(false);
      if (bestInterimHeard) {
        processResult(bestInterimHeard, bestInterimScore);
      } else {
        setSpResult({ heard: "", score: 0, correct: cardRef.current?.[0] || "",
          error: "Couldn't catch that. Make sure your mic is enabled, speak clearly, then tap stop. If this keeps happening, try Chrome or Safari." });
      }
    };

    setSpResult(null);
    recognition.start();
  }, []);

  const startListening = useCallback(() => {
    setSpResult(null);
    window.speechSynthesis?.cancel();
    releaseAudio();
    launchRecognition();
  }, [launchRecognition]);

  // Browser-only TTS (no AudioContext/Audio elements) — safe to use before mic
  const speakBrowser = useCallback((text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const cfg = lang === "jp" ? { lang: "ja-JP", prefix: "ja", rate: 0.85 }
                               : { lang: "es-MX", prefix: "es", rate: 0.82 };
    u.lang = cfg.lang;
    u.rate = cfg.rate;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(v => v.lang === cfg.lang) || voices.find(v => v.lang.startsWith(cfg.prefix));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  }, [lang]);

  const handleSpeak = async (text) => {
    setSpeaking(true);
    await speak(text, lang);
    setTimeout(() => setSpeaking(false), 1200);
  };

  const buildQuiz = useCallback((cards, idx, d, flatWords) => {
    const c = cards[idx];
    const aI = (d || dir) === "target" ? 1 : 0;
    const pool = (flatWords || ALL_FLAT).filter(w => w[aI] !== c[aI]);
    const wrong = shuffle(pool).slice(0, 3).map(w => w[aI]);
    setOpts(shuffle([c[aI], ...wrong]));
  }, [dir, ALL_FLAT]);

  const start = (key) => {
    const isAll = key === "__all__";
    const cards = isAll ? shuffle(ALL_FLAT) : shuffle(WORDS_CUR[key]);
    setCatKey(key);
    setCatLabel(isAll ? "All Words" : key);
    setDeck(cards);
    setI(0);
    setFlipped(false);
    setPick(null);
    setScore({ hit: 0, miss: 0 });
    setStreak(0);
    setView("practice");
    if (mode === "quiz") buildQuiz(cards, 0, dir, ALL_FLAT);
  };

  const go = (ni) => {
    if (ni < 0 || ni >= deck.length) return;
    setI(ni);
    setFlipped(false);
    setPick(null);
    setSpResult(null);
    if (mode === "quiz") buildQuiz(deck, ni);
  };

  const handlePick = (o) => {
    if (pick !== null) return;
    const correct = deck[i][dir === "target" ? 1 : 0];
    setPick(o);
    if (o === correct) {
      setScore(s => ({ ...s, hit: s.hit + 1 }));
      setStreak(s => s + 1);
    } else {
      setScore(s => ({ ...s, miss: s.miss + 1 }));
      setStreak(0);
    }
  };

  const toggleMaster = () => {
    const key = deck[i][0] + "|" + deck[i][1];
    toggleStar(key);
  };

  const card = deck[i];
  const qIdx = dir === "target" ? 0 : 1;
  const aIdx = dir === "target" ? 1 : 0;
  const pct = deck.length ? ((i + 1) / deck.length) * 100 : 0;
  const total = score.hit + score.miss;
  const isDone = view === "practice" && i === deck.length - 1 && (
    (mode === "quiz" && pick !== null) || (mode === "speak" && spResult !== null)
  );
  const mKey = card ? card[0] + "|" + card[1] : "";
  const isMastered = mastered.has(mKey);

  const scoreSavedRef = useRef(false);
  useEffect(() => {
    if (isDone && !scoreSavedRef.current) {
      scoreSavedRef.current = true;
      saveQuizScore(catKey, dir, score.hit, score.miss);
    }
    if (!isDone) {
      scoreSavedRef.current = false;
    }
  }, [isDone, catKey, dir, score.hit, score.miss, saveQuizScore]);

  const goHome = () => { setView("home"); };
  const goLangPicker = () => { setLang(null); setView("home"); };

  return (
    <div style={S.root}>
      <div style={S.grain} />

      {/* Auth buttons */}
      {lang && (view === "home" || view === "profile") && (
        <AuthButton user={user} onSignIn={signIn} onSignUp={signUp} onSignOut={signOut}
          onProfile={() => setView("profile")} />
      )}

      {/* ═══════════ LANGUAGE PICKER ═══════════ */}
      {!lang && (
        <div style={S.container}>
          <div style={{ textAlign: "center", padding: "60px 0 24px", animation: "fadeUp 0.5s ease" }}>
            <div style={{ fontSize: 48, marginBottom: 10, animation: "float 3s ease-in-out infinite" }}>🌍</div>
            <h1 style={S.title}>My Words</h1>
            <p style={S.sub}>Choose a language to start learning</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20 }}>
            {[["es", "🇲🇽", "Spanish", "Español", TOTAL + " words"],
              ["jp", "🇯🇵", "Japanese", "日本語", TOTAL_JP + " words"]].map(([code, flag, name, native, count], idx) => (
              <button key={code} onClick={() => { setLang(code); setDir("target"); }}
                style={{ display: "flex", alignItems: "center", gap: 16, width: "100%",
                  padding: "22px 24px", borderRadius: 22, border: "2px solid #ede6de",
                  background: "white", cursor: "pointer", textAlign: "left",
                  boxShadow: "0 4px 20px rgba(74,53,38,0.06)", transition: "all 0.2s",
                  animation: `fadeUp 0.4s ease ${idx * 100}ms both` }}>
                <span style={{ fontSize: 40 }}>{flag}</span>
                <div>
                  <div style={{ fontFamily: "'Nunito'", fontWeight: 800, fontSize: 20, color: "#3d2e1f" }}>{name}</div>
                  <div style={{ fontFamily: "'Crimson Pro'", fontSize: 14, color: "#a89585" }}>{native} · {count}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Auth at bottom of picker */}
          <div style={{ marginTop: 30 }}>
            <AuthButton user={user} onSignIn={signIn} onSignUp={signUp} onSignOut={signOut}
              onProfile={() => { setLang("es"); setView("profile"); }} />
          </div>
          <div style={{ height: 32 }} />
        </div>
      )}

      {/* ═══════════ HOME ═══════════ */}
      {lang && view === "home" && (
        <div style={S.container}>
          <div style={{ textAlign: "center", padding: "16px 0 12px", animation: "fadeUp 0.5s ease" }}>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ fontSize: 44, animation: "float 3s ease-in-out infinite" }}>{L.flag}</div>
            </div>
            <h1 style={S.title}>{L.name}</h1>
            <p style={S.sub}>{TOTAL_CUR} words · powered by ElevenLabs voice AI</p>
            <button onClick={goLangPicker}
              style={{ marginTop: 8, background: "none", border: "none", fontSize: 13, cursor: "pointer",
                color: "#a89585", fontFamily: "'Nunito'", fontWeight: 600 }}>
              🌍 Switch Language
            </button>
          </div>

          <div style={S.pillRow}>
            {[["flash","📇 Flashcards"],["quiz","🧠 Quiz"],["speak","🎙 Speak"]].map(([m,l]) => (
              <button key={m} onClick={() => setMode(m)}
                style={{ ...S.pill, ...(mode === m ? S.pillOn : {}) }}>{l}</button>
            ))}
          </div>
          {mode !== "speak" && (
            <div style={S.pillRow}>
              {[["target", L.dirLabels[0]],["en", L.dirLabels[1]]].map(([d,l]) => (
                <button key={d} onClick={() => setDir(d)}
                  style={{ ...S.pillSm, ...(dir === d ? S.pillSmOn : {}) }}>{l}</button>
              ))}
            </div>
          )}

          <div style={S.stats}>
            <div style={S.si}><span style={S.sn}>{TOTAL_CUR}</span><span style={S.sl}>words</span></div>
            <div style={S.sep} />
            <div style={S.si}><span style={S.sn}>{Object.keys(WORDS_CUR).length}</span><span style={S.sl}>topics</span></div>
            <div style={S.sep} />
            <div style={S.si}><span style={S.sn}>{mastered.size}</span><span style={S.sl}>starred</span></div>
          </div>

          <button onClick={() => start("__all__")} style={S.allBtn}>
            <span style={{ fontSize: 20 }}>✦</span>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontWeight: 700, fontSize: 15, fontFamily: "'Nunito'" }}>Practice All Words</div>
              <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 400 }}>{TOTAL_CUR} words · shuffled</div>
            </div>
          </button>

          <div style={S.grid}>
            {Object.keys(WORDS_CUR).map((c, idx) => (
              <button key={c} onClick={() => start(c)}
                style={{ ...S.catCard, animationDelay: `${idx * 25}ms` }}>
                <span style={{ fontSize: 20 }}>{CAT_ICONS_CUR[c] || "📖"}</span>
                <span style={S.catName}>{c}</span>
                <span style={S.catCount}>{WORDS_CUR[c].length} words</span>
              </button>
            ))}
          </div>
          <div style={{ height: 32 }} />
        </div>
      )}

      {/* ═══════════ PRACTICE ═══════════ */}
      {lang && view === "practice" && card && (
        <div style={S.container}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0 8px" }}>
            <button onClick={goHome} style={S.back}>← Back</button>
            <span style={S.badge}>{CAT_ICONS_CUR[catKey] || "📖"} {catLabel}</span>
          </div>

          <div style={S.progWrap}><div style={{ ...S.progFill, width: `${pct}%` }} /></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#a89585", margin: "2px 0 10px", fontFamily: "'Crimson Pro'" }}>
            <span>{i + 1} of {deck.length}</span>
            {(mode === "quiz" || mode === "speak") && total > 0 && (
              <span style={{ color: score.hit/total > 0.7 ? "#6b9e5a" : "#c49060" }}>
                {streak >= 3 ? `🔥${streak} ` : ""}{Math.round((score.hit / total) * 100)}%
              </span>
            )}
          </div>

          {/* FLASHCARD */}
          {mode === "flash" && (
            <div style={{ perspective: 1200, margin: "8px 0 16px", userSelect: "none", WebkitUserSelect: "none" }}
              onTouchStart={e => { touchRef.current = e.touches[0].clientX; }}
              onTouchEnd={e => {
                if (!touchRef.current) return;
                const dx = e.changedTouches[0].clientX - touchRef.current;
                if (Math.abs(dx) > 50) { dx > 0 ? go(i-1) : go(i+1); }
                touchRef.current = null;
              }}>
              <div onClick={() => setFlipped(f => !f)}
                style={{ position: "relative", width: "100%", minHeight: 280, cursor: "pointer",
                  transition: "transform 0.5s cubic-bezier(0.4,0,0.2,1)", transformStyle: "preserve-3d",
                  transform: flipped ? "rotateY(180deg)" : "none" }}>
                <div style={{ ...S.face, background: "white", border: "2px solid #ede6de",
                  boxShadow: "0 12px 40px rgba(74,53,38,0.07), 0 2px 6px rgba(74,53,38,0.04)" }}>
                  <div style={S.lbl}>{dir === "target" ? L.native : "english"}</div>
                  <div style={S.bigWord}>{card[qIdx]}</div>
                  <div style={{ fontSize: 12, color: "#c8b8a6", marginTop: 20, fontStyle: "italic",
                    fontFamily: "'Crimson Pro'" }}>tap to reveal</div>
                </div>
                <div style={{ ...S.face, background: "linear-gradient(150deg, #fef9f3, #fff)",
                  border: "2px solid #d4c4b0", transform: "rotateY(180deg)",
                  boxShadow: "0 12px 40px rgba(74,53,38,0.09)" }}>
                  <div style={S.lbl}>{dir === "target" ? "english" : L.native}</div>
                  <div style={{ ...S.bigWord, fontSize: 28, color: "#5a3e28" }}>{card[aIdx]}</div>
                </div>
              </div>
            </div>
          )}

          {/* QUIZ */}
          {mode === "quiz" && (
            <div style={{ animation: "popIn 0.3s ease" }}>
              <div style={{ textAlign: "center", padding: "32px 24px", background: "white",
                borderRadius: 24, border: "2px solid #ede6de", marginBottom: 14,
                boxShadow: "0 8px 28px rgba(74,53,38,0.06)" }}>
                <div style={S.lbl}>{dir === "target" ? L.quizQ[0] : L.quizQ[1]}</div>
                <div style={{ fontFamily: "'Nunito'", fontSize: 28, fontWeight: 800, color: "#3d2e1f", marginTop: 8 }}>
                  {card[qIdx]}
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleSpeak(card[0]); }}
                  style={{ marginTop: 12, background: "none", border: "none", fontSize: 18, cursor: "pointer",
                    opacity: speaking ? 0.5 : 1, transition: "all 0.2s",
                    animation: speaking ? "pulse 0.6s ease infinite" : "none" }}>
                  🔊 <span style={{ fontSize: 11, color: "#b8a696", fontFamily: "'Crimson Pro'" }}>listen</span>
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {opts.map((o, j) => {
                  const correct = card[aIdx];
                  const isR = o === correct;
                  const isP = pick === o;
                  const done = pick !== null;
                  let bg = "white", bdr = "#e8ddd3", clr = "#3d2e1f";
                  if (done && isR) { bg = "#edf7ea"; bdr = "#7a9e6f"; clr = "#2d5a3f"; }
                  else if (done && isP && !isR) { bg = "#fdecea"; bdr = "#d4756b"; clr = "#8b3a33"; }
                  return (
                    <button key={j} onClick={() => handlePick(o)}
                      style={{ padding: "15px 18px", borderRadius: 16, border: `2px solid ${bdr}`,
                        background: bg, color: clr, fontSize: 15, cursor: done ? "default" : "pointer",
                        fontFamily: "'Crimson Pro'", fontWeight: 500, textAlign: "left",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        transition: "all 0.15s", animation: `fadeUp 0.3s ease ${j * 50}ms both` }}>
                      <span>{o}</span>
                      {done && isR && <span style={{ color: "#5a9e4f" }}>✓</span>}
                      {done && isP && !isR && <span style={{ color: "#d4756b" }}>✗</span>}
                    </button>
                  );
                })}
              </div>
              {pick !== null && i < deck.length - 1 && (
                <button onClick={() => go(i + 1)}
                  style={{ display: "block", margin: "14px auto 0", padding: "11px 30px",
                    borderRadius: 999, border: "none", cursor: "pointer",
                    background: "linear-gradient(135deg, #c2956a, #a07048)", color: "white",
                    fontFamily: "'Nunito'", fontWeight: 700, fontSize: 14,
                    boxShadow: "0 4px 16px rgba(160,112,72,0.3)" }}>
                  Next →
                </button>
              )}
            </div>
          )}

          {/* SPEAK */}
          {mode === "speak" && (
            <div style={{ animation: "popIn 0.3s ease" }}>
              <div style={{ textAlign: "center", padding: "32px 24px", background: "white",
                borderRadius: 24, border: "2px solid #ede6de", marginBottom: 14,
                boxShadow: "0 8px 28px rgba(74,53,38,0.06)" }}>
                <div style={S.lbl}>{L.speakPrompt}</div>
                <div style={{ fontFamily: "'Nunito'", fontSize: 28, fontWeight: 800, color: "#3d2e1f", marginTop: 8 }}>
                  {card[1]}
                </div>
                <button onClick={(e) => { e.stopPropagation(); speakBrowser(card[0]); }}
                  style={{ marginTop: 12, background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>
                  🔊 <span style={{ fontSize: 11, color: "#b8a696", fontFamily: "'Crimson Pro'" }}>hear it</span>
                </button>
              </div>

              {/* Mic button */}
              <div style={{ display: "flex", justifyContent: "center", margin: "20px 0" }}>
                <button onClick={() => {
                    if (listening && recognitionRef.current) {
                      recognitionRef.current.stop();
                    } else {
                      startListening();
                    }
                  }}
                  style={{ width: 80, height: 80, borderRadius: "50%",
                    border: `3px solid ${listening ? "#c2956a" : "#e0d5c8"}`,
                    background: listening ? "linear-gradient(135deg, #fff5e6, #ffecd2)" : "white",
                    cursor: "pointer", fontSize: 32,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: listening ? "0 0 0 8px rgba(194,149,106,0.2)" : "0 4px 16px rgba(0,0,0,0.06)",
                    transition: "all 0.3s",
                    animation: listening ? "pulse 1s ease infinite" : "none" }}>
                  {listening ? "⏹" : "🎙"}
                </button>
              </div>
              <p style={{ textAlign: "center", fontSize: 13, color: "#a89585", fontFamily: "'Crimson Pro'",
                marginBottom: 16 }}>
                {listening ? "Listening... speak now!" : spResult ? "" : "Tap the mic and say the word"}
              </p>

              {/* Result */}
              {spResult && (
                <div style={{ animation: "popIn 0.3s ease", padding: "20px", borderRadius: 20,
                  background: spResult.error ? "#fff8f0" : spResult.score >= 0.7 ? "#edf7ea" : "#fdecea",
                  border: `2px solid ${spResult.error ? "#e0d5c8" : spResult.score >= 0.7 ? "#7a9e6f" : "#d4756b"}`,
                  textAlign: "center" }}>

                  {spResult.error ? (
                    <p style={{ fontFamily: "'Crimson Pro'", fontSize: 15, color: "#8b6544" }}>{spResult.error}</p>
                  ) : (
                    <>
                      <div style={{ fontSize: 36, marginBottom: 8 }}>
                        {spResult.score >= 0.9 ? "🎉" : spResult.score >= 0.7 ? "👍" : "😅"}
                      </div>
                      <div style={{ fontFamily: "'Nunito'", fontWeight: 800, fontSize: 18,
                        color: spResult.score >= 0.7 ? "#2d5a3f" : "#8b3a33", marginBottom: 4 }}>
                        {spResult.score >= 0.9 ? "Perfect!" : spResult.score >= 0.7 ? "Close enough!" : "Not quite..."}
                      </div>
                      <div style={{ fontFamily: "'Nunito'", fontWeight: 700, fontSize: 22,
                        color: "#3d2e1f", margin: "12px 0 4px" }}>
                        {Math.round(spResult.score * 100)}% match
                      </div>
                      <div style={{ display: "flex", justifyContent: "center", gap: 24, margin: "12px 0",
                        fontFamily: "'Crimson Pro'", fontSize: 14 }}>
                        <div>
                          <div style={{ color: "#a89585", fontSize: 11, textTransform: "uppercase",
                            letterSpacing: 1, fontFamily: "'Nunito'", fontWeight: 600, marginBottom: 4 }}>You said</div>
                          <div style={{ color: "#3d2e1f", fontWeight: 500, fontSize: 16 }}>
                            "{spResult.heard || "..."}"
                          </div>
                        </div>
                        <div>
                          <div style={{ color: "#a89585", fontSize: 11, textTransform: "uppercase",
                            letterSpacing: 1, fontFamily: "'Nunito'", fontWeight: 600, marginBottom: 4 }}>Correct</div>
                          <div style={{ color: "#3d2e1f", fontWeight: 500, fontSize: 16 }}>
                            "{spResult.correct}"
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                        <button onClick={() => { setSpResult(null); startListening(); }}
                          style={{ padding: "9px 20px", borderRadius: 999, border: "1.5px solid #e0d5c8",
                            background: "white", cursor: "pointer", fontFamily: "'Nunito'",
                            fontWeight: 600, fontSize: 13, color: "#6b5544" }}>
                          🔄 Try again
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); speakBrowser(card[0]); }}
                          style={{ padding: "9px 20px", borderRadius: 999, border: "1.5px solid #e0d5c8",
                            background: "white", cursor: "pointer", fontFamily: "'Nunito'",
                            fontWeight: 600, fontSize: 13, color: "#6b5544" }}>
                          🔊 Hear it
                        </button>
                        {i < deck.length - 1 && (
                          <button onClick={() => go(i + 1)}
                            style={{ padding: "9px 20px", borderRadius: 999, border: "none", cursor: "pointer",
                              background: "linear-gradient(135deg, #c2956a, #a07048)", color: "white",
                              fontFamily: "'Nunito'", fontWeight: 700, fontSize: 13,
                              boxShadow: "0 4px 16px rgba(160,112,72,0.3)" }}>
                            Next →
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Controls */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 4px", gap: 10 }}>
            <button onClick={() => mode === "speak" ? speakBrowser(card[0]) : handleSpeak(card[0])}
              title={`Hear it in ${L.name}`}
              style={{ width: 52, height: 52, borderRadius: "50%", border: "2px solid #e0d5c8",
                background: speaking ? "#fff5e6" : "white", cursor: "pointer", fontSize: 22,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 10px rgba(0,0,0,0.04)", transition: "all 0.2s",
                animation: speaking ? "ripple 0.8s ease" : "none" }}>
              🔊
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => go(i-1)} disabled={i===0}
                style={{ ...S.nav, opacity: i===0 ? 0.3 : 1 }}>‹</button>
              <button onClick={() => go(i+1)} disabled={i>=deck.length-1}
                style={{ ...S.nav, opacity: i>=deck.length-1 ? 0.3 : 1 }}>›</button>
            </div>
            <button onClick={toggleMaster}
              style={{ width: 52, height: 52, borderRadius: "50%",
                border: `2px solid ${isMastered ? "#e0b860" : "#e0d5c8"}`,
                background: isMastered ? "#fff8e6" : "white",
                cursor: "pointer", fontSize: 22,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.2s", color: isMastered ? "#d4a030" : "#c8b090" }}>
              {isMastered ? "★" : "☆"}
            </button>
          </div>

          <div style={{ textAlign: "center", fontSize: 12, color: "#a89585", padding: "8px 14px 20px",
            background: "#f0e9df", borderRadius: 12, fontFamily: "'Crimson Pro'", lineHeight: 1.6 }}>
            🎙 Tap 🔊 for human-quality pronunciation · Repeat out loud!
            <br />Swipe left/right to navigate · ☆ to star words for review
          </div>
        </div>
      )}

      {/* ═══════════ PROFILE ═══════════ */}
      {lang && view === "profile" && user && (
        <div style={S.container}>
          <div style={{ padding: "16px 0 8px" }}>
            <button onClick={goHome} style={S.back}>← Back</button>
          </div>

          <div style={{ textAlign: "center", padding: "12px 0 20px", animation: "fadeUp 0.4s ease" }}>
            <div style={{ fontSize: 44, marginBottom: 8 }}>📊</div>
            <h1 style={{ ...S.title, fontSize: 26 }}>My Progress</h1>
            <p style={{ fontFamily: "'Crimson Pro'", fontSize: 14, color: "#a89585", marginTop: 4 }}>
              {user.email}
            </p>
          </div>

          {/* Overall Stats */}
          <div style={S.stats}>
            <div style={S.si}>
              <span style={S.sn}>{stats?.totalSessions || 0}</span>
              <span style={S.sl}>sessions</span>
            </div>
            <div style={S.sep} />
            <div style={S.si}>
              <span style={{ ...S.sn, color: (stats?.overallPct || 0) >= 70 ? "#6b9e5a" : "#c49060" }}>
                {stats?.overallPct || 0}%
              </span>
              <span style={S.sl}>accuracy</span>
            </div>
            <div style={S.sep} />
            <div style={S.si}>
              <span style={S.sn}>{mastered.size}</span>
              <span style={S.sl}>starred</span>
            </div>
          </div>

          {/* Needs Work */}
          {stats?.weakCategories?.length > 0 && (
            <div style={{ marginTop: 18, animation: "fadeUp 0.4s ease 0.1s both" }}>
              <h3 style={{ fontFamily: "'Nunito'", fontWeight: 700, fontSize: 15, color: "#4a3526",
                marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                📝 Needs Practice
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {stats.weakCategories.map((cat) => (
                  <button key={cat.name} onClick={() => { start(cat.name === "__all__" ? "__all__" : cat.name); setMode("quiz"); }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 16px", borderRadius: 16, border: "2px solid #f5d4c4",
                      background: "#fff8f3", cursor: "pointer", textAlign: "left" }}>
                    <div>
                      <span style={{ fontFamily: "'Nunito'", fontWeight: 700, fontSize: 14, color: "#4a3526" }}>
                        {CAT_ICONS_CUR[cat.name] || "📖"} {cat.name === "__all__" ? "All Words" : cat.name}
                      </span>
                      <span style={{ fontFamily: "'Crimson Pro'", fontSize: 12, color: "#a89585", marginLeft: 8 }}>
                        {cat.sessions} {cat.sessions === 1 ? "session" : "sessions"}
                      </span>
                    </div>
                    <span style={{ fontFamily: "'Nunito'", fontWeight: 800, fontSize: 16,
                      color: cat.pct < 50 ? "#d4756b" : "#c49060" }}>
                      {cat.pct}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Strong Categories */}
          {stats?.strongCategories?.length > 0 && (
            <div style={{ marginTop: 18, animation: "fadeUp 0.4s ease 0.2s both" }}>
              <h3 style={{ fontFamily: "'Nunito'", fontWeight: 700, fontSize: 15, color: "#4a3526",
                marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                ⭐ Going Strong
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {stats.strongCategories.map((cat) => (
                  <div key={cat.name}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 16px", borderRadius: 16, border: "1.5px solid #d4e8cf",
                      background: "#f3faf0" }}>
                    <div>
                      <span style={{ fontFamily: "'Nunito'", fontWeight: 700, fontSize: 14, color: "#4a3526" }}>
                        {CAT_ICONS_CUR[cat.name] || "📖"} {cat.name === "__all__" ? "All Words" : cat.name}
                      </span>
                      <span style={{ fontFamily: "'Crimson Pro'", fontSize: 12, color: "#a89585", marginLeft: 8 }}>
                        {cat.sessions} {cat.sessions === 1 ? "session" : "sessions"}
                      </span>
                    </div>
                    <span style={{ fontFamily: "'Nunito'", fontWeight: 800, fontSize: 16, color: "#6b9e5a" }}>
                      {cat.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Activity */}
          {stats?.recentScores?.length > 0 && (
            <div style={{ marginTop: 18, animation: "fadeUp 0.4s ease 0.3s both" }}>
              <h3 style={{ fontFamily: "'Nunito'", fontWeight: 700, fontSize: 15, color: "#4a3526",
                marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                🕐 Recent Activity
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {stats.recentScores.map((s, idx) => {
                  const total = s.hits + s.misses;
                  const pct = total > 0 ? Math.round((s.hits / total) * 100) : 0;
                  const date = new Date(s.created_at);
                  const timeStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
                    + " " + date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
                  return (
                    <div key={idx}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 14px", borderRadius: 14, background: "white",
                        border: "1px solid #ede6de" }}>
                      <div>
                        <span style={{ fontFamily: "'Nunito'", fontWeight: 600, fontSize: 13, color: "#4a3526" }}>
                          {CAT_ICONS_CUR[s.category] || "📖"} {s.category === "__all__" ? "All Words" : s.category}
                        </span>
                        <span style={{ fontFamily: "'Crimson Pro'", fontSize: 11, color: "#b8a696", marginLeft: 8 }}>
                          {s.direction === "target" ? L.dirProfile[0] : s.direction === "en" ? L.dirProfile[1] : s.direction === "es" ? "ES→EN" : "EN→ES"}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontFamily: "'Nunito'", fontWeight: 700, fontSize: 14,
                          color: pct >= 70 ? "#6b9e5a" : pct >= 50 ? "#c49060" : "#d4756b" }}>
                          {pct}%
                        </span>
                        <span style={{ fontFamily: "'Crimson Pro'", fontSize: 11, color: "#b8a696" }}>
                          {timeStr}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Starred Words */}
          {mastered.size > 0 && (
            <div style={{ marginTop: 18, animation: "fadeUp 0.4s ease 0.4s both" }}>
              <h3 style={{ fontFamily: "'Nunito'", fontWeight: 700, fontSize: 15, color: "#4a3526",
                marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                ⭐ Starred Words ({mastered.size})
              </h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[...mastered].map((key) => {
                  const [w, en] = key.split("|");
                  return (
                    <span key={key}
                      style={{ padding: "6px 12px", borderRadius: 12, background: "#fff8e6",
                        border: "1px solid #e8d8a8", fontFamily: "'Crimson Pro'", fontSize: 13,
                        color: "#6b5544" }}>
                      {w} — {en}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {(!stats || stats.totalSessions === 0) && mastered.size === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", animation: "fadeUp 0.4s ease" }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🚀</div>
              <p style={{ fontFamily: "'Nunito'", fontWeight: 700, fontSize: 16, color: "#4a3526" }}>
                No activity yet!
              </p>
              <p style={{ fontFamily: "'Crimson Pro'", fontSize: 14, color: "#a89585", marginTop: 6 }}>
                Start a quiz or speak session to track your progress.
              </p>
              <button onClick={goHome}
                style={{ ...S.pill, ...S.pillOn, marginTop: 16, fontSize: 14 }}>
                Start Practicing
              </button>
            </div>
          )}

          <div style={{ height: 32 }} />
        </div>
      )}

      {/* ═══════════ DONE OVERLAY ═══════════ */}
      {isDone && L && (
        <div onClick={goHome}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(6px)", display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "white", borderRadius: 28, padding: "36px 28px",
              textAlign: "center", maxWidth: 320, width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.18)", animation: "popIn 0.4s ease" }}>
            <div style={{ fontSize: 52 }}>
              {score.hit/total > 0.8 ? "🎉" : score.hit/total > 0.5 ? "💪" : "📖"}
            </div>
            <h2 style={{ fontFamily: "'Nunito'", color: "#3d2e1f", margin: "10px 0 4px", fontWeight: 800 }}>
              {score.hit/total > 0.8 ? L.done[0] : score.hit/total > 0.5 ? L.done[1] : L.done[2]}
            </h2>
            <p style={{ color: "#9b8574", fontSize: 15, fontFamily: "'Crimson Pro'" }}>
              {score.hit} of {total} correct — {Math.round((score.hit/total)*100)}%
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
              <button onClick={() => start(catKey)}
                style={{ ...S.pill, ...S.pillOn, fontSize: 14 }}>🔄 Retry</button>
              <button onClick={goHome}
                style={{ ...S.pill, fontSize: 14 }}>🏠 Home</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  root: { fontFamily: "'Crimson Pro', serif", minHeight: "100vh", background: "#f5efe8", color: "#3d2e1f", WebkitFontSmoothing: "antialiased" },
  grain: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, opacity: 0.35,
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
    backgroundSize: "200px" },
  container: { maxWidth: 440, margin: "0 auto", padding: "0 16px", position: "relative", zIndex: 1 },
  title: { fontFamily: "'Nunito'", fontWeight: 800, fontSize: 32, color: "#4a3526", letterSpacing: "-0.5px" },
  sub: { fontSize: 14, color: "#a89585", margin: "6px 0 0", fontWeight: 300 },
  pillRow: { display: "flex", gap: 8, justifyContent: "center", margin: "10px 0 4px", flexWrap: "wrap" },
  pill: { padding: "10px 22px", borderRadius: 999, border: "1.5px solid #ddd0c4", background: "white",
    fontSize: 13, cursor: "pointer", fontFamily: "'Nunito'", color: "#6b5544", fontWeight: 600, transition: "all 0.2s" },
  pillOn: { background: "linear-gradient(135deg, #c2956a, #a87b52)", color: "white", borderColor: "transparent",
    boxShadow: "0 3px 14px rgba(194,149,106,0.35)" },
  pillSm: { padding: "6px 16px", borderRadius: 999, border: "1.5px solid #e0d6ca", background: "transparent",
    fontSize: 12, cursor: "pointer", fontFamily: "'Nunito'", color: "#9b8574", fontWeight: 600, transition: "all 0.2s" },
  pillSmOn: { background: "#ebe2d7", color: "#5a3e28", borderColor: "#d4c4b0" },
  stats: { display: "flex", justifyContent: "center", alignItems: "center", gap: 20, background: "white",
    borderRadius: 18, padding: "14px 24px", margin: "14px 0", boxShadow: "0 2px 14px rgba(0,0,0,0.04)",
    border: "1px solid #ede6de" },
  si: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  sn: { fontFamily: "'Nunito'", fontWeight: 800, fontSize: 20, color: "#4a3526" },
  sl: { fontSize: 10, color: "#a89585", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "'Nunito'", fontWeight: 600 },
  sep: { width: 1, height: 28, background: "#e8ddd3" },
  allBtn: { display: "flex", alignItems: "center", gap: 14, width: "100%", padding: "16px 20px",
    borderRadius: 18, border: "none", cursor: "pointer", fontFamily: "'Crimson Pro'",
    background: "linear-gradient(135deg, #c2956a 0%, #9e6b40 100%)", color: "white",
    boxShadow: "0 6px 24px rgba(158,107,64,0.35)", marginBottom: 14, transition: "all 0.2s" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 },
  catCard: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5,
    padding: "14px 13px", borderRadius: 16, border: "1.5px solid #ede6de", background: "white",
    cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", transition: "all 0.2s",
    animation: "fadeUp 0.35s ease both", textAlign: "left" },
  catName: { fontFamily: "'Nunito'", fontWeight: 700, fontSize: 13, color: "#4a3526", lineHeight: 1.2 },
  catCount: { fontSize: 11, color: "#b8a696", fontFamily: "'Crimson Pro'" },
  back: { background: "none", border: "none", fontSize: 14, color: "#9b8574", cursor: "pointer",
    fontFamily: "'Nunito'", fontWeight: 600 },
  badge: { fontSize: 12, color: "#6b5544", background: "#ede6de", padding: "5px 14px",
    borderRadius: 999, fontWeight: 600, fontFamily: "'Nunito'" },
  progWrap: { background: "#e8ddd3", borderRadius: 999, height: 5, overflow: "hidden", margin: "8px 0 2px" },
  progFill: { height: "100%", background: "linear-gradient(90deg, #c2956a, #dbb78e)", borderRadius: 999, transition: "width 0.4s ease" },
  face: { position: "absolute", inset: 0, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
    borderRadius: 26, display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", padding: "36px 28px" },
  lbl: { fontSize: 10, textTransform: "uppercase", letterSpacing: 2.5, color: "#b8a696", marginBottom: 12,
    fontFamily: "'Nunito'", fontWeight: 700 },
  bigWord: { fontFamily: "'Nunito'", fontSize: 32, fontWeight: 800, color: "#3d2e1f", textAlign: "center", lineHeight: 1.3 },
  nav: { width: 44, height: 44, borderRadius: "50%", border: "1.5px solid #ddd0c4", background: "white",
    cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center",
    color: "#6b5544", transition: "all 0.2s", fontWeight: 300 },
};
