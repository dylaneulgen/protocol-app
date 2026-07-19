// Shared state mutations used by more than one panel (drag/drop scheduling,
// completion toggles). Centralised so the goal tree, backlog, and calendar all
// behave identically.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});

  function leafOf(id) {
    var st = P.store.getState();
    var f = P.model.find(st.goals, id);
    if (!f || !P.model.isLeaf(f.node)) return null;
    return f.node;
  }

  // Schedule a one-off task leaf at the given Date.
  function schedule(id, startDate) {
    var n = leafOf(id);
    if (!n || !n.leaf || n.leaf.kind !== 'task') return;
    n.leaf.scheduledStart = startDate.toISOString();
    P.store.commit();
  }

  // Move a task back to the backlog.
  function unschedule(id) {
    var n = leafOf(id);
    if (!n || !n.leaf || n.leaf.kind !== 'task') return;
    if (!n.leaf.scheduledStart) return; // already in the backlog — no real change, no undo step
    n.leaf.scheduledStart = null;
    P.store.commit();
  }

  function toggleDone(id, value) {
    var n = leafOf(id);
    if (!n || !n.leaf || n.leaf.kind !== 'task') return;
    n.leaf.done = (value === undefined) ? !n.leaf.done : !!value;
    n.leaf.completedAt = n.leaf.done ? new Date().toISOString() : null;
    if (n.leaf.done) logRunning(n.leaf); // stop & log the timer when completing
    P.store.commit();
  }

  // ---- Task timer: log actual time spent --------------------------------------
  // Add the elapsed running time into actualMin and stop the timer (mutates leaf).
  function logRunning(lf) {
    if (lf && lf.timerStart) {
      lf.actualMin = (lf.actualMin || 0) + (Date.now() - new Date(lf.timerStart).getTime()) / 60000;
      lf.timerStart = null;
    }
  }

  // Toggle whether one occurrence of a recurring budget (on a given day) is done.
  function toggleOccurrence(id, dateKey) {
    var n = leafOf(id);
    if (!n || !n.leaf || n.leaf.kind !== 'budget') return;
    var list = n.leaf.completedOccurrences || (n.leaf.completedOccurrences = []);
    var i = list.indexOf(dateKey);
    if (i === -1) list.push(dateKey); else list.splice(i, 1);
    P.store.commit();
  }

  P.actions = {
    schedule: schedule,
    unschedule: unschedule,
    toggleDone: toggleDone,
    toggleOccurrence: toggleOccurrence
  };
})();
