// Pure, dependency-free helpers: ids, duration parsing/formatting, and local-time
// date math. UMD-wrapped so the same file works as a classic <script> in the
// Electron renderer (attaches to window.Planner.util) and as a CommonJS module in
// the Node test runner (module.exports).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Planner = root.Planner || {};
    root.Planner.util = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---- IDs ------------------------------------------------------------------
  function uid(prefix) {
    prefix = prefix || 'id';
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---- Duration -------------------------------------------------------------
  // Accepts "1h30m", "90m", "2h", "1:30", "90" (bare = minutes). Returns whole
  // minutes, or null if it can't be understood.
  function parseDuration(input) {
    if (input == null) return null;
    if (typeof input === 'number') return Number.isFinite(input) ? Math.max(0, Math.round(input)) : null;
    var s = String(input).trim().toLowerCase();
    if (s === '') return null;

    var colon = s.match(/^(\d+):([0-5]?\d)$/);
    if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);

    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s)); // bare number = minutes

    var total = 0;
    var matched = false;
    var hm = s.match(/(\d+(?:\.\d+)?)\s*h/);
    if (hm) { total += Math.round(parseFloat(hm[1]) * 60); matched = true; }
    var mm = s.match(/(\d+)\s*m/);
    if (mm) { total += parseInt(mm[1], 10); matched = true; }
    return matched ? total : null;
  }

  function formatDuration(min) {
    min = Math.max(0, Math.round(min || 0));
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (h && m) return h + 'h ' + m + 'm';
    if (h) return h + 'h';
    return m + 'm';
  }

  // ---- Dates (all local time) ----------------------------------------------
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function ymd(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function parseYmd(s) {
    var p = String(s).split('-');
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 0, 0, 0, 0);
  }
  function atTime(date, hhmm) {
    var p = String(hhmm || '00:00').split(':');
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate(),
      parseInt(p[0], 10) || 0, parseInt(p[1], 10) || 0, 0, 0);
    return d;
  }
  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 0, 0, 0, 0);
  }
  function addMonths(date, n) {
    return new Date(date.getFullYear(), date.getMonth() + n, 1, 0, 0, 0, 0);
  }
  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  }
  function startOfWeek(date, weekStartsOn) {
    weekStartsOn = weekStartsOn == null ? 0 : weekStartsOn;
    var d = startOfDay(date);
    var diff = (d.getDay() - weekStartsOn + 7) % 7;
    return addDays(d, -diff);
  }
  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }
  function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
  }
  function toISO(date) { return date.toISOString(); }
  function fromISO(s) { return new Date(s); }

  // ---- Display --------------------------------------------------------------
  function fmtTime(date) {
    var h = date.getHours(), m = date.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    var hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + pad(m) + ' ' + ap;
  }
  function fmtTimeShort(date) {
    var h = date.getHours(), m = date.getMinutes();
    var ap = h >= 12 ? 'p' : 'a';
    var hh = h % 12; if (hh === 0) hh = 12;
    return (m === 0 ? hh : hh + ':' + pad(m)) + ap;
  }
  function fmtDateShort(date) {
    return DOW[date.getDay()] + ' ' + MONTHS[date.getMonth()] + ' ' + date.getDate();
  }
  function fmtDateLong(date) {
    return DOW[date.getDay()] + ', ' + MONTHS[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
  }

  // ---- Time-of-day parsing --------------------------------------------------
  // Flexible free-text time parse so users can type "900am", "9am", "9:00 AM",
  // "930pm", "1400", "9", "9:30" etc. Returns { h:0-23, m:0-59 } or null. With an
  // am/pm suffix the hour must read as a 12-hour clock (1–12); without one a bare
  // number is taken as 24-hour.
  function parseClock(input) {
    if (input == null) return null;
    var s = String(input).trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
    if (s === '') return null;
    var ampm = null;
    var suf = s.match(/(am|pm|a|p)$/);
    if (suf) { ampm = suf[1].charAt(0); s = s.slice(0, s.length - suf[1].length); }
    if (s === '') return null;

    var h, m;
    var colon = s.match(/^(\d{1,2}):(\d{2})$/);
    if (colon) { h = parseInt(colon[1], 10); m = parseInt(colon[2], 10); }
    else if (/^\d+$/.test(s)) {
      if (s.length <= 2) { h = parseInt(s, 10); m = 0; }
      else if (s.length === 3) { h = parseInt(s.charAt(0), 10); m = parseInt(s.slice(1), 10); }
      else if (s.length === 4) { h = parseInt(s.slice(0, 2), 10); m = parseInt(s.slice(2), 10); }
      else return null;
    } else return null;

    if (isNaN(h) || isNaN(m) || m > 59) return null;
    if (ampm) {
      if (h < 1 || h > 12) return null;
      if (ampm === 'p' && h !== 12) h += 12;
      else if (ampm === 'a' && h === 12) h = 0;
    } else if (h > 23) return null;
    if (h > 23) return null;
    return { h: h, m: m };
  }

  // 24-hour h/m → friendly "9:00 AM".
  function fmtClock(h, m) {
    h = ((h % 24) + 24) % 24; m = m || 0;
    var ap = h >= 12 ? 'PM' : 'AM';
    var hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + pad(m) + ' ' + ap;
  }

  // Elapsed clock from milliseconds: "m:ss" under an hour, else "h:mm:ss".
  function fmtElapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? (h + ':' + pad(m) + ':' + pad(sec)) : (m + ':' + pad(sec));
  }

  return {
    pad: pad,
    uid: uid,
    parseDuration: parseDuration,
    formatDuration: formatDuration,
    DOW: DOW, MONTHS: MONTHS, MONTHS_LONG: MONTHS_LONG,
    ymd: ymd, parseYmd: parseYmd, atTime: atTime,
    addDays: addDays, addMonths: addMonths,
    startOfDay: startOfDay, startOfWeek: startOfWeek, startOfMonth: startOfMonth,
    sameDay: sameDay, minutesSinceMidnight: minutesSinceMidnight,
    toISO: toISO, fromISO: fromISO,
    fmtTime: fmtTime, fmtTimeShort: fmtTimeShort,
    fmtDateShort: fmtDateShort, fmtDateLong: fmtDateLong,
    parseClock: parseClock, fmtClock: fmtClock,
    fmtElapsed: fmtElapsed
  };
});
