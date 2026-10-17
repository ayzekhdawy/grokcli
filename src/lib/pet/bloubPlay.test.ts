import { describe, expect, it } from "vitest";
import { BotEngine, POSES } from "./bloub";
import { REST_GAZE } from "./bloub/face";
import { PET_LOOK_NEAR_SCALE } from "./petMarkPaint";
import {
  BLOUB_LOOK_LOCAL_ENTER_MORPH,
  PET_COMPOSING_HOLD_MS,
  bloubExpressionOf,
  bloubLookAtPointer,
  bloubNotifFill,
  bloubSettleState,
  bloubShapeId,
  bloubShapeRadii,
  bloubShouldLoop,
  bloubStateNeedsLivePaint,
  normalizePetExpression,
  petIsComposing,
  petVerbForComposer,
  resolveBloubPlay,
} from "./bloubPlay";

describe("bloub product mapping", () => {
  it("maps saved pet shapes onto the 8 bloub skins", () => {
    expect(bloubShapeId("hex")).toBe("hexagone");
    expect(bloubShapeId("blob")).toBe("cercle");
    expect(bloubShapeId("wedge")).toBe("triangle");
    expect(bloubShapeId("cloud")).toBe("nuage");
    expect(bloubShapeId("leaf")).toBe("goutte");
    expect(bloubShapeId("nope")).toBe("cercle");
  });

  it("maps session verbs onto measured animation states", () => {
    expect(resolveBloubPlay("writing", "neutre").state).toBe("alert");
    expect(resolveBloubPlay("notifying", "neutre").state).toBe("notify");
    expect(resolveBloubPlay("waiting", "neutre").state).toBe("wide");
    expect(resolveBloubPlay("thinking", "neutre").state).toBe("thinking");
    expect(resolveBloubPlay("searching", "neutre").state).toBe("comet");
    expect(resolveBloubPlay("working", "neutre").state).toBe("orbit");
    expect(resolveBloubPlay("sad", "neutre").state).toBe("exclaim");
    expect(resolveBloubPlay("celebrate", "neutre").state).toBe("idle");
  });

  it("maps rest moods onto idle + expression", () => {
    const play = resolveBloubPlay("laughing", "neutre");
    expect(play.state).toBe("idle");
    expect(play.expression).toBe("hilare");
    expect(resolveBloubPlay("idle", "curieux").expression).toBe("curieux");
    expect(normalizePetExpression("nope")).toBe("neutre");
  });

  it("turns composer typing into the catalog alert morph while idle", () => {
    expect(
      petVerbForComposer({ sessionVerb: "idle", composing: true }),
    ).toBe("writing");
    expect(resolveBloubPlay("writing", "neutre").state).toBe("alert");
    expect(
      petVerbForComposer({ sessionVerb: "working", composing: true }),
    ).toBe("working");
    expect(
      petVerbForComposer({ sessionVerb: "idle", composing: false }),
    ).toBe("idle");
  });

  it("drops the alert morph when typing pauses or the draft is empty", () => {
    expect(
      petIsComposing({ empty: true, lastTypeAt: 1000, now: 1100 }),
    ).toBe(false);
    expect(
      petIsComposing({ empty: false, lastTypeAt: 0, now: 5000 }),
    ).toBe(false);
    expect(
      petIsComposing({ empty: false, lastTypeAt: 1000, now: 1100 }),
    ).toBe(true);
    expect(
      petIsComposing({
        empty: false,
        lastTypeAt: 1000,
        now: 1000 + PET_COMPOSING_HOLD_MS + 1,
      }),
    ).toBe(false);
  });

  it("loops the typing alert and settles orbit/comet after one cycle", () => {
    expect(bloubShouldLoop("alert")).toBe(true);
    expect(bloubShouldLoop("orbit")).toBe(false);
    expect(bloubShouldLoop("comet")).toBe(false);
    expect(bloubSettleState("orbit")).toBe("thinking");
    expect(bloubSettleState("comet")).toBe("thinking");
    expect(bloubSettleState("alert")).toBeNull();
    expect(bloubStateNeedsLivePaint("orbit")).toBe(true);
    expect(bloubStateNeedsLivePaint("thinking")).toBe(true);
    expect(bloubStateNeedsLivePaint("idle")).toBe(false);
  });

  it("uses a non-blue unread pastille", () => {
    expect(bloubNotifFill("#111111")).toBe("#FF3B1A");
    expect(bloubNotifFill("#FF3B1A")).toBe("#C8FF00");
  });

  it("samples idle, hexagon, and notify frames from the engine", () => {
    const engine = new BotEngine(
      100,
      "idle",
      bloubShapeRadii("blob"),
      bloubExpressionOf("neutre"),
    );
    const idle = engine.sample(POSES.idle);
    expect(idle.bodyPath.startsWith("M")).toBe(true);
    expect(idle.eyes.length).toBe(2);
    engine.setState("hexagon", 0);
    const hex = engine.sample(POSES.hexagon);
    expect(hex.bodyPath.startsWith("M")).toBe(true);
    expect(hex.bodyPath).not.toBe(idle.bodyPath);
    engine.reset("notify", 0);
    const note = engine.sample(POSES.notify);
    expect(note.notif).not.toBeNull();
    expect(note.notif!.r).toBeGreaterThan(0);
  });

  it("samples distinct typing / trigger / finish catalogue poses", () => {
    const engine = new BotEngine(
      100,
      "idle",
      bloubShapeRadii("blob"),
      bloubExpressionOf("neutre"),
    );
    const idle = engine.sample(POSES.idle);
    engine.reset(resolveBloubPlay("writing", "neutre").state, 0);
    const typing = engine.sample(POSES.alert);
    expect(typing.bodyPath).not.toBe(idle.bodyPath);
    expect(typing.dots.length).toBeGreaterThan(0);

    engine.reset(resolveBloubPlay("working", "neutre").state, 0);
    const trigger = engine.sample(POSES.orbit);
    expect(trigger.arcs.length).toBeGreaterThan(0);
    expect(trigger.bodyPath).not.toBe(typing.bodyPath);

    engine.reset(resolveBloubPlay("notifying", "neutre").state, 0);
    const done = engine.sample(POSES.notify);
    expect(done.notif).not.toBeNull();
    expect(done.bodyPath).not.toBe(trigger.bodyPath);
  });
});

