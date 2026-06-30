// The backlog: every unscheduled, not-done one-off task leaf. Items are drag
// sources for the calendar, and the backlog itself is a drop target so you can
// drag a scheduled block back here to unschedule it.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var listEl = null;

  function mount() {
    listEl = document.getElementById('backlog-list');

    // Drop target: dragging a calendar block here clears its schedule.
    listEl.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      listEl.classList.add('drop-hover');
    });
    listEl.addEventListener('dragleave', function () {
      listEl.classList.remove('drop-hover');
    });
    listEl.addEventListener('drop', function (e) {
      e.preventDefault();
      listEl.classList.remove('drop-hover');
      var id = e.dataTransfer.getData('text/plain') || P.dragNodeId;
      if (id) P.actions.unschedule(id);
    });
  }

  function render() {
    if (!listEl) return;
    var state = P.store.getState();
    var items = P.model.leaves(state.goals, function (n) {
      var lf = n.leaf;
      return lf && lf.kind === 'task' && !lf.scheduledStart && !lf.done;
    });

    // Cluster by goal path so tasks from the same goal sit together.
    var crumbCache = {};
    function crumbs(n) {
      if (crumbCache[n.id] == null) {
        var trail = P.model.path(state.goals, n.id);
        crumbCache[n.id] = trail.slice(0, -1).map(function (x) { return x.title; }).join(' › ');
      }
      return crumbCache[n.id];
    }
    items.sort(function (a, b) {
      var ca = crumbs(a), cb = crumbs(b);
      if (ca !== cb) return ca < cb ? -1 : 1;
      return (a.title || '').localeCompare(b.title || '');
    });

    var countEl = document.getElementById('backlog-count');
    if (countEl) countEl.textContent = items.length ? '(' + items.length + ')' : '';

    listEl.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-hint';
      empty.textContent = 'Nothing here yet.';
      listEl.appendChild(empty);
      return;
    }

    items.forEach(function (n) {
      var lf = n.leaf;
      var card = document.createElement('div');
      card.className = 'backlog-card';
      card.draggable = true;
      card.dataset.id = n.id;
      card.title = 'Drag onto a day to schedule · click to edit';

      card.innerHTML =
        (crumbs(n) ? '<div class="crumbs">' + esc(crumbs(n)) + '</div>' : '') +
        '<div class="bl-title">' + esc(n.title) + '</div>' +
        '<div class="bl-dur">' +
          (lf.durationMin > 0 ? esc(P.util.formatDuration(lf.durationMin)) : 'No duration set') +
        '</div>';

      card.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', n.id);
        e.dataTransfer.effectAllowed = 'move';
        P.dragNodeId = n.id;
      });
      // Click to open the editor (set a date, duration, etc.) — more discoverable
      // than drag-and-drop for someone meeting the backlog for the first time.
      card.addEventListener('click', function () {
        if (P.goals && P.goals.openLeaf) P.goals.openLeaf(n.id);
      });

      listEl.appendChild(card);
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  P.backlog = { mount: mount, render: render };
})();
