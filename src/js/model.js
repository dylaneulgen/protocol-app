// Pure domain logic for the goal forest: node factories, tree navigation,
// roll-up totals, and recurrence expansion. No DOM access — this is the part the
// Node tests exercise directly. UMD-wrapped like util.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util.js'));
  } else {
    root.Planner = root.Planner || {};
    root.Planner.model = factory(root.Planner.util);
  }
})(typeof self !== 'undefined' ? self : this, function (util) {
  'use strict';

  // A node is a LEAF iff it has no children. Only leaves carry concrete data
  // (duration, schedule). Parents derive everything from their descendants.
  function isLeaf(node) {
    return !node.children || node.children.length === 0;
  }

  function defaultTaskLeaf() {
    return {
      kind: 'task',
      durationMin: 0, // no default time — the user sets it
      estimated: false,
      scheduledStart: null, // ISO string, or null = backlog
      done: false,
      completedAt: null,
      actualMin: 0,         // time actually spent (logged by the timer)
      timerStart: null      // ISO string while a timer is running, else null
    };
  }

  function defaultBudgetLeaf() {
    return {
      kind: 'budget',
      durationMin: 0, // no default time — the user sets it
      estimated: true, // budgets are reserved capacity, not confirmed work
      recurrence: {
        daysOfWeek: [1, 2, 3, 4, 5], // 0=Sun .. 6=Sat
        startTime: '18:00',
        startDate: null,
        endDate: null
      },
      completedOccurrences: [] // ['YYYY-MM-DD', ...]
    };
  }

  function makeNode(title, leaf) {
    return {
      id: util.uid('n'),
      title: title || 'Untitled',
      notes: '',
      collapsed: false,
      children: [],
      leaf: leaf === undefined ? defaultTaskLeaf() : leaf
    };
  }

  // A fresh goal starts as a leaf task; adding a subgoal promotes it to a parent.
  function makeGoal(title) { return makeNode(title, defaultTaskLeaf()); }

  // Locate a node by id within a forest (array of root nodes).
  // Returns { node, parent, list, index } or null.
  function find(forest, id) {
    function rec(list, parent) {
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (n.id === id) return { node: n, parent: parent, list: list, index: i };
        if (n.children && n.children.length) {
          var r = rec(n.children, n);
          if (r) return r;
        }
      }
      return null;
    }
    return rec(forest, null);
  }

  // Path of nodes from a root down to (and including) the node with `id`.
  function path(forest, id) {
    var result = [];
    function rec(list, acc) {
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        var here = acc.concat([n]);
        if (n.id === id) { result = here; return true; }
        if (n.children && n.children.length && rec(n.children, here)) return true;
      }
      return false;
    }
    rec(forest, []);
    return result;
  }

  function walk(forest, fn, depth, parent) {
    depth = depth || 0;
    for (var i = 0; i < forest.length; i++) {
      var n = forest[i];
      fn(n, depth, parent);
      if (n.children && n.children.length) walk(n.children, fn, depth + 1, n);
    }
  }

  // Collect every leaf node in the forest (optionally filtered).
  function leaves(forest, filter) {
    var out = [];
    walk(forest, function (n) {
      if (isLeaf(n) && (!filter || filter(n))) out.push(n);
    });
    return out;
  }

  function addChild(forest, parentId, node) {
    if (parentId == null) { forest.push(node); return node; }
    var f = find(forest, parentId);
    if (!f) return null;
    var p = f.node;
    if (isLeaf(p)) p.leaf = null; // promoting a leaf to a parent drops its leaf data
    p.children = p.children || [];
    p.children.push(node);
    return node;
  }

  function removeNode(forest, id) {
    var f = find(forest, id);
    if (!f) return null;
    f.list.splice(f.index, 1);
    // If a parent just lost its last child, it becomes a leaf again.
    if (f.parent && (!f.parent.children || f.parent.children.length === 0)) {
      f.parent.leaf = defaultTaskLeaf();
    }
    return f.node;
  }

  // Is `maybeAncestorId` an ancestor of (or equal to) `id`? Used to block
  // moving a node into its own subtree.
  function isAncestor(forest, maybeAncestorId, id) {
    if (maybeAncestorId === id) return true;
    var f = find(forest, maybeAncestorId);
    if (!f) return false;
    return !!find(f.node.children || [], id) ||
      (f.node.children || []).some(function (c) { return c.id === id; });
  }

  // ---- Roll-up --------------------------------------------------------------
  // Aggregate concrete data from all descendant leaves of `node`.
  function rollup(node) {
    var acc = {
      finiteMin: 0,        // total of one-off task durations
      estimatedMin: 0,     // portion of finiteMin flagged as estimated
      doneMin: 0,          // portion of finiteMin completed
      taskCount: 0,
      doneCount: 0,
      budgetCount: 0,
      recurringWeeklyMin: 0 // reserved recurring effort per week
    };
    function rec(n) {
      if (isLeaf(n)) {
        var lf = n.leaf || {};
        if (lf.kind === 'budget') {
          var days = (lf.recurrence && lf.recurrence.daysOfWeek) ? lf.recurrence.daysOfWeek.length : 0;
          acc.recurringWeeklyMin += (lf.durationMin || 0) * days;
          acc.budgetCount += 1;
        } else {
          var d = lf.durationMin || 0;
          acc.finiteMin += d;
          if (lf.estimated) acc.estimatedMin += d;
          acc.taskCount += 1;
          if (lf.done) { acc.doneMin += d; acc.doneCount += 1; }
        }
      } else {
        for (var i = 0; i < n.children.length; i++) rec(n.children[i]);
      }
    }
    rec(node);
    acc.percent = acc.finiteMin > 0
      ? Math.round((acc.doneMin / acc.finiteMin) * 100)
      : (acc.taskCount > 0 ? Math.round((acc.doneCount / acc.taskCount) * 100) : 0);
    return acc;
  }

  // ---- Recurrence -----------------------------------------------------------
  // Expand a budget leaf into concrete occurrences within [rangeStart, rangeEnd]
  // (Date objects; inclusive by day). Returns an array of
  // { nodeId, date, start (Date), durationMin, done }.
  function expandOccurrences(node, rangeStart, rangeEnd) {
    var lf = node && node.leaf;
    if (!lf || lf.kind !== 'budget' || !lf.recurrence) return [];
    var rec = lf.recurrence;
    var days = rec.daysOfWeek || [];
    if (!days.length) return [];
    var winStart = rec.startDate ? util.parseYmd(rec.startDate) : null;
    var winEnd = rec.endDate ? util.parseYmd(rec.endDate) : null;
    var done = lf.completedOccurrences || [];

    var out = [];
    var cur = util.startOfDay(rangeStart);
    var last = util.startOfDay(rangeEnd);
    var guard = 0;
    while (cur.getTime() <= last.getTime() && guard < 2000) {
      guard++;
      if (days.indexOf(cur.getDay()) !== -1) {
        var afterStart = !winStart || cur.getTime() >= winStart.getTime();
        var beforeEnd = !winEnd || cur.getTime() <= winEnd.getTime();
        if (afterStart && beforeEnd) {
          var key = util.ymd(cur);
          out.push({
            nodeId: node.id,
            date: key,
            start: util.atTime(cur, rec.startTime || '00:00'),
            durationMin: lf.durationMin || 0,
            done: done.indexOf(key) !== -1
          });
        }
      }
      cur = util.addDays(cur, 1);
    }
    return out;
  }

  // ---- Templates ------------------------------------------------------------
  // A template is a reusable goal SKELETON: a node tree carrying NO ids and none
  // of the volatile per-instance state (no schedule, done flag, timer, logged
  // time, or completed occurrences). There are no built-in templates — every
  // template is one the user saved from an existing goal, persisted in
  // state.templates (builtin:false).
  //   instantiateTemplate(tpl, name) — stamp a skeleton out as a real goal (fresh ids)
  //   templateFromNode(node)         — capture an existing goal back into a skeleton
  //   normalizeTemplate(tpl)         — defensive clean-up for stored/old templates

  // Produce a clean leaf (volatile fields reset to defaults) from a leaf
  // description. Used both when stamping a template OUT and when capturing one IN,
  // so an instantiated goal can never inherit another instance's schedule/progress.
  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  function freshLeaf(leaf) {
    if (!leaf || typeof leaf !== 'object') return defaultTaskLeaf();
    if (leaf.kind === 'budget') {
      var b = defaultBudgetLeaf();
      b.durationMin = isFiniteNum(leaf.durationMin) ? leaf.durationMin : 0;
      b.estimated = true;
      var r = leaf.recurrence || {};
      b.recurrence.daysOfWeek = Array.isArray(r.daysOfWeek) ? r.daysOfWeek.slice() : b.recurrence.daysOfWeek;
      b.recurrence.startTime = r.startTime || b.recurrence.startTime;
      b.recurrence.startDate = null; // a date window is per-instance schedule, not template shape
      b.recurrence.endDate = null;
      b.completedOccurrences = [];
      return b;
    }
    var t = defaultTaskLeaf();
    t.durationMin = isFiniteNum(leaf.durationMin) ? leaf.durationMin : 0;
    t.estimated = !!leaf.estimated;
    return t; // scheduledStart/done/completedAt/actualMin/timerStart stay at defaults
  }

  // Deep-clone a skeleton into a live goal node with brand-new ids.
  function stampNode(skel) {
    var kids = (skel && Array.isArray(skel.children)) ? skel.children : [];
    var node = {
      id: util.uid('n'),
      title: (skel && typeof skel.title === 'string') ? skel.title : 'Untitled',
      notes: (skel && typeof skel.notes === 'string') ? skel.notes : '',
      collapsed: false,
      children: [],
      leaf: null
    };
    if (kids.length) node.children = kids.map(stampNode);
    else node.leaf = freshLeaf(skel && skel.leaf);
    return node;
  }

  // Capture a live node as a skeleton (strip ids + volatile state).
  function skeletonOf(node) {
    var kids = (node && Array.isArray(node.children)) ? node.children : [];
    var skel = {
      title: (node && typeof node.title === 'string') ? node.title : 'Untitled',
      notes: (node && typeof node.notes === 'string') ? node.notes : '',
      children: [],
      leaf: null
    };
    if (kids.length) skel.children = kids.map(skeletonOf);
    else skel.leaf = freshLeaf(node && node.leaf);
    return skel;
  }

  // Stamp a template out as a new top-level goal. `name` (optional, trimmed)
  // overrides the skeleton's root title when non-empty.
  function instantiateTemplate(tpl, name) {
    var root = stampNode(tpl && tpl.root ? tpl.root : { title: 'Untitled' });
    var n = (name == null) ? '' : String(name).trim();
    if (n) root.title = n;
    return root;
  }

  // Build a fresh custom template from an existing goal node.
  function templateFromNode(node, meta) {
    meta = meta || {};
    return {
      id: util.uid('tpl'),
      name: meta.name || (node && node.title) || 'Untitled',
      builtin: false,
      root: skeletonOf(node)
    };
  }

  // Defensive normalisation so a custom/old/partial template can't crash the UI.
  function normalizeTemplate(tpl) {
    if (!tpl || typeof tpl !== 'object' || !tpl.root || typeof tpl.root !== 'object') return null;
    return {
      id: tpl.id || util.uid('tpl'),
      name: typeof tpl.name === 'string' ? tpl.name : 'Untitled',
      builtin: !!tpl.builtin,
      root: skeletonOf(tpl.root)
    };
  }

  // No built-in templates — kept as an (empty) seam so store.js can still ask for
  // built-ins generically. Every template comes from the user saving a goal.
  var BUILTIN_TEMPLATES = [];

  return {
    isLeaf: isLeaf,
    defaultTaskLeaf: defaultTaskLeaf,
    defaultBudgetLeaf: defaultBudgetLeaf,
    makeNode: makeNode,
    makeGoal: makeGoal,
    find: find,
    path: path,
    walk: walk,
    leaves: leaves,
    addChild: addChild,
    removeNode: removeNode,
    isAncestor: isAncestor,
    rollup: rollup,
    expandOccurrences: expandOccurrences,
    instantiateTemplate: instantiateTemplate,
    templateFromNode: templateFromNode,
    normalizeTemplate: normalizeTemplate,
    BUILTIN_TEMPLATES: BUILTIN_TEMPLATES
  };
});
