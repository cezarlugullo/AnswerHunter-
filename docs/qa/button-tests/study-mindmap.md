# Study Page: Mind Map

Buttons for the mind map visualization feature that groups questions by AI-generated tags.

## Buttons in this group

### Button: Open Mind Map
- **DOM**: `#btnMindMap`
- **File**: study.js line 4657
- **Handler**: `openMindMap` (named function, line 4582)
- **Trace**: UI click → `openMindMap()` → add `.open` class to `#mindMapOverlay` → `renderMindMap()` → load SM-2 data → group visible questions by tags → render topic blocks with color-coded pills

#### Static Analysis
- Element reference: ❌ — `document.getElementById('btnMindMap')` at line 4657 with **no null check** before `.addEventListener`
- Null safety: ⚠️ — If `#btnMindMap` missing, line 4657 throws
- Error handling: ✅ — `renderMindMap()` is async but called internally; handles empty visible questions gracefully (line 4599)
- Promise handling: ⚠️ — `renderMindMap()` is async and called without await inside `openMindMap()` (line 4584). If it rejects, the error is unhandled.

#### Issues
- **S1** — No null guard on `#btnMindMap`.
- **S2** — `renderMindMap()` is async (line 4590) but called synchronously in `openMindMap()` (line 4584). Any rejection is unhandled.

---

### Button: Close Mind Map
- **DOM**: `#mindMapCloseBtn`
- **File**: study.js line 4658
- **Handler**: `closeMindMap` (named function, line 4586)
- **Trace**: UI click → `closeMindMap()` → remove `.open` class from `#mindMapOverlay`

#### Static Analysis
- Element reference: ⚠️ — `mindMapCloseBtn` obtained via `document.getElementById('mindMapCloseBtn')` at line 4579; no null check before `.addEventListener` at line 4658
- Null safety: ⚠️ — If `#mindMapCloseBtn` missing, line 4658 throws
- Error handling: ✅ — Synchronous
- Promise handling: ✅ — N/A

#### Issues
- **S1** — No null guard on `mindMapCloseBtn` before addEventListener.

---

### Button: Mind Map Overlay Click
- **DOM**: `#mindMapOverlay`
- **File**: study.js line 4659
- **Handler**: inline arrow `e => { if (e.target === mindMapOverlay) closeMindMap(); }`
- **Trace**: UI click on backdrop → if target is the overlay itself → `closeMindMap()`

#### Static Analysis
- Element reference: ⚠️ — `mindMapOverlay` obtained at line 4578; no null check before addEventListener at line 4659
- Null safety: ⚠️ — If `#mindMapOverlay` missing, line 4659 throws
- Error handling: ✅ — Synchronous with proper target check
- Promise handling: ✅ — N/A

#### Issues
- **S1** — No null guard on `mindMapOverlay` before addEventListener.

---

## Test Scenarios

| Scenario | Expected | Status |
|----------|----------|--------|
| Click mind map button | Overlay opens, loading spinner shown | [Unverified] — requires browser runtime |
| Mind map renders with tagged questions | Color-coded topic blocks shown | [Unverified] — requires browser runtime |
| Mind map with untagged questions | Grouped under "Geral" bucket | [Unverified] — requires browser runtime |
| Mind map with 0 visible questions | "Nenhuma questão visível para mapear" shown | [Unverified] — requires browser runtime |
| Mind map with >8 questions per topic | "+N questões" overflow indicator shown | [Unverified] — requires browser runtime |
| Click close button | Overlay closes | [Unverified] — requires browser runtime |
| Click overlay background | Overlay closes | [Unverified] — requires browser runtime |
| Click inside modal content (not overlay) | No close (target check) | [Unverified] — requires browser runtime |
| Press ESC while mind map open | Overlay closes (line 4660-4661) | [Unverified] — requires browser runtime |
| `#btnMindMap` missing from HTML | TypeError at line 4657 | [Unverified] — requires browser runtime |
| `#mindMapOverlay` missing from HTML | TypeError at line 4659 | [Unverified] — requires browser runtime |
| `renderMindMap()` rejects | Unhandled promise rejection; overlay stays open with loading | [Unverified] — requires browser runtime |

## Overall Status: ❌ — All three mind map DOM references (`btnMindMap`, `mindMapCloseBtn`, `mindMapOverlay`) lack null guards. `renderMindMap()` is async but called without await, risking unhandled rejections.
