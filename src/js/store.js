// Renderer-side state container + persistence. Holds the single `state` object,
// debounces saves to disk through the preload bridge, and notifies subscribed
// render functions when something changes.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});

  var state = null;
  var listeners = [];
  var saveTimer = null;
  var SAVE_DELAY = 400;
  var lastError = null;

  // ---- Undo / redo --------------------------------------------------------
  // Snapshot-based history: every discrete (non-silent) mutation records the
  // state as it was BEFORE the change, so Ctrl+Z can restore it. `lastSnapshot`
  // always holds a serialized copy of the current committed state; on the next
  // real change we push it onto the undo stack. View-only changes (switching
  // area, navigating months, expand/collapse) pass { noHistory:true } so they
  // never clutter the undo timeline — undo targets your data, not your view.
  var undoStack = [];
  var redoStack = [];
  var lastSnapshot = null;
  var pendingSilent = false; // mid-burst of silent (note-typing) edits
  var HISTORY_LIMIT = 80;
  function snapshot() { return JSON.stringify(state); }
  function pushUndo(snap) {
    undoStack.push(snap);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0; // any genuine change invalidates the redo timeline
  }

  // Persistence backend. In Electron this is the secure preload bridge
  // (window.planner) that reads/writes a JSON file on disk. When the page is
  // opened in a plain browser (e.g. double-clicking index.html, or this preview),
  // there is no bridge — so we fall back to localStorage and Blob download/upload
  // so the app is still fully usable for testing.
  var IO = window.planner || browserFallback();
  function browserFallback() {
    var KEY = 'dylan-planner-data';
    return {
      load: function () {
        try {
          var raw = localStorage.getItem(KEY);
          return Promise.resolve(raw ? JSON.parse(raw) : null);
        } catch (e) { return Promise.resolve(null); }
      },
      save: function (data) {
        try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota */ }
        return Promise.resolve({ ok: true });
      },
      exportBackup: function (data) {
        try {
          var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = 'planner-backup.json';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        } catch (e) { /* ignore */ }
        return Promise.resolve({ ok: true });
      },
      importBackup: function () {
        return new Promise(function (resolve) {
          var inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'application/json,.json';
          inp.onchange = function () {
            var f = inp.files && inp.files[0];
            if (!f) { resolve(null); return; }
            var r = new FileReader();
            r.onload = function () { try { resolve(JSON.parse(r.result)); } catch (e) { resolve(null); } };
            r.onerror = function () { resolve(null); };
            r.readAsText(f);
          };
          inp.click();
        });
      },
      openDataFolder: function () { return Promise.resolve({ browser: true }); },
      dataPath: function () { return Promise.resolve('browser localStorage (the desktop app stores a JSON file instead)'); }
    };
  }

  function defaultState() {
    var today = P.util.ymd(new Date());
    return {
      version: 2,
      notesItems: [],   // [{ id, title, body, updatedAt }]
      items: [],        // flat list of tasks / habits / branches (see model.js)
      ui: {
        area: 'calendar',   // which sidebar section is shown: calendar | notes
        calMode: 'month',   // month overview | day page
        anchorDate: today,  // month being viewed
        dayDate: today,     // day page being viewed
        weekStartsOn: 0,
        selectedNoteId: null,
        notesListCollapsed: true,
        timer: { running: false, startedAt: null, accumMs: 0 }
      }
    };
  }

  // Defensive normalisation so an old/partial/corrupt file can't crash the UI.
  // Version 1 files (the goal-forest era) are converted to flat items.
  function migrate(data) {
    var s = defaultState();
    if (!data || typeof data !== 'object' || data.__loadError) {
      if (data && data.__loadError) lastError = data.message || 'unknown error';
      return s;
    }
    if (Array.isArray(data.notesItems)) s.notesItems = data.notesItems.map(normalizeNoteItem).filter(Boolean);
    // Migrate the old single-journal string into one note so nothing is lost.
    if (!s.notesItems.length && typeof data.journal === 'string' && data.journal.trim()) {
      s.notesItems.push({
        id: P.util.uid('note'), title: 'Journal',
        body: data.journal, updatedAt: data.journalUpdatedAt || null
      });
    }
    if (Array.isArray(data.items)) {
      s.items = data.items.map(normalizeItem).filter(Boolean);
    } else if (Array.isArray(data.goals)) {
      s.items = P.model.migrateV1(data.goals).map(normalizeItem).filter(Boolean);
    }
    if (data.ui && typeof data.ui === 'object') {
      if (data.ui.area === 'notes' || data.ui.area === 'calendar') s.ui.area = data.ui.area;
      if (isYmd(data.ui.anchorDate)) s.ui.anchorDate = data.ui.anchorDate;
      if (isYmd(data.ui.dayDate)) s.ui.dayDate = data.ui.dayDate;
      if (data.ui.calMode === 'day' || data.ui.calMode === 'month') s.ui.calMode = data.ui.calMode;
      if (typeof data.ui.weekStartsOn === 'number') s.ui.weekStartsOn = data.ui.weekStartsOn;
      if (data.ui.selectedNoteId) s.ui.selectedNoteId = data.ui.selectedNoteId;
      if (typeof data.ui.notesListCollapsed === 'boolean') s.ui.notesListCollapsed = data.ui.notesListCollapsed;
      var t = data.ui.timer;
      if (t && typeof t === 'object') {
        s.ui.timer.accumMs = (typeof t.accumMs === 'number' && isFinite(t.accumMs) && t.accumMs > 0) ? t.accumMs : 0;
        s.ui.timer.startedAt = typeof t.startedAt === 'string' ? t.startedAt : null;
        s.ui.timer.running = !!t.running && !!s.ui.timer.startedAt;
      }
    }
    return s;
  }

  function isYmd(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function isHm(v) { return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v); }
  function str(v, fallback) { return typeof v === 'string' ? v : fallback; }

  // A subtask is a task nested in `children`; only top-level tasks keep a date.
  function normalizeTask(it, isSub) {
    var t = P.model.makeTask(str(it.title, 'Untitled'));
    t.id = it.id || P.util.uid('n');
    t.notes = str(it.notes, '');
    t.time = isHm(it.time) ? it.time : null;
    t.date = (!isSub && isYmd(it.date)) ? it.date : null;
    t.done = !!it.done;
    t.completedAt = it.completedAt || null;
    t.children = Array.isArray(it.children)
      ? it.children.map(function (c) { return normalizeTask(c || {}, true); }) : [];
    return t;
  }

  function normalizeItem(it) {
    if (!it || typeof it !== 'object') return null;

    if (it.kind === 'habit') {
      var h = P.model.makeHabit(str(it.title, 'Untitled'));
      h.id = it.id || P.util.uid('n');
      h.notes = str(it.notes, '');
      h.time = isHm(it.time) ? it.time : null;
      var r = it.recurrence || {};
      if (Array.isArray(r.daysOfWeek)) {
        h.recurrence.daysOfWeek = r.daysOfWeek.filter(function (d) {
          return typeof d === 'number' && d >= 0 && d <= 6;
        });
      }
      h.recurrence.startDate = isYmd(r.startDate) ? r.startDate : null;
      h.recurrence.endDate = isYmd(r.endDate) ? r.endDate : null;
      h.completedOccurrences = Array.isArray(it.completedOccurrences)
        ? it.completedOccurrences.filter(isYmd) : [];
      return h;
    }

    // Anything else (including old 'branch' items) normalises to a task.
    return normalizeTask(it, false);
  }

  function normalizeNoteItem(n) {
    if (!n || typeof n !== 'object') return null;
    return {
      id: n.id || P.util.uid('note'),
      title: typeof n.title === 'string' ? n.title : 'Untitled',
      body: typeof n.body === 'string' ? n.body : '',
      updatedAt: n.updatedAt || null
    };
  }

  async function init() {
    var loaded = null;
    try { loaded = await IO.load(); }
    catch (e) { console.error('load failed', e); }
    state = migrate(loaded);
    lastSnapshot = snapshot();
    undoStack = [];
    redoStack = [];
    pendingSilent = false;
    return state;
  }

  function getState() { return state; }
  function getLoadError() { return lastError; }

  function subscribe(fn) { listeners.push(fn); }
  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { console.error('render error', e); }
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      IO.save(state).then(function (res) {
        if (res && res.error) console.error('save error', res.error);
      }).catch(function (e) { console.error('save failed', e); });
    }, SAVE_DELAY);
  }

  // Call after mutating state. Options:
  //   silent      — persist but don't re-render (journal typing, so the editor
  //                 never rebuilds under the cursor). A whole burst of silent
  //                 edits is coalesced into ONE undo step (the pre-burst state).
  //   noHistory   — a view-only change (area/month/collapse/selection) that should
  //                 re-render and persist but never appear on the undo timeline.
  //   provisional — render + persist but stay completely invisible to history and
  //                 leave the baseline untouched. Used for the throwaway quick-add
  //                 placeholder: if saved it becomes one clean undo step (clean →
  //                 task), if cancelled it rolls back to nothing with no trace.
  function commit(opts) {
    opts = opts || {};
    scheduleSave();

    if (opts.provisional) { notify(); return; }

    if (opts.silent) {
      // Record the pre-burst snapshot once, then just track the latest state so
      // per-keystroke edits collapse into a single undoable note edit.
      if (!opts.noHistory && !pendingSilent && lastSnapshot != null) {
        pushUndo(lastSnapshot);
        pendingSilent = true;
      }
      lastSnapshot = snapshot();
      return;
    }

    if (!opts.noHistory && lastSnapshot != null) pushUndo(lastSnapshot);
    pendingSilent = false; // a discrete visible action seals any typing burst
    notify();
    lastSnapshot = snapshot(); // current state becomes the baseline for next time
  }

  // Restore a serialized snapshot as the live state, persist it, and re-render.
  function applySnapshot(json) {
    var next;
    try { next = JSON.parse(json); } catch (e) { return false; }
    state = next;
    lastSnapshot = json;
    pendingSilent = false;
    IO.save(state).catch(function (e) { console.error(e); });
    notify();
    return true;
  }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(snapshot());
    return applySnapshot(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(snapshot());
    return applySnapshot(redoStack.pop());
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  // Replace the entire state (e.g. after an import) and save immediately.
  // Recorded on the undo stack so an accidental import can be reverted.
  function replaceState(newData) {
    if (lastSnapshot != null) pushUndo(lastSnapshot);
    pendingSilent = false;
    state = migrate(newData);
    lastSnapshot = snapshot();
    IO.save(state).catch(function (e) { console.error(e); });
    notify();
  }

  // Flush any pending debounced save NOW, synchronously when possible. Called on
  // window unload/quit so the last edit can't be lost inside the debounce window.
  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      if (window.planner && window.planner.saveSync) window.planner.saveSync(state);
      else IO.save(state);
    } catch (e) { /* ignore */ }
  }

  P.io = IO; // persistence backend (Electron bridge or browser fallback)
  P.store = {
    init: init,
    getState: getState,
    getLoadError: getLoadError,
    subscribe: subscribe,
    commit: commit,
    replaceState: replaceState,
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    flush: flush,
    defaultState: defaultState
  };
})();
