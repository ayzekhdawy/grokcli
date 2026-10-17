/**
 * Settings → Runtime → SSH: watch list, live search, available hosts.
 * Layout must use `.settings-card` + `.settings-row` (14px 16px). Do not
 * render labels outside a settings-row — they sit on the card edge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api";
import type { MessageKey, Vars } from "@/i18n";
import { UiSwitch } from "./shared";
import { mergeWatchingSet, partitionSshHosts } from "@/lib/sshHostMatch";
import { remoteSessionLabel } from "@/lib/sshRemoteSessionDisplay";
import { useSshWatch } from "@/providers/SshWatchProvider";

type TFn = (k: MessageKey, vars?: Vars) => string;

type Props = {
  t: TFn;
};

export function SshHostsPanel({ t }: Props) {
  const watch = useSshWatch();
  const [list, setList] = useState<api.SshListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [watchErr, setWatchErr] = useState<Record<string, string>>({});
  const [probes, setProbes] = useState<Record<string, api.SshProbeResult>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const inflightRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setList(await api.sshListHosts());
    } catch (e) {
      setList({
        hosts: [],
        configPath: "",
        configExists: false,
        sshFound: false,
        error: String(e),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const runTest = async (alias: string): Promise<api.SshProbeResult | null> => {
    if (!api.isTauri()) return null;
    setTesting(alias);
    try {
      const r = await api.sshTestHost(alias);
      setProbes((prev) => ({ ...prev, [alias]: r }));
      return r;
    } catch (e) {
      const r: api.SshProbeResult = {
        alias,
        ok: false,
        sshOk: false,
        cli: "unknown",
        auth: "unknown",
        error: String(e),
        errorCode: "other",
        installCmd: `ssh ${alias} 'curl -fsSL https://x.ai/cli/install.sh | bash'`,
        loginCmd: `ssh -t ${alias} 'grok login --device-auth'`,
        installRemoteCmd: "curl -fsSL https://x.ai/cli/install.sh | bash",
        loginRemoteCmd: "grok login --device-auth",
      };
      setProbes((prev) => ({ ...prev, [alias]: r }));
      return r;
    } finally {
      setTesting(null);
    }
  };

  const watchingSet = useMemo(
    () => mergeWatchingSet(watch.watchAliases, pending),
    [watch.watchAliases, pending],
  );
  const persistedWatch = useMemo(
    () => new Set(watch.watchAliases),
    [watch.watchAliases],
  );
  const parts = useMemo(
    () => partitionSshHosts(list?.hosts ?? [], watchingSet, query),
    [list?.hosts, watchingSet, query],
  );

  const onWatch = async (alias: string, next: boolean) => {
    if (!api.isTauri()) return;
    if (inflightRef.current.has(alias)) return;
    inflightRef.current.add(alias);
    setPending((p) => ({ ...p, [alias]: next }));
    setWatchErr((e) => {
      const n = { ...e };
      delete n[alias];
      return n;
    });
    try {
      const r = next
        ? await watch.enableWatch(alias)
        : await watch.disableWatch(alias);
      if (!r.ok) {
        setWatchErr((e) => ({
          ...e,
          [alias]: t("settings.ssh.watchError", {
            error: r.error || t("settings.ssh.unknownHost"),
          }),
        }));
        return;
      }
      if (next) void runTest(alias);
    } catch (err) {
      setWatchErr((e) => ({
        ...e,
        [alias]: t("settings.ssh.watchError", { error: String(err) }),
      }));
    } finally {
      inflightRef.current.delete(alias);
      setPending((p) => {
        const n = { ...p };
        delete n[alias];
        return n;
      });
    }
  };

  const desktop = api.isTauri();
  const hosts = list?.hosts ?? [];

  return (
    <div className="settings-card" id="settings-anchor-sshHosts">
      <div className="settings-row settings-row--stack">
        <div className="settings-row__text">
          <div className="settings-row__label">{t("settings.ssh.title")}</div>
          <div className="settings-row__desc">{t("settings.ssh.desc")}</div>
        </div>
        {list?.configPath ? (
          <div className="settings-row__hint">
            {t("settings.ssh.configPath", { path: list.configPath })}
          </div>
        ) : null}
        {!list?.sshFound ? (
          <div className="settings-row__hint is-danger" role="status">
            {t("settings.ssh.sshBinaryMissing")}
          </div>
        ) : null}
        {list?.error && list.error !== "desktop-only" ? (
          <div className="settings-row__hint is-danger" role="alert">
            {list.error}
          </div>
        ) : null}
        <div className="settings-row__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!desktop || loading}
            onClick={() => void refresh()}
          >
            {t("settings.ssh.refresh")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="settings-row">
          <div className="settings-row__hint">{t("settings.ssh.loading")}</div>
        </div>
      ) : !desktop ? (
        <div className="settings-row">
          <div className="settings-row__hint">{t("settings.ssh.honesty")}</div>
        </div>
      ) : !list?.configExists ? (
        <div className="settings-row">
          <div className="settings-row__hint">
            {t("settings.ssh.configMissing", {
              path: list?.configPath || "~/.ssh/config",
            })}
          </div>
        </div>
      ) : hosts.length === 0 ? (
        <div className="settings-row">
          <div className="settings-row__hint">{t("settings.ssh.noHosts")}</div>
        </div>
      ) : (
        <>
          <div className="settings-row settings-row--stack">
            <div className="settings-row__text">
              <div className="settings-row__label">
                {t("settings.ssh.watchingTitle")}
              </div>
              <div className="settings-row__desc">
                {t("settings.ssh.watchingHint")}
              </div>
            </div>
          </div>
          {parts.watching.length === 0 ? (
            <div className="settings-row">
              <div className="settings-row__hint">
                {t("settings.ssh.watchingEmpty")}
              </div>
            </div>
          ) : (
            parts.watching.map((h) => (
              <HostRow
                key={h.alias}
                host={h}
                t={t}
                watching
                confirmed={persistedWatch.has(h.alias)}
                pending={Object.prototype.hasOwnProperty.call(pending, h.alias)}
                watchError={watchErr[h.alias]}
                sshFound={!!list?.sshFound}
                testing={testing}
                probe={probes[h.alias]}
                copied={copied}
                sessions={watch.sessionsByAlias[h.alias] ?? []}
                onTest={() => void runTest(h.alias)}
                onWatch={(next) => void onWatch(h.alias, next)}
                onCopy={copy}
              />
            ))
          )}

          <div className="settings-row settings-row--stack">
            <input
              className="settings-input"
              type="search"
              value={query}
              placeholder={t("settings.ssh.searchPlaceholder")}
              aria-label={t("settings.ssh.searchPlaceholder")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {query.trim() &&
          parts.watching.length === 0 &&
          parts.available.length === 0 ? (
            <div className="settings-row">
              <div className="settings-row__hint">
                {t("settings.ssh.searchEmpty")}
              </div>
            </div>
          ) : (
            <>
              <div className="settings-row settings-row--stack">
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.ssh.availableTitle")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.ssh.availableHint")}
                  </div>
                </div>
              </div>
              {parts.available.length === 0 ? (
                <div className="settings-row">
                  <div className="settings-row__hint">
                    {t("settings.ssh.availableEmpty")}
                  </div>
                </div>
              ) : (
                parts.available.map((h) => (
                  <HostRow
                    key={h.alias}
                    host={h}
                    t={t}
                    watching={false}
                    confirmed={false}
                    pending={Object.prototype.hasOwnProperty.call(pending, h.alias)}
                    watchError={watchErr[h.alias]}
                    sshFound={!!list?.sshFound}
                    testing={testing}
                    probe={probes[h.alias]}
                    copied={copied}
                    sessions={[]}
                    onTest={() => void runTest(h.alias)}
                    onWatch={(next) => void onWatch(h.alias, next)}
                    onCopy={copy}
                  />
                ))
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function HostRow({
  host,
  t,
  watching,
  confirmed,
  pending,
  watchError,
  sshFound,
  testing,
  probe,
  copied,
  sessions,
  onTest,
  onWatch,
  onCopy,
}: {
  host: api.SshHost;
  t: TFn;
  watching: boolean;
  confirmed: boolean;
  pending: boolean;
  watchError?: string;
  sshFound: boolean;
  testing: string | null;
  probe?: api.SshProbeResult;
  copied: string | null;
  sessions: api.SshRemoteSession[];
  onTest: () => void;
  onWatch: (next: boolean) => void;
  onCopy: (key: string, text: string) => void;
}) {
  const testingThis = testing === host.alias;
  const meta = [
    host.user ? t("settings.ssh.user", { user: host.user }) : null,
    host.hostname || null,
    host.port ? t("settings.ssh.port", { port: host.port }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="settings-row settings-row--stack" aria-busy={pending}>
      <div className="settings-ssh-hostline">
        <div className="settings-row__text">
          <div className="settings-row__label">{host.alias}</div>
          {meta ? <div className="settings-row__desc">{meta}</div> : null}
        </div>
        <div className="settings-ssh-hostline__controls">
          <UiSwitch
            checked={watching}
            disabled={!sshFound}
            label={
              watching ? t("settings.ssh.watchOff") : t("settings.ssh.watchOn")
            }
            onChange={onWatch}
          />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={testingThis || !sshFound}
            onClick={onTest}
          >
            {testingThis
              ? t("settings.ssh.testing")
              : t("settings.ssh.test")}
          </button>
        </div>
      </div>
      {watchError ? (
        <div className="settings-row__hint is-danger" role="alert">
          {watchError}
        </div>
      ) : pending ? (
        <div className="settings-row__hint">
          {watching
            ? t("settings.ssh.watchStarting")
            : t("settings.ssh.watchStopping")}
        </div>
      ) : null}
      {probe ? (
        <HostProbe t={t} probe={probe} copied={copied} onCopy={onCopy} />
      ) : watching || pending ? null : (
        <div className="settings-row__hint">{t("settings.ssh.notProbed")}</div>
      )}
      {confirmed && sessions.length > 0 ? (
        <ul className="settings-ssh-sessions">
          {sessions.slice(0, 8).map((s) => (
            <li key={s.id} className="settings-ssh-session">
              <span className="settings-ssh-session__title">
                {remoteSessionLabel({
                  title: s.title,
                  cwd: s.cwd,
                  untitled: s.id.slice(0, 8),
                })}
              </span>
              {s.cwd ? (
                <span className="settings-ssh-session__cwd">{s.cwd}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : confirmed ? (
        <div className="settings-row__hint">
          {t("settings.ssh.remoteSessionsEmpty")}
        </div>
      ) : null}
    </div>
  );
}

function HostProbe({
  t,
  probe,
  copied,
  onCopy,
}: {
  t: TFn;
  probe: api.SshProbeResult;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const sshChip = probe.sshOk ? "is-ok" : "is-fail";
  const cliChip =
    probe.cli === "ok" ? "is-ok" : probe.cli === "missing" ? "is-fail" : "is-muted";
  const authChip =
    probe.auth === "ok" ? "is-ok" : probe.auth === "missing" ? "is-fail" : "is-muted";
  const showInstall = probe.cli !== "ok";
  const showLogin = probe.cli === "ok" && probe.auth !== "ok";

  return (
    <div className="settings-ssh-probe">
      <div className="settings-ssh-chips">
        <span className={"settings-acp-chip " + sshChip} role="status">
          <span className="settings-acp-chip__dot" aria-hidden />
          <span className="settings-acp-chip__label">
            {probe.sshOk
              ? t("settings.ssh.statusSshOk")
              : t("settings.ssh.statusSshFail", {
                  error: probe.error || t("settings.ssh.unknownHost"),
                })}
          </span>
        </span>
        {probe.sshOk ? (
          <>
            <span className={"settings-acp-chip " + cliChip} role="status">
              <span className="settings-acp-chip__dot" aria-hidden />
              <span className="settings-acp-chip__label">
                {probe.cli === "ok"
                  ? t("settings.ssh.statusCliOk", {
                      version: probe.cliVersion || "grok",
                    })
                  : t("settings.ssh.statusCliMissing")}
              </span>
            </span>
            <span className={"settings-acp-chip " + authChip} role="status">
              <span className="settings-acp-chip__dot" aria-hidden />
              <span className="settings-acp-chip__label">
                {probe.auth === "ok"
                  ? t("settings.ssh.statusAuthOk")
                  : t("settings.ssh.statusAuthMissing")}
              </span>
            </span>
          </>
        ) : null}
      </div>
      {probe.errorCode === "host_key" ? (
        <div className="settings-row__hint">
          {t("settings.ssh.hostKeyHint", { alias: probe.alias })}
        </div>
      ) : null}
      {showInstall ? (
        <CopyCmd
          title={t("settings.ssh.installTitle")}
          hint={t("settings.ssh.installHint", { alias: probe.alias })}
          cmd={probe.installCmd}
          copyKey={`${probe.alias}-install`}
          copied={copied}
          onCopy={onCopy}
          t={t}
        />
      ) : null}
      {showLogin ? (
        <CopyCmd
          title={t("settings.ssh.loginTitle")}
          hint={t("settings.ssh.loginHint", { alias: probe.alias })}
          cmd={probe.loginCmd}
          copyKey={`${probe.alias}-login`}
          copied={copied}
          onCopy={onCopy}
          t={t}
        />
      ) : null}
    </div>
  );
}

function CopyCmd({
  title,
  hint,
  cmd,
  copyKey,
  copied,
  onCopy,
  t,
}: {
  title: string;
  hint: string;
  cmd: string;
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  t: TFn;
}) {
  return (
    <div className="settings-ssh-cmd">
      <div className="settings-row__label">{title}</div>
      <div className="settings-row__hint">{hint}</div>
      <code className="settings-acp-cmd">{cmd}</code>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => onCopy(copyKey, cmd)}
      >
        {copied === copyKey ? t("message.copied") : t("message.copy")}
      </button>
    </div>
  );
}
