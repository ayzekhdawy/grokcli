/**
 * PTY terminal text inset is on `.xterm`, not the veil host.
 * Padding the host / persist chrome would leave an unveiled wallpaper ring.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("terminal inner pad stays on xterm", () => {
  const sw = stripComments(
    readFileSync(join(ROOT, "styles/side-workbench.part1.css"), "utf8"),
  );

  it("defines 5px pad on the pty root without insetting the veil host", () => {
    const block = sw.match(/\.sw-terminal--pty\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toMatch(/--sw-term-pad:\s*5px/);
    expect(block).toMatch(/padding:\s*0/);
    expect(block).toMatch(/background:\s*var\(--sw-term-veil\)/);
  });

  it("keeps the xterm host edge-to-edge", () => {
    const block = sw.match(/\.sw-terminal__xterm\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toMatch(/padding:\s*0/);
    expect(block).toMatch(/background:\s*transparent/);
  });

  it("insets .xterm with border-box so FitAddon subtracts the pad", () => {
    const block = sw.match(/\.sw-terminal__xterm\s+\.xterm\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toMatch(/padding:\s*var\(--sw-term-pad,\s*5px\)\s*!important/);
    expect(block).toMatch(/box-sizing:\s*border-box\s*!important/);
    expect(block).toMatch(/background:\s*transparent\s*!important/);
  });

  it("offsets xterm helpers onto the padded screen", () => {
    const block =
      sw.match(/\.sw-terminal__xterm\s+\.xterm-helpers\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toMatch(/top:\s*var\(--sw-term-pad,\s*5px\)\s*!important/);
    expect(block).toMatch(/left:\s*var\(--sw-term-pad,\s*5px\)\s*!important/);
  });
});
