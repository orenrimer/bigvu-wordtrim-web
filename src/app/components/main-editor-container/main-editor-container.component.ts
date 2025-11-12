import { Component, OnInit, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SegmentationLoaderService } from '../../services/segmentation-loader.service';
import { EditorStateService } from '../../services/editor-state.service';
import { VideoPlayerService } from '../../services/video-player.service';
import { TimelineService } from '../../services/timeline.service';
import { TutorialService } from '../../services/tutorial.service';
import { HistoryService } from '../../services/history.service';
import { SkeletonLoaderComponent } from '../skeleton-loader/skeleton-loader.component';
import { WordChipComponent } from '../word-chip/word-chip.component';
import { ActionBarComponent } from '../action-bar/action-bar.component';
import { VideoPlayerComponent } from '../video-player/video-player.component';
import { TimelineComponent } from '../timeline/timeline.component';
import { TutorialModalComponent } from '../tutorial-modal/tutorial-modal.component';
import { Word } from '../../models';
import { environment } from '../../../environments/environment.development';

/**
 * Main Editor Container Component
 * Orchestrator component that manages all child components for the Wordtrim editor
 * Based on PRD: Component Architecture - MainEditorContainer
 * 
 * This component will coordinate:
 * - Video player
 * - Word chips display
 * - Timeline with handles
 * - Action bar (Remove, Keep Only, Restore, Unselect)
 * - Tutorial modal
 * - Undo/Redo functionality
 */
@Component({
  selector: 'app-main-editor-container',
  standalone: true,
  imports: [CommonModule, SkeletonLoaderComponent, WordChipComponent, ActionBarComponent, VideoPlayerComponent, TimelineComponent, TutorialModalComponent],
  templateUrl: './main-editor-container.component.html',
  styleUrl: './main-editor-container.component.scss'
})
export class MainEditorContainerComponent implements OnInit {
  // Expose segmentation service signals to template
  loadingState = this.segmentationService.loadingState;
  error = this.segmentationService.error;

  // Expose editor state signals to template
  words = this.editorState.words;
  selectionStart = this.editorState.selectionStart;
  selectionEnd = this.editorState.selectionEnd;
  selectedWords = this.editorState.selectedWords;
  hasSelection = this.editorState.hasSelection;
  hasCompleteSelection = this.editorState.hasCompleteSelection;
  currentPlaybackWordIndex = this.editorState.currentPlaybackWordIndex;

  // Computed signals for template conditionals
  isLoading = computed(() => this.loadingState() === 'loading');
  hasError = computed(() => this.loadingState() === 'error');
  hasWords = computed(() => this.words().length > 0);

