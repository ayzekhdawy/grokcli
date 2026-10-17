/**
 * Type or browse a remote directory on an OpenSSH host.
 */
import { useCallback, useEffect, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import * as api from "@/lib/api";
import type { Vars } from "@/i18n";

type Props = {
  open: boolean;
  alias: string;
  initialPath?: string;
  t: (k: string, vars?: Vars) => string;
  onClose: () => void;
  onOpen: (path: string) => void;
};

export function SshPathPickerModal({
  open,
  alias,
  initialPath = "",
  t,
  onClose,
  onOpen,
}: Props) {
  const [path, setPath] = useState(initialPath);
  const [listing, setListing] = useState<api.SshListDirResult | null>(null);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(
    async (next: string) => {
      if (!api.isTauri()) return;
      setLoading(true);
      try {
        const r = await api.sshListDir(alias, next || null);
        setListing(r);
        if (r.ok && r.path) setPath(r.path);
      } finally {
        setLoading(false);
      }
    },
    [alias],
  );

  useEffect(() => {
    if (!open) return;
    setPath(initialPath);
    void browse(initialPath);
  }, [open, alias, initialPath, browse]);

  const parent = path.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
  const dirs = (listing?.entries ?? []).filter((e) => e.isDir);

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={t("composer.remote.pathTitle", { alias })}
      size="md"
      wrapBody
      closeLabel={t("common.cancel")}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!path.trim()}
            onClick={() => onOpen(path.trim())}
          >
            {t("composer.remote.open")}
          </button>
        </>
      }
    >
      <div className="settings-row settings-row--stack">
        <input
          className="settings-input"
          value={path}
          placeholder={t("composer.remote.pathPlaceholder")}
          aria-label={t("composer.remote.pathPlaceholder")}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void browse(path.trim());
            }
          }}
        />
        <div className="settings-ssh-host__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={loading}
            onClick={() => void browse("")}
          >
            {t("composer.remote.home")}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={loading || !path || path === "/"}
            onClick={() => void browse(parent)}
          >
            {t("composer.remote.parent")}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={loading}
            onClick={() => void browse(path.trim())}
          >
            {t("composer.remote.browse")}
          </button>
        </div>
        {listing && !listing.ok ? (
          <div className="settings-row__hint is-danger" role="status">
            {listing.error || t("settings.ssh.unknownHost")}
          </div>
        ) : null}
        {loading ? (
          <div className="settings-row__hint">{t("settings.ssh.loading")}</div>
        ) : (
          <ul className="ssh-path-list">
            {dirs.map((d) => {
              const next = `${listing?.path?.replace(/\/+$/, "") || ""}/${d.name}`.replace(
                /\/+/g,
                "/",
              );
              return (
                <li key={d.name}>
                  <button
                    type="button"
                    className="ssh-path-list__row"
                    onClick={() => void browse(next)}
                  >
                    {d.name}/
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </GlassModal>
  );
}
