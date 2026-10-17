import { describe, expect, it } from "vitest";
import { resolveWorkChromeLabel } from "./workChromeLabel";

const formatDuration = (s: number) => `${s}s`;
const workingFor = (d: string) => `Working for ${d}`;
const workedFor = (d: string) => `Worked for ${d}`;
const doneLabel = "工作了";

describe("resolveWorkChromeLabel", () => {
  it("live always uses 工作中/Working for + timer", () => {
    expect(
      resolveWorkChromeLabel({
        live: true,
        durationSec: 0,
        workingFor,
        workedFor,
        doneLabel,
        formatDuration,
      }),
    ).toBe("Working for 0s");
    expect(
      resolveWorkChromeLabel({
        live: true,
        durationSec: 38,
        workingFor,
        workedFor,
        doneLabel,
        formatDuration,
      }),
    ).toBe("Working for 38s");
    expect(
      resolveWorkChromeLabel({
        live: true,
        durationSec: null,
        workingFor,
        workedFor,
        doneLabel,
        formatDuration,
      }),
    ).toBe("Working for 0s");
  });

  it("done uses 工作了/Worked for + duration", () => {
    expect(
      resolveWorkChromeLabel({
        live: false,
        durationSec: 62,
        workingFor,
        workedFor,
        doneLabel,
        formatDuration,
      }),
    ).toBe("Worked for 62s");
  });

  it("done without duration falls back to 工作了 (not 已工作/工作)", () => {
    expect(
      resolveWorkChromeLabel({
        live: false,
        durationSec: undefined,
        workingFor,
        workedFor,
        doneLabel: "工作了",
        formatDuration,
      }),
    ).toBe("工作了");
  });
});
