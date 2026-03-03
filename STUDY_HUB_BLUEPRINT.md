# AnswerHunter Study Hub — Complete Redesign Blueprint

> Generated: March 2026 | Agents: Research, IA/UX, Visual Design, Frontend, Data Integration, QA

---

## 1. RESEARCH REPORT — 10+ Platform Analysis

### 1.1 Platform Comparison Table

| Platform | Organization Patterns | Progress Patterns | Tools | Strategy to Adopt | Why It Works |
|---|---|---|---|---|---|
| **Coursera** | Courses → Weeks → Modules → Lessons. "My Learning" dashboard. | Per-course %, weekly deadlines, graded assignments, certificates. | Video, readings, quizzes, peer review, discussion forums. | Time-bounded modules with clear deadlines and completion %. | Deadlines create urgency; visual % motivates "just one more." |
| **Khan Academy** | Subject → Unit → Lesson. Mastery-based progression. | Mastery points (0-100 per skill), unit tests gate progression. Energy points + streaks. | Practice exercises, unit tests, videos, articles, Khanmigo AI tutor. | Mastery gates — can't advance until prerequisite is solid. | Prevents knowledge gaps; feels like genuine competence, not just time spent. |
| **Duolingo** | Language → Section → Unit → Lesson. Linear path with branching. | Daily XP, streak (freeze protection), leagues, hearts system. | Bite-size lessons (3-5 min), listening, speaking, matching, stories. | Daily habit loop: streak + XP + leagues. Session brevity. | Habit psychology: loss aversion (streak), social competition (leagues), dopamine (XP). |
| **Codecademy** | Career Paths → Skill Paths → Courses → Lessons → Projects. | Skill % per path, course completion, project portfolio. | Interactive code editor, quizzes, projects, cheatsheets. | Career/Skill Paths as curated sequences. Portfolio/project-based milestones. | Goal-oriented learning (I want to become X) beats aimless browsing. |
| **Pluralsight** | Skill IQ assessments → Channels → Courses → Modules. Role-based paths. | Skill IQ score (1-300), Role IQ, skill gaps heatmap, course minutes. | Video, assessments, interactive labs, sandboxes, Iris AI assistant. | Skill gap analysis: test first, then learn what's weak. Analytics dashboard. | Diagnostic → targeted learning is more efficient than linear consumption. |
| **Brilliant** | Courses → Chapters → Lessons (interactive problems). | Per-course progress, concept mastery, streak. | Interactive problem-solving, visual explanations, personalized practice. | Interactive problem-first learning. Concepts click through doing. | Active recall through problems > passive reading. Immediate feedback loop. |
| **Quizlet** | Sets → Folders → Classes. Flashcard-centric. | Familiarity score, study streaks, round completion. | Flashcards, Learn mode (adaptive), Test mode, Match game, spaced repetition. | Multiple study modes from same content. Familiarity scoring per card. | Same material, different angles = better encoding. Spaced repetition is proven. |
| **Moodle** | Courses → Sections → Activities/Resources. | Activity completion checkmarks, grade book, course completion %. | Assignments, quizzes, forums, wikis, SCORM packages. | Per-activity completion tracking with visual checklist. | Granular tracking reveals exactly where student is stuck. |
| **LinkedIn Learning** | Learning Paths → Courses → Chapters → Videos. Role guides (35+ roles). | Course time, path %, saved content, certificates. | Video, quizzes, exercise files, Skill Evaluations. | "My Learning" continuity + role-based path curation. | Frictionless resume (pick up where you left off) + career-aligned recommendations. |
| **Open edX** | Programs → Courses → Sections → Subsections → Units. | XBlock-based grade calculation, dashboards, learner analytics. | Video, problems, discussions, peer assessment, ORA. | Modular content units (XBlocks) that can be reordered/mixed. | Component-based architecture scales well for diverse content types. |
| **Anki** | Decks → Sub-decks → Cards. Tag-based organization. | Due/New/Learning queues. Retention %, review intervals, forecast graph. | SRS flashcards (SM-2/FSRS), add-ons, statistics, sync. | Transparent SRS queue: "due today" as primary action surface. | Clear daily obligation drives habit. Visible interval builds trust in the algorithm. |
| **Notion (for study)** | Databases → Views (table, board, calendar, gallery). | Status property (Not started/In progress/Done). | Templates, databases, linked views, formulas, relations. | Multiple views of same data (card, list, board, calendar). | Users choose their mental model. Same data, different lenses. |

