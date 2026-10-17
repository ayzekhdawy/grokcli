/**
 * Homepage appearance editor — floating panel that reuses AppearanceSection
 * so theme / wallpaper / interface prefs apply live on the workbench.
 */
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "@/components/icons";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { SettingsModelProvider } from "@/providers/SettingsModelContext";
import { useAppearanceEditorModel } from "@/hooks/useAppearanceEditorModel";
import { installDialogFocus } from "@/lib/a11yFocus";
import { acquireNativeWebviewCover } from "@/lib/nativeWebviewCover";
import { createT, resolveLocale } from "@/i18n";

export function ThemeEditorModal(props: {
  open: boolean;
  onClose: () => void;
  locale: string;
}) {
  const { open, onClose, locale } = props;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const tr = createT(resolveLocale(locale));
  const { model, toast } = useAppearanceEditorModel({
    open,
    locale,
    onClose,
  });

  useEffect(() => {
    if (!open) return;
    return installDialogFocus(() => panelRef.current, {
      onEscape: () => onCloseRef.current(),
      capture: false,
      initialFocus: "first",
      restoreFocus: true,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const release = acquireNativeWebviewCover();
    return () => release();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="overlay theme-editor-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="modal glass-modal theme-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="theme-editor"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="theme-editor__head">
          <h2 id={titleId} className="theme-editor__title">
            {tr("user.themeEditor")}
          </h2>
          <button
            type="button"
            className="icon-btn modal-close"
            onClick={onClose}
            aria-label={tr("common.close")}
          >
            <IconClose size={16} />
          </button>
        </header>
        <div className="theme-editor__body">
          <SettingsModelProvider value={model}>
            <AppearanceSection />
          </SettingsModelProvider>
        </div>
        {toast ? (
          <div className="app-toast" role="status">
            {toast}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
