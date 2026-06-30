// Unit tests for the pure logic (no DOM, no Electron). Run with: npm test
// (requires Node 18+, which ships the built-in `node:test` runner).
const test = require('node:test');
const assert = require('node:assert');

const util = require('../src/js/util.js');
const model = require('../src/js/model.js');

test('parseDuration understands common formats', () => {
  assert.strictEqual(util.parseDuration('1h30m'), 90);
  assert.strictEqual(util.parseDuration('90m'), 90);
  assert.strictEqual(util.parseDuration('2h'), 120);
  assert.strictEqual(util.parseDuration('1:30'), 90);
  assert.strictEqual(util.parseDuration('45'), 45);
  assert.strictEqual(util.parseDuration('1.5h'), 90);
  assert.strictEqual(util.parseDuration(''), null);
  assert.strictEqual(util.parseDuration('banana'), null);
});

test('formatDuration is human readable', () => {
  assert.strictEqual(util.formatDuration(90), '1h 30m');
  assert.strictEqual(util.formatDuration(120), '2h');
  assert.strictEqual(util.formatDuration(45), '45m');
  assert.strictEqual(util.formatDuration(0), '0m');
});

test('date helpers work in local time', () => {
  const d = new Date(2026, 5, 29, 13, 30); // Mon Jun 29 2026
  assert.strictEqual(util.ymd(d), '2026-06-29');
  assert.strictEqual(util.minutesSinceMidnight(d), 13 * 60 + 30);
  const ws = util.startOfWeek(d, 0); // Sunday-start
  assert.strictEqual(util.ymd(ws), '2026-06-28');
  assert.strictEqual(util.ymd(util.addDays(d, 3)), '2026-07-02');
  assert.strictEqual(util.ymd(util.startOfMonth(d)), '2026-06-01');
});

test('rollup aggregates finite, done, and recurring totals', () => {
  const goal = model.makeNode('Get fit', null);
  goal.children = [
    model.makeNode('Run 5k', { kind: 'task', durationMin: 30, scheduledStart: null, done: true, completedAt: null }),
    model.makeNode('Meal prep', { kind: 'task', durationMin: 60, scheduledStart: null, done: false, completedAt: null }),
    model.makeNode('Gym', {
      kind: 'budget', durationMin: 60,
      recurrence: { daysOfWeek: [1, 3, 5], startTime: '07:00', startDate: null, endDate: null },
      completedOccurrences: []
    })
  ];
  const r = model.rollup(goal);
  assert.strictEqual(r.finiteMin, 90);        // 30 + 60 one-off tasks
  assert.strictEqual(r.doneMin, 30);          // run done
  assert.strictEqual(r.taskCount, 2);
  assert.strictEqual(r.doneCount, 1);
  assert.strictEqual(r.budgetCount, 1);
  assert.strictEqual(r.recurringWeeklyMin, 180); // 60 * 3 days
  assert.strictEqual(r.percent, 33);          // round(30/90*100)
});

test('rollup handles deep nesting', () => {
  const root = model.makeNode('Top', null);
  const mid = model.makeNode('Mid', null);
  mid.children = [model.makeNode('Leaf', { kind: 'task', durationMin: 120, estimated: false, scheduledStart: null, done: true })];
  root.children = [mid];
  const r = model.rollup(root);
  assert.strictEqual(r.finiteMin, 120);
  assert.strictEqual(r.percent, 100);
});

test('addChild promotes a leaf to a parent; removeNode demotes back', () => {
  const forest = [model.makeGoal('Goal A')];
  const goalId = forest[0].id;
  assert.ok(model.isLeaf(forest[0]));

  const child = model.makeNode('Subtask', model.defaultTaskLeaf());
  model.addChild(forest, goalId, child);
  assert.ok(!model.isLeaf(forest[0]));        // now a parent
  assert.strictEqual(forest[0].leaf, null);   // leaf data dropped

  model.removeNode(forest, child.id);
  assert.ok(model.isLeaf(forest[0]));         // back to a leaf
  assert.ok(forest[0].leaf && forest[0].leaf.kind === 'task');
});

