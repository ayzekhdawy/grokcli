import { describe, expect, it } from "vitest";
import {
  parseRemoteImUserContent,
  remoteImChannelLabel,
} from "./remoteImUserContent";

describe("parseRemoteImUserContent", () => {
  it("parses journaled Remote IM header", () => {
    const p = parseRemoteImUserContent(
      "[Remote IM · feishu]\n不继续计划了，写个总结",
    );
    expect(p).toEqual({
      channel: "feishu",
      body: "不继续计划了，写个总结",
    });
  });

  it("parses weixin and multi-line body", () => {
    const p = parseRemoteImUserContent(
      "[Remote IM · weixin]\n\n第一行\n第二行",
    );
    expect(p?.channel).toBe("weixin");
    expect(p?.body).toBe("第一行\n第二行");
  });

  it("returns null for normal text", () => {
    expect(parseRemoteImUserContent("普通消息")).toBeNull();
    expect(parseRemoteImUserContent("[Scheduled: 日报]\n\nhi")).toBeNull();
  });
});

describe("remoteImChannelLabel", () => {
  it("localizes known channels", () => {
    expect(remoteImChannelLabel("feishu", "zh")).toBe("飞书");
    expect(remoteImChannelLabel("weixin", "en")).toBe("WeChat");
    expect(remoteImChannelLabel("unknown-x", "zh")).toBe("unknown-x");
  });
});
