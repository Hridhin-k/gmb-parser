"use client";

import { useState, useSyncExternalStore } from "react";

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
        className="h-11 rounded-full border border-silver bg-white px-4 text-sm text-ink"
      >
        {listening ? "Listening…" : "Speak"}
      </button>
      {error ? (
        <p className="mt-2 text-sm text-slate" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
