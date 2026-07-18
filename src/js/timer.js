// A standalone stopwatch living at the bottom of the sidebar — for timing
// whatever you're doing right now. Not tied to any task. State persists in
// ui.timer (so an app restart doesn't lose a running timer); starting/stopping
// never touches the undo timeline.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var btn = null, pop = null, dispEl = null, goBtn = null;

  function mount() {
    btn = document.getElementById('btn-timer');
    pop = document.getElementById('timer-pop');
    dispEl = document.getElementById('timer-display');
    goBtn = document.getElementById('timer-go');

    btn.addEventListener('click', function () {
      pop.hidden = !pop.hidden;
      render();
    });
    goBtn.addEventListener('click', toggle);
    document.getElementById('timer-reset').addEventListener('click', reset);

    // Click anywhere else closes the popover.
    document.addEventListener('mousedown', function (e) {
      if (pop.hidden) return;
      if (pop.contains(e.target) || btn.contains(e.target)) return;
      pop.hidden = true;
    });

    setInterval(tick, 500);
  }

  function t() { return P.store.getState().ui.timer; }

  function elapsedMs() {
    var tm = t();
    var ms = tm.accumMs || 0;
    if (tm.running && tm.startedAt) ms += Date.now() - new Date(tm.startedAt).getTime();
    return ms;
  }

  function toggle() {
    var tm = t();
    if (tm.running) {
      tm.accumMs = elapsedMs();
      tm.running = false;
      tm.startedAt = null;
    } else {
      tm.running = true;
      tm.startedAt = new Date().toISOString();
    }
    P.store.commit({ noHistory: true });
    render();
  }

  function reset() {
    var tm = t();
    tm.running = false;
    tm.startedAt = null;
    tm.accumMs = 0;
    P.store.commit({ noHistory: true });
    render();
  }

  function tick() {
    if (!t().running) return;
    render();
  }

  function render() {
    if (!btn) return;
    var tm = t();
    var ms = elapsedMs();
    // The sidebar button doubles as the readout while running (or paused mid-way).
    btn.textContent = (tm.running || ms > 0) ? P.util.fmtElapsed(ms) : 'Timer';
    btn.classList.toggle('running', !!tm.running);
    if (!pop.hidden) {
      dispEl.textContent = P.util.fmtElapsed(ms);
      goBtn.textContent = tm.running ? 'Pause' : (ms > 0 ? 'Resume' : 'Start');
    }
  }

  P.timer = { mount: mount, render: render };
})();
