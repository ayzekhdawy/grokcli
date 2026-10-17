import { describe, expect, it } from "vitest";
import { mirrorInvoke } from "./mirrorTransport";

/**
 * The `CMD_TO_METHOD` allowlist in mirrorTransport is the client-side half of
 * the mirror RPC security boundary: only Tauri command names present in it are
 * translatable to a WS method, everything else throws `UNSUPPORTED` before any
 * frame is sent. These tests pin that boundary.
 *
 * In the test env `isMirrorClient()` is false, so `mirrorEnsureTransport()`
 * resolves immediately and an *allowlisted* command fails with
 * "mirror websocket not connected" — i.e. it passed the allowlist and reached
 * the transport. A non-allowlisted command instead throws synchronously with
 * `code === "UNSUPPORTED"` and never touches the socket.
 */

async function invokeError(cmd: string): Promise<Error & { code?: string }> {
  try {
    await mirrorInvoke(cmd, {});
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error(`expected mirrorInvoke(${cmd}) to reject`);
}

describe("mirror CMD_TO_METHOD allowlist", () => {
  it("rejects commands not on the allowlist with UNSUPPORTED", async () => {
    // Desktop-only surfaces the phone must never reach.
    for (const cmd of ["secrets_get_masked", "voice_start", "reset_app_data", "fs_read_file"]) {
      const err = await invokeError(cmd);
      expect(err.code, cmd).toBe("UNSUPPORTED");
    }
  });

  it("allows voice_status (voice.status) past the boundary", async () => {
    const err = await invokeError("voice_status");
    // Allowlisted → not UNSUPPORTED; it reached the transport layer.
    expect(err.code).not.toBe("UNSUPPORTED");
    expect(String(err.message)).toContain("mirror websocket");
  });

  it("allows session_stop_report (session.stopReport) past the boundary", async () => {
    const err = await invokeError("session_stop_report");
    expect(err.code).not.toBe("UNSUPPORTED");
    expect(String(err.message)).toContain("mirror websocket");
  });

  it("allows voice_transcribe (voice.transcribe) past the boundary", async () => {
    const err = await invokeError("voice_transcribe");
    expect(err.code).not.toBe("UNSUPPORTED");
    expect(String(err.message)).toContain("mirror websocket");
  });
});