### 1.2 Extracted Heuristics (15 Professional Platform Principles)

1. **H1 — Hierarchical Content Tree**: Discipline → Module → Topic → Card/Activity. Every item has a clear "address" (breadcrumb).
2. **H2 — Mastery Gates**: Progress to next level requires demonstrated competence, not just time spent.
3. **H3 — Daily Obligation Surface**: The #1 screen answers "What should I do RIGHT NOW?" (due reviews, next steps).
4. **H4 — Progress Visibility**: Per-item, per-module, per-discipline completion % always visible. Never hide progress.
5. **H5 — Multiple Study Modes**: Same content → different practice modes (read, quiz, flashcard, explain, match).
6. **H6 — Spaced Repetition as Core**: Not a feature — it IS the scheduling engine. Due dates drive the daily queue.
7. **H7 — Streak & Habit Loop**: Daily streak with visible counter. XP for every action. Streaks create loss aversion.
8. **H8 — Diagnostic First**: Assess before teaching. Identify gaps, then target weak areas.
9. **H9 — Session Brevity**: Short, focused sessions (5-15 min) with clear start/end. Pomodoro-compatible.
10. **H10 — Contextual Tools**: Tools appear WHERE they're needed (review tools in review flow, quiz in practice).
11. **H11 — Multi-View Library**: Same data displayed as cards, list, timeline, or calendar. User chooses.
12. **H12 — Smart Collections**: Auto-generated groups: "Due Today", "Overdue", "Weak Areas", "Mastered", "Untouched".
13. **H13 — Career/Goal Alignment**: Connect study to WHY (exam date, certification, grade goal).
14. **H14 — Social Proof & Gamification**: Badges, levels, leaderboard. Make progress feel rewarding.
15. **H15 — Frictionless Resume**: One-click continue from exactly where you left off. "Continue studying" as hero CTA.

---

## 2. IA/UX ARCHITECTURE

### 2.1 Information Architecture

```
Study Hub (study.html)
├── 🏠 Home (Today)
│   ├── Continue Studying (hero CTA → resumes last session)
│   ├── Daily Briefing (due reviews, streak, recommendations)
│   ├── Quick Stats (cards studied, accuracy, time, streak)
│   └── Recent Activity Feed
│
├── 📚 Library
│   ├── View Toggle: Cards / List / Board
│   ├── Smart Collections
│   │   ├── In Progress
│   │   ├── Review Today
│   │   ├── Overdue
│   │   ├── Mastered
│   │   ├── Untouched
│   │   └── Flagged
│   ├── Discipline → Module → Topic → Cards
│   ├── Search (global: disciplines + topics + cards)
│   ├── Sort (progress, priority, due date, last activity, difficulty)
│   └── Filters (tags, status, difficulty, date range)
│
├── 📖 Study Session
│   ├── Session Setup (source selection, mode, card count)
│   ├── Active Session
│   │   ├── Card Display (question + reveal + rate)
│   │   ├── Card Actions (explain, hint, mnemonic, note, flag)
│   │   ├── Progress Bar (cards done / total)
│   │   └── Session Timer (optional)
│   ├── AI Tools (contextual dock)
│   │   ├── Explain Why Wrong
│   │   ├── Socratic Hint
│   │   ├── Generate Mnemonic
│   │   ├── Chat de Dúvida
│   │   └── Generate Review Card
│   └── Session Summary (results + next steps)
│
├── 🔄 Review (Spaced Repetition)
│   ├── Due Today Queue
│   ├── Overdue Queue
│   ├── Review Session (same card UI + SRS rating)
│   └── Forecast (upcoming reviews by day)
│
├── 🧪 Practice
│   ├── Quiz Mode (AI-generated MCQ)
│   ├── Simulado (timed mock exam)
│   ├── Flashcard Mode (3D flip)
│   └── Challenge Mode (random mix)
│
├── 🗺️ Planning
│   ├── Study Plans (daily/weekly auto-generated)
│   ├── Learning Paths (prerequisite chains)
│   ├── Goal Setting (exam dates, targets)
│   └── Calendar View (upcoming reviews + exams)
│
├── 📊 Insights
│   ├── Overview Dashboard (XP, level, accuracy, time)
│   ├── Activity Heatmap
│   ├── Discipline Breakdown
│   ├── Weak Areas Analysis
│   ├── Streak & Consistency
│   └── Export / Backup
│
└── ⚙️ Settings
    ├── Theme (light/dark/auto)
    ├── Language (pt-BR/en)
    ├── AI Provider config
    └── Data Management (export/import/reset)
```

