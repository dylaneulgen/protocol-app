// Custom monochrome date & time pickers. They replace Chromium's native popups
// (which are grey with a hard-coded blue accent and can't be themed via CSS) with
// our own black-and-white UI. They drive a real <input type="date"|"time"> by its
// value, so every existing read/write path keeps working — only the popup is ours.
//   P.picker.attach(input) — wire an input to open our popup instead of the native
//   P.picker.close()       — dismiss the popup (e.g. when the dialog closes)
(function () {
  'use strict';
  var P = (window.Planner = window.Planner || {});
  var U = null;

  var pop = null;      // the single shared popup element
  var current = null;  // the input the popup is bound to
  var kind = null;     // 'date' | 'time'
  var viewYear = 0, viewMonth = 0; // calendar month being shown

  function pad(n) { return (n < 10 ? '0' : '') + n; }

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
    var k = input.type === 'time' ? 'time' : 'date';
    input.addEventListener('click', function () { open(input, k); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(input, k); }
      // Escape closes only the popup — stop it bubbling so the dialog's own Escape
      // handler (which would close the whole editor) doesn't also fire.
      else if (e.key === 'Escape' && pop && !pop.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
    });
  }

  function open(input, k) {
    ensurePop();
    if (current === input && !pop.hidden) { close(); return; } // toggle off on re-click
    current = input; kind = k;
    // A modal <dialog> lives in the top layer; a popup in <body> would render
    // behind its backdrop. Re-parent into the input's dialog so we overlay it.
    var host = input.closest('dialog') || document.body;
    if (pop.parentNode !== host) host.appendChild(pop);
    pop.className = 'mp-pop mp-' + k;
    pop.hidden = false;
    if (k === 'date') openDate(input); else openTime(input);
    position(input);
  }

  function close() {
    if (pop && !pop.hidden) { pop.hidden = true; pop.innerHTML = ''; }
    current = null; kind = null;
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

  // ---- date ----------------------------------------------------------------
  function openDate(input) {
    var v = input.value ? U.parseYmd(input.value) : new Date();
    viewYear = v.getFullYear(); viewMonth = v.getMonth();
    renderDate(input);
  }

  function renderDate(input) {
    var sel = input.value ? U.parseYmd(input.value) : null;
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

  // ---- time ----------------------------------------------------------------
  function parseTime(v) {
    if (!v) return { h: 9, m: 0 };
    var p = String(v).split(':');
    return { h: parseInt(p[0], 10) || 0, m: parseInt(p[1], 10) || 0 };
  }

  function renderTime(selH, selM) {
    var html = '<div class="mp-time"><div class="mp-col" data-mp-col="h">';
    for (var h = 0; h < 24; h++) {
      html += '<button type="button" class="mp-cell' + (h === selH ? ' mp-sel' : '') + '" data-mp-h="' + h + '">' + pad(h) + '</button>';
    }
    html += '</div><div class="mp-col" data-mp-col="m">';
    for (var m = 0; m < 60; m += 5) {
      html += '<button type="button" class="mp-cell' + (m === selM ? ' mp-sel' : '') + '" data-mp-m="' + m + '">' + pad(m) + '</button>';
    }
    html += '</div></div>';
    html += '<div class="mp-foot">' +
      '<button type="button" class="mp-link" data-mp="clear">Clear</button>' +
      '<button type="button" class="mp-link" data-mp="now">Now</button></div>';
    pop.innerHTML = html;
    // bring the selected hour/minute into view
    Array.prototype.forEach.call(pop.querySelectorAll('.mp-cell.mp-sel'), function (el) {
      el.scrollIntoView({ block: 'center' });
    });
  }

  function openTime(input) {
    var t = parseTime(input.value);
    renderTime(t.h, t.m);
  }

  // ---- shared click handling -----------------------------------------------
  function onPopClick(e) {
    var nav = e.target.closest('[data-mp]');
    if (kind === 'date') {
      var day = e.target.closest('[data-mp-day]');
      if (day) { setValue(day.getAttribute('data-mp-day')); close(); return; }
      if (!nav) return;
      var a = nav.getAttribute('data-mp');
      if (a === 'prev') { if (--viewMonth < 0) { viewMonth = 11; viewYear--; } renderDate(current); }
      else if (a === 'next') { if (++viewMonth > 11) { viewMonth = 0; viewYear++; } renderDate(current); }
      else if (a === 'today') { setValue(U.ymd(new Date())); close(); }
      else if (a === 'clear') { setValue(''); close(); }
      return;
    }
    // time
    var hEl = e.target.closest('[data-mp-h]');
    var mEl = e.target.closest('[data-mp-m]');
    if (hEl || mEl) {
      var t = parseTime(current.value);
      var h = hEl ? parseInt(hEl.getAttribute('data-mp-h'), 10) : t.h;
      var m = mEl ? parseInt(mEl.getAttribute('data-mp-m'), 10) : t.m;
      setValue(pad(h) + ':' + pad(m));
      renderTime(h, m); // refresh the highlight, keep the popup open
      return;
    }
    if (!nav) return;
    if (nav.getAttribute('data-mp') === 'now') { var n = new Date(); setValue(pad(n.getHours()) + ':' + pad(n.getMinutes())); close(); }
    else if (nav.getAttribute('data-mp') === 'clear') { setValue(''); close(); }
  }

  P.picker = { attach: attach, close: close };
})();
