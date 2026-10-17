/**
 * Composer location chip: this computer vs a watching SSH host.
 */
import { useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconChevronDown, IconFolder } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { useFloatingMenu } from "@/lib/floatingMenu";
import { useSshWatch } from "@/providers/SshWatchProvider";
import { SshPathPickerModal } from "@/components/SshPathPickerModal";
import type { Vars } from "@/i18n";

type Props = {
  t: (k: string, vars?: Vars) => string;
  disabled?: boolean;
  onOpenRemote: (alias: string, path: string) => void;
};

const LIST_MAX_H = 220;

export function ComposerRemoteMenu({ t, disabled, onOpenRemote }: Props) {
  const { watchAliases, draftRemote, setDraftRemote } = useSshWatch();
  const [open, setOpen] = useState(false);
  const [pickerAlias, setPickerAlias] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const estHeight = Math.min(360, 52 + Math.min(LIST_MAX_H, (watchAliases.length + 2) * 40));
  const { pos, style: popStyle } = useFloatingMenu({
    open,
    triggerRef,
    panelRef: popRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: "auto",
    fitContent: true,
    minWidth: 240,
    estHeight,
    gap: 8,
    deps: [watchAliases.length],
  });

  if (watchAliases.length === 0 && !draftRemote) return null;

  const label = draftRemote
    ? `${draftRemote.alias}:${draftRemote.path}`
    : t("composer.remote.thisComputer");

  return (
    <div ref={rootRef} className={`cpm cpm--context${open ? " is-open" : ""}`}>
      <Tip label={t("composer.remote.pick")} disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          className={
            "composer__context-item composer__context-item--project" +
            (open ? " is-open" : "") +
            (!draftRemote ? " is-muted" : "")
          }
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <IconFolder size={14} />
          <span className="composer__context-label">{label}</span>
          <IconChevronDown size={12} />
        </button>
      </Tip>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            className="cmm__pop cmm__pop--portal cpm__pop"
            role="menu"
            aria-label={t("composer.remote.pick")}
            style={popStyle as CSSProperties}
          >
            <button
              type="button"
              role="menuitem"
              className={"cpm__action" + (!draftRemote ? " is-active" : "")}
              onClick={() => {
                setDraftRemote(null);
                setOpen(false);
              }}
            >
              <span>{t("composer.remote.thisComputer")}</span>
              {!draftRemote ? (
                <span className="cmm__opt-check" aria-hidden>
                  <IconCheck size={16} />
                </span>
              ) : null}
            </button>
            {watchAliases.length === 0 ? (
              <div className="settings-row__hint" style={{ padding: "8px 12px" }}>
                {t("composer.remote.watchingNone")}
              </div>
            ) : (
              watchAliases.map((alias) => {
                const active = draftRemote?.alias === alias;
                return (
                  <button
                    key={alias}
                    type="button"
                    role="menuitem"
                    className={"cpm__action" + (active ? " is-active" : "")}
                    onClick={() => {
                      setOpen(false);
                      setPickerAlias(alias);
                    }}
                  >
                    <span>{alias}</span>
                    {active ? (
                      <span className="cmm__opt-check" aria-hidden>
                        <IconCheck size={16} />
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )}
      {pickerAlias ? (
        <SshPathPickerModal
          open
          alias={pickerAlias}
          initialPath={
            draftRemote?.alias === pickerAlias ? draftRemote.path : ""
          }
          t={t}
          onClose={() => setPickerAlias(null)}
          onOpen={(path) => {
            const alias = pickerAlias;
            setPickerAlias(null);
            setDraftRemote({ alias, path });
            onOpenRemote(alias, path);
          }}
        />
      ) : null}
    </div>
  );
}