### 2.2 Navigation Model

**Primary**: Collapsible sidebar with icon + label. 7 sections (Home, Library, Study, Review, Practice, Plan, Insights).
**Secondary**: Topbar with global search (⌘K / Ctrl+K), notification bell (due reviews), theme toggle, quick-add.
**Tertiary**: Breadcrumb inside content area for deep navigation (Library → Discipline → Module → Topic).
**Contextual**: Tool dock slides in from right when studying. Keyboard shortcut `/` opens command palette.

### 2.3 Primary Study Flow

```
Open Study Hub
  → Home: "You have 14 cards due. Continue?" [CTA]
  → Click CTA → Study Session starts (auto-selects due cards)
  → Card 1: Question visible, options hidden
  → Reveal → See correct answer highlighted
  → Rate (Again / Hard / Good / Easy) → FSRS updates interval
  → Optional: Explain, Hint, Mnemonic, Note, Flag
  → Next card...
  → Session End → Summary: 14/14 done, 85% correct, +120 XP
  → Recommendations: "3 weak topics to review" / "Try a quiz on Topic X"
  → Back to Home (streak updated, stats refreshed)
```

---

## 3. DESIGN SYSTEM — "Tinta & Papel" (Ink & Paper)

### 3.1 Aesthetic Direction

**Concept**: Premium academic stationery — the feeling of a beautifully crafted notebook
combined with modern editorial typography. Warm, tactile, and precise.

NOT: purple gradients, generic dashboards, bubbly/toy UI, dark mode by default.

**Mood**: Monocle Magazine × Moleskine × Dieter Rams

### 3.2 Typography

- **Display**: `Fraunces` (weight 600-900) — distinctive optical-size variable font with academic charm
- **Body**: `Outfit` (weight 300-700) — modern geometric sans, excellent readability
- **Mono**: `JetBrains Mono` — for code/data values

### 3.3 Color Tokens (Light)

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#f6f2ec` | Page background (warm cream) |
| `--surface` | `#ffffff` | Cards, panels |
| `--surface-raised` | `#faf8f5` | Elevated surfaces |
| `--border` | `#e5ddd2` | Borders, dividers |
| `--border-strong` | `#c9bfb0` | Emphasized borders |
| `--text-1` | `#1a1a1a` | Primary text (ink) |
| `--text-2` | `#5c5c5c` | Secondary text |
| `--text-3` | `#9a9a9a` | Tertiary/muted |
| `--accent` | `#c17832` | Primary accent (warm copper) |
| `--accent-hover` | `#a86428` | Accent hover |
| `--accent-subtle` | `#fdf3e7` | Accent background |
| `--success` | `#2d7a4f` | Correct, mastered, positive |
| `--success-subtle` | `#e8f5ee` | Success background |
| `--warning` | `#d4a03c` | Caution, due soon |
| `--warning-subtle` | `#fef8e8` | Warning background |
| `--danger` | `#c44536` | Wrong, overdue, destructive |
| `--danger-subtle` | `#fdf0ee` | Danger background |
| `--info` | `#4a7fb5` | Informational |
| `--info-subtle` | `#edf4fb` | Info background |

