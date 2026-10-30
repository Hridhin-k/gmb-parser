"use client";

import { useState, useSyncExternalStore } from "react";
import { Mic } from "lucide-react";

interface SpeechAlternative {
  transcript: string;
}

interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<SpeechAlternative>>;
}

interface SpeechRecognizer {
  lang: string;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
}

type SpeechCtor = new () => SpeechRecognizer;

function recognitionCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const host = window as Window & {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

/** Fills a field from the browser speech API when that API exists. */
export function SpeakButton({
  onText,
  disabled,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const ready = useSyncExternalStore(
    () => () => {},
    () => Boolean(recognitionCtor()),
    () => false
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) return null;

  function listen() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    const recognition = new Ctor();
    recognition.lang = "en-IN";
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) onText(transcript);
    };
    recognition.onerror = () => setError("Speech was not captured. You can type instead.");
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  return (
    <div>
      <button
        type="button"
        onClick={listen}
        disabled={disabled || listening}
        aria-live="polite"
        className="inline-flex h-12 items-center gap-1.5 rounded-md border border-line bg-white px-4 text-[15px] font-medium text-ink disabled:opacity-50"
      >
        <Mic className="size-4" aria-hidden />
        {listening ? "Listening…" : "Speak"}
      </button>
      {error ? (
        <p className="mt-2 text-[13px] text-warn" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
