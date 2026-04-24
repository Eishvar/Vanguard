import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import skynetLogo from "@/assets/skynet-logo.webp";

interface IntroSequenceProps {
  onComplete: () => void;
}

const LANGUAGES = {
  EN: {
    label: "EN",
    subtitle: "DECENTRALISED SWARM INTELLIGENCE",
    corp: "CITADEL CORPORATION",
    placeholder: "ENTER AUTHORIZATION CODE",
    granted: "✓ AUTHORIZATION GRANTED",
  },
  MY: {
    label: "MY",
    subtitle: "PERISIKAN KAWANAN TERAGIH",
    corp: "SYARIKAT CITADEL",
    placeholder: "MASUKKAN KOD KEBENARAN",
    granted: "✓ KEBENARAN DIBERIKAN",
  },
  ID: {
    label: "ID",
    subtitle: "KECERDASAN KAWANAN TERDESENTRALISASI",
    corp: "KORPORASI CITADEL",
    placeholder: "MASUKKAN KODE OTORISASI",
    granted: "✓ OTORISASI DIBERIKAN",
  },
  TL: {
    label: "TL",
    subtitle: "DESENTRALISADONG KATALINUHANG PANGKAWAN",
    corp: "KORPORASYON NG CITADEL",
    placeholder: "ILAGAY ANG KODIGO NG AWTORISASYON",
    granted: "✓ AWTORISASYON IPINAGKALOOB",
  },
} as const;

type LangKey = keyof typeof LANGUAGES;

