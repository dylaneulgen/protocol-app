// Unit tests for the pure logic (no DOM, no Electron). Run with: npm test
// (requires Node 18+, which ships the built-in `node:test` runner).
const test = require('node:test');
const assert = require('node:assert');

const util = require('../src/js/util.js');
const model = require('../src/js/model.js');

test('parseClock understands free-text time', () => {
  assert.deepStrictEqual(util.parseClock('900am'), { h: 9, m: 0 });
  assert.deepStrictEqual(util.parseClock('9am'), { h: 9, m: 0 });
  assert.deepStrictEqual(util.parseClock('9:00 AM'), { h: 9, m: 0 });
  assert.deepStrictEqual(util.parseClock('930pm'), { h: 21, m: 30 });
  assert.deepStrictEqual(util.parseClock('12am'), { h: 0, m: 0 });
  assert.deepStrictEqual(util.parseClock('12pm'), { h: 12, m: 0 });
  assert.deepStrictEqual(util.parseClock('1230pm'), { h: 12, m: 30 });
  assert.deepStrictEqual(util.parseClock('1400'), { h: 14, m: 0 });
  assert.deepStrictEqual(util.parseClock('0930'), { h: 9, m: 30 });
  assert.deepStrictEqual(util.parseClock('9'), { h: 9, m: 0 });
  assert.deepStrictEqual(util.parseClock('9:30'), { h: 9, m: 30 });
  assert.strictEqual(util.parseClock(''), null);
  assert.strictEqual(util.parseClock('banana'), null);
  assert.strictEqual(util.parseClock('25:00'), null);
  assert.strictEqual(util.parseClock('9:60'), null);
  assert.strictEqual(util.parseClock('13am'), null); // 12-hour clock only
});

test('clock formatting round-trips stored HH:MM', () => {
  assert.strictEqual(util.fmtClock(9, 0), '9:00 AM');
  assert.strictEqual(util.fmtClock(21, 30), '9:30 PM');
  assert.strictEqual(util.fmtClock(0, 0), '12:00 AM');
  assert.strictEqual(util.fmtClock(12, 0), '12:00 PM');
  assert.strictEqual(util.hm({ h: 9, m: 5 }), '09:05');
  assert.strictEqual(util.fmtHM('21:30'), '9:30 PM');
  assert.strictEqual(util.fmtHMShort('09:00'), '9a');
  assert.strictEqual(util.fmtHMShort('21:30'), '9:30p');
  assert.strictEqual(util.fmtHMShort('nope'), '');
});

test('date helpers work in local time', () => {
  const d = new Date(2026, 5, 29, 13, 30); // Mon Jun 29 2026
  assert.strictEqual(util.ymd(d), '2026-06-29');
  const ws = util.startOfWeek(d, 0); // Sunday-start
  assert.strictEqual(util.ymd(ws), '2026-06-28');
  assert.strictEqual(util.ymd(util.addDays(d, 3)), '2026-07-02');
  assert.strictEqual(util.ymd(util.startOfMonth(d)), '2026-06-01');
});

test('habitOccursOn matches weekdays inside the window', () => {
  const h = model.makeHabit('Gym');
  h.recurrence.daysOfWeek = [1, 3, 5]; // Mon Wed Fri
  assert.strictEqual(model.habitOccursOn(h, '2026-06-29'), true);  // Monday
  assert.strictEqual(model.habitOccursOn(h, '2026-06-30'), false); // Tuesday
  h.recurrence.startDate = '2026-07-01';
  assert.strictEqual(model.habitOccursOn(h, '2026-06-29'), false); // before window
  assert.strictEqual(model.habitOccursOn(h, '2026-07-01'), true);  // Wednesday
  h.recurrence.endDate = '2026-07-02';
  assert.strictEqual(model.habitOccursOn(h, '2026-07-03'), false); // after window
  h.recurrence.daysOfWeek = [];
  assert.strictEqual(model.habitOccursOn(h, '2026-07-01'), false);
});

test('itemsOn gathers a day: dated tasks and recurring habits (top level only)', () => {
  const run = model.makeTask('Run'); run.date = '2026-06-29';
  const later = model.makeTask('Elsewhere'); later.date = '2026-07-01';
  const backlog = model.makeTask('Someday');
  const habit = model.makeHabit('Stretch');
  habit.recurrence.daysOfWeek = [1]; // Mondays
  habit.completedOccurrences = ['2026-06-29'];

  const items = [run, later, backlog, habit];
  const entries = model.itemsOn(items, '2026-06-29'); // a Monday
  assert.deepStrictEqual(entries.map((e) => e.item.id), [run.id, habit.id]);
  assert.strictEqual(entries[1].done, true); // habit checked off that day
  assert.strictEqual(model.itemsOn(items, '2026-06-30').length, 0);
});

