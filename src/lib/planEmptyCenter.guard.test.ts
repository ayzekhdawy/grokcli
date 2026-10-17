/**
 * Side-workbench Plan empty state must fill the pane and center copy.
 * `.plan-resource-empty` caps width at 28rem for the Resources document
 * empty; without a side-pane override that left-aligns the block.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("plan empty state centers in the side pane", () => {
  const sw = stripComments(
    readFileSync(join(ROOT, "styles/side-workbench.part1.css"), "utf8"),
  );
  const chat = stripComments(
    readFileSync(join(ROOT, "styles/chat.part1.css"), "utf8"),
  );
  const planTab = readFileSync(
    join(ROOT, "components/side-workbench/PlanTab.tsx"),
    "utf8",
  );

  it("keeps the Resources empty cap that the side pane must override", () => {
    const block = chat.match(/\.plan-resource-empty\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toMatch(/max-width:\s*28rem/);
  });

  it("PlanTab empty uses plan-resource-empty inside .sw-plan", () => {
    expect(planTab).toMatch(/className="sw-plan"/);
    expect(planTab).toMatch(/plan-resource-empty plan-resource-empty--/);
  });

  it("side pane stretches and centers the empty block", () => {
    const block =
      sw.match(/\.sw-plan\s+\.plan-resource-empty\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toMatch(/max-width:\s*none/);
    expect(block).toMatch(/width:\s*100%/);
    expect(block).toMatch(/align-self:\s*stretch/);
    expect(block).toMatch(/align-items:\s*center/);
    expect(block).toMatch(/justify-content:\s*center/);
    expect(block).toMatch(/text-align:\s*center/);
  });
});