  constructor(
    private segmentationService: SegmentationLoaderService,
    private editorState: EditorStateService,
    private videoService: VideoPlayerService,
    public timelineService: TimelineService,
    private tutorialService: TutorialService,
    private historyService: HistoryService
  ) {
    // Effect: Sync current playback word with video time
    // Always highlight current word during playback
    effect(() => {
      const currentTime = this.videoService.currentTime();
      const isPlaying = this.videoService.isPlaying();

      if (isPlaying) {
        // Always update current playback word during video playback
        this.editorState.updateCurrentPlaybackWord(currentTime);
      } else {
        // Clear current playback word when video is paused/stopped
        this.editorState.clearCurrentPlaybackWord();
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    // Load segmentation data from environment URL on component initialization
    this.loadSegmentation();

    // Auto-show tutorial tip on initial load (Feature 7)
    this.tutorialService.autoShowOnInit();
  }

  /**
   * Load segmentation data from configured URL
   */
  loadSegmentation(): void {
    this.segmentationService.loadSegmentation(environment.segmentationUrl).subscribe({
      next: () => {
        // Initialize editor state with loaded words
        const loadedWords = this.segmentationService.words();
        this.editorState.initializeWords(loadedWords);

        console.info('Segmentation loaded successfully', {
          wordCount: this.words().length
        });
      },
      error: (err: Error) => {
        console.error('Failed to load segmentation', err);
      }
    });
  }

  /**
   * Retry loading segmentation after error
   */
  retryLoad(): void {
    this.segmentationService.reset();
    this.editorState.reset();
    this.loadSegmentation();
  }

  /**
   * Handle word click event
   * Delegates to EditorStateService for selection logic
   * Also triggers 3-second video preview based on PRD
   * Also dismisses tutorial tip on first word click (Feature 7)
   * Also captures state for undo/redo when complete selection is made (Feature 8)
   */
  onWordClick(word: Word): void {
    // Notify tutorial service of word click (dismisses tip on first click)
    this.tutorialService.onWordClick();

    const currentStart = this.selectionStart();
    const currentEnd = this.selectionEnd();
    const hadCompleteSelection = currentStart && currentEnd;

    // Scenario 1: No selection - clicked word becomes start
    if (!currentStart) {
      // Capture state BEFORE selecting (empty selection state) for undo (Feature 8)
      this.captureState();

      this.editorState.selectWord(word);

      // Capture state AFTER selecting start word (start-only state) for incremental undo (Feature 8)
      // This allows undo to go: complete → start-only → empty
      // The timeline effect will set handles automatically when selection changes
      // We capture state here - handles will be captured as they are set by the effect
      this.captureState();

      // Play 3 seconds forward from start
      this.videoService.playWordPreview(word.start, false);
      return;
    }

    // Scenario 2A: Has start, no end - clicked SAME word (toggle to end)
    if (currentStart && !currentEnd && word.index === currentStart.index) {
      this.editorState.selectWord(word); // This will make it both start and end

      // Capture state after complete selection (Feature 8)
      this.captureState();

      // Play 3 seconds backward ending at word end with smart margin
      const wordDuration = word.end - word.start;
      this.videoService.playWordPreview(word.start, true, wordDuration);
      return;
    }

    // Scenario 2B: Has start, no end - clicked DIFFERENT word (becomes end)
    if (currentStart && !currentEnd && word.index > currentStart.index) {
      this.editorState.selectWord(word);

      // Capture state after complete selection (Feature 8)
      this.captureState();

      // Play 3 seconds backward ending at word end with smart margin
      const wordDuration = word.end - word.start;
      this.videoService.playWordPreview(word.start, true, wordDuration);
      return;
    }

    // Scenario 3A: Complete selection with SAME word (start === end), clicking again
    if (currentStart && currentEnd &&
      currentStart.index === currentEnd.index &&
      word.index === currentStart.index) {
      // Capture full selection state BEFORE resetting (Feature 8)
      this.captureState();

      // Reset to just start (toggle back)
      this.editorState.clearSelection();
      this.editorState.selectWord(word);
      // Play 3 seconds forward from start
      this.videoService.playWordPreview(word.start, false);
      return;
    }

    // Scenario 3B: Complete selection with DIFFERENT words, clicking on the END word
    if (currentStart && currentEnd && word.index === currentEnd.index) {
      // Capture full selection state BEFORE resetting (Feature 8)
      this.captureState();

      // Reset selection and make end word the new start
      this.editorState.clearSelection();
      this.editorState.selectWord(word);
      // Play 3 seconds forward from new start
      this.videoService.playWordPreview(word.start, false);
      return;
    }

    // All other cases: Complete selection, clicking on different word → reset and start new selection
    // This includes clicking on a word outside the selection
    const hadCompleteSelectionBefore = currentStart && currentEnd;

    if (hadCompleteSelectionBefore) {
      // Capture full selection state BEFORE resetting (Feature 8)
      this.captureState();
    }

    this.editorState.selectWord(word);

    // Capture new start-only state after resetting (for incremental undo)
    // Only if we had a complete selection before (so undo can go: new_start → full_selection)
    if (hadCompleteSelectionBefore) {
      this.captureState();
    }

    this.videoService.playWordPreview(word.start, false);
  }

  /**
   * Clear current selection
   * Used by action bar buttons in Feature 6
   */
  clearSelection(): void {
    this.editorState.clearSelection();
  }

  // ========== Feature 8: Undo/Redo Functionality ==========

  /**
   * Capture current editor state snapshot
   * Called after trackable actions (selection changes, handle adjustments, segment actions)
   */
  captureState(): void {
    const snapshot = this.editorState.captureState(
      this.timelineService.startHandle(),
      this.timelineService.endHandle()
    );
    this.historyService.pushState(snapshot);
  }

  /**
   * Perform undo operation
   * Restores previous editor state
   */
  undo(): void {
    const currentSnapshot = this.editorState.captureState(
      this.timelineService.startHandle(),
      this.timelineService.endHandle()
    );
    const previousState = this.historyService.undo(currentSnapshot);

    if (previousState) {
      this.restoreState(previousState);
    }
  }

  /**
   * Perform redo operation
   * Reapplies undone state
   */
  redo(): void {
    const currentSnapshot = this.editorState.captureState(
      this.timelineService.startHandle(),
      this.timelineService.endHandle()
    );
    const nextState = this.historyService.redo(currentSnapshot);

    if (nextState) {
      this.restoreState(nextState);
    }
  }

  /**
   * Restore editor state from snapshot
   * Updates both EditorStateService and TimelineService
   */
  private restoreState(snapshot: any): void {
    // Restore editor state (words and selection)
    // This will trigger the timeline effect to update handles automatically
    this.editorState.restoreState(snapshot);

    // Note: Timeline handles are updated automatically by the timeline effect
    // when selection signals change. We don't need to manually restore handles
    // because the effect will set them correctly based on the restored selection.
    // For start-only state: selectionStart exists, selectionEnd is null → effect sets start handle only
    // For complete state: both exist → effect sets both handles
    // For empty state: both null → effect clears handles
  }
}