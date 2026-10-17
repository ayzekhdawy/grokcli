/**
 * Per-model extras for a custom provider: context window, image/video caps,
 * reasoning ladder. Channel-level TOML still receives the active model's
 * values on save so Grok Build spawn is unchanged.
 */

import { useEffect, useMemo, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import { UiCheck } from "@/components/settings/shared";
import { IconHelp, IconPlus, IconTrash } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { createT, type Locale } from "@/i18n";
import type { ProviderEffortEntry, ProviderModelEntry } from "@/lib/api";
import {
  alignGrokPresetEfforts,
  defaultCustomChannelEfforts,
} from "@/lib/providerPresets";

export type ProviderModelSettingsValue = {
  contextWindow: number | null;
  supportsVision: boolean;
  supportsVideo: boolean;
  efforts: ProviderEffortEntry[];
};

type DraftEffort = { id: string; name: string; isDefault: boolean };

function FieldHelp({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="prov-field__label">
      <span>{label}</span>
      <Tip label={tip} placement="top" className="ui-tip--wrap" delayMs={280}>
        <button
          type="button"
          className="settings-label-help"
          aria-label={tip}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <IconHelp size={14} stroke={1.75} />
        </button>
      </Tip>
    </span>
  );
}

function parseWindow(raw: string): number | null {
  const n = Number(raw.replace(/[_\s,]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function ProviderModelSettingsModal({
  open,
  locale,
  model,
  providerId,
  baseUrl,
  fallbackEfforts,
  onClose,
  onSave,
}: {
  open: boolean;
  locale: Locale;
  model: ProviderModelEntry | null;
  providerId: string;
  baseUrl: string;
  fallbackEfforts: ProviderEffortEntry[];
  onClose: () => void;
  onSave: (next: ProviderModelSettingsValue) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [windowDraft, setWindowDraft] = useState("");
  const [supportsVision, setSupportsVision] = useState(false);
  const [supportsVideo, setSupportsVideo] = useState(false);
  const [efforts, setEfforts] = useState<DraftEffort[]>([]);
  const [draftEffortId, setDraftEffortId] = useState("");
  const [draftEffortName, setDraftEffortName] = useState("");

  useEffect(() => {
    if (!open || !model) return;
    const seed =
      model.efforts && model.efforts.length > 0
        ? model.efforts
        : fallbackEfforts.length
          ? fallbackEfforts
          : defaultCustomChannelEfforts();
    setWindowDraft(
      model.contextWindow != null && model.contextWindow > 0
        ? String(model.contextWindow)
        : "",
    );
    setSupportsVision(!!model.supportsVision);
    setSupportsVideo(!!model.supportsVideo);
    setEfforts(
      seed.map((e) => ({
        id: e.id,
        name: e.name?.trim() || e.id,
        isDefault: !!e.isDefault,
      })),
    );
    setDraftEffortId("");
    setDraftEffortName("");
  }, [open, model, fallbackEfforts]);

  const addEffort = () => {
    const id = draftEffortId.trim();
    if (!id) return;
    setEfforts((list) => {
      if (list.some((x) => x.id === id)) return list;
      return [
        ...list,
        {
          id,
          name: draftEffortName.trim() || id,
          isDefault: list.length === 0,
        },
      ];
    });
    setDraftEffortId("");
    setDraftEffortName("");
  };

  const resetGrok = () => {
    const grok = alignGrokPresetEfforts({
      providerId,
      baseUrl,
      efforts: [],
    });
    const reset = grok ?? defaultCustomChannelEfforts();
    setEfforts(
      reset.map((e) => ({
        id: e.id,
        name: e.name || e.id,
        isDefault: !!e.isDefault,
      })),
    );
  };

  const save = () => {
    let nextEfforts = efforts
      .map((e) => ({
        id: e.id.trim(),
        name: e.name.trim() || e.id.trim(),
        isDefault: !!e.isDefault,
      }))
      .filter((e) => e.id);
    if (nextEfforts.length === 0) {
      nextEfforts = defaultCustomChannelEfforts().map((e) => ({
        id: e.id,
        name: e.name || e.id,
        isDefault: !!e.isDefault,
      }));
    } else if (!nextEfforts.some((e) => e.isDefault)) {
      nextEfforts = nextEfforts.map((e, i) => ({ ...e, isDefault: i === 0 }));
    }
    onSave({
      contextWindow: parseWindow(windowDraft),
      supportsVision,
      supportsVideo,
      efforts: nextEfforts,
    });
  };

  const title = model
    ? tr("prov.modelSettingsTitle", { name: model.name || model.id })
    : tr("prov.modelSettings");

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      closeLabel={tr("common.close")}
      wrapBody
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {tr("common.cancel")}
          </button>
          <button type="button" className="btn btn--solid" onClick={save}>
            {tr("common.save")}
          </button>
        </>
      }
    >
      <div className="prov-model-settings">
        <label className="prov-field">
          <FieldHelp
            label={tr("prov.modelContextWindow")}
            tip={tr("prov.modelContextWindowHint")}
          />
          <input
            className="settings-input"
            inputMode="numeric"
            value={windowDraft}
            onChange={(e) => setWindowDraft(e.target.value)}
            placeholder={tr("prov.modelContextWindowPh")}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <div className="prov-field">
          <FieldHelp
            label={tr("prov.modelCaps")}
            tip={tr("prov.modelCapsHint")}
          />
          <div className="prov-model-settings__caps">
            <UiCheck
              checked={supportsVision}
              onChange={setSupportsVision}
              label={tr("prov.modelCapImages")}
            />
            <UiCheck
              checked={supportsVideo}
              onChange={setSupportsVideo}
              label={tr("prov.modelCapVideo")}
            />
          </div>
        </div>

        <div className="prov-field">
          <span className="prov-field__label-row">
            <FieldHelp
              label={tr("prov.efforts")}
              tip={tr("prov.effortsModelHint")}
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={resetGrok}
            >
              {tr("prov.effortsResetGrok")}
            </button>
          </span>
          <div
            className="prov-models prov-efforts"
            role="group"
            aria-label={tr("prov.efforts")}
          >
            <div className="prov-models__head" aria-hidden>
              <span>{tr("prov.effortDisplayName")}</span>
              <span>{tr("prov.effortId")}</span>
              <span />
            </div>
            {efforts.length === 0 ? (
              <p className="prov-models__empty">{tr("prov.effortsEmpty")}</p>
            ) : (
              efforts.map((e, index) => (
                <div key={index} className="prov-models__row">
                  <input
                    className="settings-input"
                    value={e.name}
                    onChange={(ev) => {
                      const name = ev.target.value;
                      setEfforts((list) =>
                        list.map((row, i) =>
                          i === index ? { ...row, name } : row,
                        ),
                      );
                    }}
                    placeholder={tr("prov.effortDisplayNamePh")}
                    aria-label={tr("prov.effortDisplayName")}
                    autoComplete="off"
                  />
                  <input
                    className="settings-input"
                    value={e.id}
                    onChange={(ev) => {
                      const next = ev.target.value;
                      setEfforts((list) =>
                        list.map((row, i) =>
                          i === index
                            ? {
                                ...row,
                                id: next,
                                name:
                                  !row.name.trim() || row.name.trim() === row.id
                                    ? next
                                    : row.name,
                              }
                            : row,
                        ),
                      );
                    }}
                    placeholder={tr("prov.effortIdPh")}
                    aria-label={tr("prov.effortId")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="icon-btn prov-models__remove"
                    onClick={() =>
                      setEfforts((list) => list.filter((_, i) => i !== index))
                    }
                    aria-label={tr("prov.removeEffort")}
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              ))
            )}
            <div className="prov-models__add-row">
              <input
                className="settings-input"
                value={draftEffortName}
                onChange={(ev) => setDraftEffortName(ev.target.value)}
                placeholder={tr("prov.effortDisplayNamePh")}
                aria-label={tr("prov.effortDisplayName")}
                autoComplete="off"
              />
              <input
                className="settings-input"
                value={draftEffortId}
                onChange={(ev) => {
                  const id = ev.target.value;
                  setDraftEffortId(id);
                  setDraftEffortName((n) =>
                    !n.trim() || n.trim() === draftEffortId.trim() ? id : n,
                  );
                }}
                placeholder={tr("prov.effortIdPh")}
                aria-label={tr("prov.effortId")}
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    addEffort();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn--ghost btn--sm prov-models__add-btn"
                disabled={!draftEffortId.trim()}
                onClick={addEffort}
              >
                <IconPlus size={14} />
                {tr("prov.addEffort")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </GlassModal>
  );
}