test('find and path locate nodes in the forest', () => {
  const forest = [model.makeNode('Root', null)];
  const a = model.makeNode('A', null);
  const b = model.makeNode('B', model.defaultTaskLeaf());
  forest[0].children = [a];
  a.children = [b];
  const found = model.find(forest, b.id);
  assert.strictEqual(found.node.title, 'B');
  assert.strictEqual(found.parent.title, 'A');
  const p = model.path(forest, b.id).map((n) => n.title);
  assert.deepStrictEqual(p, ['Root', 'A', 'B']);
});

test('expandOccurrences yields one occurrence per matching weekday in range', () => {
  const budget = model.makeNode('Coursework', {
    kind: 'budget', durationMin: 120, estimated: true,
    recurrence: { daysOfWeek: [1, 2, 3, 4, 5], startTime: '18:00', startDate: null, endDate: null },
    completedOccurrences: ['2026-06-29']
  });
  // Week of Sun Jun 28 .. Sat Jul 4, 2026 → weekdays Mon-Fri = 5 occurrences.
  const start = new Date(2026, 5, 28);
  const end = new Date(2026, 6, 4);
  const occ = model.expandOccurrences(budget, start, end);
  assert.strictEqual(occ.length, 5);
  assert.strictEqual(occ[0].date, '2026-06-29'); // Monday
  assert.strictEqual(occ[0].done, true);         // marked complete
  assert.strictEqual(occ[1].done, false);
  occ.forEach((o) => {
    assert.strictEqual(o.start.getHours(), 18);
    assert.strictEqual(o.durationMin, 120);
  });
});

test('there are no built-in templates (templates come from saving goals)', () => {
  assert.ok(Array.isArray(model.BUILTIN_TEMPLATES));
  assert.strictEqual(model.BUILTIN_TEMPLATES.length, 0);
});

test('instantiateTemplate stamps a goal with fresh ids and the given name', () => {
  const src = model.makeNode('New goal', null);
  src.children = [model.makeGoal('Plan'), model.makeGoal('Do'), model.makeGoal('Review')];
  const tpl = model.templateFromNode(src);            // a saved (custom) template
  const a = model.instantiateTemplate(tpl, 'Ship v1');
  const b = model.instantiateTemplate(tpl, 'Ship v2');
  assert.strictEqual(a.title, 'Ship v1');
  assert.strictEqual(a.children.length, 3);          // Plan / Do / Review
  assert.ok(a.id && a.id !== b.id);                  // fresh ids per instance
  assert.notStrictEqual(a.children[0].id, b.children[0].id);
  // a blank name falls back to the template's captured root title
  assert.strictEqual(model.instantiateTemplate(tpl, '   ').title, 'New goal');
});

test('capturing a budget goal as a template drops its date window but keeps the shape', () => {
  const goal = model.makeNode('Dated habit', {
    kind: 'budget', durationMin: 45, estimated: true,
    recurrence: { daysOfWeek: [1, 3], startTime: '07:30', startDate: '2026-01-01', endDate: '2026-03-01' },
    completedOccurrences: ['2026-01-05']
  });
  const tpl = model.templateFromNode(goal);
  const g = model.instantiateTemplate(tpl, 'Again');
  assert.strictEqual(g.leaf.kind, 'budget');
  assert.deepStrictEqual(g.leaf.recurrence.daysOfWeek, [1, 3]); // shape preserved
  assert.strictEqual(g.leaf.recurrence.startTime, '07:30');
  assert.strictEqual(g.leaf.recurrence.startDate, null);        // window is schedule, dropped
  assert.strictEqual(g.leaf.recurrence.endDate, null);
  assert.deepStrictEqual(g.leaf.completedOccurrences, []);
});

