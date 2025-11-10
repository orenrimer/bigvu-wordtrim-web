# WORDTRIM - Development Tasks (Phase 1)

## Project Setup & Configuration

**Goal:** Initialize Angular 17 standalone project with required dependencies and folder structure

- [ ] 0.1: Initialize Angular 17 standalone project using Angular CLI
- [ ] 0.2: Install dependencies (RxJS, Angular Signals, HLS.js for video streaming)
- [ ] 0.3: Configure project structure (components, services, models, assets folders)
- [ ] 0.4: Create TypeScript interfaces for segmentation data structure (Word, Segment)
- [ ] 0.5: Set up environment configuration files for mock data URLs
- [ ] 0.6: Configure Angular standalone component patterns
- [ ] 0.7: Set up basic routing and main container structure
- [ ] 0.8: Create initial git commit
- [ ] 0.9: Create new Git branch for the first phase — `git checkout -b phase-1`

---

## FEATURE 1: Loading State & Segmentation Loader

### Git Branch Setup
- [ ] **feature1-git-1:** Create new Git branch for this feature — `git checkout -b feature/segmentation-loader`

### Service Tasks
- [ ] 1.1: Create `SegmentationLoaderService` using RxJS for HTTP requests
- [ ] 1.2: Implement method to fetch segmentation JSON from provided URL
- [ ] 1.3: Implement data flattening logic to convert nested segments into flat word array
- [ ] 1.4: Preserve timing information (start, end, confidence) for each word
- [ ] 1.5: Create Signal-based state for loading status (loading, success, error)
- [ ] 1.6: Handle error states and retry logic for failed requests

### Component Tasks
- [ ] 1.7: Create `SkeletonLoaderComponent` for word area loading state
- [ ] 1.8: Match skeleton design to Figma specifications
- [ ] 1.9: Implement loading state display in word display area

### UI/Logic Integration
- [ ] 1.10: Connect `SegmentationLoaderService` to main editor container
- [ ] 1.11: Display skeleton loader while fetching data
- [ ] 1.12: Render word array after successful load
- [ ] 1.13: Handle multi-language support (no English-specific assumptions)

### Testing Tasks
- [ ] 1.14: Test segmentation loading with sample URLs
- [ ] 1.15: Test flattening logic with nested segment structures
- [ ] 1.16: Verify loading states (skeleton → loaded → error)
- [ ] 1.17: Test with different languages and RTL content

### Git Branch Merge
- [ ] **feature1-git-2:** Merge feature branch into main — `git checkout main && git merge feature/segmentation-loader`

---

## FEATURE 2: Core Components Setup

### Git Branch Setup
- [ ] **feature2-git-1:** Create new Git branch for this feature — `git checkout -b feature/core-components`

### Component Tasks
- [ ] 2.1: Create `ButtonComponent` as standalone component with variants (primary, secondary, disabled)
- [ ] 2.2: Implement button states and styling matching Figma design
- [ ] 2.3: Create `WordChipComponent` as standalone component
- [ ] 2.4: Implement word chip display with text and timing data
- [ ] 2.5: Create `ActionBarComponent` for segment actions container
- [ ] 2.6: Create `MainEditorContainer` as orchestrator component

### UI/Logic Integration
- [ ] 2.7: Set up component communication architecture via services
- [ ] 2.8: Configure input/output properties for components
- [ ] 2.9: Implement proper component lifecycle hooks

### Testing Tasks
- [ ] 2.10: Unit test button component variants and states
- [ ] 2.11: Unit test word chip rendering with various text lengths
- [ ] 2.12: Verify component communication patterns

### Git Branch Merge
- [ ] **feature2-git-2:** Merge feature branch into main — `git checkout main && git merge feature/core-components`

---

## FEATURE 3: Word Selection Logic

### Git Branch Setup
- [ ] **feature3-git-1:** Create new Git branch for this feature — `git checkout -b feature/word-selection`