function eyeAreaScale(matrix: string): number {
  const inner = matrix.match(/matrix\(([^)]+)\)/)?.[1];
  expect(inner, matrix).toBeTruthy();
  const [a, b, c, d] = inner!.split(",").map(Number);
  return Math.abs(a * d - b * c);
}

function eyePairRatio(engine: BotEngine, t: number): number {
  const eyes = engine.sample(t).eyes;
  expect(eyes).toHaveLength(2);
  const a = eyeAreaScale(eyes[0]!.matrix);
  const b = eyeAreaScale(eyes[1]!.matrix);
  return Math.min(a, b) / Math.max(a, b);
}

describe("local hover look", () => {
  it("faces the camera as the pointer enters the local ring", () => {
    expect(BLOUB_LOOK_LOCAL_ENTER_MORPH).toBeGreaterThan(0.2);
    const enter = bloubLookAtPointer(PET_LOOK_NEAR_SCALE, 0, true);
    expect(enter.mix).toBe(1);
    expect(enter.wander).toBe(0);
    expect(enter.yaw).toBeCloseTo(0, 5);
    expect(enter.pitch).toBeGreaterThan(0);
    const center = bloubLookAtPointer(0, 0, true);
    expect(center.yaw).toBeCloseTo(0, 5);
    expect(center.mix).toBe(1);
  });

  it("travels with hover offset across the face, short of a rest 3/4 turn", () => {
    const left = bloubLookAtPointer(-0.35, 0, true);
    const right = bloubLookAtPointer(0.35, 0.2, true);
    const cheek = bloubLookAtPointer(1, 0, true);
    expect(left.yaw).toBeLessThan(0);
    expect(right.yaw).toBeGreaterThan(0);
    expect(Math.abs(left.yaw)).toBeGreaterThan(6);
    expect(Math.abs(cheek.yaw)).toBeGreaterThan(12);
    expect(Math.abs(cheek.yaw)).toBeLessThan(Math.abs(REST_GAZE.yaw));
    expect(Math.abs(right.pitch - left.pitch)).toBeGreaterThan(2);
  });

  it("eases from rest 3/4 to a frontal pair instead of jumping", () => {
    const rest = new BotEngine(
      100,
      "idle",
      bloubShapeRadii("blob"),
      bloubExpressionOf("neutre"),
    );
    const restRatio = eyePairRatio(rest, 0);
    expect(restRatio).toBeLessThan(0.85);

    const hover = new BotEngine(
      100,
      "idle",
      bloubShapeRadii("blob"),
      bloubExpressionOf("neutre"),
    );
    hover.setLook(bloubLookAtPointer(-0.35, 0.1, true), 0, BLOUB_LOOK_LOCAL_ENTER_MORPH);
    expect(eyePairRatio(hover, 0)).toBeCloseTo(restRatio, 2);
    const mid = eyePairRatio(hover, BLOUB_LOOK_LOCAL_ENTER_MORPH * 0.15);
    const end = eyePairRatio(hover, BLOUB_LOOK_LOCAL_ENTER_MORPH);
    expect(mid).toBeGreaterThan(restRatio);
    expect(end).toBeGreaterThan(mid);
    expect(end).toBeGreaterThan(0.84);
  });

  it("scales the two eyes more at the cheek than at center, without rest 大小眼", () => {
    const rest = new BotEngine(
      100,
      "idle",
      bloubShapeRadii("blob"),
      bloubExpressionOf("neutre"),
    );
    const restRatio = eyePairRatio(rest, 0);
    const center = new BotEngine(
      100,
      "idle",
      bloubShapeRadii("blob"),
      bloubExpressionOf("neutre"),
    );
    center.setLook(bloubLookAtPointer(0, 0, true), 0, 0);
    const cheek = new BotEngine(
      100,
      "idle",
      bloubShapeRadii("blob"),
      bloubExpressionOf("neutre"),
    );
    cheek.setLook(bloubLookAtPointer(1, 0, true), 0, 0);
    const centerRatio = eyePairRatio(center, 0);
    const cheekRatio = eyePairRatio(cheek, 0);
    expect(centerRatio).toBeGreaterThan(0.92);
    expect(cheekRatio).toBeLessThan(centerRatio - 0.04);
    expect(cheekRatio).toBeGreaterThan(restRatio);
    expect(cheekRatio).toBeGreaterThan(0.72);
  });

  it("reports look and expression morphs so the overlay can paint at full cadence", () => {
    const engine = new BotEngine(
      100,
      "idle",
      bloubShapeRadii("blob"),
      bloubExpressionOf("neutre"),
    );
    expect(engine.isMorphing(0)).toBe(false);
    engine.setExpression(bloubExpressionOf("attentif"), 1);
    expect(engine.isMorphing(1)).toBe(true);
    expect(engine.isMorphing(1 + BotEngine.SHAPE_MORPH + 0.01)).toBe(false);
    engine.setLook(bloubLookAtPointer(0, 0, true), 3, BLOUB_LOOK_LOCAL_ENTER_MORPH);
    expect(engine.isMorphing(3)).toBe(true);
    expect(engine.isMorphing(3 + BLOUB_LOOK_LOCAL_ENTER_MORPH + 0.01)).toBe(false);
  });
});
