// Pure domain logic for the day's items. A top-level item is a one-off TASK
// (optional date/time) or a recurring HABIT (checked off per day). A task can
// hold subtasks — child tasks rendered as indented checkboxes, nested to any
// depth. No DOM access — this is the part the Node tests exercise directly.
// UMD-wrapped like util.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util.js'));
  } else {
    root.Planner = root.Planner || {};
    root.Planner.model = factory(root.Planner.util);
  }
})(typeof self !== 'undefined' ? self : this, function (util) {
  'use strict';

  // ---- Factories ------------------------------------------------------------
  function makeTask(title) {
    return {
      id: util.uid('n'),
      kind: 'task',
      title: title || 'Untitled',
      notes: '',
      time: null,         // 'HH:MM' (24h), or null = no time of day
      date: null,         // 'YYYY-MM-DD', or null = backlog (top-level only)
      done: false,
      completedAt: null,
      children: []        // subtasks (each a task); no own date — they live under the parent
    };
  }

  // A subtask is just a task that never carries its own date.
  function makeSubtask(title) { return makeTask(title); }

  function makeHabit(title) {
    return {
      id: util.uid('n'),
      kind: 'habit',
      title: title || 'Untitled',
      notes: '',
      time: null,
      recurrence: {
        daysOfWeek: [1, 2, 3, 4, 5], // 0=Sun .. 6=Sat
        startDate: null,             // 'YYYY-MM-DD' window (optional)
        endDate: null
      },
      completedOccurrences: [] // ['YYYY-MM-DD', ...]
    };
  }

  function titleOf(item) { return (item && item.title) || 'Untitled'; }

  // ---- Tree navigation over items + their subtasks --------------------------
  // Locate a node anywhere in the forest. Returns
  // { item, parent (node or null), list (its containing array), index } or null.
  function find(items, id) {
    function rec(list, parent) {
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (n.id === id) return { item: n, parent: parent, list: list, index: i };
        if (n.children && n.children.length) {
          var r = rec(n.children, n);
          if (r) return r;
        }
      }
      return null;
    }
    return rec(items, null);
  }

  function remove(items, id) {
    var f = find(items, id);
    if (!f) return null;
    f.list.splice(f.index, 1);
    return f.item;
  }

  function addChild(items, parentId, node) {
    var f = find(items, parentId);
    if (!f) return null;
    f.item.children = f.item.children || [];
    f.item.children.push(node);
    return node;
  }

  // ---- Habits ---------------------------------------------------------------
  // Does this habit occur on the given 'YYYY-MM-DD'? Day-of-week match within the
  // optional start/end window (YMD strings compare chronologically).
  function habitOccursOn(habit, ymd) {
    var rec = habit && habit.recurrence;
    if (!rec || !rec.daysOfWeek || !rec.daysOfWeek.length) return false;
    if (rec.startDate && ymd < rec.startDate) return false;
    if (rec.endDate && ymd > rec.endDate) return false;
    return rec.daysOfWeek.indexOf(util.parseYmd(ymd).getDay()) !== -1;
  }

  function habitDoneOn(habit, ymd) {
    return (habit.completedOccurrences || []).indexOf(ymd) !== -1;
  }

  // ---- A day's plan ---------------------------------------------------------
  // The top-level items happening on `ymd`: dated tasks and habits that recur
  // that day. Entries are { item, done } — for a habit `done` is that day's
  // occurrence; for a task it's the task's own flag. Subtasks come along under
  // each item and are rendered by the caller.
  function itemsOn(items, ymd) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind === 'habit') {
        if (habitOccursOn(it, ymd)) out.push({ item: it, done: habitDoneOn(it, ymd) });
      } else if (it.date === ymd) {
        out.push({ item: it, done: !!it.done });
      }
    }
    return out;
  }

  // 'HH:MM' → minutes since midnight, or null.
  function timeMin(t) {
    if (typeof t !== 'string') return null;
    var m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  // Order a day's entries by time of day (timed first, chronological; untimed
  // after), stable among equals. Sorts in place and returns the array.
  function sortEntries(entries) {
    return entries
      .map(function (e, i) { return { e: e, i: i }; })
      .sort(function (a, b) {
        var ta = timeMin(a.e.item.time), tb = timeMin(b.e.item.time);
        if (ta === null && tb === null) return a.i - b.i;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return (ta - tb) || (a.i - b.i);
      })
      .map(function (x) { return x.e; });
  }

  // ---- Migration from the old goal forest (data version 1) ------------------
  // Every leaf of the old hierarchy becomes a flat top-level item. Task leaves
  // keep their schedule and done state; budget leaves become habits. Parents,
  // templates, tags, durations, and per-task timers are dropped.
  function migrateV1(forest) {
    var items = [];
    if (!Array.isArray(forest)) return items;

    function leafDown(node) {
      if (!node || typeof node !== 'object') return;
      var kids = Array.isArray(node.children) ? node.children : [];
      if (kids.length) { kids.forEach(leafDown); return; }
      var lf = node.leaf;
      if (!lf || typeof lf !== 'object') lf = { kind: 'task' };
      if (lf.kind === 'budget') {
        var h = makeHabit(node.title);
        h.id = node.id || h.id;
        h.notes = typeof node.notes === 'string' ? node.notes : '';
        var r = lf.recurrence || {};
        h.recurrence.daysOfWeek = Array.isArray(r.daysOfWeek) ? r.daysOfWeek.slice() : h.recurrence.daysOfWeek;
        h.recurrence.startDate = r.startDate || null;
        h.recurrence.endDate = r.endDate || null;
        h.time = typeof r.startTime === 'string' ? r.startTime : null;
        h.completedOccurrences = Array.isArray(lf.completedOccurrences) ? lf.completedOccurrences.slice() : [];
        items.push(h);
      } else {
        var t = makeTask(node.title);
        t.id = node.id || t.id;
        t.notes = typeof node.notes === 'string' ? node.notes : '';
        if (typeof lf.scheduledStart === 'string') {
          var d = new Date(lf.scheduledStart);
          if (!isNaN(d.getTime())) {
            t.date = util.ymd(d);
            if (d.getHours() !== 0 || d.getMinutes() !== 0) {
              t.time = util.pad(d.getHours()) + ':' + util.pad(d.getMinutes());
            }
          }
        }
        t.done = !!lf.done;
        t.completedAt = lf.completedAt || null;
        items.push(t);
      }
    }

    forest.forEach(leafDown);
    return items;
  }

  return {
    makeTask: makeTask,
    makeSubtask: makeSubtask,
    makeHabit: makeHabit,
    titleOf: titleOf,
    find: find,
    remove: remove,
    addChild: addChild,
    habitOccursOn: habitOccursOn,
    habitDoneOn: habitDoneOn,
    itemsOn: itemsOn,
    timeMin: timeMin,
    sortEntries: sortEntries,
    migrateV1: migrateV1
  };
});
