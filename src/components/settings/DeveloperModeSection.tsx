/**
 * Settings → About: Developer mode toggle + gated tools (update sim, …).
 */

import { useCallback, useEffect, useState } from "react";
import { Select } from "@/components/Select";
import { IconBolt } from "@/components/icons";
import { UiCheck } from "./shared";
import {
  DEVELOPER_MODE_CHANGE_EVENT,
  loadDeveloperModePref,
  saveDeveloperModePref,
} from "@/lib/developerModePref";
import {
  UPDATE_SIM_CHANGE_EVENT,
  UPDATE_SIM_VERSION,
  readUpdateSimMode,
  writeUpdateSimMode,
  type UpdateSimMode,
} from "@/lib/updateSim";
import type { MessageKey } from "@/i18n";

export function DeveloperModeSection({
  t,
  rowHighlight,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  rowHighlight: (anchorId: string) => string;
}) {
  const [devMode, setDevMode] = useState(() => loadDeveloperModePref());
  const [simMode, setSimMode] = useState<UpdateSimMode>(() =>
    readUpdateSimMode(),
  );

  useEffect(() => {
    const sync = () => {
      setDevMode(loadDeveloperModePref());
      setSimMode(readUpdateSimMode());
    };
    window.addEventListener(DEVELOPER_MODE_CHANGE_EVENT, sync);
    window.addEventListener(UPDATE_SIM_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener(DEVELOPER_MODE_CHANGE_EVENT, sync);
      window.removeEventListener(UPDATE_SIM_CHANGE_EVENT, sync);
    };
  }, []);

  const onToggleDev = useCallback(() => {
    const next = !loadDeveloperModePref();
    if (!next) {
      // Turning off clears sim first so gated tools disappear cleanly.
      writeUpdateSimMode("off");
    }
    saveDeveloperModePref(next);
    setDevMode(next);
    setSimMode(readUpdateSimMode());
  }, []);

  const onSimChange = useCallback((v: string) => {
    const mode: UpdateSimMode =
      v === "silent" ? "silent" : v === "manual" ? "manual" : "off";
    writeUpdateSimMode(mode);
    setSimMode(mode);
  }, []);

  return (
    <div
      className={
        "settings-card" + rowHighlight("settings-anchor-developerMode")
      }
      id="settings-anchor-developerMode"
    >
      <div className="settings-row">
        <div className="settings-row__text">
          <div className="settings-row__label">
            <IconBolt size={16} />
            {t("settings.developerMode")}
          </div>
          <div className="settings-row__desc">
            {t("settings.developerModeDesc")}
          </div>
        </div>
        <UiCheck
          checked={devMode}
          onChange={onToggleDev}
          ariaLabel={t("settings.developerMode")}
        />
      </div>

      {devMode ? (
        <div
          className={
            "settings-row settings-row--stack" +
            rowHighlight("settings-anchor-updateSim")
          }
          id="settings-anchor-updateSim"
        >
          <div className="settings-row__text">
            <div className="settings-row__label">
              {t("settings.updateSim")}
            </div>
            <div className="settings-row__desc">
              {t("settings.updateSimDesc", { version: UPDATE_SIM_VERSION })}
            </div>
          </div>
          <div className="settings-about-update__actions">
            <Select
              value={simMode}
              aria-label={t("settings.updateSim")}
              onChange={onSimChange}
              options={[
                { value: "off", label: t("settings.updateSim.off") },
                { value: "silent", label: t("settings.updateSim.silent") },
                { value: "manual", label: t("settings.updateSim.manual") },
              ]}
            />
          </div>
          {simMode !== "off" ? (
            <div className="settings-row__hint" role="status">
              {t("settings.updateSim.active", {
                mode:
                  simMode === "silent"
                    ? t("settings.updateSim.silent")
                    : t("settings.updateSim.manual"),
                version: UPDATE_SIM_VERSION,
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
