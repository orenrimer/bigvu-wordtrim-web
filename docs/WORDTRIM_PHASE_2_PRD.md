# WORDTRIM — PRD (Phase 1 Reference + Full Phase 2 Specification)

## Document Overview

**Note:** Phase 1 PRD exists as a separate file.
- Reference path: `docs/WORDTRIM_PRD.md`

This document contains the full Phase 2 specification, written for development automation via Cursor AI.

---

## Phase 2 — Gap Removal & Timing Optimization

### Overview

Phase 2 extends the Wordtrim editor with a full gap-editing workflow:

- Detect silent gaps between words
- Let the user review, remove, or keep gaps
- Apply strict timing rules with no padding
- Generate accurate segmentation output
- Maintain smooth performance for playback + editing

**Important:** This logic sits on top of the Phase 1 word-selection and deletion features.

---

## 1. Gap Detection & Review

### 1.1 Gap Detection Logic

Gap detection runs on the flattened array of remaining words after Phase 1 edits.

#### Formula

```
GapDuration = NextWord.start - PreviousWord.end
```

#### Rules

- A gap is valid if: `GapDuration >= threshold`
- **Threshold range:** 0.1s – 1.0s
- **Default threshold:** 0.1s
- Only gaps between visible words count

### 1.2 Gap Visualization (Brackets UI)

Each gap appears between words like:

```
(0.4s)
```

#### UI Requirements

- **Precision:** one decimal digit
- Each bracket is clickable
- **States:**
  - **Active (Remove)** — gap marked for removal
  - **Ignored (Keep)** — gap will be preserved
  - **Selected (focused)** — currently focused gap

### 1.3 Gap Review Mode — Workflow

#### Activation

- User clicks **"Remove Gaps"** in the Action Bar
- → Enters **Gap Review Mode**

#### Behavior

- All gaps ≥ threshold → marked **Active (Remove)** initially
- User may toggle any individual gap
- **Changing threshold:**
  - Recalculates all gaps
  - Resets manual selections

#### Playback

- Playback should skip only gaps marked for removal

#### Completion

**Apply:**
- Commit removal
- Recompute final segmentation

**Cancel:**
- Discard all temporary changes

---

## 2. Strict Start / End Timing

After gap removal:

- `start = firstWord.start`
- `end = lastWord.end`

**No padding added at all** (no +0.05s, −0.10s, etc.)

Timing must match word boundaries exactly.

---

## 3. Output Format (JSON)

Final output is a list of segments:

```json
[
  { "start": X, "end": Y }
]
```

### Rules

- Removed gaps split output into multiple segments
- Segments must be:
  - **Ordered** — sequential by start time
  - **Non-overlapping** — no time conflicts
  - **Duration > 0** — valid time range

### Example

**Words:** `A B |(gap removed)| C D`

**Output:**

```json
[
  { "start": A.start, "end": B.end },
  { "start": C.start, "end": D.end }
]
```

---

## 4. Edge Cases

- **Very low thresholds → many gaps**
  - UI + performance must stay smooth
- **Words removed in Phase 1 must not form gaps**
- **If all gaps are removed → may form a single segment**
- **Gap removal cannot affect areas outside the "Kept Only" range**

---

## 5. Performance Requirements

### Threshold Slider

- Recalculation must use a **300ms debounce**

### Gap Detection

- Should be memoized based on:
  - Word list
  - Threshold

### DOM Updates

- Batch DOM updates to avoid layout thrashing

### Playback Skipping

- Must be **frame-synced** (use `requestAnimationFrame`)
- Must be **accurate**
- Must be **free of audible artifacts**

---

## 6. Definition of Done

Phase 2 is complete when:

- ✅ Gap detection accurate and stable
- ✅ Bracket UI matches Figma design
- ✅ Playback skipping is smooth
- ✅ Threshold + toggling work as described
- ✅ Apply produces correct final JSON segmentation
- ✅ Performance remains smooth even with 300+ gaps

### Unit Tests Required

- Gap detection
- Segmentation recomputation

---

## Related Documents

- **Phase 1 PRD:** `docs/WORDTRIM_PRD.md`
- **Phase 2 Tasks:** `docs/TASKS_PHASE_2.md`
- **Design Guide:** `docs/DESIGN_GUIDE.md`
