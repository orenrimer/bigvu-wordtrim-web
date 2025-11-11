# WORDTRIM - Word-Based Video Editor (Phase 1)

## Project Overview
Wordtrim is a **word-based video editing interface** that allows users to trim videos by selecting and manipulating individual words from the video transcription. The interface provides fine-grained control over video segments through word selection and timeline manipulation.

Before starting development, download the **BIGVU app (Android/iOS)** and try the **Wordtrim** feature. The implementation must follow the same logic and UX as the existing app.

---

## Timeline & Phases
### Phase 1 (2 weeks): Edit Segment and UI
- Word selection interface
- Video preview with playback controls
- Timeline with handles for fine-tuning
- Segment actions (Remove, Keep Only, Restore, Unselect)
- Tutorial modal and help system
- Undo/Redo functionality

### Phase 2: Remove Gaps, Fix Start/End Logic
- Automatic gap removal between segments
- Start/end trimming optimization
- (Details provided after Phase 1 completion)

---

## Technical Stack
- **Framework:** Angular 17 (standalone components)
- **State Management:** Angular Signals or RxJS Services (choose appropriately)
- **Backend:** Not required (mock data only)
- **Integration:** To be integrated with existing frontend infrastructure after completion

---

## Design Resources
- **Figma Design:** [Main Design](https://www.figma.com/design/dMLIy2VaCLGZ5SY02qDY9A/Wordtrim---do-not-delete?node-id=1-4877)

---

## Data Sources & Structure

### Segmentation JSON Example
`https://assets.bigvu.tv/storyVideos/.../segmentation_en-US.json`

```json
[
  {
    "start": 4.08,
    "end": 7.44,
    "confidence": 0,
    "words": [
      { "start": 4.08, "end": 4.72, "confidence": 0.955, "word": "Hello," },
      { "start": 4.72, "end": 4.88, "confidence": 0.999, "word": "and" }
    ],
    "text": "Hello, and welcome back to yet another exciting video."
  }
]
```

#### Processing Requirements
1. Load segmentation from URL.
2. Flatten structure into a single array of words.
3. Preserve timing (`start`, `end` per word).
4. Support all languages (no assumptions about English).

### Video Source Example
`https://assets.bigvu.tv/storyVideos/.../video.m3u8`

---

## Component Architecture
Create **standalone Angular 17 components**:
1. `ButtonComponent` – Reusable button (multiple states/variants)
2. `WordChipComponent` – Individual word display with selection states
3. `VideoPlayerComponent` – Custom player with preview controls
4. `TimelineComponent` – Word timeline with draggable handles
5. `ActionBarComponent` – Remove / Keep Only / Restore / Unselect
6. `TutorialModalComponent` – Onboarding tip + tutorial video
7. `MainEditorContainer` – Orchestrator of all components

> *Do not implement the top navigation bar — existing components will handle it.*

---

## Core Features & Requirements

### 1. Loading State
- Show skeleton loader on the word area while loading.
- Fetch segmentation JSON from URL.
- Flatten and render all words (default = non-deleted).

### 2. Word States
Each word can be in one of:
- **Normal** – default
- **Selected (Start)** – start of current selection
- **Selected (End)** – end of current selection
- **Selected (Range)** – between start & end
- **Deleted** – removed from output

Match all visuals to Figma.

### 3. Word Selection Logic
#### Initial Selection
1. First click → start point.
2. Display start handle on timeline.
3. Second click → end point.
4. Display end handle.
5. All words between start–end inclusive become selected.

#### Selection Modes
- Deleted words can be selected (for restoration).
- Selection always moves forward in time.
- Clicking a word before the start → it becomes new start.

#### Resetting Selection
- Clicking any word after full selection → clears current selection, sets new start.
- Does **not** affect deleted/restored states.

#### Selection with Deleted Words
- Can select across deleted words.
- If selection includes deleted words → Restore button visible.
- Deleted words remain visually distinct.

### 4. Timeline Handles & Fine-Tuning
- When words selected, show draggable **Start** and **End** handles.
- Sub-word precision (no snapping to word boundaries).
- If dragged halfway into a word → that word exits selection.
- Visual timeline highlights the current editable segment.
- Video updates only when drag ends.
- Handles can cross deleted words.

### 5. Video Preview & Playback
#### Aspect Ratio Support
Auto-detect and adapt:
- 16:9 – landscape
- 1:1 – square
- 9:16 – portrait

#### Preview on Word Click
- Plays 3 seconds from clicked word’s start time.
- If it’s an end word → play 3 seconds **before**.

#### Preview of Selected Segment
- Plays from fine-tuned start to end (handle positions).

#### Video Playback
- **Always skips deleted segments for seamless playback.**
- No distinction between "full" and "edited" modes.
- Single Play button that automatically jumps over deleted words.

### 6. Segment Actions
#### Remove This Segment
- Mark words in selection as deleted.
- Disabled if all selected already deleted.
- Clears selection afterward.

#### Keep Only This Segment
- Marks all words outside selection as deleted.
- Keeps only selected.
- Clears selection afterward.

#### Restore
- Restores deleted words within selection only.
- Button visible only if selection contains deleted words.
- Clears selection afterward.

#### Unselect
- Clears selection (start/end) only.
- Does not affect deleted state.

### 7. Tutorial System
#### Editing Tip Modal
- Appears on initial load.
- Disappears on:
  - User clicks “X”, or
  - Clicks “Show Me How”, or
  - Clicks first word.

#### Tutorial Video
- “Show Me How” opens video tutorial modal.
- Embedded video (URL provided later).

### 8. Undo/Redo System
Track all actions that affect output:
- Selection/unselection
- Handle drag adjustments
- Remove / Keep Only / Restore

Maintain **history stack**:
- Undo → previous state
- Redo → reapply undone state
- Clear redo stack on new action.

### 9. Save & Output
**Format:**
```json
[
  { "start": 4.08, "end": 7.44 },
  { "start": 15.20, "end": 25.80 }
]
```
**Rules:**
- Include only non-deleted segments.
- Use fine-tuned handle positions.
- Sorted chronologically.
- No gaps.
- Output to `console.log` for now.

---

## Edge Cases & Special Scenarios
### Scenario 1: Fine-Tuning Across Words
- Select words 1–10, drag end to middle of word 7 → selection updates to 1–6.

### Scenario 2: Selecting Deleted Words
- Deleted words 20–30 can still be reselected (for restore).

### Scenario 3: Keep Only on Deleted Selection
- Selecting 15–25 (includes deleted 15–20) and clicking Keep Only restores 15–20.

### Scenario 4: Empty Output
- Deleting all words → show error (illegal state).

---

## Development Guidelines
### Best Practices
1. Component communication via services.
2. Reactive programming (RxJS).
3. Type-safe interfaces.
4. Optimize for large transcripts.
5. Accessibility (keyboard navigation, screen readers).
6. i18n (RTL, CJK, etc.).

### Testing Considerations
- Multiple languages.
- Short (<30s) and long (>10min) videos.
- Hundreds of words.
- All edge cases.
- Complex undo/redo chains.

---

## Definition of Done (Phase 1)
Phase 1 is complete when:
- All standalone Angular 17 components are implemented.
- Segmentation loads from URL with skeleton.
- Word selection logic works.
- Timeline handles fine-tune accurately.
- All four segment actions function.
- Video preview adapts to aspect ratios.
- 3s preview on word click.
- Playback always skips deleted segments seamlessly.
- Tutorial modal functions properly.
- Undo/Redo works on all actions.
- Save outputs correct array.
- All edge cases handled.
- Code follows Angular style guide.
- Works with multiple languages.

---