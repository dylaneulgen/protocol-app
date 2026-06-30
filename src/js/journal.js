// Notes: create multiple notes and edit them in a two-pane view (note list on the
// left, title + body editor on the right). A plain flat list — no folders.
// Exposed as P.notes.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var listEl = null, titleEl = null, bodyEl = null;

  function mount() {
    listEl = document.getElementById('notes-list');
    titleEl = document.getElementById('note-title');
    bodyEl = document.getElementById('note-body');

    document.getElementById('btn-new-note').addEventListener('click', newNote);

    titleEl.addEventListener('input', onTitleInput);
    bodyEl.addEventListener('input', onBodyInput);

    listEl.addEventListener('click', onListClick);
  }

  function s() { return P.store.getState(); }
  function noteById(id) { return s().notesItems.filter(function (n) { return n.id === id; })[0] || null; }
  function selectedNote() { return noteById(s().ui.selectedNoteId); }

  // ---- render ---------------------------------------------------------------
  function render() {
    if (!listEl) return;
    renderList();
    loadEditor();
  }

  function renderList() {
    var st = s();
    listEl.innerHTML = '';
    st.notesItems.forEach(function (n) { listEl.appendChild(noteItemEl(n)); });
  }

  function noteItemEl(n) {
    var it = el('div', 'nl-note' + (n.id === s().ui.selectedNoteId ? ' active' : ''));
    it.dataset.noteId = n.id;
    it.innerHTML = '<span class="nl-note-title">' + esc(n.title || 'Untitled') + '</span>' +
      '<span class="nl-actions"><button data-action="del-note">×</button></span>';
    return it;
  }

  // ---- editor ---------------------------------------------------------------
  function loadEditor() {
    var n = selectedNote();
    titleEl.disabled = !n;
    bodyEl.disabled = !n;
    if (!n) {
      if (document.activeElement !== titleEl) titleEl.value = '';
      if (document.activeElement !== bodyEl) bodyEl.value = '';
      return;
    }
    if (document.activeElement !== titleEl) titleEl.value = n.title || '';
    if (document.activeElement !== bodyEl) bodyEl.value = n.body || '';
  }

  function onTitleInput() {
    var n = selectedNote(); if (!n) return;
    n.title = titleEl.value;
    n.updatedAt = new Date().toISOString();
    P.store.commit({ silent: true });
    var lbl = listEl.querySelector('.nl-note[data-note-id="' + n.id + '"] .nl-note-title');
    if (lbl) lbl.textContent = n.title || 'Untitled';
  }

  function onBodyInput() {
    var n = selectedNote(); if (!n) return;
    n.body = bodyEl.value;
    n.updatedAt = new Date().toISOString();
    P.store.commit({ silent: true });
  }

  // ---- actions --------------------------------------------------------------
  function newNote() {
    var st = s();
    var note = {
      id: P.util.uid('note'),
      title: 'New note', body: '', updatedAt: new Date().toISOString()
    };
    st.notesItems.push(note);
    st.ui.selectedNoteId = note.id;
    P.store.commit();
    titleEl.focus();
    titleEl.select();
  }

  function selectNote(id) {
    s().ui.selectedNoteId = id;
    P.store.commit({ noHistory: true }); // selecting a note is a view change
  }

  // Open a specific note by id (used by global search): select it and scroll its
  // list entry into view. The caller switches to the Notes area.
  function open(id) {
    s().ui.selectedNoteId = id;
    P.store.commit({ noHistory: true });
    var item = listEl && listEl.querySelector('.nl-note[data-note-id="' + id + '"]');
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  function delNote(id) {
    var st = s();
    var i = st.notesItems.findIndex(function (n) { return n.id === id; });
    if (i === -1) return;
    if (!window.confirm('Delete "' + (st.notesItems[i].title || 'Untitled') + '"?')) return;
    st.notesItems.splice(i, 1);
    if (st.ui.selectedNoteId === id) st.ui.selectedNoteId = null;
    P.store.commit();
  }

  // ---- events ---------------------------------------------------------------
  function onListClick(e) {
    var actEl = e.target.closest('[data-action]');
    if (actEl && actEl.dataset.action === 'del-note') {
      delNote(actEl.closest('.nl-note').dataset.noteId);
      return;
    }
    var noteEl = e.target.closest('.nl-note');
    if (noteEl) selectNote(noteEl.dataset.noteId);
  }

  // ---- util -----------------------------------------------------------------
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function esc(str) {
    return String(str).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  P.notes = { mount: mount, render: render, open: open };
})();
