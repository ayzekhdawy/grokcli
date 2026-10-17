/**
 * Overlays for already-extracted domains: reliability, sandbox, export, search.
 * Session open and sandbox profile apply stay with the host.
 */
import { lazy, Suspense } from "react";
import { ExportMdModal, type ExportMdHonesty } from "@/components/workbench-modals/ExportMdModal";
import { ExportImageModal } from "@/components/workbench-modals/ExportImageModal";
import { SearchPalette } from "@/components/workbench-modals/SearchPalette";
import { useSearchPalette } from "@/hooks/useSearchPalette";
import type { Locale } from "@/i18n";
import type { AppPlatform } from "@/lib/appPlatform";
import type { Project, SessionRow } from "@/lib/app/sidebarModels";
import type { GoalOrchEvent } from "@/lib/goalOrch";
import type { ProcessLimitEvent } from "@/lib/processBudget";
import type { ReliabilityCenterView } from "@/lib/reliabilityCenter";
import {
  cliSupportsSandbox,
  type SandboxProfileId,
} from "@/lib/sandboxProfile";
import type { SandboxWizardMode } from "@/lib/sandboxWizard";
import type {
  ExportImageMetaParts,
  ExportImagePreviewPhase,
} from "@/lib/exportSharePro";
import type { ShareCardSkinId } from "@/lib/shareCardSkins";

const ReliabilityCenterModal = lazy(async () => {
  const m = await import("@/components/ReliabilityCenterModal");
  return { default: m.ReliabilityCenterModal };
});
const SandboxWizard = lazy(async () => {
  const m = await import("@/components/SandboxWizard");
  return { default: m.SandboxWizard };
});

type SearchPaletteApi = ReturnType<typeof useSearchPalette>;

export type WorkbenchDomainOverlaysProps = {
  locale: Locale;
  platform: AppPlatform;
  cliVersion: string | null | undefined;
  showReliability: boolean;
  closeReliability: () => void;
  reliabilityView: ReliabilityCenterView;
  goalOrchUiEnabled: boolean;
  goalOrchEvents: GoalOrchEvent[];
  lastProcessLimit: ProcessLimitEvent | null;
  sessionIds: string[];
  onOpenDoctor: () => void;
  onSelectReliabilitySession: (id: string) => void;
  sandboxWizardOpen: boolean;
  sandboxWizardMode: SandboxWizardMode;
  closeSandboxWizard: () => void;
  skipSandboxWizard: (opts: { dontOfferAgain: boolean }) => void;
  onApplySandbox: (
    profile: SandboxProfileId,
    opts: { dontOfferAgain: boolean },
  ) => void;
  exportMdOpen: boolean;
  exportMdBusy: boolean;
  exportMdIncludeThoughts: boolean;
  exportMdIncludeTools: boolean;
  exportMdHonesty: ExportMdHonesty;
  closeExportSessionMd: () => void;
  runExportSessionMd: (kind: "copy" | "download") => void | Promise<void>;
  setExportMdIncludeThoughts: (value: boolean) => void;
  setExportMdIncludeTools: (value: boolean) => void;
  exportImageOpen: boolean;
  exportImageBusy: boolean;
  exportImageCanAct: boolean;
  exportImageSkin: ShareCardSkinId;
  exportImageSmart: boolean;
  exportImagePreviewPhase: ExportImagePreviewPhase;
  exportImagePreviewUrl: string | null;
  exportImageOptionsMatch: boolean;
  exportImagePreviewError: string | null;
  exportImageBytesLabel: string | null;
  exportImageMetaParts: ExportImageMetaParts;
  closeExportSessionImage: () => void;
  runExportSessionImage: (kind: "copy" | "download") => void | Promise<void>;
  applyExportImageSkin: (skin: ShareCardSkinId) => void;
  setExportImageSmart: (value: boolean) => void;
  searchPalette: SearchPaletteApi;
  sessions: SessionRow[];
  projects: Project[];
  settingsShortcutHint: string;
  onPickSearchSession: (row: SessionRow, project: Project | null) => void;
};

