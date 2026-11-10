/**
 * What the journal screens share while the app is open: the last Deník data
 * (so returning to the screen shows it at once and refreshes behind), the
 * entry just deleted (for "undo"), and a one-off confirmation to show.
 *
 * Memory only. Entry text is never written to the phone from here; an
 * unsaved draft goes through lib/journal/drafts.ts, which encrypts it.
 */
import { useSyncExternalStore } from 'react';

import type { EntrySummary, JournalHome } from '../api/journal';
import { homeWithout, homeWithSaved } from './format';

export type Flash = 'saved' | 'restored' | 'unshared' | 'savedFromChat';

export type JournalState = {
  home: JournalHome | null;
  /** When `home` was fetched (ms). 0 means "fetch again on the next visit". */
  homeAt: number;
  /** Raised by every change; a list screen reloads when it differs from the one it loaded at. */
  revision: number;
  deleted: Pick<EntrySummary, 'id' | 'entryDate'> | null;
  flash: Flash | null;
};

let state: JournalState = { home: null, homeAt: 0, revision: 0, deleted: null, flash: null };
/** Whose data this is. A different account starts from nothing. */
let owner: string | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<JournalState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const journalStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  setHome(home: JournalHome) {
    set({ home, homeAt: Date.now() });
  },
  /** An entry was created or changed: show it now, confirm with the server on the next visit. */
  saved(e: EntrySummary, isNew: boolean, flash: Flash | null = 'saved') {
    set({
      home: state.home ? homeWithSaved(state.home, e, isNew) : null,
      homeAt: 0,
      revision: state.revision + 1,
      flash,
    });
  },
  /** An entry was deleted: gone from the screen at once, and offered back. */
  deleted(e: Pick<EntrySummary, 'id' | 'entryDate'>) {
    set({
      home: state.home ? homeWithout(state.home, e) : null,
      homeAt: 0,
      revision: state.revision + 1,
      deleted: { id: e.id, entryDate: e.entryDate },
      flash: null,
    });
  },
  restored(e: EntrySummary) {
    set({
      home: state.home ? homeWithSaved(state.home, e, true) : null,
      homeAt: 0,
      revision: state.revision + 1,
      deleted: null,
      flash: 'restored',
    });
  },
  /** Something changed that the cached screen cannot work out itself (share, forget everything). */
  changed(flash: Flash | null = null) {
    set({ homeAt: 0, revision: state.revision + 1, flash: flash ?? state.flash });
  },
  dismissDeleted() {
    if (state.deleted) set({ deleted: null });
  },
  clearFlash() {
    if (state.flash) set({ flash: null });
  },
  /**
   * Called by every journal screen, while it renders, with the signed-in
   * user: nothing of one account may show for the next, not even for a frame.
   * The caller reads the emptied state in the same render; any other
   * subscriber is told right after (a store must not notify during a render).
   */
  own(userId: string | null) {
    if (owner === userId) return;
    owner = userId;
    state = { home: null, homeAt: 0, revision: state.revision + 1, deleted: null, flash: null };
    queueMicrotask(() => listeners.forEach((l) => l()));
  },
};

/** The journal state of the signed-in user. */
export function useJournalStore(userId: string | null): JournalState {
  journalStore.own(userId);
  return useSyncExternalStore(journalStore.subscribe, journalStore.get, journalStore.get);
}
