"use client";

import { useEffect, useState, type CSSProperties } from "react";

/** Keep the accessible sentence intact while its visual words arrive in order. */
export function FadeText({ text, delay = 0 }: { text: string; delay?: number }) {
  return <span className="fade-text" aria-label={text}>{text.split(" ").map((word, index) =>
    <span className="fade-word" aria-hidden="true" key={`${index}-${word}`} style={{ "--text-delay": `${delay + index * 80}ms` } as CSSProperties}>{word}{" "}</span>
  )}</span>;
}

const examples = [
  "A little astronaut discovers a world made entirely of flowers…",
  "Turn my character into the star of a cinematic cartoon…",
  "A midnight drive. A red sports car. An unexpected adventure…",
  "The same story, with your own characters. Make it yours…",
];

export function RotatingPrompt({ reducedMotion, active }: { reducedMotion: boolean; active: boolean }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reducedMotion || !active) return;
    const timer = window.setInterval(() => setIndex(current => (current + 1) % examples.length), 6000);
    return () => window.clearInterval(timer);
  }, [reducedMotion, active]);

  if (!active) return null;
  return <div className="prompt-example" aria-hidden="true"><span className="prompt-example-line" key={index}>
    {examples[index].split(" ").map((word, wordIndex, words) => <span className="prompt-example-word" key={wordIndex}>{[...word].map((letter, letterIndex) => {
      const offset = words.slice(0, wordIndex).join(" ").length + letterIndex;
      return <span key={letterIndex} style={{ "--text-delay": `${offset * 11}ms` } as CSSProperties}>{letter}</span>;
    })}{" "}</span>)}
  </span></div>;
}
