// The Goals panel: a collapsible outline of the goal forest. Parents show live
// rolled-up totals (finite time + recurring weekly budget + completion); leaves
// carry the concrete duration/schedule and are the drag sources for the calendar.
// A modal <dialog> edits leaf details (type, duration, schedule, recurrence).
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var treeEl = null;
  var dlg = null;
  var goalDlg = null;
  var editingId = null;
  var creatingNew = false;   // editor opened for a freshly click-created task
  var savedThisOpen = false; // did the user actually save this editor session
  // Selection is a list (in click order); the LAST id is the "primary" — the one
  // whose details/actions show and the target for paste. Plain click = single
  // select; Shift+click toggles a node in/out of the set (multi-select).
  var selectedIds = [];
  var clipboard = [];        // copied goal subtrees (deep clones), pasted with fresh ids
  var selectedTemplateId = null; // template chosen in the New-goal dialog (null = Blank)

  function primaryId() { return selectedIds.length ? selectedIds[selectedIds.length - 1] : null; }
  function isSelected(id) { return selectedIds.indexOf(id) !== -1; }

  // ---- Mount ----------------------------------------------------------------
  function mount() {
    treeEl = document.getElementById('goal-tree');
    dlg = document.getElementById('leaf-dialog');
    goalDlg = document.getElementById('goal-dialog');

    document.getElementById('btn-add-goal').addEventListener('click', addGoal);
    document.getElementById('goal-cancel').addEventListener('click', function () { goalDlg.close(); });
    document.getElementById('goal-form').addEventListener('submit', onGoalCreate);
    document.getElementById('tpl-picker').addEventListener('click', onPickerClick);

    treeEl.addEventListener('click', onClick);
    treeEl.addEventListener('dblclick', onDblClick);
    treeEl.addEventListener('change', onChange);
    treeEl.addEventListener('dragstart', onDragStart);

    wireDialog();
  }

  // ---- Render ---------------------------------------------------------------
  function render() {
    if (!treeEl) return;
    var state = P.store.getState();
    if (!state.goals.length) { treeEl.innerHTML = ''; return; }
    // Each top-level goal is its own separated card; its subtree renders as a tree.
    treeEl.innerHTML = state.goals.map(function (n) {
      return '<div class="goal-card">' + nodeHtml(n, 0) + '</div>';
    }).join('');
  }

  function nodeHtml(n, depth) {
    var leaf = P.model.isLeaf(n);
    var selCls = isSelected(n.id) ? ' selected' : '';
    if (n.id === primaryId()) selCls += ' primary-sel';
    var html = '<div class="node" data-id="' + n.id + '">';
    html += '<div class="node-row ' + (leaf ? 'is-leaf' : 'is-parent') +
      (depth === 0 ? ' goal-header' : '') + selCls +
      rowMods(n) + '"' +
      (leaf && n.leaf.kind === 'task' ? ' draggable="true"' : '') + '>';

    // lead slot: caret for parents; done checkbox for task leaves (shown on select)
    if (!leaf) {
      html += '<button class="caret" data-action="toggle" title="Expand / collapse">' +
        (n.collapsed ? '▸' : '▾') + '</button>';
    } else if (n.leaf.kind === 'task') {
      html += '<span class="leadslot"><input type="checkbox" class="done-box" data-action="done"' +
        (n.leaf.done ? ' checked' : '') + '></span>';
    } else {
      html += '<span class="leadslot"></span>';
    }

    // title
    html += '<span class="title">' + esc(n.title) + '</span>';

    // meta + actions — hidden until the row is selected (see CSS)
    html += '<span class="meta">' + metaHtml(n, leaf) + '</span>';
    html += '<span class="row-actions">';
    html += '<button data-action="add-sub">Add</button>';
    if (leaf) html += '<button data-action="details">Edit</button>';
    if (depth === 0) html += '<button data-action="save-template" title="Save as a reusable template">Save</button>';
    html += '<button data-action="delete">Delete</button>';
    html += '</span>';

    html += '</div>'; // .node-row

    if (!leaf && !n.collapsed) {
      html += '<div class="children">' +
        n.children.map(function (c) { return nodeHtml(c, depth + 1); }).join('') +
        '</div>';
    }
    html += '</div>'; // .node
    return html;
  }

  function rowMods(n) {
    if (P.model.isLeaf(n)) {
      var lf = n.leaf;
      var m = '';
      if (lf.kind === 'budget') m += ' kind-budget';
      else {
        if (lf.done) m += ' done';
        if (lf.scheduledStart) m += ' scheduled';
      }
      return m;
    }
    return '';
  }

  function metaHtml(n, leaf) {
    if (!leaf) {
      var r = P.model.rollup(n);
      var parts = [];
      if (r.finiteMin > 0) parts.push('<span class="chip total">' + P.util.formatDuration(r.finiteMin) + '</span>');
      if (r.recurringWeeklyMin > 0) parts.push('<span class="chip rec">' + P.util.formatDuration(r.recurringWeeklyMin) + '/wk</span>');
      if (r.taskCount > 0) {
        parts.push('<span class="progress"><span class="progress-fill" style="width:' + r.percent + '%"></span></span>' +
          '<span class="pct">' + r.percent + '%</span>');
      }
      return parts.join(' ');
    }

    var lf = n.leaf;
    if (lf.kind === 'budget') {
      var b = [];
      if (lf.durationMin > 0) b.push('<span class="chip dur">' + P.util.formatDuration(lf.durationMin) + '</span>');
      b.push('<span class="chip rec">' + recurrenceSummary(lf.recurrence) + '</span>');
      return b.join(' ');
    }
    var out = [];
    if (lf.durationMin > 0) out.push('<span class="chip dur">' + P.util.formatDuration(lf.durationMin) + '</span>');
    if (lf.actualMin >= 1) out.push('<span class="chip actual">logged ' + P.util.formatDuration(Math.round(lf.actualMin)) + '</span>');
    if (lf.scheduledStart) {
      var d = new Date(lf.scheduledStart);
      // A start-of-day (midnight) task carries no real time-of-day — show just the
      // date rather than a misleading "12a".
      var atDayStart = d.getHours() === 0 && d.getMinutes() === 0;
      out.push('<span class="chip when">' + P.util.fmtDateShort(d) +
        (atDayStart ? '' : ' ' + P.util.fmtTimeShort(d)) + '</span>');
    }
    return out.join(' ');
  }

  function recurrenceSummary(rec) {
    if (!rec) return 'no recurrence';
    var days = (rec.daysOfWeek || []).slice().sort(function (a, b) { return a - b; });
    var label;
    if (sameSet(days, [1, 2, 3, 4, 5])) label = 'Mon–Fri';
    else if (sameSet(days, [0, 6])) label = 'Sat–Sun';
    else if (days.length === 7) label = 'Every day';
    else if (!days.length) label = 'no days';
    else label = days.map(function (d) { return P.util.DOW[d]; }).join(' ');
    return label + ' · ' + to12h(rec.startTime);
  }
  function to12h(hhmm) {
    var p = String(hhmm || '0:0').split(':');
    var h = parseInt(p[0], 10) || 0, m = parseInt(p[1], 10) || 0;
    var ap = h >= 12 ? 'p' : 'a', hh = h % 12; if (hh === 0) hh = 12;
    return (m === 0 ? hh : hh + ':' + P.util.pad(m)) + ap;
  }
  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ---- Events ---------------------------------------------------------------
  function nodeIdOf(el) {
    var node = el.closest('.node');
    return node ? node.dataset.id : null;
  }

  function onClick(e) {
    var btn = e.target.closest('[data-action]');
    if (btn) {
      var action = btn.dataset.action;
      var id = nodeIdOf(btn);
      if (!id) return;
      var st = P.store.getState();
      if (action === 'toggle') {
        var f = P.model.find(st.goals, id);
        if (f) { f.node.collapsed = !f.node.collapsed; P.store.commit({ noHistory: true }); }
      } else if (action === 'add-sub') {
        var f2 = P.model.find(st.goals, id);
        var parent = f2 ? f2.node : null;
        // Breaking a task into subtasks: carry its existing work (duration,
        // schedule, logged time) into the first subnode instead of losing it.
        var carry = null;
        if (parent && P.model.isLeaf(parent) && parent.leaf) {
          var plf = parent.leaf;
          if ((plf.durationMin || 0) > 0 || plf.scheduledStart || plf.done ||
            plf.kind === 'budget' || (plf.actualMin || 0) > 0 || plf.timerStart) {
            carry = plf;
          }
        }
        var child = P.model.makeNode('New task', carry || P.model.defaultTaskLeaf());
        if (parent) parent.collapsed = false;
        P.model.addChild(st.goals, id, child); // clears parent.leaf
        selectedIds = [child.id];
        P.store.commit();
        startRename(child.id); // immediately let the user name it
      } else if (action === 'delete') {
        deleteNode(id);
      } else if (action === 'details') {
        openLeafEditor(id);
      } else if (action === 'save-template') {
        saveAsTemplate(id);
      }
      return; // 'done' handled in onChange
    }
    // Clicking a row (not an action) selects it — that's when its details appear.
    var row = e.target.closest('.node-row');
    if (row) {
      var rid = nodeIdOf(row);
      if (rid) selectNode(rid, e.shiftKey);
    }
  }

  // Update selection. Plain click selects just this row (clicking the only
  // selected row again clears it). Shift+click toggles this row in/out of the
  // selection so several goals can be picked at once (for copy/paste).
  function selectNode(id, additive) {
    if (additive) {
      var i = selectedIds.indexOf(id);
      if (i === -1) selectedIds.push(id); else selectedIds.splice(i, 1);
    } else if (selectedIds.length === 1 && selectedIds[0] === id) {
      selectedIds = [];
    } else {
      selectedIds = [id];
    }
    applySelectionClasses();
  }

  // Reflect selectedIds onto the DOM without a full re-render: every selected row
  // gets `.selected`; the primary (last-clicked) also gets `.primary-sel`, which
  // is what reveals its details/actions row.
  function applySelectionClasses() {
    if (!treeEl) return;
    Array.prototype.forEach.call(treeEl.querySelectorAll('.node-row.selected, .node-row.primary-sel'), function (r) {
      r.classList.remove('selected', 'primary-sel');
    });
    selectedIds.forEach(function (id) {
      var row = rowOf(id);
      if (row) row.classList.add('selected');
    });
    var pid = primaryId();
    if (pid) { var pr = rowOf(pid); if (pr) pr.classList.add('primary-sel'); }
  }

  function rowOf(id) {
    var node = treeEl.querySelector('.node[data-id="' + id + '"]');
    return node ? node.querySelector('.node-row') : null;
  }

  function onChange(e) {
    var box = e.target.closest('[data-action="done"]');
    if (!box) return;
    var id = nodeIdOf(box);
    if (id) P.actions.toggleDone(id, box.checked);
  }

  function onDblClick(e) {
    var title = e.target.closest('.title');
    if (!title) return;
    var id = nodeIdOf(title);
    if (id) editTitleInline(title, id);
  }

  function onDragStart(e) {
    var row = e.target.closest('.node-row');
    if (!row || !row.getAttribute('draggable')) return;
    var id = nodeIdOf(row);
    if (!id) return;
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    P.dragNodeId = id;
  }

  function deleteNode(id) {
    var st = P.store.getState();
    var f = P.model.find(st.goals, id);
    if (!f) return;
    var hasKids = f.node.children && f.node.children.length;
    var msg = hasKids ? 'Delete "' + f.node.title + '" and everything inside it?'
      : 'Delete "' + f.node.title + '"?';
    if (!window.confirm(msg)) return;
    P.model.removeNode(st.goals, id);
    P.store.commit();
  }

  // "+ Add goal" opens a small dialog to name the goal and pick a template first.
  function addGoal() {
    selectedTemplateId = null; // default to a blank goal each time
    var nameInput = document.getElementById('goal-name');
    nameInput.value = '';
    nameInput.placeholder = 'Name your goal';
    renderTemplatePicker();
    goalDlg.showModal();
    nameInput.focus();
  }
  function onGoalCreate(e) {
    e.preventDefault();
    var st = P.store.getState();
    var name = document.getElementById('goal-name').value.trim();
    var tpl = selectedTemplateId ? findTemplate(selectedTemplateId) : null;
    var g = tpl ? P.model.instantiateTemplate(tpl, name) : P.model.makeGoal(name || 'Untitled');
    st.goals.push(g);
    selectedIds = [g.id];
    goalDlg.close();
    P.store.commit();
  }

  // ---- Template picker (inside the New-goal dialog) -------------------------
  function findTemplate(id) {
    var list = P.store.getState().templates || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function renderTemplatePicker() {
    var wrap = document.getElementById('tpl-picker');
    if (!wrap) return;
    var field = document.getElementById('tpl-field');
    var tpls = P.store.getState().templates || [];
    // With no saved templates there's nothing to choose from — hide the section.
    if (field) field.style.display = tpls.length ? '' : 'none';
    if (!tpls.length) { wrap.innerHTML = ''; return; }
    var html = slot(null, 'Blank', false);
    tpls.forEach(function (t) {
      html += slot(t.id, t.name, !t.builtin);
    });
    wrap.innerHTML = html;

    function slot(id, name, deletable) {
      var sel = ((id || null) === selectedTemplateId) ? ' selected' : '';
      var h = '<div class="tpl-slot">';
      h += '<button type="button" class="tpl-card' + sel + '" data-tpl="' + esc(id || '') + '">';
      h += '<span class="tpl-name">' + esc(name) + '</span>';
      h += '</button>';
      if (deletable) {
        h += '<button type="button" class="tpl-del" data-tpl-del="' + esc(id) +
          '" title="Delete this template" aria-label="Delete template">×</button>';
      }
      h += '</div>';
      return h;
    }
  }

  function onPickerClick(e) {
    var del = e.target.closest('[data-tpl-del]');
    if (del) { e.stopPropagation(); deleteTemplate(del.getAttribute('data-tpl-del')); return; }
    var card = e.target.closest('.tpl-card');
    if (!card) return;
    selectedTemplateId = card.getAttribute('data-tpl') || null;
    renderTemplatePicker();
    document.getElementById('goal-name').focus();
  }

  function deleteTemplate(id) {
    var st = P.store.getState();
    var list = st.templates || [];
    var i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].id === id) { i = k; break; }
    if (i === -1 || list[i].builtin) return; // built-ins are not deletable
    if (!window.confirm('Delete the template "' + list[i].name + '"?')) return;
    list.splice(i, 1);
    if (selectedTemplateId === id) selectedTemplateId = null; // fall back to Blank
    P.store.commit();          // persist (undoable)
    renderTemplatePicker();    // commit re-renders the tree; refresh the open picker too
  }

  // Save an existing top-level goal's structure as a reusable custom template.
  function saveAsTemplate(id) {
    var st = P.store.getState();
    var f = P.model.find(st.goals, id);
    if (!f) return;
    var tpl = P.model.templateFromNode(f.node);
    st.templates = st.templates || [];
    st.templates.push(tpl);
    P.store.commit();
    if (P.app && P.app.toast) P.app.toast('Saved template "' + tpl.name + '"');
  }

  // The one in-progress inline rename's finish() (or null). Tracked so we never
  // have two rename inputs alive at once — that race is what made the caret vanish
  // and could crash the app (see editTitleInline).
  var activeRename = null;

  // Find a node's title in the DOM and start renaming it.
  function startRename(id) {
    var span = treeEl.querySelector('.node[data-id="' + id + '"] .title');
    if (span) editTitleInline(span, id);
  }

  // Inline rename using a real text input — shows a caret and is reliable across
  // engines (the old contentEditable approach hid the cursor).
  //
  // Robustness: a rename's blur handler commits and re-renders the whole tree. If
  // that fired synchronously while another render was running (or while focus was
  // moving to a second rename input), it would detach the live input mid-operation
  // — the caret never appeared and the app could crash. So: (1) only one rename is
  // ever active — starting a new one cleanly finishes the previous and re-finds the
  // freshly rendered node, and (2) the blur-save is deferred a tick so it can never
  // re-enter render() synchronously. Enter/Escape still finish immediately.
  function editTitleInline(span, id) {
    if (activeRename) activeRename(true); // commit any rename already in progress
    // The previous finish re-rendered the tree, so re-find the live title element.
    span = (treeEl && treeEl.querySelector('.node[data-id="' + id + '"] .title')) || span;
    if (!span || !span.isConnected) return;

    var st = P.store.getState();
    var f = P.model.find(st.goals, id);
    if (!f) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'title-input';
    input.value = f.node.title;
    span.replaceWith(input);
    input.focus();
    input.select();

    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      if (activeRename === finish) activeRename = null;
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('keydown', onKey);
      var val = input.value.trim() || 'Untitled';
      if (save && f.node && f.node.title !== val) {
        f.node.title = val;
        P.store.commit(); // re-render swaps the input back to a normal row
      } else {
        render();         // no change / cancelled — just restore the row
      }
    }
    activeRename = finish;

    // Defer the blur-save so a blur caused by a re-render detaching this input
    // can't re-enter commit()/render() synchronously inside that render.
    function onBlur() { if (!done) setTimeout(function () { finish(true); }, 0); }
    function onKey(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    }
    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKey);
  }

  // ---- Leaf editor dialog ---------------------------------------------------
  function wireDialog() {
    // Day-of-week toggle buttons
    var dowWrap = document.getElementById('lf-dow');
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (lbl, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dow-btn';
      b.dataset.dow = String(i);
      b.textContent = lbl;
      b.addEventListener('click', function () { b.classList.toggle('on'); });
      dowWrap.appendChild(b);
    });

    // The recurring switch toggles which fieldset is visible
    document.getElementById('lf-recurring').addEventListener('change', syncKindFields);

    document.getElementById('lf-cancel').addEventListener('click', cancelEditor);
    document.getElementById('leaf-form').addEventListener('submit', onDialogSubmit);

    // Handle dismissal directly (Cancel button + Escape). We intentionally do NOT
    // rely on the dialog 'close' event — it doesn't fire reliably across engines.
    dlg.addEventListener('keydown', function (e) { if (e.key === 'Escape') cancelEditor(); });

    // Live duration validation hint
    document.getElementById('lf-duration').addEventListener('input', function () {
      var v = P.util.parseDuration(this.value);
      var hint = document.getElementById('lf-duration-hint');
      hint.textContent = v == null ? '' : P.util.formatDuration(v);
      hint.classList.toggle('bad', this.value.trim() !== '' && v == null);
    });

    // Date fields: open our custom monochrome calendar on click (instead of typing,
    // and instead of Chromium's un-themeable blue native popup).
    if (P.picker) {
      Array.prototype.forEach.call(dlg.querySelectorAll('input[type="date"]'), function (inp) {
        P.picker.attach(inp);
      });
    }

    // Time fields are free text: type anything ("900am", "9", "1830") and on blur
    // it normalises to a friendly "9:00 AM". Unreadable input is left as typed.
    ['lf-time', 'lf-rec-time'].forEach(function (id) {
      var inp = document.getElementById(id);
      if (!inp) return;
      inp.addEventListener('blur', function () {
        var t = P.util.parseClock(inp.value);
        if (t) inp.value = P.util.fmtClock(t.h, t.m);
      });
    });
  }

  function syncKindFields() {
    var recurring = document.getElementById('lf-recurring').checked;
    document.getElementById('lf-task-fields').style.display = recurring ? 'none' : '';
    document.getElementById('lf-budget-fields').style.display = recurring ? '' : 'none';
    document.getElementById('leaf-dialog-title').textContent = recurring ? 'Recurring time budget' : 'Task details';
  }

  // Dismiss the editor. If it was opened for a freshly click-created task that
  // the user never saved, discard that placeholder. Idempotent.
  function cancelEditor() {
    if (P.picker) P.picker.close();
    if (creatingNew && !savedThisOpen && editingId) {
      var st = P.store.getState();
      P.model.removeNode(st.goals, editingId);
      P.store.commit({ provisional: true }); // roll back the placeholder, no undo trace
    }
    creatingNew = false;
    editingId = null;
    if (dlg.open) dlg.close();
  }

  function openLeafEditor(id, opts) {
    var st = P.store.getState();
    var f = P.model.find(st.goals, id);
    if (!f || !P.model.isLeaf(f.node)) return;
    editingId = id;
    creatingNew = !!(opts && opts.isNew);
    savedThisOpen = false;
    var n = f.node, lf = n.leaf;

    document.getElementById('lf-title').value = n.title;
    document.getElementById('lf-notes').value = n.notes || '';
    document.getElementById('lf-duration').value = lf.durationMin > 0 ? P.util.formatDuration(lf.durationMin) : '';
    var durHint = document.getElementById('lf-duration-hint');
    durHint.textContent = '';
    durHint.classList.remove('bad');

    var kind = lf.kind === 'budget' ? 'budget' : 'task';
    document.getElementById('lf-recurring').checked = (kind === 'budget');

    // Task fields. A scheduledStart at exactly midnight means "no time of day"
    // (start of the day) — show a blank Time field so the round-trip stays clean.
    if (kind === 'task' && lf.scheduledStart) {
      var d = new Date(lf.scheduledStart);
      document.getElementById('lf-date').value = P.util.ymd(d);
      var hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
      document.getElementById('lf-time').value = hasTime ? P.util.fmtClock(d.getHours(), d.getMinutes()) : '';
    } else {
      document.getElementById('lf-date').value = '';
      document.getElementById('lf-time').value = '';
    }

    // Budget fields
    var rec = (kind === 'budget' ? lf.recurrence : null) || P.model.defaultBudgetLeaf().recurrence;
    Array.prototype.forEach.call(document.querySelectorAll('#lf-dow .dow-btn'), function (b) {
      var on = rec.daysOfWeek.indexOf(parseInt(b.dataset.dow, 10)) !== -1;
      b.classList.toggle('on', on);
    });
    var rt = P.util.parseClock(rec.startTime || '18:00') || { h: 18, m: 0 };
    document.getElementById('lf-rec-time').value = P.util.fmtClock(rt.h, rt.m);
    document.getElementById('lf-rec-start').value = rec.startDate || '';
    document.getElementById('lf-rec-end').value = rec.endDate || '';

    syncKindFields();
    dlg.showModal();
    document.getElementById('lf-title').focus();
  }

  function onDialogSubmit(e) {
    e.preventDefault();
    var st = P.store.getState();
    var f = P.model.find(st.goals, editingId);
    if (!f) { dlg.close(); return; }
    var n = f.node;

    // Duration is optional. Empty = no duration (0). If something IS typed, it
    // still has to be a duration we understand, so a typo doesn't save as 0.
    var durRaw = document.getElementById('lf-duration').value.trim();
    var durMin = 0;
    if (durRaw !== '') {
      var parsed = P.util.parseDuration(durRaw);
      if (parsed == null || parsed < 0) {
        var hint = document.getElementById('lf-duration-hint');
        hint.textContent = 'Not a valid duration';
        hint.classList.add('bad');
        document.getElementById('lf-duration').focus();
        return;
      }
      durMin = parsed;
    }

    // Warn before a destructive task→budget conversion: a recurring budget has no
    // place to keep per-task tracked time, so converting would discard any logged
    // minutes or a running timer. Make that loss explicit rather than silent.
    if (document.getElementById('lf-recurring').checked && n.leaf && n.leaf.kind === 'task') {
      var loggedMin = n.leaf.actualMin || 0;
      if (n.leaf.timerStart) loggedMin += (Date.now() - new Date(n.leaf.timerStart).getTime()) / 60000;
      if (loggedMin >= 1 && !window.confirm(
        'This task has ' + P.util.formatDuration(Math.round(loggedMin)) +
        ' of tracked time. Converting it to a recurring budget will discard that. Continue?')) {
        return; // leave the editor open so the user can switch Recurring back off
      }
    }

    n.title = document.getElementById('lf-title').value.trim() || 'Untitled';
    n.notes = document.getElementById('lf-notes').value;

    var kind = document.getElementById('lf-recurring').checked ? 'budget' : 'task';

    if (kind === 'budget') {
      var days = [];
      Array.prototype.forEach.call(document.querySelectorAll('#lf-dow .dow-btn.on'), function (b) {
        days.push(parseInt(b.dataset.dow, 10));
      });
      days.sort(function (a, b) { return a - b; });
      var prevOcc = (n.leaf && n.leaf.kind === 'budget' && n.leaf.completedOccurrences) || [];
      n.leaf = {
        kind: 'budget',
        durationMin: durMin,
        recurrence: {
          daysOfWeek: days.length ? days : [1, 2, 3, 4, 5],
          startTime: clock24(document.getElementById('lf-rec-time').value, '18:00'),
          startDate: document.getElementById('lf-rec-start').value || null,
          endDate: document.getElementById('lf-rec-end').value || null
        },
        completedOccurrences: prevOcc
      };
    } else {
      var dateStr = document.getElementById('lf-date').value;
      var t = P.util.parseClock(document.getElementById('lf-time').value);
      var scheduledStart = null;
      if (dateStr) {
        var dd = P.util.parseYmd(dateStr); // midnight (start of the chosen day)
        // No (or unreadable) time → leave it at the start of that day rather than
        // inventing a default time-of-day.
        if (t) dd.setHours(t.h, t.m, 0, 0);
        scheduledStart = dd.toISOString();
      }
      // Preserve tracked time, any running timer, and the done state. Done is no
      // longer edited from this dialog (its checkbox lives on the row), so carry
      // the existing value through instead of silently clearing it. Rebuilding the
      // leaf must NOT discard work the user has logged.
      var prev = (n.leaf && n.leaf.kind === 'task') ? n.leaf : null;
      var done = prev ? !!prev.done : false;
      var actualMin = prev ? (prev.actualMin || 0) : 0;
      var timerStart = prev ? (prev.timerStart || null) : null;
      n.leaf = {
        kind: 'task',
        durationMin: durMin,
        scheduledStart: scheduledStart,
        done: done,
        completedAt: done ? ((prev && prev.completedAt) || new Date().toISOString()) : null,
        actualMin: actualMin,
        timerStart: timerStart
      };
    }

    savedThisOpen = true;
    creatingNew = false;
    if (P.picker) P.picker.close();
    dlg.close();
    editingId = null;
    P.store.commit();
  }

  // Reveal a node from elsewhere (e.g. global search): expand its ancestors so
  // it's visible, select it, scroll it into view, and briefly flash it.
  function reveal(id) {
    var st = P.store.getState();
    if (!P.model.find(st.goals, id)) return;
    P.model.path(st.goals, id).forEach(function (n) {
      if (n.children && n.children.length) n.collapsed = false;
    });
    selectedIds = [id];
    P.store.commit({ noHistory: true }); // re-renders the (now expanded) tree
    var node = treeEl && treeEl.querySelector('.node[data-id="' + id + '"]');
    if (node) {
      node.scrollIntoView({ block: 'center' });
      var row = node.querySelector('.node-row');
      if (row) {
        row.classList.add('flash');
        setTimeout(function () { row.classList.remove('flash'); }, 1100);
      }
    }
  }

  // ---- Copy / paste (Ctrl+C / Ctrl+V) ---------------------------------------
  // Copy the current selection (one or more goals/subtrees) onto an internal
  // clipboard. If both an ancestor and one of its descendants are selected, the
  // descendant is dropped — it's already included inside the ancestor's copy, so
  // keeping it would paste a duplicate. Returns true if anything was copied.
  function copySelection() {
    var st = P.store.getState();
    var ids = selectedIds.filter(function (id) { return !!P.model.find(st.goals, id); });
    var roots = ids.filter(function (id) {
      return !ids.some(function (other) { return other !== id && isAncestorOf(st.goals, other, id); });
    });
    if (!roots.length) return false;
    clipboard = roots.map(function (id) {
      return JSON.parse(JSON.stringify(P.model.find(st.goals, id).node));
    });
    if (P.app && P.app.toast) P.app.toast('Copied ' + clipboard.length + ' goal' + (clipboard.length === 1 ? '' : 's'));
    return true;
  }

  // Paste the clipboard under the primary (last-selected) node: as children when
  // it's a parent goal, or as siblings right after it when it's a leaf task (so a
  // leaf's own task data is never clobbered). With nothing selected, paste as new
  // top-level goals. Every pasted node gets brand-new ids. Returns true on paste.
  function pasteClipboard() {
    if (!clipboard.length) return false;
    var st = P.store.getState();
    var fresh = clipboard.map(function (orig) { return freshIds(JSON.parse(JSON.stringify(orig))); });
    var pid = primaryId();
    var target = pid ? P.model.find(st.goals, pid) : null;

    if (target && !P.model.isLeaf(target.node)) {
      target.node.collapsed = false;
      fresh.forEach(function (nn) { P.model.addChild(st.goals, pid, nn); });
    } else if (target) {
      Array.prototype.splice.apply(target.list, [target.index + 1, 0].concat(fresh));
    } else {
      fresh.forEach(function (nn) { st.goals.push(nn); });
    }

    selectedIds = fresh.map(function (nn) { return nn.id; });
    P.store.commit();
    if (P.app && P.app.toast) P.app.toast('Pasted ' + fresh.length + ' goal' + (fresh.length === 1 ? '' : 's'));
    return true;
  }

  // Is `ancestorId` a strict ancestor of `id`? (Both ids exist in the forest.)
  function isAncestorOf(forest, ancestorId, id) {
    if (ancestorId === id) return false;
    return P.model.path(forest, id).some(function (n) { return n.id === ancestorId; });
  }

  // Recursively stamp a cloned subtree with new ids so a paste never collides with
  // the originals (or with an earlier paste of the same clipboard). A paste is a
  // FRESH instance: it keeps the plan (titles, durations, schedule, recurrence) but
  // clears per-run progress, so a copy never inherits the original's logged time,
  // done state, or — worst — a live stopwatch (which would otherwise render a
  // phantom second running timer counting from the same moment).
  function freshIds(node) {
    node.id = P.util.uid('n');
    var lf = node.leaf;
    if (lf) {
      if (lf.kind === 'budget') {
        lf.completedOccurrences = [];
      } else {
        lf.timerStart = null;
        lf.actualMin = 0;
        lf.done = false;
        lf.completedAt = null;
      }
    }
    if (node.children && node.children.length) node.children.forEach(freshIds);
    return node;
  }

  // ---- util -----------------------------------------------------------------
  // Free-text time field → "HH:MM" (24h) for storage; falls back when unreadable.
  function clock24(str, fallback) {
    var t = P.util.parseClock(str);
    return t ? P.util.pad(t.h) + ':' + P.util.pad(t.m) : fallback;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  P.goals = {
    mount: mount, render: render, openLeaf: openLeafEditor, reveal: reveal,
    copySelection: copySelection, pasteClipboard: pasteClipboard
  };
})();
