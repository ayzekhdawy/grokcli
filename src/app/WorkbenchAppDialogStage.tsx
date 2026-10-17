/**
 * In-app confirm/prompt mount. Host still opens dialogs via setAppDialog;
 * chrome + confirm/submit handlers live here so the overlay can change
 * without opening AppWorkbench.
 */
import type { Dispatch, RefObject, SetStateAction } from "react";
import { AppDialogHost } from "@/components/workbench-modals/AppDialogHost";
import type { Locale } from "@/i18n";
import type { AppDialog } from "@/lib/app/appDialogTypes";

export function WorkbenchAppDialogStage(props: {
  locale: Locale;
  dialog: AppDialog;
  dialogRef: RefObject<AppDialog>;
  panelRef: RefObject<HTMLDivElement | null>;
  confirmBtnRef: RefObject<HTMLButtonElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  inputValue: string;
  error: string;
  onDismiss: () => void;
  onInputChange: (value: string) => void;
  setDialog: Dispatch<SetStateAction<AppDialog>>;
  setError: Dispatch<SetStateAction<string>>;
}) {
  const { dialog } = props;
  if (!dialog) return null;
  return (
    <AppDialogHost
      locale={props.locale}
      dialog={dialog}
      dialogRef={props.dialogRef}
      panelRef={props.panelRef}
      confirmBtnRef={props.confirmBtnRef}
      inputRef={props.inputRef}
      inputValue={props.inputValue}
      error={props.error}
      onDismiss={props.onDismiss}
      onInputChange={props.onInputChange}
      onClearError={() => props.setError("")}
      onConfirm={(d) => {
        const run = d.onConfirm;
        props.setDialog(null);
        void run();
      }}
      onPromptSubmit={(value) => {
        if (dialog.kind !== "prompt") return;
        const submit = dialog.onSubmit;
        void (async () => {
          const ok = await submit(value);
          if (typeof ok === "string") {
            props.setError(ok);
            return;
          }
          if (ok === false) return;
          props.setError("");
          props.setDialog((cur) =>
            cur && cur.kind === "prompt" && cur.onSubmit === submit
              ? null
              : cur,
          );
        })();
      }}
    />
  );
}
