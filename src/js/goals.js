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
  var selectedId = null;     // which node is selected (reveals its details/actions)
  var selectedTemplateId = null; // template chosen in the New-goal dialog (null = Blank)

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
    var html = '<div class="node" data-id="' + n.id + '">';
    html += '<div class="node-row ' + (leaf ? 'is-leaf' : 'is-parent') +
      (depth === 0 ? ' goal-header' : '') + (n.id === selectedId ? ' selected' : '') +
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

    // live timer — visible whenever a task's timer is running (any selection state)
    if (leaf && n.leaf.kind === 'task' && n.leaf.timerStart) {
      html += '<span class="timer-live" data-id="' + n.id + '">' +
        P.util.fmtElapsed(Date.now() - new Date(n.leaf.timerStart).getTime()) + '</span>';
    }

    // meta + actions — hidden until the row is selected (see CSS)
    html += '<span class="meta">' + metaHtml(n, leaf) + '</span>';
    html += '<span class="row-actions">';
    if (leaf && n.leaf.kind === 'task') {
      html += '<button data-action="timer">' + (n.leaf.timerStart ? 'Stop' : 'Start') + '</button>';
    }
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
        if (lf.estimated) m += ' estimated';
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
    if (lf.estimated) out.push('<span class="chip est">est</span>');
    if (lf.scheduledStart) {
      var d = new Date(lf.scheduledStart);
      out.push('<span class="chip when">' + P.util.fmtDateShort(d) + ' ' + P.util.fmtTimeShort(d) + '</span>');
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
        selectedId = child.id;
        P.store.commit();
        startRename(child.id); // immediately let the user name it
      } else if (action === 'delete') {
        deleteNode(id);
      } else if (action === 'details') {
        openLeafEditor(id);
      } else if (action === 'save-template') {
        saveAsTemplate(id);
      } else if (action === 'timer') {
        P.actions.toggleTimer(id);
      }
      return; // 'done' handled in onChange
    }
    // Clicking a row (not an action) selects it — that's when its details appear.
    var row = e.target.closest('.node-row');
    if (row) {
      var rid = nodeIdOf(row);
      if (rid) selectNode(rid);
    }
  }

  // Toggle selection: clicking the selected row again deselects it (hides details).
  function selectNode(id) {
    Array.prototype.forEach.call(treeEl.querySelectorAll('.node-row.selected'), function (r) {
      r.classList.remove('selected');
    });
    if (id === selectedId) { selectedId = null; return; }
    selectedId = id;
    var node = treeEl.querySelector('.node[data-id="' + id + '"]');
    if (node) {
      var row = node.querySelector('.node-row');
      if (row) row.classList.add('selected');
    }
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
    selectedId = g.id;
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

  // Find a node's title in the DOM and start renaming it.
  function startRename(id) {
    var span = treeEl.querySelector('.node[data-id="' + id + '"] .title');
    if (span) editTitleInline(span, id);
  }

  // Inline rename using a real text input — shows a caret and is reliable
  // across engines (the old contentEditable approach hid the cursor).
  function editTitleInline(span, id) {
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
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('keydown', onKey);
      if (save) {
        f.node.title = input.value.trim() || 'Untitled';
        P.store.commit(); // re-render swaps the input back to a normal row
      } else {
        render();
      }
    }
    function onBlur() { finish(true); }
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
    document.getElementById('lf-duration-hint').textContent = '';

    var kind = lf.kind === 'budget' ? 'budget' : 'task';
    document.getElementById('lf-recurring').checked = (kind === 'budget');

    // Task fields
    if (kind === 'task' && lf.scheduledStart) {
      var d = new Date(lf.scheduledStart);
      document.getElementById('lf-date').value = P.util.ymd(d);
      document.getElementById('lf-time').value = P.util.pad(d.getHours()) + ':' + P.util.pad(d.getMinutes());
    } else {
      document.getElementById('lf-date').value = '';
      document.getElementById('lf-time').value = '';
    }
    document.getElementById('lf-done').checked = kind === 'task' ? !!lf.done : false;
    document.getElementById('lf-estimated').checked = kind === 'task' ? !!lf.estimated : false;

    // Budget fields
    var rec = (kind === 'budget' ? lf.recurrence : null) || P.model.defaultBudgetLeaf().recurrence;
    Array.prototype.forEach.call(document.querySelectorAll('#lf-dow .dow-btn'), function (b) {
      var on = rec.daysOfWeek.indexOf(parseInt(b.dataset.dow, 10)) !== -1;
      b.classList.toggle('on', on);
    });
    document.getElementById('lf-rec-time').value = rec.startTime || '18:00';
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

    var durMin = P.util.parseDuration(document.getElementById('lf-duration').value);
    if (durMin == null || durMin <= 0) {
      var hint = document.getElementById('lf-duration-hint');
      hint.textContent = 'Required';
      hint.classList.add('bad');
      document.getElementById('lf-duration').focus();
      return;
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
    var estimated = document.getElementById('lf-estimated').checked;

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
        estimated: true,
        recurrence: {
          daysOfWeek: days.length ? days : [1, 2, 3, 4, 5],
          startTime: document.getElementById('lf-rec-time').value || '18:00',
          startDate: document.getElementById('lf-rec-start').value || null,
          endDate: document.getElementById('lf-rec-end').value || null
        },
        completedOccurrences: prevOcc
      };
    } else {
      var dateStr = document.getElementById('lf-date').value;
      var timeStr = document.getElementById('lf-time').value;
      var scheduledStart = null;
      if (dateStr) {
        var dd = P.util.parseYmd(dateStr);
        var tp = (timeStr || '09:00').split(':');
        dd.setHours(parseInt(tp[0], 10) || 0, parseInt(tp[1], 10) || 0, 0, 0);
        scheduledStart = dd.toISOString();
      }
      var done = document.getElementById('lf-done').checked;
      // Preserve tracked time and any running timer. Rebuilding the leaf from the
      // form must NOT silently discard work the user has logged — editing details
      // is a routine action, and losing logged minutes / a live timer is data loss.
      var prev = (n.leaf && n.leaf.kind === 'task') ? n.leaf : null;
      var actualMin = prev ? (prev.actualMin || 0) : 0;
      var timerStart = prev ? (prev.timerStart || null) : null;
      // Ticking "Done" here while a timer runs banks the elapsed time and stops
      // the timer, mirroring actions.toggleDone.
      if (done && timerStart) {
        actualMin += (Date.now() - new Date(timerStart).getTime()) / 60000;
        timerStart = null;
      }
      n.leaf = {
        kind: 'task',
        durationMin: durMin,
        estimated: estimated,
        scheduledStart: scheduledStart,
        done: done,
        completedAt: done ? ((prev && prev.completedAt) || new Date().toISOString()) : null,
        actualMin: actualMin,
        timerStart: timerStart
      };
    }

    savedThisOpen = true;
    creatingNew = false;
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
    selectedId = id;
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

  // ---- util -----------------------------------------------------------------
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  P.goals = { mount: mount, render: render, openLeaf: openLeafEditor, reveal: reveal };
})();
