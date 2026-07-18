// The calendar area. Month is the overview grid: a chip per top-level item each
// day, drag a chip between days to reschedule, click a day to open it. Day is a
// plain checklist — tasks (with indented subtasks) and any habits that recur
// that day. Tasks are created and edited through the modal editor; there is no
// inline text entry here.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var U = null;

  var bodyEl = null;
  var titleEl = null;

  function mount() {
    U = P.util;
    bodyEl = document.getElementById('calendar-body');
    titleEl = document.getElementById('cal-title');
  }

  function ui() { return P.store.getState().ui; }

  function render() {
    if (!bodyEl) return;
    // The title bar swaps its Month↔day controls off this class (back button, and
    // hiding "+ Task" on a day where the inline button covers it).
    document.body.classList.toggle('cal-day', ui().area === 'calendar' && ui().calMode === 'day');
    // Skip drawing while the Calendar area is hidden (single-view layout). It is
    // rendered fresh the moment its sidebar item is selected, so this just avoids
    // wasted work on every notes keystroke.
    if (bodyEl.offsetParent === null) return;
    if (ui().calMode === 'day') renderDay(); else renderMonth();
  }

  function openDay(ymd) {
    var st = P.store.getState();
    st.ui.calMode = 'day';
    st.ui.dayDate = ymd;
    P.store.commit({ noHistory: true });
  }

  function backToMonth() {
    var st = P.store.getState();
    st.ui.calMode = 'month';
    st.ui.anchorDate = st.ui.dayDate; // keep the month you came from in view
    P.store.commit({ noHistory: true });
  }

  // ---- month ----------------------------------------------------------------
  function renderMonth() {
    var state = P.store.getState();
    var a = U.parseYmd(state.ui.anchorDate);
    if (titleEl) titleEl.textContent = U.MONTHS_LONG[a.getMonth()] + ' ' + a.getFullYear();

    var ws = state.ui.weekStartsOn || 0;
    var gridStart = U.startOfWeek(U.startOfMonth(a), ws);
    var days = [];
    for (var i = 0; i < 42; i++) days.push(U.addDays(gridStart, i));

    bodyEl.innerHTML = '';
    var wrap = el('div', 'cal-month');

    var head = el('div', 'cal-month-head');
    for (var d = 0; d < 7; d++) {
      var dow = el('div', 'cm-dow');
      dow.textContent = U.DOW[(ws + d) % 7];
      head.appendChild(dow);
    }
    wrap.appendChild(head);

    var grid = el('div', 'cal-month-grid');
    days.forEach(function (day) {
      var ymd = U.ymd(day);
      var inMonth = day.getMonth() === a.getMonth();
      var cell = el('div', 'cm-cell' + (inMonth ? '' : ' off') + (isToday(day) ? ' today' : ''));
      cell.dataset.date = ymd;

      var dn = el('div', 'cm-daynum');
      dn.textContent = String(day.getDate());
      cell.appendChild(dn);

      var list = el('div', 'cm-items');
      P.model.sortEntries(P.model.itemsOn(state.items, ymd))
        .forEach(function (entry) { list.appendChild(monthChip(entry)); });
      cell.appendChild(list);

      // Click a day to open it; drop a chip on it to reschedule.
      cell.addEventListener('click', function () { openDay(ymd); });
      attachDrop(cell, ymd);
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
    bodyEl.appendChild(wrap);
  }

  function monthChip(entry) {
    var it = entry.item;
    var c = el('div', 'cm-chip');
    var prefix = it.time ? U.fmtHMShort(it.time) + ' ' : '';
    if (it.kind === 'habit') {
      c.className += ' habit' + (entry.done ? ' done' : '');
      c.textContent = prefix + it.title;
    } else {
      c.className += ' task' + (it.done ? ' done' : '');
      c.textContent = prefix + it.title;
      c.draggable = true;
      c.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', it.id);
        e.dataTransfer.effectAllowed = 'move';
        P.dragNodeId = it.id;
      });
    }
    // Let the cell's click handler open the day — a chip is part of the day.
    return c;
  }

  function attachDrop(target, ymd) {
    target.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      target.classList.add('drop-hover');
    });
    target.addEventListener('dragleave', function () { target.classList.remove('drop-hover'); });
    target.addEventListener('drop', function (e) {
      e.preventDefault();
      target.classList.remove('drop-hover');
      var id = e.dataTransfer.getData('text/plain') || P.dragNodeId;
      if (id) P.actions.schedule(id, ymd);
    });
  }

  // ---- day ------------------------------------------------------------------
  // The date and the "‹ Month" back button live in the title bar; this page is
  // just the day's checklist and one "+ Add task" button.
  function renderDay() {
    var state = P.store.getState();
    var ymd = state.ui.dayDate;
    var day = U.parseYmd(ymd);
    if (titleEl) titleEl.textContent = U.fmtDateLong(day) + (isToday(day) ? '  ·  Today' : '');

    bodyEl.innerHTML = '';
    var wrap = el('div', 'day-view');

    var listWrap = el('div', 'day-list');
    var entries = P.model.sortEntries(P.model.itemsOn(state.items, ymd));
    if (!entries.length) {
      var empty = el('div', 'empty-hint big');
      empty.textContent = 'Click anywhere to add a task.';
      listWrap.appendChild(empty);
    } else {
      entries.forEach(function (entry) { listWrap.appendChild(taskTree(entry, ymd, 0)); });
    }
    // Click any empty space on the day to create a new task there.
    listWrap.addEventListener('click', function (e) {
      if (e.target.closest('.day-row')) return; // a click on a task or its controls
      if (P.editor) P.editor.openNew();
    });
    // Dropping a chip from another day reschedules it here.
    attachDrop(listWrap, ymd);
    wrap.appendChild(listWrap);

    bodyEl.appendChild(wrap);
  }

  // A task (or habit) row plus its subtasks, indented beneath it. Recursive, so
  // a subtask can itself hold subtasks.
  function taskTree(entry, ymd, depth) {
    var node = el('div', 'task-node');
    node.appendChild(taskRow(entry, ymd, depth));
    var kids = entry.item.children || [];
    if (kids.length) {
      var box = el('div', 'subtasks');
      kids.forEach(function (child) {
        box.appendChild(taskTree({ item: child, done: !!child.done }, ymd, depth + 1));
      });
      node.appendChild(box);
    }
    return node;
  }

  function taskRow(entry, ymd, depth) {
    var it = entry.item;
    var row = el('div', 'day-row' + (it.kind === 'habit' ? ' habit' : '') + (entry.done ? ' done' : ''));
    row.dataset.id = it.id;

    var box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'dr-done';
    box.checked = entry.done;
    box.addEventListener('change', function () {
      if (it.kind === 'habit') P.actions.toggleOccurrence(it.id, ymd);
      else P.actions.toggleDone(it.id, box.checked);
    });
    row.appendChild(box);

    if (it.time) row.appendChild(chip('time', U.fmtHMShort(it.time)));

    var title = el('span', 'dr-title');
    title.textContent = it.title;
    row.appendChild(title);

    if (it.kind === 'habit') row.appendChild(chip('rec', 'habit'));

    row.appendChild(rowActions(it));

    // Only top-level one-off tasks are dragged onto the calendar; subtasks and
    // habit occurrences move with (or are generated by) their parent.
    if (it.kind === 'task' && depth === 0) {
      row.draggable = true;
      row.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', it.id);
        e.dataTransfer.effectAllowed = 'move';
        P.dragNodeId = it.id;
      });
    }
    return row;
  }

  function rowActions(it) {
    var acts = el('span', 'dr-actions');
    // Habits are generated per-day, so they don't grow subtask checklists.
    if (it.kind === 'task') {
      var sub = el('button', '');
      sub.textContent = '+ Add';
      sub.title = 'Add a subtask';
      sub.addEventListener('click', function () { if (P.editor) P.editor.openNewSub(it.id); });
      acts.appendChild(sub);
    }
    var edit = el('button', '');
    edit.textContent = 'Edit';
    edit.addEventListener('click', function () { if (P.editor) P.editor.openItem(it.id); });
    acts.appendChild(edit);

    var del = el('button', '');
    del.textContent = 'Delete';
    del.addEventListener('click', function () {
      var kids = (it.children && it.children.length) ? ' and its subtasks' : '';
      var what = it.kind === 'habit' ? '"' + it.title + '" (every day it recurs)' : '"' + it.title + '"' + kids;
      if (!window.confirm('Delete ' + what + '?')) return;
      P.actions.deleteItem(it.id);
    });
    acts.appendChild(del);
    return acts;
  }

  // Briefly highlight an item's row on the open day page (search jump).
  function flashItem(id) {
    var row = bodyEl && bodyEl.querySelector('.day-row[data-id="' + id + '"]');
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    row.classList.add('flash');
    setTimeout(function () { row.classList.remove('flash'); }, 1100);
  }

  // ---- helpers --------------------------------------------------------------
  function chip(cls, text) {
    var c = el('span', 'chip ' + cls);
    c.textContent = text;
    return c;
  }

  function isToday(day) { return U.sameDay(day, new Date()); }

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  P.calendar = { mount: mount, render: render, openDay: openDay, backToMonth: backToMonth, flashItem: flashItem };
})();
