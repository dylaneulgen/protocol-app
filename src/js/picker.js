// Custom monochrome date picker. Replaces Chromium's native calendar popup (which
// is grey with a hard-coded blue accent and can't be themed via CSS) with our own
// black-and-white UI. It drives a real <input type="date"> by its value, so every
// existing read/write path keeps working — only the popup is ours. (Time fields are
// plain text with free-text parsing — see util.parseClock — and have no popup.)
//   P.picker.attach(input) — wire a date input to open our popup
//   P.picker.close()       — dismiss the popup (e.g. when the dialog closes)
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var U = null;

  var pop = null;      // the single shared popup element
  var current = null;  // the input the popup is bound to
  var viewYear = 0, viewMonth = 0; // calendar month being shown

  function ensurePop() {
    if (pop) return;
    U = P.util;
    pop = document.createElement('div');
    pop.hidden = true;
    // Keep the field focused and avoid text-selection when interacting with the
    // popup (mousedown would otherwise blur the input / start a selection).
    pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
    pop.addEventListener('click', onPopClick);
    document.body.appendChild(pop);

    document.addEventListener('mousedown', function (e) {
      if (pop.hidden) return;
      if (e.target === current || pop.contains(e.target)) return;
      close();
    });
    window.addEventListener('resize', function () { if (!pop.hidden) close(); });
  }

  function attach(input) {
    if (!input || input.dataset.mpWired) return;
    input.dataset.mpWired = '1';
    input.addEventListener('click', function () { open(input); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(input); }
      // Escape closes only the popup — stop it bubbling so the dialog's own Escape
      // handler (which would close the whole editor) doesn't also fire.
      else if (e.key === 'Escape' && pop && !pop.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
    });
  }

  function open(input) {
    ensurePop();
    if (current === input && !pop.hidden) { close(); return; } // toggle off on re-click
    current = input;
    // A modal <dialog> lives in the top layer; a popup in <body> would render
    // behind its backdrop. Re-parent into the input's dialog so we overlay it.
    var host = input.closest('dialog') || document.body;
    if (pop.parentNode !== host) host.appendChild(pop);
    pop.className = 'mp-pop mp-date';
    pop.hidden = false;
    var v = input.value ? U.parseYmd(input.value) : new Date();
    viewYear = v.getFullYear(); viewMonth = v.getMonth();
    render();
    position(input);
  }

  function close() {
    if (pop && !pop.hidden) { pop.hidden = true; pop.innerHTML = ''; }
    current = null;
  }

  function position(input) {
    var r = input.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = Math.round(r.left) + 'px';
    pop.style.top = Math.round(r.bottom + 4) + 'px';
    var pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = Math.max(8, window.innerWidth - 8 - pr.width) + 'px';
    if (pr.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, Math.round(r.top - pr.height - 4)) + 'px';
  }

  function setValue(v) {
    if (!current) return;
    current.value = v;
    current.dispatchEvent(new Event('input', { bubbles: true }));
    current.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function render() {
    var sel = current.value ? U.parseYmd(current.value) : null;
    var today = new Date();
    var first = new Date(viewYear, viewMonth, 1);
    var gridStart = new Date(viewYear, viewMonth, 1 - first.getDay());

    var html = '<div class="mp-head">' +
      '<button type="button" class="mp-nav" data-mp="prev" aria-label="Previous month">‹</button>' +
      '<span class="mp-title">' + U.MONTHS_LONG[viewMonth] + ' ' + viewYear + '</span>' +
      '<button type="button" class="mp-nav" data-mp="next" aria-label="Next month">›</button></div>';
    html += '<div class="mp-grid mp-dow">';
    ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(function (d) { html += '<span class="mp-w">' + d + '</span>'; });
    html += '</div><div class="mp-grid mp-days">';
    for (var i = 0; i < 42; i++) {
      var d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      var cls = 'mp-day';
      if (d.getMonth() !== viewMonth) cls += ' mp-off';
      if (U.sameDay(d, today)) cls += ' mp-today';
      if (sel && U.sameDay(d, sel)) cls += ' mp-sel';
      html += '<button type="button" class="' + cls + '" data-mp-day="' + U.ymd(d) + '">' + d.getDate() + '</button>';
    }
    html += '</div>';
    html += '<div class="mp-foot">' +
      '<button type="button" class="mp-link" data-mp="clear">Clear</button>' +
      '<button type="button" class="mp-link" data-mp="today">Today</button></div>';
    pop.innerHTML = html;
  }

  function onPopClick(e) {
    var day = e.target.closest('[data-mp-day]');
    if (day) { setValue(day.getAttribute('data-mp-day')); close(); return; }
    var nav = e.target.closest('[data-mp]');
    if (!nav) return;
    var a = nav.getAttribute('data-mp');
    if (a === 'prev') { if (--viewMonth < 0) { viewMonth = 11; viewYear--; } render(); }
    else if (a === 'next') { if (++viewMonth > 11) { viewMonth = 0; viewYear++; } render(); }
    else if (a === 'today') { setValue(U.ymd(new Date())); close(); }
    else if (a === 'clear') { setValue(''); close(); }
  }

  P.picker = { attach: attach, close: close };
})();
