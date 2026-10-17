import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "EnvInfoButton.tsx"),
  "utf8",
);

describe("EnvInfoButton pin / dock", () => {
  it("defaults to a dropdown and can pin into the chat-column dock", () => {
    expect(src).toContain("loadEnvInfoPinnedPref");
    expect(src).toContain("saveEnvInfoPinnedPref");
    expect(src).toContain('data-testid="env-info-pin"');
    expect(src).toContain('data-env-mode={pinned ? "dock" : "dropdown"}');
    expect(src).toContain("sw-env-menu menu-panel");
    expect(src).toContain("sw-env-dock");
    expect(src).toContain("asideOpen");
  });

  it("keeps the dock open on row jump and parks with the right rail", () => {
    expect(src).toMatch(/if \(!pinned\) setOpen\(false\)/);
    expect(src).toContain("setParked(true)");
    expect(src).toContain("is-parked");
  });
});
