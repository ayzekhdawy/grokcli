/**
 * Soft-close incomplete markdown while streaming so ReactMarkdown does not
 * flash bare `**`, `*`, `` ` ``, or unclosed fences mid-turn.
 *
 * Single linear scan, dependency-free. Final (non-streaming) content is never
 * rewritten.
 */

/**
 * Return a render-safe markdown string for live streaming.
 * When not streaming, returns `src` unchanged.
 */
export function softCloseMarkdown(src: string, streaming: boolean): string {
  if (!streaming || !src) return src;

  let fenceOpen = false;
  let fenceCount = 0;
  let mathBlockOpen = false;
  let mathBlockCount = 0;
  let bold = 0; // **
  let strike = 0; // ~~
  let underlineBold = 0; // __
  let italicStar = 0; // single *
  let italicUnder = 0; // single _
  let inlineCode = 0; // single `
  let inlineMath = 0; // $…$

  let i = 0;
  const n = src.length;
  while (i < n) {
    // Line-start fence ```
    if (
      src.startsWith("```", i) &&
      (i === 0 || src[i - 1] === "\n")
    ) {
      fenceOpen = !fenceOpen;
      fenceCount += 1;
      i += 3;
      continue;
    }

    if (fenceOpen) {
      i += 1;
      continue;
    }

    const ch = src[i];
    const prev = i > 0 ? src[i - 1] : "";
    const escaped = prev === "\\";

    if (!escaped && ch === "`") {
      // Multi-backtick runs (``` already handled at line start): skip.
      if (src[i + 1] === "`") {
        while (i < n && src[i] === "`") i += 1;
        continue;
      }
      inlineCode += 1;
      i += 1;
      continue;
    }
    if (inlineCode % 2 === 1) {
      i += 1;
      continue;
    }

    if (src.startsWith("$$", i) && !escaped) {
      mathBlockOpen = !mathBlockOpen;
      mathBlockCount += 1;
      i += 2;
      continue;
    }
    if (mathBlockOpen) {
      i += 1;
      continue;
    }

    if (!escaped && src.startsWith("**", i)) {
      bold += 1;
      i += 2;
      continue;
    }
    if (!escaped && src.startsWith("~~", i)) {
      strike += 1;
      i += 2;
      continue;
    }
    if (!escaped && src.startsWith("__", i)) {
      underlineBold += 1;
      i += 2;
      continue;
    }
    if (!escaped && ch === "$") {
      inlineMath += 1;
      i += 1;
      continue;
    }
    // Single * / _ only when not part of ** / __ (already consumed above).
    if (!escaped && ch === "*") {
      italicStar += 1;
      i += 1;
      continue;
    }
    if (!escaped && ch === "_") {
      italicUnder += 1;
      i += 1;
      continue;
    }

    i += 1;
  }

  let s = src;
  if (bold % 2 === 1) s += "**";
  if (strike % 2 === 1) s += "~~";
  if (underlineBold % 2 === 1) s += "__";
  if (italicStar % 2 === 1) s += "*";
  if (italicUnder % 2 === 1) s += "_";
  if (inlineCode % 2 === 1) s += "`";
  if (inlineMath % 2 === 1) s += "$";
  if (mathBlockCount % 2 === 1) s += "\n$$";
  if (fenceCount % 2 === 1) s += "\n```";
  return s;
}