### Service Tasks
- [ ] 3.1: Create `EditorStateService` using Angular Signals for selection state management
- [ ] 3.2: Implement Signal for current selection (startWord, endWord, selectedWords array)
- [ ] 3.3: Implement Signal for deleted words state
- [ ] 3.4: Create selection update logic (first click = start, second click = end)
- [ ] 3.5: Implement selection range calculation (all words between start and end inclusive)
- [ ] 3.6: Handle selection reset logic (clicking after full selection clears and starts new)
- [ ] 3.7: Implement selection validation (always moves forward in time)
- [ ] 3.8: Handle selection with deleted words (can select across deleted words)
- [ ] 3.9: Implement logic for clicking word before start (becomes new start)

### Component Tasks
- [ ] 3.10: Update `WordChipComponent` to display word states (Normal, Selected Start, Selected End, Selected Range, Deleted)
- [ ] 3.11: Implement click handler in `WordChipComponent`
- [ ] 3.12: Style word states matching Figma (colors, borders, backgrounds)
- [ ] 3.13: Display visual indicators for selection start and end words

### UI/Logic Integration
- [ ] 3.14: Connect word chips to `EditorStateService` selection signals
- [ ] 3.15: Update UI reactively when selection changes
- [ ] 3.16: Implement proper hover states for word chips
- [ ] 3.17: Handle selection across deleted words with proper visual feedback

### Testing Tasks
- [ ] 3.18: Test initial selection (first click → start, second click → end)
- [ ] 3.19: Test selection reset behavior
- [ ] 3.20: Test selection with deleted words
- [ ] 3.21: Test clicking before start point
- [ ] 3.22: Test selection range calculation accuracy
- [ ] 3.23: Verify forward-in-time selection constraint

### Git Branch Merge
- [ ] **feature3-git-2:** Merge feature branch into main — `git checkout main && git merge feature/word-selection`

---

## FEATURE 4: Video Player & Preview Logic

### Git Branch Setup
- [ ] **feature4-git-1:** Create new Git branch for this feature — `git checkout -b feature/video-player`

### Service Tasks
- [ ] 4.1: Create `VideoPlayerService` with HLS.js integration
- [ ] 4.2: Implement video loading from m3u8 URL
- [ ] 4.3: Create Signal for player state (playing, paused, currentTime, duration)
- [ ] 4.4: Implement aspect ratio detection logic (16:9, 1:1, 9:16)
- [ ] 4.5: Create methods for preview playback (3-second preview from word click)
- [ ] 4.6: Implement preview logic for end words (3 seconds before)
- [ ] 4.7: Create method for full video playback
- [ ] 4.8: Implement edited video playback (skip deleted segments seamlessly)
- [ ] 4.9: Create method for selected segment playback

### Component Tasks
- [ ] 4.10: Create `VideoPlayerComponent` as standalone component
- [ ] 4.11: Implement video element with HLS.js player
- [ ] 4.12: Create responsive container that adapts to aspect ratios
- [ ] 4.13: Implement playback controls UI (play, pause, progress bar)
- [ ] 4.14: Add time display (current time / total duration)
- [ ] 4.15: Style player controls matching Figma design

### UI/Logic Integration
- [ ] 4.16: Connect video player to word click events (3s preview)
- [ ] 4.17: Implement preview playback on word selection
- [ ] 4.18: Connect player to segment selection for preview functionality
- [ ] 4.19: Handle video seek operations based on timing data
- [ ] 4.20: Implement seamless playback skipping deleted segments
- [ ] 4.21: Auto-detect and apply correct aspect ratio styling

### Testing Tasks
- [ ] 4.22: Test video loading with sample m3u8 URLs
- [ ] 4.23: Test aspect ratio detection and responsive layout
- [ ] 4.24: Test 3-second preview on word click (start and end words)
- [ ] 4.25: Test full video playback
- [ ] 4.26: Test edited playback (verify deleted segments are skipped)
- [ ] 4.27: Test segment preview playback

