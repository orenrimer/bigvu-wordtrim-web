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
- [ ] 13.3: Optimize trimming to remove unnecessary frames at segment boundaries
- [ ] 13.4: Ensure trimming preserves video quality and smooth transitions
- [ ] 13.5: Update `editor-state.service.ts` with optimized trimming logic

### Component Tasks
- [ ] 13.6: Add 'Preview Start / End' button to `action-bar.component.ts` and `action-bar.component.html`
- [ ] 13.7: On button click, displaying seconds until first word and seconds until last word respectively
- [ ] 13.8: On button click, change action-bar content according to Figma design
- [ ] 13.9: Implement functionality for buttons in preview mode action bar
- [ ] 13.10: Make word-chips-container unclickable during preview mode to prevent accidental selection changes
- [ ] 13.11: Show tip modal when opening preview mode, using the existing `tutorial-modal.component.ts` and following the Figma design

### UI/Logic Integration
- [ ] 13.11: Implement preview start/end functionality
- [ ] 13.12: Integrate optimized trimming into output generation
- [ ] 13.13: Ensure trimming works with gap removal feature
- [ ] 13.14: Update output format with optimized start/end times
- [ ] 13.15: Handle trimming with undo/redo system

### Testing Tasks
- [ ] 13.16: Test preview start/end button functionality and word-chips display
- [ ] 13.17: Test start trimming with various segment configurations
- [ ] 13.18: Test end trimming with various segment configurations
- [ ] 13.19: Verify trimming doesn't affect video quality
- [ ] 13.20: Test trimming with gap removal feature
- [ ] 13.21: Test trimming with undo/redo operations
- [ ] 13.22: Verify output format is correct after trimming optimization

### Git Branch Merge
- [ ] **feature13-git-2:** Merge feature branch into phase-2 — `git checkout phase-2 && git merge feature/fix-start-end`

---

## FEATURE 14: Remove Gaps Between Segments

### Git Branch Setup
- [ ] **feature14-git-1:** Create new Git branch for this feature — `git checkout -b feature/remove-gaps`

### Service Tasks
- [ ] 14.1: Analyze output segments to identify gaps between consecutive segments
- [ ] 14.2: Implement gap detection logic (find time differences between segment end and next segment start)
- [ ] 14.3: Create method to merge segments that are close together (within threshold)
- [ ] 14.4: Implement automatic gap removal algorithm
- [ ] 14.5: Handle edge cases (gaps at start/end, multiple consecutive gaps)
- [ ] 14.6: Preserve fine-tuned handle positions when merging segments
- [ ] 14.7: Update `OutputGeneratorService` to apply gap removal before final output

### Component Tasks
- [ ] 14.8: Add UI indicator for gap removal (optional: show gaps before removal)
- [ ] 14.9: Update action bar to show gap removal status (if applicable)
- [ ] 14.10: Ensure timeline reflects merged segments correctly

### UI/Logic Integration
- [ ] 14.11: Integrate gap removal into output generation flow
- [ ] 14.12: Ensure gap removal works with undo/redo system
- [ ] 14.13: Update output format to reflect merged segments
- [ ] 14.14: Handle gap removal when segments are restored

### Testing Tasks
- [ ] 14.15: Test gap removal with various gap sizes
- [ ] 14.16: Test gap removal with multiple consecutive gaps
- [ ] 14.17: Test gap removal at video start/end
- [ ] 14.18: Verify gap removal preserves fine-tuned handle positions
- [ ] 14.19: Test gap removal with undo/redo operations
- [ ] 14.20: Verify output format is correct after gap removal

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

