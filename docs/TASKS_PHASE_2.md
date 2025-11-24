# WORDTRIM - Development Tasks (Phase 2)

## Project Setup & Configuration

**Goal:** Continue development on Phase 2 features after Phase 1 completion

- [ ] **phase2-git-1:** Create new Git branch for Phase 2 — `git checkout -b phase-2`

---

## FEATURE 13: Fix Start/End Logic & Optimization

### Git Branch Setup
- [ ] **feature13-git-1:** Create new Git branch for this feature — `git checkout -b feature/fix-start-end`

### Service Tasks
- [ ] 13.1: Implement improved start trimming algorithm
- [ ] 13.2: Implement improved end trimming algorithm
- [ ] 13.3: Ensure trimming preserves video quality and smooth transitions
- [ ] 13.4: Update `editor-state.service.ts` with optimized trimming logic

### Component Tasks
- [ ] 13.6: Add 'Preview Start / End' button to `action-bar.component.ts` and `action-bar.component.html`
- [ ] 13.7: On button click, displaying seconds until first word and seconds until last word respectively
- [ ] 13.8: On button click, change action-bar content according to Figma design
- [ ] 13.9: Implement functionality for buttons in preview mode action bar
- [ ] 13.10: Make word-chips-container unclickable during preview mode to prevent accidental selection changes
- [ ] 13.11: Show tip modal when opening preview mode, using the existing `tutorial-modal.component.ts` and following the Figma design

### UI/Logic Integration
- [ ] 13.12: Implement preview start/end functionality
- [ ] 13.13: Integrate optimized trimming into output generation
- [ ] 13.14: Ensure trimming works with gap removal feature
- [ ] 13.15: Seprate trimming logic with undo/redo system

### Testing Tasks
- [ ] 13.16: Test preview start/end button functionality and word-chips display
- [ ] 13.17: Test start trimming with various segment configurations
- [ ] 13.18: Test end trimming with various segment configurations
- [ ] 13.19: Verify trimming doesn't affect video quality
- [ ] 13.20: Test trimming with gap removal feature
- [ ] 13.21: Verify output format is correct after trimming optimization

### Git Branch Merge
- [ ] **feature13-git-2:** Merge feature branch into phase-2 — `git checkout phase-2 && git merge feature/fix-start-end`

---

## FEATURE 14: Gap Detection & Removal

### Git Branch Setup
- [ ] **feature14-git-1:** Create new Git branch for this feature — `git checkout -b feature/remove-gaps`

### Service Tasks - Gap Detection
- [ ] 14.1: Create `gap-detection.service.ts` to handle gap detection logic
- [ ] 14.2: Implement gap detection formula: `GapDuration = NextWord.start - PreviousWord.end`
- [ ] 14.3: Implement gap validation logic (gap is valid if `GapDuration >= threshold`)
- [ ] 14.4: Add configurable threshold range (0.1s – 1.0s) with default 0.1s
- [ ] 14.5: Ensure gap detection only runs on visible words (after Phase 1 edits)
- [ ] 14.6: Implement memoization for gap detection based on word list and threshold
- [ ] 14.7: Create gap state management (Active/Remove, Ignored/Keep, Selected)

### Service Tasks - Gap Removal & Output
- [ ] 14.8: Implement gap removal algorithm that splits output into multiple segments
- [ ] 14.9: Implement strict start/end timing: `start = firstWord.start`, `end = lastWord.end` (no padding)
- [ ] 14.10: Update `OutputGeneratorService` to generate JSON segments format: `[{ "start": X, "end": Y }]`
- [ ] 14.11: Ensure output segments are ordered, non-overlapping, and duration > 0
- [ ] 14.12: Handle edge case: if all gaps removed → form single segment
- [ ] 14.13: Ensure gap removal doesn't affect areas outside "Kept Only" range
- [ ] 14.14: Integrate gap removal with undo/redo system

### Component Tasks - Gap Visualization (Brackets UI)
- [ ] 14.15: Create gap bracket component to display gaps between words: `(0.4s)`
- [ ] 14.16: Implement gap bracket with one decimal digit precision
- [ ] 14.17: Make each bracket clickable to toggle gap state
- [ ] 14.18: Implement three bracket states: Active (Remove), Ignored (Keep), Selected (focused)
- [ ] 14.19: Style bracket UI according to Figma design
- [ ] 14.20: Integrate brackets into word-chips-container component

