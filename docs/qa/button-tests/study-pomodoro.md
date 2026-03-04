# Study Page: Pomodoro Timer

Buttons for the floating Pomodoro timer widget (25 min focus / 5 min break).

## Buttons in this group

### Button: Pomodoro Toggle (Show/Hide Widget)
- **DOM**: `#btnPomodoro`
- **File**: study.js line 4664
- **Handler**: inline arrow function
- **Trace**: UI click → toggle `.visible` class on `#pomodoroWidget` → `updatePomDisplay()` updates time/label

#### Static Analysis
- Element reference: ❌ — `document.getElementById('btnPomodoro')` at line 4664 with **no null check** before `.addEventListener`
- Null safety: ⚠️ — `document.getElementById('pomodoroWidget')` at line 4665 could return null; `.classList.toggle()` would throw
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S1** — No null guard on `#btnPomodoro`. If missing, line 4664 throws.
- **S2** — No null guard on `#pomodoroWidget` at line 4665.

---

### Button: Play/Pause
- **DOM**: `#pomPlayPause`
- **File**: study.js line 4670
- **Handler**: inline arrow `() => { if (_pom.running) pausePomodoro(); else startPomodoro(); }`
- **Trace**: UI click → if running: `pausePomodoro()` (clear interval, update icon to play) → if paused: `startPomodoro()` (start interval, update icon to pause) → timer counts down → when reaches 0: toggles break/focus mode, shows toast, awards XP

#### Static Analysis
- Element reference: ❌ — No null check on `#pomPlayPause` before addEventListener at line 4670
- Null safety: ⚠️ — `startPomodoro()` accesses `document.getElementById('pomPlayIcon')` at line 4274 without null check
- Error handling: ✅ — Synchronous timer logic
- Promise handling: ✅ — N/A

#### Issues
- **S1** — No null guard on `#pomPlayPause`.
- **S2** — `document.getElementById('pomPlayIcon')` inside `startPomodoro()` (line 4274) and `pausePomodoro()` (line 4295) not null-checked; `.textContent` throws if missing.

---

### Button: Reset
- **DOM**: `#pomReset`
- **File**: study.js line 4675
- **Handler**: `resetPomodoro` (named function, line 4298)
- **Trace**: UI click → `clearInterval(_pom.intervalId)` → reset state: `running=false`, `isBreak=false`, `remaining=POM_WORK (25 min)` → update play icon → `updatePomDisplay()`

#### Static Analysis
- Element reference: ❌ — No null check on `#pomReset` before addEventListener at line 4675
- Null safety: ⚠️ — Same internal null risk as play/pause for `pomPlayIcon`
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S1** — No null guard on `#pomReset`.

---

### Button: Close
- **DOM**: `#pomClose`
- **File**: study.js line 4677
- **Handler**: inline arrow `() => { pausePomodoro(); getElementById('pomodoroWidget').classList.remove('visible'); }`
- **Trace**: UI click → `pausePomodoro()` (pause timer if running) → hide widget by removing `.visible`

#### Static Analysis
- Element reference: ❌ — No null check on `#pomClose` before addEventListener at line 4677
- Null safety: ⚠️ — `document.getElementById('pomodoroWidget')` at line 4679 could return null
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S1** — No null guard on `#pomClose`.
- **S2** — No null guard on `#pomodoroWidget` at line 4679.

---

## Test Scenarios

| Scenario | Expected | Status |
|----------|----------|--------|
| Click pomodoro toggle | Widget appears with 25:00 timer | [Unverified] — requires browser runtime |
| Click pomodoro toggle again | Widget hides | [Unverified] — requires browser runtime |
| Click play | Timer starts counting down, icon changes to pause | [Unverified] — requires browser runtime |
| Click pause while running | Timer pauses, icon changes to play | [Unverified] — requires browser runtime |
| Timer reaches 0 during focus mode | Toast "Hora da pausa", switches to 5 min break | [Unverified] — requires browser runtime |
| Timer reaches 0 during break mode | Toast "Pausa encerrada", switches to 25 min focus | [Unverified] — requires browser runtime |
| Click reset during running timer | Timer stops, resets to 25:00 | [Unverified] — requires browser runtime |
| Click reset during break | Resets to focus mode 25:00 | [Unverified] — requires browser runtime |
| Click close while running | Timer pauses, widget hides | [Unverified] — requires browser runtime |
| Click close while paused | Widget hides, timer preserved | [Unverified] — requires browser runtime |
| Reopen widget after close | Timer state preserved from before close | [Unverified] — requires browser runtime |
| `#btnPomodoro` missing from HTML | TypeError at line 4664 | [Unverified] — requires browser runtime |
| `#pomPlayPause` missing from HTML | TypeError at line 4670 | [Unverified] — requires browser runtime |
| `#pomodoroWidget` missing from HTML | TypeError on classList access | [Unverified] — requires browser runtime |
| XP award after focus session complete | `awardXP(20)` called | [Unverified] — requires browser runtime |
| Multiple rapid play/pause clicks | Guards prevent double-start (`if (_pom.running) return`) | [Unverified] — requires browser runtime |

## Overall Status: ❌ — None of the four pomodoro button references use null guards. All will throw TypeError if their corresponding elements are missing from HTML. Internal functions (`startPomodoro`, `pausePomodoro`, `resetPomodoro`) also lack null checks on `pomPlayIcon`.
