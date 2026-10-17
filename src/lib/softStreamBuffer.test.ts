import { describe, expect, it } from "vitest";
import {
  createSoftBufferState,
  stepSoftBuffer,
  SOFT_BUFFER_CHAR_THRESHOLD,
} from "./softStreamBuffer";

describe("softStreamBuffer", () => {
  it("reveals streaming text immediately (never hides a short intro)", () => {
    let state = createSoftBufferState();
    let r = stepSoftBuffer({
      state,
      raw: "hi",
      streaming: true,
      nowMs: 1000,
    });
    // First chunk paints right away — a short intro before tool calls must
    // not stay invisible until thresholds or tools arrive.
    expect(r.displayed).toBe("hi");
    expect(r.state.bypassed).toBe(true);
    const long = "x".repeat(SOFT_BUFFER_CHAR_THRESHOLD);
    r = stepSoftBuffer({
      state: r.state,
      raw: long,
      streaming: true,
      nowMs: 1001,
    });
    expect(r.displayed).toBe(long);
    expect(r.state.bypassed).toBe(true);
  });

  it("bypasses code fences immediately", () => {
    const r = stepSoftBuffer({
      state: createSoftBufferState(),
      raw: "```json\n{}\n",
      streaming: true,
      nowMs: 0,
    });
    expect(r.displayed).toContain("```json");
    expect(r.state.bypassed).toBe(true);
  });

  it("releases full text when not streaming", () => {
    const r = stepSoftBuffer({
      state: createSoftBufferState(),
      raw: "done",
      streaming: false,
      nowMs: 0,
    });
    expect(r.displayed).toBe("done");
  });
});
