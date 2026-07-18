// The modal task editor — the only way to create or change a task. A top-level
// task can carry a date and be made recurring (a habit); a subtask is just a
// title/time/notes checklist item, so those fields are hidden for it. Exposed as
// P.editor.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});

  var dlg = null;
  var editingId = null;    // item being edited
  var creatingNew = false; // opened for a provisional new (task or subtask)
  var savedThisOpen = false;
  var editingSub = false;  // is the target a subtask (nested under another task)

  function mount() {
    dlg = document.getElementById('item-dialog');

    // Day-of-week toggle buttons
    var dowWrap = document.getElementById('it-dow');
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (lbl, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dow-btn';
      b.dataset.dow = String(i);
      b.textContent = lbl;
      b.addEventListener('click', function () { b.classList.toggle('on'); });
      dowWrap.appendChild(b);
    });

    document.getElementById('it-recurring').addEventListener('change', syncKindFields);
    document.getElementById('it-cancel').addEventListener('click', cancelItem);
    document.getElementById('it-delete').addEventListener('click', deleteFromDialog);
    document.getElementById('item-form').addEventListener('submit', onSubmit);
    dlg.addEventListener('keydown', function (e) { if (e.key === 'Escape') cancelItem(); });

    // Date fields open the custom monochrome calendar popup.
    if (P.picker) {
      Array.prototype.forEach.call(document.querySelectorAll('#item-dialog input[type="date"]'), function (inp) {
        P.picker.attach(inp);
      });
    }

    // Time is free text: "900am", "9", "1830" all normalise on blur.
    var time = document.getElementById('it-time');
    time.addEventListener('blur', function () {
      var t = P.util.parseClock(time.value);
      if (t) time.value = P.util.fmtClock(t.h, t.m);
    });
    time.addEventListener('input', function () { time.classList.remove('bad'); });
  }

  function items() { return P.store.getState().items; }

  // ---- Opening --------------------------------------------------------------
  // "+ Add task" / title-bar "+ Task": a provisional top-level task the editor
  // names. Cancelling rolls it back to nothing; saving records one clean step.
  function openNew() {
    var st = P.store.getState();
    var task = P.model.makeTask('');
    // From a day page it lands on that day; otherwise it starts in the backlog.
    if (st.ui.area === 'calendar' && st.ui.calMode === 'day') task.date = st.ui.dayDate;
    st.items.push(task);
    P.store.commit({ provisional: true });
    openItem(task.id, { isNew: true });
  }

  // "+ Sub" on a task row: a provisional subtask nested under `parentId`.
  function openNewSub(parentId) {
    var st = P.store.getState();
    var f = P.model.find(st.items, parentId);
    if (!f) return;
    var sub = P.model.makeSubtask('');
    f.item.children = f.item.children || [];
    f.item.children.push(sub);
    P.store.commit({ provisional: true });
    openItem(sub.id, { isNew: true });
  }

  function openItem(id, opts) {
    var f = P.model.find(items(), id);
    if (!f) return;
    var it = f.item;
    editingId = id;
    editingSub = !!f.parent; // nested → it's a subtask
    creatingNew = !!(opts && opts.isNew);
    savedThisOpen = false;

    document.getElementById('it-title').value = (it.title === 'Untitled' && creatingNew) ? '' : it.title;
    document.getElementById('it-time').value = it.time ? P.util.fmtHM(it.time) : '';
    document.getElementById('it-notes').value = it.notes || '';
    document.getElementById('it-recurring').checked = (it.kind === 'habit');

    var rec = it.kind === 'habit' ? it.recurrence : P.model.makeHabit('').recurrence;
    Array.prototype.forEach.call(document.querySelectorAll('#it-dow .dow-btn'), function (b) {
      b.classList.toggle('on', rec.daysOfWeek.indexOf(parseInt(b.dataset.dow, 10)) !== -1);
    });
    document.getElementById('it-rec-start').value = rec.startDate || '';
    document.getElementById('it-rec-end').value = rec.endDate || '';

    // A subtask is a plain checklist item: no scheduling, no recurrence.
    document.getElementById('it-recurring-row').style.display = editingSub ? 'none' : '';
    document.getElementById('it-delete').style.display = creatingNew ? 'none' : '';
    syncKindFields();
    dlg.showModal();
    document.getElementById('it-title').focus();
  }

  function syncKindFields() {
    var recurring = !editingSub && document.getElementById('it-recurring').checked;
    document.getElementById('it-habit-fields').style.display = recurring ? '' : 'none';
    document.getElementById('item-dialog-title').textContent =
      editingSub ? 'Subtask' : (recurring ? 'Habit' : 'Task');
  }

  function cancelItem() {
    if (P.picker) P.picker.close();
    if (creatingNew && !savedThisOpen && editingId) {
      P.model.remove(items(), editingId);
      P.store.commit({ provisional: true }); // roll back the placeholder, no undo trace
    }
    creatingNew = false;
    editingId = null;
    if (dlg.open) dlg.close();
  }

  function deleteFromDialog() {
    var f = P.model.find(items(), editingId);
    if (!f) { cancelItem(); return; }
    var it = f.item;
    var kids = (it.children && it.children.length) ? ' and its subtasks' : '';
    var what = it.kind === 'habit' ? '"' + it.title + '" (every day it recurs)' : '"' + it.title + '"' + kids;
    if (!window.confirm('Delete ' + what + '?')) return;
    var id = editingId;
    editingId = null;
    creatingNew = false;
    if (P.picker) P.picker.close();
    dlg.close();
    P.actions.deleteItem(id);
  }

  function onSubmit(e) {
    e.preventDefault();
    var f = P.model.find(items(), editingId);
    if (!f) { dlg.close(); return; }
    var it = f.item;

    var timeInp = document.getElementById('it-time');
    var time = null;
    if (timeInp.value.trim() !== '') {
      var t = P.util.parseClock(timeInp.value);
      if (!t) { timeInp.classList.add('bad'); timeInp.focus(); return; }
      time = P.util.hm(t);
    }

    var title = document.getElementById('it-title').value.trim() || 'Untitled';
    var notes = document.getElementById('it-notes').value;
    var recurring = !editingSub && document.getElementById('it-recurring').checked;

    var next;
    if (recurring) {
      next = P.model.makeHabit(title);
      var days = [];
      Array.prototype.forEach.call(document.querySelectorAll('#it-dow .dow-btn.on'), function (b) {
        days.push(parseInt(b.dataset.dow, 10));
      });
      days.sort(function (a, b) { return a - b; });
      next.recurrence.daysOfWeek = days.length ? days : [1, 2, 3, 4, 5];
      next.recurrence.startDate = document.getElementById('it-rec-start').value || null;
      next.recurrence.endDate = document.getElementById('it-rec-end').value || null;
      if (it.kind === 'habit') next.completedOccurrences = it.completedOccurrences || [];
    } else {
      next = P.model.makeTask(title);
      // A task keeps the day it was created on; a subtask never carries a date.
      // Turning a habit back into a one-off task lands it on the day in view, so
      // it can't vanish (there's no backlog list to fall into).
      next.date = editingSub ? null
        : (it.kind === 'task' ? it.date : P.store.getState().ui.dayDate);
      if (it.kind === 'task') {
        next.done = it.done;
        next.completedAt = it.completedAt;
        next.children = it.children || []; // never drop subtasks on an edit
      }
    }
    next.id = it.id;
    next.time = time;
    next.notes = notes;
    f.list[f.index] = next;

    savedThisOpen = true;
    creatingNew = false;
    editingId = null;
    if (P.picker) P.picker.close();
    dlg.close();
    P.store.commit();
  }

  P.editor = { mount: mount, openItem: openItem, openNew: openNew, openNewSub: openNewSub };
})();
