import { describe, expect, it } from "vitest";
import { petVerbFor } from "./petFocus";
import {
  PET_REST_MOODS,
  pickRestEmote,
  resolveLivingMood,
} from "./petMood";

describe("petVerbFor session mapping", () => {
  it("keeps the shipped session verbs", () => {
    expect(petVerbFor("needs_you")).toBe("waiting");
    expect(petVerbFor("error")).toBe("sad");
    expect(petVerbFor("ready")).toBe("notifying");
    expect(petVerbFor("connecting")).toBe("waking");
    expect(petVerbFor("idle")).toBe("idle");
    expect(petVerbFor("working", "npm test")).toBe("working");
  });

  it("maps write / search / think tools onto distinct faces", () => {
    expect(petVerbFor("working", "apply_patch")).toBe("writing");
    expect(petVerbFor("working", "str_replace")).toBe("writing");
    expect(petVerbFor("working", "web_search")).toBe("searching");
    expect(petVerbFor("working", "think")).toBe("thinking");
  });
});

describe("resolveLivingMood", () => {
  const now = 10_000;

  it("drag and one-shot emotes beat the session face", () => {
    expect(
      resolveLivingMood({
        sessionVerb: "working",
        dragging: true,
        now,
      }),
    ).toBe("dragging");
    expect(
      resolveLivingMood({
        sessionVerb: "idle",
        now,
        emoteMood: "laughing",
        emoteUntil: now + 500,
      }),
    ).toBe("laughing");
    expect(
      resolveLivingMood({
        sessionVerb: "idle",
        now,
        emoteMood: "laughing",
        emoteUntil: now - 1,
      }),
    ).toBe("idle");
  });

  it("idle hover faces the pointer immediately (listening), not curious first", () => {
    expect(
      resolveLivingMood({
        sessionVerb: "idle",
        now,
        hovering: true,
        hoverMs: 0,
      }),
    ).toBe("listening");
    expect(
      resolveLivingMood({
        sessionVerb: "idle",
        now,
        hovering: true,
        hoverMs: 200,
      }),
    ).toBe("listening");
    expect(
      resolveLivingMood({
        sessionVerb: "working",
        now,
        hovering: true,
        hoverMs: 2000,
      }),
    ).toBe("working");
  });

  it("idle rest bursts only apply while they last", () => {
    expect(
      resolveLivingMood({
        sessionVerb: "idle",
        now,
        idleBurstMood: "shy",
        idleBurstUntil: now + 100,
      }),
    ).toBe("shy");
    expect(
      resolveLivingMood({
        sessionVerb: "idle",
        now,
        idleBurstMood: "shy",
        idleBurstUntil: now,
      }),
    ).toBe("idle");
  });
});

describe("pickRestEmote", () => {
  it("picks a catalog rest face and can exclude the last one", () => {
    expect(PET_REST_MOODS.length).toBeGreaterThan(8);
    const first = pickRestEmote(undefined, 0);
    expect(PET_REST_MOODS).toContain(first);
    expect(first).not.toBe("idle");
    const next = pickRestEmote(first, 0);
    expect(next).not.toBe(first);
    expect(PET_REST_MOODS).toContain(next);
  });
});