### Component Tasks - Gap Review Mode
- [ ] 14.21: Add "Remove Gaps" button to `action-bar.component.ts` and `action-bar.component.html`
- [ ] 14.22: Implement Gap Review Mode activation on button click
- [ ] 14.23: On activation, mark all gaps ≥ threshold as Active (Remove) initially
- [ ] 14.24: Add threshold slider component with range 0.1s – 1.0s
- [ ] 14.25: Implement 300ms debounce for threshold slider recalculation
- [ ] 14.26: On threshold change, recalculate all gaps and reset manual selections
- [ ] 14.27: Update action bar content when entering Gap Review Mode
- [ ] 14.28: Add Apply button to commit gap removal and recompute segmentation
- [ ] 14.29: Add Cancel button to discard temporary changes
- [ ] 14.30: Make word-chips-container unclickable during Gap Review Mode

### Component Tasks - Playback Integration
- [ ] 14.31: Implement playback skipping for gaps marked for removal
- [ ] 14.32: Use `requestAnimationFrame` for frame-synced playback skipping
- [ ] 14.33: Ensure playback skipping is accurate and free of audible artifacts
- [ ] 14.34: Update video player to handle gap skipping during Gap Review Mode

### UI/Logic Integration
- [ ] 14.35: Integrate gap detection service with editor state service
- [ ] 14.36: Batch DOM updates to avoid layout thrashing when displaying gaps
- [ ] 14.37: Ensure gap removal works with Phase 1 word deletion features
- [ ] 14.38: Handle edge case: words removed in Phase 1 must not form gaps
- [ ] 14.39: Ensure performance remains smooth with 300+ gaps

### Testing Tasks - Gap Detection
- [ ] 14.40: Test gap detection with various threshold values (0.1s – 1.0s)
- [ ] 14.41: Test gap detection with different word configurations
- [ ] 14.42: Verify gap detection only counts visible words
- [ ] 14.43: Test gap detection memoization performance

### Testing Tasks - Gap Review Mode
- [ ] 14.44: Test Gap Review Mode activation and deactivation
- [ ] 14.45: Test threshold slider with debounce functionality
- [ ] 14.46: Test gap toggle functionality (Active ↔ Ignored)
- [ ] 14.47: Test Apply button commits removal and recomputes segmentation
- [ ] 14.48: Test Cancel button discards temporary changes
- [ ] 14.49: Verify word-chips-container is unclickable during Gap Review Mode

### Testing Tasks - Gap Removal & Output
- [ ] 14.50: Test gap removal with various gap sizes
- [ ] 14.51: Test gap removal with multiple consecutive gaps
- [ ] 14.52: Test gap removal at video start/end
- [ ] 14.53: Test edge case: all gaps removed → single segment
- [ ] 14.54: Verify output format matches JSON specification: `[{ "start": X, "end": Y }]`
- [ ] 14.55: Verify output segments are ordered, non-overlapping, duration > 0
- [ ] 14.56: Test gap removal doesn't affect areas outside "Kept Only" range

### Testing Tasks - Playback & Performance
- [ ] 14.57: Test playback skipping is smooth and accurate
- [ ] 14.58: Verify playback skipping has no audible artifacts
- [ ] 14.59: Test performance with 300+ gaps (UI must stay smooth)
- [ ] 14.60: Test gap removal with undo/redo operations
- [ ] 14.61: Test gap removal integration with Phase 1 features

### Git Branch Merge
- [ ] **feature14-git-2:** Merge feature branch into phase-2 — `git checkout phase-2 && git merge feature/remove-gaps`

---

## Integration & Testing

### Integration Tasks
- [ ] 15.1: Integrate gap removal with start/end trimming optimization
- [ ] 15.2: Ensure all Phase 2 features work together seamlessly
- [ ] 15.3: Update output generation to include all Phase 2 optimizations
- [ ] 15.4: Verify backward compatibility with Phase 1 features

### End-to-End Testing
- [ ] 15.5: Test complete workflow with gap removal and trimming
- [ ] 15.6: Test with various video lengths and segment configurations
- [ ] 15.7: Test edge cases (single segment, all segments deleted, etc.)
- [ ] 15.8: Verify output format matches requirements
- [ ] 15.9: Test performance with large videos and many segments
- [ ] 15.10: Test with multiple languages and RTL content

### Documentation
- [ ] 15.11: Update technical documentation with Phase 2 features
- [ ] 15.12: Document gap removal algorithm and thresholds
- [ ] 15.13: Document start/end trimming optimization approach
- [ ] 15.14: Update user-facing documentation if applicable

---

## Definition of Done (Phase 2)

Phase 2 is complete when:
- [ ] Gap removal between segments works automatically
- [ ] Start/end trimming optimization is implemented and tested
- [ ] All Phase 2 features integrate seamlessly with Phase 1 features
- [ ] Output format is correct and optimized
- [ ] All edge cases are handled
- [ ] Performance is acceptable with large videos
- [ ] Code follows Angular style guide
- [ ] All tests pass
- [ ] Documentation is updated