### Git Branch Merge
- [ ] **feature4-git-2:** Merge feature branch into main — `git checkout main && git merge feature/video-player`

---

## FEATURE 5: Timeline Component & Handles

### Git Branch Setup
- [ ] **feature5-git-1:** Create new Git branch for this feature — `git checkout -b feature/timeline-handles`

### Service Tasks
- [ ] 5.1: Create `TimelineService` for timeline state management using Signals
- [ ] 5.2: Implement Signal for handle positions (start handle, end handle)
- [ ] 5.3: Create method to calculate handle positions from word selection
- [ ] 5.4: Implement fine-tuning logic (sub-word precision)
- [ ] 5.5: Create method to update selection based on handle drag
- [ ] 5.6: Implement logic to exit words from selection when handle drags across them
- [ ] 5.7: Handle timeline interactions across deleted words
- [x] 5.8: Implement debounce for smoother user experience handle usage

### Component Tasks
- [ ] 5.9: Create `TimelineComponent` as standalone component
- [ ] 5.10: Implement word timeline visualization
- [ ] 5.11: Create draggable start handle element
- [ ] 5.12: Create draggable end handle element
- [ ] 5.13: Implement visual highlighting for selected segment on timeline
- [ ] 5.14: Style timeline matching Figma specifications
- [ ] 5.15: Display deleted word segments with distinct styling

### UI/Logic Integration
- [ ] 5.16: Connect timeline to `EditorStateService` selection signals
- [ ] 5.17: Implement drag-and-drop handlers for start and end handles
- [ ] 5.18: Update video preview only when drag ends (not during drag)
- [ ] 5.19: Calculate and update word selection based on handle positions
- [ ] 5.20: Implement sub-word precision (halfway into word = word exits selection)
- [ ] 5.21: Handle timeline interactions with deleted words
- [ ] 5.22: Sync timeline handles with word selection changes

### Testing Tasks
- [ ] 5.23: Test handle display when selection is made
- [ ] 5.24: Test handle drag functionality (smooth dragging)
- [ ] 5.25: Test fine-tuning precision (sub-word level)
- [ ] 5.26: Test word exit from selection when handle crosses midpoint
- [ ] 5.28: Test handle drag across deleted words
- [ ] 5.28: Verify video update only on drag end

### Git Branch Merge
- [ ] **feature5-git-2:** Merge feature branch into main — `git checkout main && git merge feature/timeline-handles`

---

## FEATURE 6: Segment Actions

### Git Branch Setup
- [ ] **feature6-git-1:** Create new Git branch for this feature — `git checkout -b feature/segment-actions`

### Service Tasks
- [ ] 6.1: Extend `EditorStateService` with segment action methods
- [ ] 6.2: Implement `removeSegment()` method (mark selected words as deleted)
- [ ] 6.3: Implement `keepOnlySegment()` method (mark all non-selected as deleted)
- [ ] 6.4: Implement `restoreSegment()` method (restore deleted words in selection)
- [ ] 6.5: Implement `unselectSegment()` method (clear selection without affecting deleted state)
- [ ] 6.6: Add validation logic (disable Remove if all selected already deleted)
- [ ] 6.7: Implement auto-clear selection after each action
- [ ] 6.8: Create Signal for action button states (enabled/disabled/visible)

### Component Tasks
- [ ] 6.9: Update `ActionBarComponent` with four action buttons
- [ ] 6.10: Create "Remove This Segment" button with proper styling
- [ ] 6.11: Create "Keep Only This Segment" button with proper styling
- [ ] 6.12: Create "Restore" button (conditionally visible)
- [ ] 6.13: Create "Unselect" button with proper styling
- [ ] 6.14: Implement button disabled states based on current selection
- [ ] 6.15: Match action bar design to Figma specifications

### UI/Logic Integration
- [ ] 6.16: Connect action buttons to `EditorStateService` methods
- [ ] 6.17: Show Restore button only when selection contains deleted words
- [ ] 6.18: Disable Remove button when all selected words are already deleted
- [ ] 6.19: Clear selection after each segment action
- [ ] 6.20: Update word chip display after actions
- [ ] 6.21: Update timeline display after actions

