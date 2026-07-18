# Protocol

A granular productivity tool — a fully local desktop app built around a
calendar and notes. Click a day and check off every little thing on it: tasks
with an optional time of day, subtasks nested underneath, and recurring habits.
A stopwatch sits in the corner for timing whatever you're doing.

I built this for myself to plan my own work.

## How it works

- **Calendar** opens on today's month; click any day to open it.
- On a day, hit **+ Add task** to create a task (fill in its name, an optional
  time, and notes). Everything is a checkbox.
- Give any task **subtasks** with **+ Sub** — child checkboxes indented beneath
  it, nested as deep as you like.
- Mark a task **recurring** in its editor and it becomes a **habit** that shows
  up on its weekdays, checked off per day.
- Undated tasks live in the **backlog**; drag them onto a day to schedule.
- **Notes** is a plain multi-note editor. **Timer** (bottom of the sidebar) is
  a simple stopwatch.

Old goal-tree data files migrate automatically: every leaf task keeps its date
and state, and recurring budgets become habits.

## Install

- **[Download for Windows](https://github.com/dylaneulgen/protocol/releases/latest)** — `Protocol Setup <version>.exe`
- **[Download for macOS](https://github.com/dylaneulgen/protocol/releases/latest)** — `Protocol-<version>-mac.dmg` (universal — Apple Silicon + Intel)

Your data is local.

## Run from source

```bash
npm install
npm start
```