export function IntroSequence({ onComplete }: IntroSequenceProps) {
  const [phase, setPhase] = useState<"idle" | "granted" | "glitch" | "split" | "done">("idle");
  const [pin, setPin] = useState("");
  const [lang, setLang] = useState<LangKey>("EN");
  const inputRef = useRef<HTMLInputElement>(null);
  const t = LANGUAGES[lang];

  /*
   * HOW TO ADJUST VERTICAL POSITION:
   *
   * • Everything up/down together → change `translateY: "-3%"` on both motion.div halves
   *   More negative (e.g. "-6%") = higher. Less (e.g. "-1%") = lower.
   *
   * • Logo only → change `pb-X` on the top-half inner div. Higher = logo lower.
   *
   * • Title/text only → change `pt-X` on the bottom-half inner div. Higher = text lower.
   *
   * • Input/button position → change `bottom-X` on the auth input wrapper. Higher = lower.
   */

  const handleSubmit = useCallback(() => {
    if (phase !== "idle" || pin.trim() === "") return;
    setPhase("granted");
    setTimeout(() => setPhase("glitch"), 600);
    setTimeout(() => setPhase("split"), 1100);
    setTimeout(() => {
      setPhase("done");
      onComplete();
    }, 1900);
  }, [phase, pin, onComplete]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  }, [handleSubmit]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  if (phase === "done") return null;

  const isGlitching = phase === "glitch";
  const isSplit     = phase === "split";

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden" style={{ background: "#0a0f14" }}>

      <style>{`
        @keyframes glitch {
          0%   { transform: translate(0); clip-path: inset(0 0 0 0); }
          10%  { transform: translate(-3px, 1px); clip-path: inset(10% 0 60% 0); filter: hue-rotate(90deg); }
          20%  { transform: translate(3px, -1px); clip-path: inset(50% 0 20% 0); }
          30%  { transform: translate(-2px, 2px); clip-path: inset(30% 0 40% 0); filter: hue-rotate(-90deg); }
          40%  { transform: translate(2px, -2px); clip-path: inset(70% 0 5%  0); }
          50%  { transform: translate(0);         clip-path: inset(0 0 0 0); filter: none; }
          60%  { transform: translate(-4px, 1px); clip-path: inset(20% 0 55% 0); filter: brightness(1.8); }
          70%  { transform: translate(4px, -1px); clip-path: inset(60% 0 15% 0); }
          80%  { transform: translate(-1px, 3px); clip-path: inset(40% 0 35% 0); filter: saturate(3); }
          90%  { transform: translate(1px, -3px); clip-path: inset(5%  0 75% 0); }
          100% { transform: translate(0);         clip-path: inset(0 0 0 0); filter: none; }
        }
        @keyframes scanline-glitch {
          0%,100% { opacity: 0.04; }
          50%     { opacity: 0.12; }
        }
        @keyframes rgb-split {
          0%,100% { text-shadow: none; }
          25% { text-shadow: -3px 0 #ff0040, 3px 0 #00ffcc; }
          75% { text-shadow: 3px 0 #ff0040, -3px 0 #00ffcc; }
        }
        @keyframes flicker {
          0%,100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>

      {/* ── Top half ── */}
      <motion.div
        className="absolute inset-x-0 top-0 h-1/2 flex items-end justify-center overflow-hidden"
        style={{ background: "#0a0f14", translateY: "-3%" }}
        animate={isSplit ? { y: "-100%" } : { y: 0 }}
        transition={{ duration: 0.7, ease: [0.65, 0, 0.35, 1] }}
      >
        <div
          className="flex flex-col items-center pb-6"
          style={isGlitching ? { animation: "glitch 0.12s steps(3) infinite" } : {}}
        >
          <img
            src={skynetLogo}
            alt="Vanguard Logo"
            className="w-28 md:w-36 h-auto mb-2"
            style={{
              filter: "brightness(0) saturate(100%) invert(63%) sepia(85%) saturate(400%) hue-rotate(120deg) brightness(95%) contrast(95%)",
              ...(isGlitching ? { animation: "flicker 0.08s steps(2) infinite" } : {}),
            }}
            draggable={false}
          />
        </div>
      </motion.div>

      {/* ── Bottom half ── */}
      <motion.div
        className="absolute inset-x-0 bottom-0 h-1/2 flex flex-col items-center justify-start overflow-hidden"
        style={{ background: "#0a0f14", translateY: "-3%" }}
        animate={isSplit ? { y: "100%" } : { y: 0 }}
        transition={{ duration: 0.7, ease: [0.65, 0, 0.35, 1] }}
      >
        <div
          className="flex flex-col items-center pt-6"
          style={isGlitching ? { animation: "glitch 0.12s steps(3) infinite" } : {}}
        >
          <h1
            className="font-display text-4xl md:text-6xl font-bold tracking-[0.15em] mb-3"
            style={{
              color: "#c0c0c0",
              ...(isGlitching ? { animation: "rgb-split 0.1s steps(2) infinite" } : {}),
            }}
          >
            VANGUARD
          </h1>
          <p className="text-xs md:text-sm tracking-[0.25em] text-foreground/70 mb-2 font-mono uppercase">
            {t.subtitle}
          </p>
          <p
            className="text-xs tracking-[0.2em] font-display"
            style={{ color: "#00cba9" }}
          >
            {t.corp}
          </p>
        </div>
      </motion.div>

      {/* ── Language switcher ── */}
      {phase === "idle" && (
        <div className="absolute bottom-8 inset-x-0 flex justify-center gap-2 z-50">
          {(Object.keys(LANGUAGES) as LangKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setLang(key)}
              className={`px-2.5 py-1 font-mono text-[9px] tracking-[0.2em] uppercase border transition-all duration-200
                ${lang === key
                  ? "border-primary/60 text-primary bg-primary/10"
                  : "border-border/30 text-muted-foreground/40 hover:border-border/60 hover:text-muted-foreground"
                }`}
            >
              {LANGUAGES[key].label}
            </button>
          ))}
        </div>
      )}

      {/* ── Auth input — idle only ── */}
      <AnimatePresence>
        {phase === "idle" && (
          <motion.div
            className="absolute bottom-20 inset-x-0 flex justify-center z-50"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ delay: 0.5, duration: 0.5 }}
          >
            <div className="flex items-center border border-primary/40 bg-black/40 backdrop-blur-sm overflow-hidden">
              <input
                ref={inputRef}
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t.placeholder}
                maxLength={32}
                className="bg-transparent px-4 py-2.5 font-mono text-[11px] tracking-[0.25em] text-primary/80
                  placeholder:text-primary/25 outline-none w-64 uppercase"
                style={{ caretColor: "#00cba9" }}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                onClick={handleSubmit}
                disabled={pin.trim() === ""}
                className="px-3 py-2.5 border-l border-primary/40 text-primary/60
                  hover:bg-primary/10 hover:text-primary transition-all duration-200
                  disabled:opacity-20 disabled:pointer-events-none font-mono text-[14px]"
                title="Submit"
              >
                →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Authorization granted banner — granted + glitch phases ── */}
      <AnimatePresence>
        {(phase === "granted" || phase === "glitch") && (
          <motion.div
            className="absolute bottom-20 inset-x-0 flex justify-center z-50"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            transition={{ duration: 0.2 }}
          >
            <div className="border border-primary/60 bg-primary/10 px-6 py-2.5">
              <span className="font-mono text-[11px] tracking-[0.3em] text-primary uppercase">
                {t.granted}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Scanline overlay ── */}
      <div
        className="absolute inset-0 z-40 pointer-events-none"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)",
          animation: isGlitching ? "scanline-glitch 0.08s steps(2) infinite" : "none",
        }}
      />
    </div>
  );
}