### Testing Tasks
- [ ] 6.22: Test Remove This Segment action
- [ ] 6.23: Test Keep Only This Segment action
- [ ] 6.24: Test Restore action with deleted words
- [ ] 6.25: Test Unselect action
- [ ] 6.26: Test edge case: Keep Only on selection with deleted words (should restore those words)
- [ ] 6.27: Verify button states (enabled/disabled/visible) update correctly
- [ ] 6.28: Test selection clearing after each action

### Git Branch Merge
- [ ] **feature6-git-2:** Merge feature branch into main — `git checkout main && git merge feature/segment-actions`

---

## FEATURE 7: Tutorial Modal & Help System

### Git Branch Setup
- [ ] **feature7-git-1:** Create new Git branch for this feature — `git checkout -b feature/tutorial-system`

### Service Tasks
- [ ] 7.1: Create `TutorialService` for tutorial state management
- [ ] 7.2: Implement Signal for tutorial modal visibility
- [ ] 7.3: Implement Signal for tutorial video modal visibility
- [ ] 7.4: Create methods to show/hide modals
- [ ] 7.5: Implement logic to auto-show editing tip on initial load
- [ ] 7.6: Create method to dismiss tip on first word click

### Component Tasks
- [ ] 7.7: Create `TutorialModalComponent` for editing tip modal
- [ ] 7.8: Implement modal content with tip text
- [ ] 7.9: Add close button (X) to tip modal
- [ ] 7.10: Add "Show Me How" button to tip modal
- [ ] 7.11: Create `TutorialVideoModalComponent` for video tutorial
- [ ] 7.12: Implement video embed in tutorial video modal
- [ ] 7.13: Style modals matching Figma specifications
- [ ] 7.14: Implement modal backdrop and overlay

### UI/Logic Integration
- [ ] 7.15: Show editing tip modal on initial page load
- [ ] 7.16: Dismiss tip modal on X button click
- [ ] 7.17: Open tutorial video modal on "Show Me How" click
- [ ] 7.18: Dismiss tip modal on first word click
- [ ] 7.19: Connect tutorial video URL (to be provided)
- [ ] 7.20: Implement proper modal z-index and layering

