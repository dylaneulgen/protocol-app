// Search the page you're on — items (title, notes, tag, if/else text) on the
// Calendar page, notes (title + body) on the Notes page. Opened from the
// "Search" button in the top bar or Ctrl+F / Ctrl+K. It opens NON-modally, so
// the page stays put behind it. Picking an item jumps to its day (or opens its
// editor if it has none); picking a note reveals it. Read-only — it never
// mutates data.
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var dlg = null, input = null, resultsEl = null;
  var results = [];
  var active = 0;

  // Which page the search currently operates over ('calendar' | 'notes').
  function area() { return P.store.getState().ui.area; }

  function mount() {
    dlg = document.getElementById('search-dialog');
    input = document.getElementById('search-input');
    resultsEl = document.getElementById('search-results');
    if (!dlg || !input || !resultsEl) return;

    Array.prototype.forEach.call(document.querySelectorAll('[data-search-btn]'), function (b) {
      b.addEventListener('click', open);
    });
    var closeBtn = document.getElementById('search-close');
    if (closeBtn) closeBtn.addEventListener('click', close);

    input.addEventListener('input', refresh);
    input.addEventListener('keydown', onKey);
    resultsEl.addEventListener('click', onResultClick);

    // Non-modal has no backdrop, so close on a click anywhere outside the panel
    // (but not on a search button — clicking it while open just refocuses the input).
    document.addEventListener('mousedown', function (e) {
      if (!dlg.open) return;
      if (dlg.contains(e.target) || e.target.closest('[data-search-btn]')) return;
      close();
    });
  }

  function open() {
    if (!dlg) return;
    if (dlg.open) { input.focus(); input.select(); return; } // already open — keep the query
    input.placeholder = area() === 'notes' ? 'Search notes…' : 'Search tasks…';
    dlg.show(); // non-modal: the current page stays visible/interactive behind it
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

  // Only search the content of the page you're on — items OR notes, never both.
  function compute(q) {
    var st = P.store.getState();
    var out = [];
    if (area() === 'calendar') {
      // Walk tasks and their subtasks; each result remembers its top-level
      // ancestor so choosing it can jump to the right day.
      function visit(it, top) {
        var title = P.model.titleOf(it);
        var hay = [title, it.notes].filter(Boolean).join('\n');
        if (hay.toLowerCase().indexOf(q) !== -1) {
          var inTitle = title.toLowerCase().indexOf(q) !== -1;
          var where = top.kind === 'habit' ? 'Habit' : (top.date ? top.date : 'Backlog');
          out.push({
            type: 'item', id: it.id, item: it, top: top, title: title,
            sub: (it !== top ? 'Subtask · ' : '') + where,
            snippet: inTitle ? '' : snipHtml(hay, q)
          });
        }
        (it.children || []).forEach(function (ch) { visit(ch, top); });
      }
      st.items.forEach(function (it) { visit(it, it); });
    } else if (area() === 'notes') {
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
    }
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
      resultsEl.innerHTML = '<div class="sr-empty">Type to search your ' +
        (area() === 'notes' ? 'notes' : 'tasks') + '.</div>';
      return;
    }
    if (!results.length) {
      resultsEl.innerHTML = '<div class="sr-empty">No matches for “' + esc(q) + '”.</div>';
      return;
    }
    resultsEl.innerHTML = results.map(function (r, i) {
      return '<div class="sr-item' + (i === active ? ' active' : '') + '" data-i="' + i + '">' +
        '<span class="sr-kind">' + (r.type === 'note' ? 'Note' : 'Task') + '</span>' +
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
    if (r.type === 'note') {
      if (P.notes && P.notes.open) P.notes.open(r.id);
      return;
    }
    var it = r.item, top = r.top || it;
    if (top.kind === 'habit' || !top.date) {
      // No single day to jump to — open the editor instead.
      P.editor.openItem(it.id);
    } else {
      P.calendar.openDay(top.date); // re-renders synchronously
      P.calendar.flashItem(it.id);
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