export function WorkbenchDomainOverlays(props: WorkbenchDomainOverlaysProps) {
  const p = props;
  return (
    <>
      {p.showReliability ? (
        <Suspense fallback={null}>
          <ReliabilityCenterModal
            open={p.showReliability}
            onClose={p.closeReliability}
            locale={p.locale}
            view={p.reliabilityView}
            goalOrchUiEnabled={p.goalOrchUiEnabled}
            goalOrchEvents={p.goalOrchEvents}
            lastProcessLimit={p.lastProcessLimit}
            existingSessionIds={p.sessionIds}
            onOpenDoctor={p.onOpenDoctor}
            onSelectSession={p.onSelectReliabilitySession}
          />
        </Suspense>
      ) : null}
      {p.sandboxWizardOpen ? (
        <Suspense fallback={null}>
          <SandboxWizard
            open={p.sandboxWizardOpen}
            locale={p.locale}
            mode={p.sandboxWizardMode}
            platform={p.platform}
            cliSupportsSandbox={cliSupportsSandbox(p.cliVersion)}
            onClose={p.closeSandboxWizard}
            onSkip={p.skipSandboxWizard}
            onApply={p.onApplySandbox}
          />
        </Suspense>
      ) : null}
      <ExportMdModal
        locale={p.locale}
        open={p.exportMdOpen}
        busy={p.exportMdBusy}
        includeThoughts={p.exportMdIncludeThoughts}
        includeTools={p.exportMdIncludeTools}
        honesty={p.exportMdHonesty}
        onClose={p.closeExportSessionMd}
        onCopy={() => {
          void p.runExportSessionMd("copy");
        }}
        onDownload={() => {
          void p.runExportSessionMd("download");
        }}
        onIncludeThoughtsChange={p.setExportMdIncludeThoughts}
        onIncludeToolsChange={p.setExportMdIncludeTools}
      />
      <ExportImageModal
        locale={p.locale}
        open={p.exportImageOpen}
        busy={p.exportImageBusy}
        canAct={p.exportImageCanAct}
        skin={p.exportImageSkin}
        smart={p.exportImageSmart}
        previewPhase={p.exportImagePreviewPhase}
        previewUrl={p.exportImagePreviewUrl}
        optionsMatch={p.exportImageOptionsMatch}
        previewError={p.exportImagePreviewError}
        bytesLabel={p.exportImageBytesLabel}
        metaParts={p.exportImageMetaParts}
        onClose={p.closeExportSessionImage}
        onCopy={() => {
          void p.runExportSessionImage("copy");
        }}
        onDownload={() => {
          void p.runExportSessionImage("download");
        }}
        onSkinChange={p.applyExportImageSkin}
        onSmartChange={p.setExportImageSmart}
      />
      {p.searchPalette.open && (
        <SearchPalette
          locale={p.locale}
          panelRef={p.searchPalette.panelRef}
          query={p.searchPalette.query}
          mode={p.searchPalette.mode}
          rankMode={p.searchPalette.rankMode}
          includeArchived={p.searchPalette.includeArchived}
          filtersActive={p.searchPalette.filtersActive}
          activeIndex={p.searchPalette.activeIndex}
          itemCount={p.searchPalette.items.length}
          actions={p.searchPalette.actions}
          projects={p.searchPalette.projects}
          sessionHits={p.searchPalette.sessionHits}
          sessions={p.sessions}
          projectsCatalog={p.projects}
          contentSearchLoading={p.searchPalette.contentLoading}
          emptyState={p.searchPalette.emptyState}
          settingsShortcutHint={p.settingsShortcutHint}
          onClose={p.searchPalette.closePalette}
          onQueryChange={p.searchPalette.setQuery}
          onModeChange={p.searchPalette.applyMode}
          onRankModeChange={p.searchPalette.applyRankMode}
          onIncludeArchivedChange={p.searchPalette.applyIncludeArchived}
          onClearFilters={p.searchPalette.clearFilters}
          onActiveIndexChange={p.searchPalette.setActiveIndex}
          onRunAction={p.searchPalette.runAction}
          onPickProject={p.searchPalette.pickProject}
          onPickSession={p.onPickSearchSession}
        />
      )}
    </>
  );
}
