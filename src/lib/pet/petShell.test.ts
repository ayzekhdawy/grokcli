import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPetShellHash } from "./petShell";

describe("isPetShellHash", () => {
  it("matches the pet overlay route only", () => {
    expect(isPetShellHash("#/pet")).toBe(true);
    expect(isPetShellHash("#/pet?")).toBe(true);
    expect(isPetShellHash("#/settings/pet")).toBe(false);
    expect(isPetShellHash("#/workbench")).toBe(false);
    expect(isPetShellHash("")).toBe(false);
  });

  it("index.html hides the boot-gate before first paint on #/pet", () => {
    const html = readFileSync(resolve("index.html"), "utf8");
    const bootScript = html.indexOf("data-pet-shell");
    const bootGateCss = html.indexOf(".boot-gate {");
    expect(bootScript).toBeGreaterThan(0);
    expect(bootScript).toBeLessThan(bootGateCss);
    expect(html).toContain('h !== "#/pet"');
    expect(html).toContain("transparent");
  });
});