### Testing Tasks
- [ ] 7.21: Test tip modal appears on initial load
- [ ] 7.22: Test tip modal closes on X button
- [ ] 7.23: Test tutorial video modal opens on "Show Me How"
- [ ] 7.24: Test tip modal dismisses on first word click
- [ ] 7.25: Verify modal persistence logic (doesn't reappear)

### Git Branch Merge
- [ ] **feature7-git-2:** Merge feature branch into main — `git checkout main && git merge feature/tutorial-system`

---

## FEATURE 8: Undo/Redo System

### Git Branch Setup
- [ ] **feature8-git-1:** Create new Git branch for this feature — `git checkout -b feature/undo-redo`

### Service Tasks
- [ ] 8.1: Create `HistoryService` for undo/redo state management
- [ ] 8.2: Implement history stack (array of editor states)
- [ ] 8.3: Implement redo stack (array of undone states)
- [ ] 8.4: Create method to capture current editor state snapshot
- [ ] 8.5: Implement `undo()` method (restore previous state, push current to redo)
- [ ] 8.6: Implement `redo()` method (restore next state, push current to undo)
- [ ] 8.7: Create method to push new state to history (clear redo stack)
- [ ] 8.8: Implement Signals for undo/redo button states (can undo, can redo)
- [ ] 8.9: Track actions: selection changes, handle adjustments, remove, keep only, restore

### Component Tasks
- [ ] 8.10: Add undo button to main editor container
- [ ] 8.11: Add redo button to main editor container
- [ ] 8.12: Style undo/redo buttons matching Figma
- [ ] 8.13: Implement disabled states for undo/redo buttons

### UI/Logic Integration
- [ ] 8.14: Connect undo/redo buttons to `HistoryService` methods
- [ ] 8.15: Capture state snapshot after selection changes
- [ ] 8.16: Capture state snapshot after handle adjustments
- [ ] 8.17: Capture state snapshot after segment actions
- [ ] 8.18: Update UI when undo/redo is performed
- [ ] 8.19: Disable buttons when stacks are empty
- [ ] 8.20: Clear redo stack on new action

### Testing Tasks
- [ ] 8.21: Test undo after word selection
- [ ] 8.22: Test undo after handle adjustment
- [ ] 8.23: Test undo after Remove action
- [ ] 8.24: Test undo after Keep Only action
- [ ] 8.25: Test undo after Restore action
- [ ] 8.26: Test redo functionality
- [ ] 8.27: Test complex undo/redo chains (multiple actions)
- [ ] 8.28: Verify redo stack clears on new action
- [ ] 8.29: Test button states (enabled/disabled) update correctly

### Git Branch Merge
- [ ] **feature8-git-2:** Merge feature branch into main — `git checkout main && git merge feature/undo-redo`

---

## FEATURE 9: Save & Output Generation

### Git Branch Setup
- [ ] **feature9-git-1:** Create new Git branch for this feature — `git checkout -b feature/save-output`

### Service Tasks
- [ ] 9.1: Create `OutputGeneratorService` for output creation
- [ ] 9.2: Implement method to collect all non-deleted segments
- [ ] 9.3: Apply fine-tuned handle positions to segment boundaries
- [ ] 9.4: Sort segments chronologically by start time
- [ ] 9.5: Validate output (ensure no gaps, proper time ordering)
- [ ] 9.6: Implement error handling for empty output (all words deleted)
- [ ] 9.7: Format output as array of {start, end} objects

### Component Tasks
- [ ] 9.8: Create Save button in main editor container
- [ ] 9.9: Style Save button matching Figma specifications
- [ ] 9.10: Implement save confirmation feedback

### UI/Logic Integration
- [ ] 9.11: Connect Save button to `OutputGeneratorService`
- [ ] 9.12: Generate output on Save click
- [ ] 9.13: Output to console.log for Phase 1
- [ ] 9.14: Show error message if output is empty (all words deleted)
- [ ] 9.15: Display success feedback after save

### Testing Tasks
- [ ] 9.16: Test output generation with normal selection
- [ ] 9.17: Test output with fine-tuned handle positions
- [ ] 9.18: Test output chronological ordering
- [ ] 9.19: Test empty output validation (all deleted)
- [ ] 9.20: Test output format matches specification
- [ ] 9.21: Verify console.log displays correct JSON structure

### Git Branch Merge
- [ ] **feature9-git-2:** Merge feature branch into main — `git checkout main && git merge feature/save-output`

---

## Edge Cases & Quality Assurance

### Git Branch Setup
- [ ] **qa-git-1:** Create new Git branch for this feature — `git checkout -b qa/edge-cases-testing`

### Edge Case Testing
- [ ] 10.1: Test Scenario 1 - Fine-tuning across words (select 1-10, drag end to middle of 7, verify selection updates to 1-6)
- [ ] 10.2: Test Scenario 2 - Selecting deleted words (verify deleted words 20-30 can be reselected)
- [ ] 10.3: Test Scenario 3 - Keep Only on deleted selection (verify 15-25 with deleted 15-20 restores on Keep Only)
- [ ] 10.4: Test Scenario 4 - Empty output error (delete all words, verify error shown)
- [ ] 10.5: Test with short videos (<30 seconds)
- [ ] 10.6: Test with long videos (>10 minutes)
- [ ] 10.7: Test with hundreds of words (large transcripts)
- [ ] 10.8: Test performance with large datasets

### Multi-Language Testing
- [ ] 10.9: Test with English content
- [ ] 10.10: Test with RTL languages (Arabic, Hebrew)
- [ ] 10.11: Test with CJK languages (Chinese, Japanese, Korean)
- [ ] 10.12: Test with languages containing special characters
- [ ] 10.13: Verify i18n compliance and accessibility

### Accessibility Testing
- [ ] 10.14: Implement keyboard navigation for word selection
- [ ] 10.15: Add ARIA labels to interactive elements
- [ ] 10.16: Test screen reader compatibility
- [ ] 10.17: Ensure proper focus management
- [ ] 10.18: Test keyboard shortcuts for undo/redo

### Performance Optimization
- [ ] 10.19: Optimize rendering for large word arrays
- [ ] 10.20: Implement virtual scrolling if needed for long transcripts
- [ ] 10.21: Optimize video player performance
- [ ] 10.22: Test memory usage and cleanup

### Git Branch Merge
- [ ] **qa-git-2:** Merge feature branch into main — `git checkout main && git merge qa/edge-cases-testing`

---

## Code Quality & Documentation

### Git Branch Setup
- [ ] **docs-git-1:** Create new Git branch for this feature — `git checkout -b docs/code-quality`

### Code Quality Tasks
- [ ] 11.1: Review all components for Angular style guide compliance
- [ ] 11.2: Ensure proper TypeScript typing throughout
- [ ] 11.3: Add JSDoc comments to services and complex methods
- [ ] 11.4: Implement proper error handling in all services
- [ ] 11.5: Optimize RxJS subscriptions (unsubscribe, takeUntil patterns)
- [ ] 11.6: Review and optimize Signal usage
- [ ] 11.7: Ensure proper component lifecycle management

### Documentation Tasks
- [ ] 11.8: Document component interfaces and inputs/outputs
- [ ] 11.9: Document service APIs and method signatures
- [ ] 11.10: Create inline comments for complex logic
- [ ] 11.11: Document state management patterns
- [ ] 11.12: Create README with setup instructions

### Git Branch Merge
- [ ] **docs-git-2:** Merge feature branch into main — `git checkout main && git merge docs/code-quality`

---

## Deployment & Integration Preparation

**Goal:** Prepare application for integration with existing BIGVU frontend infrastructure

- [ ] 12.1: Create environment configuration for production
- [ ] 12.2: Configure build settings for deployment
- [ ] 12.3: Create environment variables for data URLs (segmentation, video)
- [ ] 12.4: Test build process and output
- [ ] 12.5: Verify all assets are properly bundled
- [ ] 12.6: Test with production-like data URLs
- [ ] 12.7: Create deployment checklist
- [ ] 12.8: Document integration points with existing infrastructure
- [ ] 12.9: Final cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] 12.10: Final responsive testing across devices
- [ ] 12.11: Create final git tag for Phase 1 release

---

## Definition of Done Checklist

**Phase 1 is complete when all of the following are verified:**

- [ ] All standalone Angular 17 components implemented (`ButtonComponent`, `WordChipComponent`, `VideoPlayerComponent`, `TimelineComponent`, `ActionBarComponent`, `TutorialModalComponent`, `MainEditorContainer`)
- [ ] Segmentation loads from URL with skeleton loader
- [ ] Word selection logic works (first click → start, second click → end, reset on third)
- [ ] Timeline handles fine-tune accurately with sub-word precision
- [ ] All four segment actions function properly (Remove, Keep Only, Restore, Unselect)
- [ ] Video preview adapts to all aspect ratios (16:9, 1:1, 9:16)
- [ ] 3-second preview on word click works correctly
- [ ] Full playback skips deleted segments seamlessly
- [ ] Tutorial modal functions properly (auto-show on load, dismisses correctly)
- [ ] Undo/Redo works on all actions with proper state management
- [ ] Save outputs correct JSON array format to console
- [ ] All edge cases handled and tested
- [ ] Code follows Angular style guide and best practices
- [ ] Works with multiple languages (LTR and RTL)
- [ ] Accessibility requirements met (keyboard navigation, screen readers)
- [ ] Performance optimized for large transcripts