test('sortEntries orders by time of day, untimed last, stable', () => {
  function entry(title, time) { const t = model.makeTask(title); t.time = time; return { item: t, done: false }; }
  const entries = [entry('late', '21:00'), entry('untimed', null), entry('early', '07:00'), entry('also-untimed', null)];
  assert.deepStrictEqual(model.sortEntries(entries).map((e) => e.item.title),
    ['early', 'late', 'untimed', 'also-untimed']);
});

test('subtasks: find, addChild, and remove work at any depth', () => {
  const parent = model.makeTask('Parent'); parent.date = '2026-07-01';
  const items = [parent];

  const kid = model.makeSubtask('Kid');
  model.addChild(items, parent.id, kid);
  assert.strictEqual(parent.children.length, 1);
  assert.strictEqual(parent.children[0].title, 'Kid');

  const grandkid = model.makeSubtask('Grandkid');
  model.addChild(items, kid.id, grandkid);

  // find reaches nested nodes and reports the parent
  const fk = model.find(items, kid.id);
  assert.strictEqual(fk.item.title, 'Kid');
  assert.strictEqual(fk.parent.id, parent.id);
  const fg = model.find(items, grandkid.id);
  assert.strictEqual(fg.parent.id, kid.id);

  // top-level items have no parent
  assert.strictEqual(model.find(items, parent.id).parent, null);

  // remove splices out of the right list, anywhere in the tree
  assert.strictEqual(model.remove(items, grandkid.id).title, 'Grandkid');
  assert.strictEqual(kid.children.length, 0);
  assert.strictEqual(model.remove(items, kid.id).title, 'Kid');
  assert.strictEqual(parent.children.length, 0);
  assert.strictEqual(model.find(items, 'nope'), null);
});

test('a fresh task starts with an empty subtask list', () => {
  assert.deepStrictEqual(model.makeTask('x').children, []);
  assert.strictEqual(model.makeSubtask('y').kind, 'task');
});

test('migrateV1 flattens goal leaves into top-level tasks and habits', () => {
  const forest = [
    {
      id: 'g1', title: 'Get fit', notes: '', children: [
        {
          id: 'n1', title: 'Run 5k', notes: 'easy pace', children: [],
          leaf: {
            kind: 'task', durationMin: 30,
            scheduledStart: new Date(2026, 6, 20, 9, 30).toISOString(),
            done: true, completedAt: 'x', actualMin: 12, timerStart: null
          }
        },
        {
          id: 'n2', title: 'Gym', notes: '', children: [],
          leaf: {
            kind: 'budget', durationMin: 60,
            recurrence: { daysOfWeek: [1, 3, 5], startTime: '07:00', startDate: '2026-07-01', endDate: null },
            completedOccurrences: ['2026-07-06']
          }
        }
      ]
    },
    {
      id: 'g2', title: 'Call the bank', notes: '', children: [],
      leaf: {
        kind: 'task', durationMin: 15,
        scheduledStart: new Date(2026, 6, 21, 0, 0).toISOString(), // midnight = no time
        done: false, completedAt: null
      }
    }
  ];

  const items = model.migrateV1(forest);
  assert.strictEqual(items.length, 3);

  const run = items[0];
  assert.strictEqual(run.kind, 'task');
  assert.strictEqual(run.title, 'Run 5k');
  assert.strictEqual(run.notes, 'easy pace');
  assert.strictEqual(run.date, '2026-07-20');
  assert.strictEqual(run.time, '09:30');
  assert.strictEqual(run.done, true);
  assert.deepStrictEqual(run.children, []);

  const gym = items[1];
  assert.strictEqual(gym.kind, 'habit');
  assert.deepStrictEqual(gym.recurrence.daysOfWeek, [1, 3, 5]);
  assert.strictEqual(gym.recurrence.startDate, '2026-07-01');
  assert.strictEqual(gym.time, '07:00');
  assert.deepStrictEqual(gym.completedOccurrences, ['2026-07-06']);

  const call = items[2];
  assert.strictEqual(call.date, '2026-07-21');
  assert.strictEqual(call.time, null); // midnight meant no time of day
});

test('migrateV1 tolerates junk without throwing', () => {
  assert.deepStrictEqual(model.migrateV1(null), []);
  assert.deepStrictEqual(model.migrateV1('x'), []);
  const items = model.migrateV1([null, { id: 'a', title: 'ok', children: null, leaf: null }]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].kind, 'task');
  assert.strictEqual(items[0].title, 'ok');
});
