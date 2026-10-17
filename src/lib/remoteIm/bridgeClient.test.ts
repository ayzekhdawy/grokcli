import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetBridgeMock,
  bridgeGetStatus,
  bridgeReloadInstance,
  bridgeStart,
  bridgeStop,
  bridgeTestConnection,
} from "./bridgeClient";
import { createDefaultInstance } from "./store";

describe("remoteIm bridgeClient (mock)", () => {
  beforeEach(() => {
    __resetBridgeMock();
  });

  it("starts and stops attached bridge", async () => {
    let st = await bridgeGetStatus();
    expect(st.state).toBe("stopped");
    expect(st.mock).toBe(true);

    st = await bridgeStart();
    expect(st.state).toBe("running");
    expect(st.enabled).toBe(true);

    st = await bridgeStop();
    expect(st.state).toBe("stopped");
  });

  it("test connection requires credentials", async () => {
    const miss = await bridgeTestConnection({
      channel: "feishu",
      instanceId: "feishu-default",
      hasCredentials: false,
    });
    expect(miss.ok).toBe(false);

    const ok = await bridgeTestConnection({
      channel: "feishu",
      instanceId: "feishu-default",
      hasCredentials: true,
    });
    expect(ok.ok).toBe(true);
    expect(ok.mock).toBe(true);
  });

  it("reload marks connected channel when enabled with credentials", async () => {
    await bridgeStart();
    const inst = {
      ...createDefaultInstance("feishu"),
      enabled: true,
      hasCredentials: true,
      credentialsRef: "remote_im:feishu:feishu-default",
    };
    const st = await bridgeReloadInstance(inst);
    expect(st.connectedChannels.some((c) => c.channel === "feishu")).toBe(
      true,
    );
  });
});
