import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetRemoteImSecretsMock,
  credentialsRefFor,
  maskSecretValue,
  redactRemoteImLog,
  remoteImSecretsDelete,
  remoteImSecretsGetMasked,
  remoteImSecretsPut,
} from "./secretsApi";

describe("remoteIm secretsApi", () => {
  beforeEach(() => {
    __resetRemoteImSecretsMock();
  });

  it("masks secrets and stores by credentialsRef", async () => {
    const ref = credentialsRefFor("feishu", "feishu-default");
    await remoteImSecretsPut({
      credentialsRef: ref,
      channel: "feishu",
      instanceId: "feishu-default",
      secrets: { app_secret: "super-secret-value" },
    });
    const masked = await remoteImSecretsGetMasked(ref);
    expect(masked?.masked.app_secret).toBe(maskSecretValue("super-secret-value"));
    expect(String(masked?.masked.app_secret)).not.toContain("super-secret");
  });

  it("deletes secrets", async () => {
    const ref = credentialsRefFor("telegram", "t1");
    await remoteImSecretsPut({
      credentialsRef: ref,
      channel: "telegram",
      instanceId: "t1",
      secrets: { token: "123456:AA" },
    });
    await remoteImSecretsDelete(ref);
    expect(await remoteImSecretsGetMasked(ref)).toBeNull();
  });

  it("redacts secret keys from log objects", () => {
    const r = redactRemoteImLog({
      app_id: "cli_x",
      app_secret: "leak-me-now",
      nested: { bot_token: "xoxb-1" },
    });
    expect(r.app_id).toBe("cli_x");
    expect(String(r.app_secret)).not.toContain("leak");
    expect(
      String((r.nested as Record<string, unknown>).bot_token),
    ).not.toContain("xoxb");
  });
});