### 3.4 Color Tokens (Dark)

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#12151c` | Deep midnight |
| `--surface` | `#1a1e28` | Cards |
| `--surface-raised` | `#222836` | Elevated |
| `--border` | `#2e3446` | Borders |
| `--text-1` | `#e5ddd2` | Primary (warm white) |
| `--text-2` | `#9a9690` | Secondary |
| `--accent` | `#e09050` | Warmer copper |

### 3.5 Spacing Scale

```
--space-1: 4px    --space-2: 8px    --space-3: 12px
--space-4: 16px   --space-5: 20px   --space-6: 24px
--space-8: 32px   --space-10: 40px  --space-12: 48px
--space-16: 64px  --space-20: 80px
```

### 3.6 Border Radius

```
--radius-sm: 6px   --radius-md: 10px   --radius-lg: 16px
--radius-xl: 24px  --radius-full: 9999px
```

### 3.7 Shadow Scale

```
--shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
--shadow-md: 0 4px 12px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04);
--shadow-lg: 0 12px 40px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04);
--shadow-xl: 0 24px 64px rgba(0,0,0,0.12);
```

### 3.8 Z-Index Scale

```
--z-base: 0     --z-dropdown: 100   --z-sticky: 200
--z-drawer: 300 --z-modal: 400      --z-toast: 500
--z-tooltip: 600
```

---

## 4. COMPONENT SPECIFICATIONS

### 4.1 Layout Components
- **AppShell**: Sidebar + Topbar + Content wrapper. Sidebar collapsible (icon-only on mobile).
- **Sidebar**: Fixed left, 260px expanded / 64px collapsed. Nav items with icons + labels + badge counts.
- **Topbar**: Sticky top. Logo/menu toggle, search (Ctrl+K), notifications, theme toggle.
- **ContentArea**: Scrollable main, max-width 1200px centered, responsive padding.
- **Breadcrumb**: Path segments with chevrons. Clickable ancestors, current segment bold.

### 4.2 Data Display
- **DisciplineCard**: Title, progress ring, card count, due count, last studied, status badge.
- **StudyCard**: Question text, options (A-E), reveal button, rating buttons, action toolbar.
- **StatWidget**: Icon, label, value, optional trend arrow (+/-%).
- **ProgressRing**: SVG ring, %, center text. Sizes: sm(32), md(48), lg(64).
- **Heatmap**: 12-week activity grid. Intensity levels 0-4. Day labels.
- **InsightCard**: Type icon, title, description, CTA button.

### 4.3 Interactive
- **SearchBar**: Input with icon, keyboard shortcut hint, dropdown results.
- **CommandPalette**: Full-screen overlay (⌘K), fuzzy search all actions/navigation.
- **FilterChips**: Multi-select horizontal scroll. Active state filled.
- **SegmentedControl**: View toggle (cards/list/board). Smooth indicator slide.
- **RatingButtons**: 4-button group (Again/Hard/Good/Easy) with FSRS-colored feedback.
- **ToolDock**: Right-side slide-in panel. AI tools contextually shown during study.

### 4.4 Feedback
- **Toast**: Bottom-right stacked. Types: info, success, warning, error. Auto-dismiss 4s.
- **EmptyState**: Center-aligned illustration/icon, heading, description, CTA.
- **Skeleton**: Pulsing placeholder shapes matching component layout.
- **Badge**: Small count/status pill. Variants: default, accent, success, danger.

---

## 5. TOOL ORGANIZATION MATRIX

