/**
 * External SessionLiveMap store.
 *
 * Stream / runtime events update the map without forcing the App shell to
 * re-render: sidebar busy dots and reliability panels subscribe selectively.
 */

import {
  busySessionIds,
  type SessionLiveMap,
  type SessionLiveSnapshot,
} from "@/lib/sessionLiveStore";

export type LiveMapBusyMeta = {
  /** Sorted busy session ids joined — identity for Set membership. */
  busyKey: string;
  busyCount: number;
  /** Bumps when busyKey changes. */
  rev: number;
};

type Listener = () => void;
type MapReducer = (prev: SessionLiveMap) => SessionLiveMap;

function busyMetaFromMap(map: SessionLiveMap, rev: number): LiveMapBusyMeta {
  const ids = [...busySessionIds(map)].sort();
  return {
    busyKey: ids.join("\0"),
    busyCount: ids.length,
    rev,
  };
}

class SessionLiveMapStore {
  private map: SessionLiveMap = {};
  private busyMeta: LiveMapBusyMeta = { busyKey: "", busyCount: 0, rev: 0 };
  private mapListeners = new Set<Listener>();
  private busyListeners = new Set<Listener>();

  subscribeMap = (listener: Listener): (() => void) => {
    this.mapListeners.add(listener);
    return () => {
      this.mapListeners.delete(listener);
    };
  };

  getMapSnapshot = (): SessionLiveMap => this.map;

  subscribeBusy = (listener: Listener): (() => void) => {
    this.busyListeners.add(listener);
    return () => {
      this.busyListeners.delete(listener);
    };
  };

  getBusySnapshot = (): LiveMapBusyMeta => this.busyMeta;

  getMap(): SessionLiveMap {
    return this.map;
  }

  getSnapshot(sessionId: string | null | undefined): SessionLiveSnapshot | null {
    if (!sessionId) return null;
    return this.map[sessionId] ?? null;
  }

  private notifyMap(): void {
    for (const l of this.mapListeners) l();
  }

  private notifyBusy(): void {
    for (const l of this.busyListeners) l();
  }

  private commit(next: SessionLiveMap): void {
    if (next === this.map) return;
    this.map = next;
    const prevKey = this.busyMeta.busyKey;
    const nextBusy = busyMetaFromMap(next, this.busyMeta.rev);
    if (nextBusy.busyKey !== prevKey) {
      this.busyMeta = {
        ...nextBusy,
        rev: this.busyMeta.rev + 1,
      };
      this.notifyBusy();
    }
    this.notifyMap();
  }

  setMap(next: SessionLiveMap | MapReducer): void {
    const resolved = typeof next === "function" ? next(this.map) : next;
    this.commit(resolved);
  }

  /** React setState-compatible updater. */
  setLiveMap = (next: SessionLiveMap | MapReducer): void => {
    this.setMap(next);
  };

  resetForTests(): void {
    this.map = {};
    this.busyMeta = { busyKey: "", busyCount: 0, rev: 0 };
  }
}

export const sessionLiveMapStore = new SessionLiveMapStore();
