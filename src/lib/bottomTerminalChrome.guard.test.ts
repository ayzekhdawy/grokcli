/**
 * Bottom terminal chips: close on hover, plus a close-all chrome button.
 * Do not hide × behind `active ?` — inactive tabs must still render it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("bottom terminal close chrome", () => {
  const tsx = readFileSync(
    join(ROOT, "components/bottom-terminal/BottomTerminal.tsx"),
    "utf8",
  );
  const css = stripComments(
    readFileSync(join(ROOT, "styles/bottom-terminal.css"), "utf8"),
  );

  it("renders a close chip on every tab", () => {
    expect(tsx).toMatch(/className="rp-tab__x"/);
    expect(tsx).not.toMatch(/\{active \?\s*\([\s\S]*?rp-tab__x/);
  });

  it("shows the close chip on tab hover without shrinking the veil host", () => {
    expect(css).toMatch(/\.bt\s+\.rp-tab:hover\s+\.rp-tab__x/);
    expect(css).toMatch(/\.bt\s+\.rp-tab\.is-active:hover\s+\.rp-tab__x/);
    expect(css).toMatch(/\.bt\s+\.rp-tab\.is-active\s+\.rp-tab__x/);
  });

  it("close paths kill the host PTY instead of only hiding the chip", () => {
    const hook = readFileSync(
      join(ROOT, "hooks/useBottomTerminal.ts"),
      "utf8",
    );
    const tab = readFileSync(
      join(ROOT, "components/side-workbench/TerminalTab.tsx"),
      "utf8",
    );
    expect(hook).toMatch(/killTerminalPtySessions/);
    expect(hook).toMatch(/droppedBottomTerminalTabIds/);
    expect(tab).toMatch(/registerTerminalPtySession\(tabId,\s*sessionId\)/);
    expect(tab).toMatch(/killTerminalPtySession\(tabId\)/);
  });

  it("exposes a close-all chrome button", () => {
    expect(tsx).toMatch(/data-testid="bottom-terminal-close-all"/);
    expect(tsx).toMatch(/onCloseAllTabs/);
    expect(tsx).toMatch(/terminal\.closeAll/);
  });
});