test('instantiateTemplate resets volatile per-instance state', () => {
  // A template carrying a "dirty" leaf must produce a clean task.
  const dirty = {
    id: 'x', name: 'Dirty', builtin: false,
    root: {
      title: 'Root', notes: '', children: [], leaf: {
        kind: 'task', durationMin: 45,
        scheduledStart: '2026-06-30T10:00:00.000Z', done: true,
        completedAt: '2026-06-30T11:00:00.000Z', actualMin: 99,
        timerStart: '2026-06-30T10:00:00.000Z'
      }
    }
  };
  const g = model.instantiateTemplate(dirty, 'Use it');
  assert.strictEqual(g.leaf.kind, 'task');
  assert.strictEqual(g.leaf.durationMin, 45);   // structure preserved
  assert.strictEqual(g.leaf.scheduledStart, null); // but schedule/progress wiped
  assert.strictEqual(g.leaf.done, false);
  assert.strictEqual(g.leaf.completedAt, null);
  assert.strictEqual(g.leaf.actualMin, 0);
  assert.strictEqual(g.leaf.timerStart, null);
});

test('instantiateTemplate preserves a recurring budget without its completions', () => {
  const src = model.makeNode('New goal', {
    kind: 'budget', durationMin: 30, estimated: true,
    recurrence: { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: '08:00', startDate: null, endDate: null },
    completedOccurrences: ['2026-06-30']
  });
  const tpl = model.templateFromNode(src);
  const g = model.instantiateTemplate(tpl, 'Stretch');
  assert.strictEqual(g.leaf.kind, 'budget');
  assert.deepStrictEqual(g.leaf.recurrence.daysOfWeek, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(g.leaf.completedOccurrences, []);
});

test('templateFromNode captures an existing goal as a reusable skeleton', () => {
  const goal = model.makeNode('My routine', null);
  goal.children = [
    model.makeNode('Step 1', { kind: 'task', durationMin: 30, estimated: false, scheduledStart: '2026-06-30T10:00:00.000Z', done: true, completedAt: 'x', actualMin: 10, timerStart: null })
  ];
  const tpl = model.templateFromNode(goal);
  assert.strictEqual(tpl.builtin, false);
  assert.strictEqual(tpl.name, 'My routine');
  assert.ok(tpl.id && tpl.id !== goal.id);
  assert.strictEqual(tpl.root.children.length, 1);
  // captured leaf keeps duration but drops schedule + progress
  const leaf = tpl.root.children[0].leaf;
  assert.strictEqual(leaf.durationMin, 30);
  assert.strictEqual(leaf.scheduledStart, null);
  assert.strictEqual(leaf.done, false);
  assert.strictEqual(leaf.actualMin, 0);
  // round-trip: stamping the captured template yields a fresh, independent goal
  const back = model.instantiateTemplate(tpl, 'Copy');
  assert.notStrictEqual(back.id, goal.id);
  assert.strictEqual(back.children.length, 1);
});

test('normalizeTemplate rejects junk and keeps custom flag', () => {
  assert.strictEqual(model.normalizeTemplate(null), null);
  assert.strictEqual(model.normalizeTemplate({ name: 'no root' }), null);
  const ok = model.normalizeTemplate({ id: 't1', name: 'Keep', builtin: false, root: { title: 'R', children: [] } });
  assert.strictEqual(ok.id, 't1');
  assert.strictEqual(ok.builtin, false);
  assert.ok(ok.root.leaf && ok.root.leaf.kind === 'task'); // childless root gets a task leaf
});

test('expandOccurrences respects start/end window', () => {
  const budget = model.makeNode('Limited', {
    kind: 'budget', durationMin: 60, estimated: true,
    recurrence: { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', startDate: '2026-06-30', endDate: '2026-07-01' },
    completedOccurrences: []
  });
  const occ = model.expandOccurrences(budget, new Date(2026, 5, 28), new Date(2026, 6, 4));
  // Only Jun 30 (Tue) and Jul 1 (Wed) fall in the window.
  assert.deepStrictEqual(occ.map((o) => o.date), ['2026-06-30', '2026-07-01']);
});
