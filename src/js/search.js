// Global search across goals (title + notes) and notes (title + body). Opens as
// a modal palette via the sidebar "Search" button or Ctrl+F / Ctrl+K. Selecting a
// result navigates to it: goals expand + scroll into view, notes open in the
// Notes editor. Read-only — it never mutates data.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var dlg = null, input = null, resultsEl = null;
  var results = [];
  var active = 0;

  function mount() {
    dlg = document.getElementById('search-dialog');
    input = document.getElementById('search-input');
    resultsEl = document.getElementById('search-results');
    if (!dlg || !input || !resultsEl) return;

    var btn = document.getElementById('btn-search');
    if (btn) btn.addEventListener('click', open);
    var closeBtn = document.getElementById('search-close');
    if (closeBtn) closeBtn.addEventListener('click', close);

    input.addEventListener('input', refresh);
    input.addEventListener('keydown', onKey);
    resultsEl.addEventListener('click', onResultClick);
    // Click on the backdrop (outside the dialog content) closes it.
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
  }

  function open() {
    if (!dlg) return;
    if (dlg.open) { input.focus(); input.select(); return; } // already open — don't wipe the query
    dlg.showModal();
    input.value = '';
    results = []; active = 0;
    render();
    input.focus();
  }
  function close() { if (dlg && dlg.open) dlg.close(); }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function move(d) {
    if (!results.length) return;
    active = (active + d + results.length) % results.length;
    render();
    var node = resultsEl.querySelector('.sr-item.active');
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  function refresh() {
    var q = input.value.trim().toLowerCase();
    results = q ? compute(q) : [];
    active = 0;
    render();
  }

  function compute(q) {
    var st = P.store.getState();
    var out = [];
    P.model.walk(st.goals, function (n) {
      var inTitle = n.title && n.title.toLowerCase().indexOf(q) !== -1;
      var inNotes = n.notes && n.notes.toLowerCase().indexOf(q) !== -1;
      if (inTitle || inNotes) {
        var trail = P.model.path(st.goals, n.id);
        var crumb = trail.slice(0, -1).map(function (x) { return x.title; }).join(' › ');
        out.push({
          type: 'goal', id: n.id, title: n.title || 'Untitled',
          sub: crumb || 'Goal',
          snippet: (inNotes && !inTitle) ? snipHtml(n.notes, q) : ''
        });
      }
    });
    st.notesItems.forEach(function (note) {
      var inTitle = note.title && note.title.toLowerCase().indexOf(q) !== -1;
      var inBody = note.body && note.body.toLowerCase().indexOf(q) !== -1;
      if (inTitle || inBody) {
        out.push({
          type: 'note', id: note.id, title: note.title || 'Untitled',
          sub: 'Note', snippet: inBody ? snipHtml(note.body, q) : ''
        });
      }
    });
    return out.slice(0, 50);
  }

  // Escaped, whitespace-collapsed ~56-char window of `text` centred on the first
  // match of `q`, with that match wrapped in <mark>. Each segment is cleaned
  // independently (no re-search after collapsing), so the centred occurrence is
  // the one highlighted and the mark can't be lost to whitespace normalisation.
  function snipHtml(text, q) {
    var i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return '';
    var start = Math.max(0, i - 24);
    var end = Math.min(text.length, i + q.length + 32);
    function clean(s) { return esc(s.replace(/\s+/g, ' ')); }
    return (start > 0 ? '…' : '') +
      clean(text.slice(start, i)) +
      '<mark>' + clean(text.slice(i, i + q.length)) + '</mark>' +
      clean(text.slice(i + q.length, end)) +
      (end < text.length ? '…' : '');
  }

  function render() {
    if (!resultsEl) return;
    var q = input.value.trim();
    if (!q) {
      resultsEl.innerHTML = '<div class="sr-empty">Type to search across your goals and notes.</div>';
      return;
    }
    if (!results.length) {
      resultsEl.innerHTML = '<div class="sr-empty">No matches for “' + esc(q) + '”.</div>';
      return;
    }
    resultsEl.innerHTML = results.map(function (r, i) {
      return '<div class="sr-item' + (i === active ? ' active' : '') + '" data-i="' + i + '">' +
        '<span class="sr-kind">' + (r.type === 'note' ? 'Note' : 'Goal') + '</span>' +
        '<div class="sr-main">' +
        '<div class="sr-title">' + hl(r.title, q) + '</div>' +
        (r.snippet ? '<div class="sr-snip">' + r.snippet + '</div>'
          : (r.sub ? '<div class="sr-snip">' + esc(r.sub) + '</div>' : '')) +
        '</div></div>';
    }).join('');
  }

  function onResultClick(e) {
    var item = e.target.closest('.sr-item');
    if (!item) return;
    choose(parseInt(item.dataset.i, 10));
  }

  function choose(i) {
    var r = results[i];
    if (!r) return;
    close();
    if (r.type === 'goal') {
      if (P.app && P.app.setArea) P.app.setArea('goals');
      if (P.goals && P.goals.reveal) P.goals.reveal(r.id);
    } else {
      if (P.app && P.app.setArea) P.app.setArea('notes');
      if (P.notes && P.notes.open) P.notes.open(r.id);
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // Escape the text, then wrap the first case-insensitive match of `q` in <mark>.
  function hl(text, q) {
    text = String(text);
    if (!q) return esc(text);
    var i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return esc(text);
    return esc(text.slice(0, i)) +
      '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' +
      esc(text.slice(i + q.length));
  }

  P.search = { mount: mount, open: open };
})();
