import { describe, expect, it } from "vitest";
import { arrayBufferToBase64, floatTo16BitPCM } from "./voiceAudio";

describe("voiceAudio", () => {
  it("encodes silence to PCM base64", () => {
    const samples = new Float32Array(16);
    const pcm = floatTo16BitPCM(samples);
    expect(pcm.byteLength).toBe(32);
    const b64 = arrayBufferToBase64(pcm);
    expect(b64.length).toBeGreaterThan(0);
    expect(atob(b64).length).toBe(32);
  });

  it("clamps float samples", () => {
    const samples = new Float32Array([2, -2, 0.5]);
    const view = new DataView(floatTo16BitPCM(samples));
    expect(view.getInt16(0, true)).toBe(0x7fff);
    expect(view.getInt16(2, true)).toBe(-0x8000);
  });
});
