/**
 * Guard: GUI-spawned console tools on Windows must hide the console window.
 * Settings → Agent used to flash a black cmd box because `git` / `rg` /
 * `tasklist` / `taskkill` / `reg` were spawned with bare Command::new.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RUST_ROOT = join(__dirname, "../../src-tauri/src");

const BARE = /\b(?:std::process::)?Command::new\(\s*"(git|rg|tasklist|taskkill|reg)"\s*\)/g;

function walkRs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkRs(p, out);
    else if (name.endsWith(".rs")) out.push(p);
  }
  return out;
}

describe("Windows console-flash guard", () => {
  it("does not spawn git/rg/tasklist/taskkill/reg without process_util", () => {
    const files = walkRs(RUST_ROOT);
    const hits: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      BARE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = BARE.exec(src))) {
        const line = src.slice(0, m.index).split("\n").length;
        hits.push(`${file.replace(RUST_ROOT + "/", "")}:${line} Command::new("${m[1]}")`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("settings inputs inherit color-scheme and hide number spinners", () => {
    const css = readFileSync(
      join(__dirname, "../styles/settings.part3.css"),
      "utf8",
    );
    expect(css).toContain("color-scheme: inherit");
    expect(css).toContain("::-webkit-inner-spin-button");
  });
});
