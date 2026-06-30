// The calendar. Day & Week are time-grids you drag tasks onto; Month is an
// overview grid. Scheduled one-off tasks render as solid blocks (dashed/amber if
// estimated); recurring time budgets render as striped "reserved" blocks the
// budget generates automatically. Dragging a block reschedules it; dragging it
// to the backlog unschedules it.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var U = null;

  var START_HOUR = 6;
  var END_HOUR = 24;
  var SLOT_MIN = 30;
  var SLOT_PX = 24;
  var SLOTS = (END_HOUR - START_HOUR) * (60 / SLOT_MIN);
  var GRID_H = SLOTS * SLOT_PX;

  var bodyEl = null;
  var titleEl = null;

  function mount() {
    U = P.util;
    bodyEl = document.getElementById('calendar-body');
    titleEl = document.getElementById('cal-title');
  }

  function anchor() {
    return U.parseYmd(P.store.getState().ui.anchorDate);
  }
  function weekStart() {
    return P.store.getState().ui.weekStartsOn || 0;
  }

  function render() {
    if (!bodyEl) return;
    // Skip while the Calendar area is hidden (single-view layout). It is rendered
    // fresh the moment its sidebar item is selected, so this just avoids wasted
    // work and prevents reading a bogus scroll position from a display:none grid.
    if (bodyEl.offsetParent === null) return;
    renderMonth(); // month is the only view
  }

  function weekDays() {
    var ws = U.startOfWeek(anchor(), weekStart());
    var days = [];
    for (var i = 0; i < 7; i++) days.push(U.addDays(ws, i));
    return days;
  }

  // ---- gather items ---------------------------------------------------------
  function taskBlocks(state, day) {
    var out = [];
    P.model.leaves(state.goals, function (n) {
      return n.leaf && n.leaf.kind === 'task' && n.leaf.scheduledStart;
    }).forEach(function (n) {
      var d = new Date(n.leaf.scheduledStart);
      if (U.sameDay(d, day)) {
        out.push({
          type: 'task', node: n, id: n.id,
          start: d, durationMin: n.leaf.durationMin || 0
        });
      }
    });
    return out;
  }

  function budgetOccurrences(state, rangeStart, rangeEnd) {
    var all = [];
    P.model.leaves(state.goals, function (n) {
      return n.leaf && n.leaf.kind === 'budget';
    }).forEach(function (n) {
      P.model.expandOccurrences(n, rangeStart, rangeEnd).forEach(function (oc) {
        oc.title = n.title;
        oc.type = 'budget';
        oc.node = n;
        oc.id = n.id;
        all.push(oc);
      });
    });
    return all;
  }

  // ---- time grid (day / week) ----------------------------------------------
  function renderTime(days, mode) {
    var state = P.store.getState();
    setTitle(mode, days);

    // Preserve the user's scroll position across re-renders (a re-render fires on
    // every edit). If we're coming from the month view there's no time-grid to
    // read, so prevScroll stays null and we fall back to a sensible default.
    var prevScroll = null;
    var existing = bodyEl.querySelector('.cal-scroll');
    if (existing) prevScroll = existing.scrollTop;

    bodyEl.innerHTML = '';
    var wrap = el('div', 'cal-timegrid');

    // header: corner + day headers
    var head = el('div', 'cal-head');
    head.appendChild(el('div', 'cal-gutter-head'));
    var heads = el('div', 'cal-dayheads');
    heads.style.gridTemplateColumns = 'repeat(' + days.length + ',1fr)';
    days.forEach(function (day) {
      var h = el('div', 'cal-dayhead' + (isToday(day) ? ' today' : ''));
      h.innerHTML = '<span class="dow">' + U.DOW[day.getDay()] + '</span>' +
        '<span class="dnum">' + day.getDate() + '</span>';
      heads.appendChild(h);
    });
    head.appendChild(heads);
    wrap.appendChild(head);

    // body: gutter (hour labels) + grid columns
    var scroll = el('div', 'cal-scroll');
    var gutter = el('div', 'cal-gutter');
    for (var hh = START_HOUR; hh < END_HOUR; hh++) {
      var lab = el('div', 'cal-hour');
      lab.style.height = (SLOT_PX * 2) + 'px';
      lab.innerHTML = '<span>' + hourLabel(hh) + '</span>';
      gutter.appendChild(lab);
    }
    scroll.appendChild(gutter);

    var grid = el('div', 'cal-grid');
    grid.style.gridTemplateColumns = 'repeat(' + days.length + ',1fr)';
    grid.style.height = GRID_H + 'px';

    days.forEach(function (day) {
      var col = el('div', 'cal-col' + (isToday(day) ? ' today' : ''));
      col.style.height = GRID_H + 'px';
      col.dataset.date = U.ymd(day);

      // assemble & lay out this day's items
      var items = taskBlocks(state, day)
        .concat(budgetOccurrences(state, day, day));
      items.forEach(function (it) {
        it.startMin = U.minutesSinceMidnight(it.start);
        it.endMin = it.startMin + (it.durationMin || 0);
      });
      layoutColumns(items);
      items.forEach(function (it) { col.appendChild(timeBlock(it)); });

      // now-line
      if (isToday(day)) {
        var now = new Date();
        var nowMin = U.minutesSinceMidnight(now);
        if (nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60) {
          var line = el('div', 'now-line');
          line.style.top = ((nowMin - START_HOUR * 60) / SLOT_MIN * SLOT_PX) + 'px';
          col.appendChild(line);
        }
      }

      attachDrop(col, day);
      grid.appendChild(col);
    });

    scroll.appendChild(grid);
    wrap.appendChild(scroll);
    bodyEl.appendChild(wrap);

    if (prevScroll != null) {
      scroll.scrollTop = prevScroll;
    } else {
      // first paint of a time view: scroll near the current time
      var focusMin = U.minutesSinceMidnight(new Date());
      var target = (Math.max(START_HOUR * 60, Math.min(focusMin, END_HOUR * 60)) - START_HOUR * 60);
      scroll.scrollTop = Math.max(0, (target / SLOT_MIN * SLOT_PX) - 80);
    }
  }

  function timeBlock(it) {
    var top = (it.startMin - START_HOUR * 60) / SLOT_MIN * SLOT_PX;
    var height = Math.max((it.durationMin || 0) / SLOT_MIN * SLOT_PX, 18);
    var b = el('div', 'cal-block');
    b.style.top = Math.max(0, top) + 'px';
    b.style.height = height + 'px';
    b.style.left = 'calc(' + (it._col / it._cols * 100) + '% + 2px)';
    b.style.width = 'calc(' + (100 / it._cols) + '% - 4px)';

    var end = new Date(it.start.getTime() + (it.durationMin || 0) * 60000);
    var timeStr = U.fmtTimeShort(it.start) + '–' + U.fmtTimeShort(end);

    if (it.type === 'budget') {
      b.className += ' budget' + (it.done ? ' done' : '');
      b.innerHTML = '<div class="cb-title">' + esc(it.title) + '</div>' +
        '<div class="cb-time">' + timeStr + '</div>';
      b.title = 'Recurring budget — click to mark this day done/undone';
      b.addEventListener('click', function () {
        P.actions.toggleOccurrence(it.id, it.date);
      });
    } else {
      var lf = it.node.leaf;
      b.className += ' task' + (lf.estimated ? ' estimated' : '') + (lf.done ? ' done' : '');
      b.draggable = true;
      b.innerHTML =
        '<input type="checkbox" class="cb-done"' + (lf.done ? ' checked' : '') + '>' +
        '<div class="cb-main"><div class="cb-title">' + esc(it.node.title) + '</div>' +
        '<div class="cb-time">' + timeStr + '</div></div>';
      b.querySelector('.cb-done').addEventListener('change', function (e) {
        P.actions.toggleDone(it.id, e.target.checked);
      });
      b.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', it.id);
        e.dataTransfer.effectAllowed = 'move';
        P.dragNodeId = it.id;
      });
      b.addEventListener('dblclick', function () {
        if (P.goals && P.goals.openLeaf) P.goals.openLeaf(it.id);
      });
    }
    return b;
  }

  // Simple interval layout: side-by-side columns for overlapping items.
  function layoutColumns(items) {
    items.sort(function (a, b) { return a.startMin - b.startMin || a.endMin - b.endMin; });
    var clusters = [];
    var cur = [];
    var curEnd = -1;
    items.forEach(function (it) {
      if (cur.length && it.startMin >= curEnd) { clusters.push(cur); cur = []; curEnd = -1; }
      cur.push(it);
      curEnd = Math.max(curEnd, it.endMin);
    });
    if (cur.length) clusters.push(cur);

    clusters.forEach(function (cluster) {
      var colsEnd = [];
      cluster.forEach(function (it) {
        var placed = false;
        for (var c = 0; c < colsEnd.length; c++) {
          if (it.startMin >= colsEnd[c]) { it._col = c; colsEnd[c] = it.endMin; placed = true; break; }
        }
        if (!placed) { it._col = colsEnd.length; colsEnd.push(it.endMin); }
      });
      cluster.forEach(function (it) { it._cols = colsEnd.length; });
    });
  }

  // Create a new one-off task at `start` and immediately open its editor so the
  // user can name it / adjust. Cancelling the editor discards the placeholder.
  function quickAdd(start) {
    var st = P.store.getState();
    var node = P.model.makeNode('New task', P.model.defaultTaskLeaf());
    node.leaf.durationMin = 0; // no default time — set in the editor that opens
    node.leaf.scheduledStart = start.toISOString();
    st.goals.push(node);
    // Provisional: the placeholder is invisible to undo until the editor is saved
    // (which records it as one clean step). Cancelling rolls it back to nothing.
    P.store.commit({ provisional: true });
    if (P.goals && P.goals.openLeaf) P.goals.openLeaf(node.id, { isNew: true });
  }

  function yToStart(col, day, clientY) {
    var rect = col.getBoundingClientRect();
    var minutesFromStart = Math.round((clientY - rect.top) / SLOT_PX) * SLOT_MIN;
    minutesFromStart = Math.max(0, Math.min(minutesFromStart, (END_HOUR - START_HOUR) * 60 - SLOT_MIN));
    var start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), START_HOUR, 0, 0, 0);
    start.setMinutes(start.getMinutes() + minutesFromStart);
    return start;
  }

  function attachDrop(col, day) {
    col.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drop-hover');
    });
    col.addEventListener('dragleave', function () { col.classList.remove('drop-hover'); });
    // Click an empty slot to create a task there.
    col.addEventListener('click', function (e) {
      if (e.target !== col) return; // only clicks on bare grid, not on a block
      quickAdd(yToStart(col, day, e.clientY));
    });
    col.addEventListener('drop', function (e) {
      e.preventDefault();
      col.classList.remove('drop-hover');
      var id = e.dataTransfer.getData('text/plain') || P.dragNodeId;
      if (!id) return;
      P.actions.schedule(id, yToStart(col, day, e.clientY));
    });
  }

  // ---- month ----------------------------------------------------------------
  function renderMonth() {
    var state = P.store.getState();
    var a = anchor();
    setTitle('month', [a]);

    var first = U.startOfMonth(a);
    var gridStart = U.startOfWeek(first, weekStart());
    var days = [];
    for (var i = 0; i < 42; i++) days.push(U.addDays(gridStart, i));

    var rangeEnd = days[41];
    var occ = budgetOccurrences(state, gridStart, rangeEnd);
    var occByDay = {};
    occ.forEach(function (o) { (occByDay[o.date] = occByDay[o.date] || []).push(o); });

    bodyEl.innerHTML = '';
    var wrap = el('div', 'cal-month');

    var head = el('div', 'cal-month-head');
    for (var d = 0; d < 7; d++) {
      var dow = el('div', 'cm-dow');
      dow.textContent = U.DOW[(weekStart() + d) % 7];
      head.appendChild(dow);
    }
    wrap.appendChild(head);

    var grid = el('div', 'cal-month-grid');
    days.forEach(function (day) {
      var inMonth = day.getMonth() === a.getMonth();
      var cell = el('div', 'cm-cell' + (inMonth ? '' : ' off') + (isToday(day) ? ' today' : ''));
      cell.dataset.date = U.ymd(day);

      var dn = el('div', 'cm-daynum');
      dn.textContent = String(day.getDate());
      cell.appendChild(dn);

      var list = el('div', 'cm-items');
      taskBlocks(state, day)
        .sort(function (x, y) { return x.start - y.start; })
        .forEach(function (it) { list.appendChild(monthChip(it)); });
      (occByDay[U.ymd(day)] || []).forEach(function (oc) { list.appendChild(monthChip(oc)); });
      cell.appendChild(list);

      attachMonthDrop(cell, day);
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
    bodyEl.appendChild(wrap);
  }

  function monthChip(it) {
    var c = el('div', 'cm-chip');
    if (it.type === 'budget') {
      c.className += ' budget' + (it.done ? ' done' : '');
      c.textContent = U.fmtTimeShort(it.start) + ' ' + it.title;
      c.addEventListener('click', function () { P.actions.toggleOccurrence(it.id, it.date); });
    } else {
      var lf = it.node.leaf;
      c.className += ' task' + (lf.estimated ? ' estimated' : '') + (lf.done ? ' done' : '');
      c.textContent = U.fmtTimeShort(it.start) + ' ' + it.node.title;
      c.draggable = true;
      c.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', it.id);
        e.dataTransfer.effectAllowed = 'move';
        P.dragNodeId = it.id;
      });
      c.addEventListener('click', function () {
        if (P.goals && P.goals.openLeaf) P.goals.openLeaf(it.id);
      });
    }
    return c;
  }

  function attachMonthDrop(cell, day) {
    cell.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cell.classList.add('drop-hover');
    });
    cell.addEventListener('dragleave', function () { cell.classList.remove('drop-hover'); });
    // Click an empty part of a day to create a task at 9:00 that day.
    cell.addEventListener('click', function (e) {
      if (e.target.closest('.cm-chip')) return; // clicked an existing item
      quickAdd(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0, 0, 0));
    });
    cell.addEventListener('drop', function (e) {
      e.preventDefault();
      cell.classList.remove('drop-hover');
      var id = e.dataTransfer.getData('text/plain') || P.dragNodeId;
      if (!id) return;
      // keep the task's existing time-of-day if it had one, else default 9:00
      var f = P.model.find(P.store.getState().goals, id);
      var hh = 9, mm = 0;
      if (f && f.node.leaf && f.node.leaf.scheduledStart) {
        var prev = new Date(f.node.leaf.scheduledStart);
        hh = prev.getHours(); mm = prev.getMinutes();
      }
      var start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0);
      P.actions.schedule(id, start);
    });
  }

  // ---- titles / helpers -----------------------------------------------------
  function setTitle(mode, days) {
    if (!titleEl) return;
    if (mode === 'day') {
      titleEl.textContent = U.fmtDateLong(days[0]);
    } else if (mode === 'month') {
      var a = days[0];
      titleEl.textContent = U.MONTHS_LONG[a.getMonth()] + ' ' + a.getFullYear();
    } else {
      var s = days[0], e = days[days.length - 1];
      var sameMonth = s.getMonth() === e.getMonth();
      titleEl.textContent = U.MONTHS[s.getMonth()] + ' ' + s.getDate() + ' – ' +
        (sameMonth ? '' : U.MONTHS[e.getMonth()] + ' ') + e.getDate() + ', ' + e.getFullYear();
    }
  }

  function hourLabel(h) {
    var ap = h >= 12 && h < 24 ? 'PM' : 'AM';
    var hh = h % 12; if (hh === 0) hh = 12;
    if (h === 24) { hh = 12; ap = 'AM'; }
    return hh + ' ' + ap;
  }

  function isToday(day) { return U.sameDay(day, new Date()); }

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  P.calendar = { mount: mount, render: render };
})();