| Tool | Category | Context | Trigger |
|---|---|---|---|
| Card Reveal + Rating | Study | During active session | Always visible |
| AI Explanation | Study → AI | After reveal, wrong answer | Card action button |
| Socratic Hint | Study → AI | Before reveal (struggling) | Card action button |
| Mnemonic Generator | Study → AI | After reveal | Card action button |
| Why Wrong Analysis | Study → AI | After wrong answer rated | Card action button |
| Chat de Dúvida | Study → AI | During/after card | Card action → drawer |
| Notes per Card | Study | During card review | Card action button |
| Voice/TTS | Study | Any card | Card action button |
| Flashcard 3D Flip | Practice | Flashcard mode | Mode selector |
| Quiz (AI MCQ) | Practice | Practice section | Section CTA |
| Simulado (Mock Exam) | Practice | Practice section | Section CTA |
| Pomodoro Timer | Productivity | Any session | Topbar button |
| Mind Map | Visualization | Library/insights | Library toolbar |
| Study Plan Generator | Planning | Planning section | Section CTA |
| Learning Paths | Planning | Planning section | Section CTA |
| Spaced Repetition Queue | Review | Review section | Auto-populated |
| Review Forecast | Review | Review section | Sub-tab |
| Activity Heatmap | Insights | Insights section | Always visible |
| Analytics Dashboard | Insights | Insights section | Always visible |
| Badges/Achievements | Insights | Insights section | Sub-tab |
| Export (JSON/CSV/Anki) | Data | Settings or Insights | Action button |
| Import/Backup | Data | Settings | Action button |
| Global Search | Navigation | Always | Ctrl+K / topbar |
| Add Question | Data Entry | Library or Study | FAB / topbar |

---

## 6. INTEGRATION NOTES (Data & Integration Agent)

### Services to Import (ES Module)

```javascript
// Core data
import { ContentHierarchyService } from '../services/ContentHierarchyService.js';
import { MigrationService } from '../services/MigrationService.js';
import { SearchIndexService } from '../services/SearchIndexService.js';

// Study engine
import { FSRSService } from '../services/FSRSService.js';

// AI features
import { ApiService } from '../services/ApiService.js';
import { PedagogicalPromptsService } from '../services/PedagogicalPromptsService.js';
import { FlashcardGeneratorService } from '../services/FlashcardGeneratorService.js';
import { RecommendationService } from '../services/RecommendationService.js';

// Planning
import { StudyPlanService } from '../services/StudyPlanService.js';
import { LearningPathService } from '../services/LearningPathService.js';

// Analytics & Gamification
import { AnalyticsService } from '../services/AnalyticsService.js';
import { BadgeService } from '../services/BadgeService.js';
import { NotesService } from '../services/NotesService.js';
import { ExportService } from '../services/ExportService.js';
```

### Storage Keys Used

| Key | Service | Read/Write |
|---|---|---|
| `binderStructure` | StorageModel (v1 compat) | Read |
| `ah_hierarchy` | ContentHierarchyService | R/W |
| `ah_sm2Data` | Local (FSRS state) | R/W |
| `ah_xpData` | Local (XP/streaks) | R/W |
| `ah_badges` | BadgeService | R/W |
| `ah_notes` | NotesService | R/W |
| `ah_analytics` | AnalyticsService | R/W |
| `ah_study_plans` | StudyPlanService | R/W |
| `ah_learning_paths` | LearningPathService | R/W |
| `settings` | SettingsModel (sync) | Read |
| `ah_theme` | Local | R/W |

---

## 7. QA CHECKLIST

- [ ] All views responsive (320px → 2560px)
- [ ] Keyboard navigation: Tab through all interactive elements
- [ ] Focus visible on all interactive elements (2px accent ring)
- [ ] Color contrast minimum 4.5:1 (normal text), 3:1 (large text)
- [ ] Screens work with 0 data (empty states)
- [ ] Loading states for all async operations (skeletons)
- [ ] Error states for failed operations (toast + inline)
- [ ] Dark mode complete coverage (no white flashes)
- [ ] Reduced motion respected (prefers-reduced-motion)
- [ ] Touch targets minimum 44×44px on mobile
- [ ] No horizontal scroll on any viewport
- [ ] Chrome extension: no external dependencies for rendering
- [ ] Page load < 200ms (measured)
- [ ] Memory: no listeners accumulating on view switch
