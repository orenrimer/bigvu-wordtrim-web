import { Component, OnInit, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SegmentationLoaderService } from '../../services/segmentation-loader.service';
import { EditorStateService } from '../../services/editor-state.service';
import { VideoPlayerService } from '../../services/video-player.service';
import { TimelineService } from '../../services/timeline.service';
import { TutorialService } from '../../services/tutorial.service';
import { HistoryService } from '../../services/history.service';
import { VideoDataService } from '../../services/video-data.service';
import { SkeletonLoaderComponent } from '../skeleton-loader/skeleton-loader.component';
import { WordChipComponent } from '../word-chip/word-chip.component';
import { ActionBarComponent } from '../action-bar/action-bar.component';
import { VideoPlayerComponent } from '../video-player/video-player.component';
import { TimelineComponent } from '../timeline/timeline.component';
import { TutorialModalComponent } from '../tutorial-modal/tutorial-modal.component';
import { Word } from '../../models';

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
  // Expose video data service signals to template
  videoDataLoadingState = this.videoDataService.loadingState;
  videoDataError = this.videoDataService.error;
  videoMetadata = this.videoDataService.metadata;

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
  isLoadingVideoData = computed(() => this.videoDataLoadingState() === 'loading');
  hasVideoDataError = computed(() => this.videoDataLoadingState() === 'error');
  isLoading = computed(() => this.loadingState() === 'loading');
  hasError = computed(() => this.loadingState() === 'error');
  hasWords = computed(() => this.words().length > 0);
  isVideoDataReady = computed(() => this.videoDataLoadingState() === 'success' && this.videoMetadata() !== null);

  // Check if error is due to empty segmentation data (don't show error card for this case)
  isEmptySegmentationError = computed(() => {
    const errorMsg = this.error();
    if (!errorMsg) return false;
    return errorMsg.includes('empty') || errorMsg.includes('no words found') || errorMsg.includes('no valid words');
  });

  // Dynamic timestamps based on words and video duration
  timestamps = computed(() => {
    const wordsList = this.words();
    if (!wordsList || wordsList.length === 0) {
      return [];
    }

    // Find first and last word
    const firstWord = wordsList[0];
    const lastWord = wordsList[wordsList.length - 1];
    const firstTime = firstWord.start;
    const lastTime = lastWord.start;

    // Calculate content duration (from first word to last word)
    const contentDuration = lastTime - firstTime;

    // Calculate number of timestamps based on duration
    // Target: one timestamp every 10 seconds
    const targetInterval = 10; // seconds between timestamps
    const timestampCount = Math.max(2, Math.ceil(contentDuration / targetInterval)); // At least 2 (first and last)

    // If we have fewer words than timestamps, use all words
    if (wordsList.length <= timestampCount) {
      return wordsList.map(word => word.start);
    }

    // Calculate evenly distributed times between first and last
    const timestamps: number[] = [];
    timestamps.push(firstTime); // First timestamp is first word

    // Calculate intermediate timestamps
    for (let i = 1; i < timestampCount - 1; i++) {
      const ratio = i / (timestampCount - 1);
      const targetTime = firstTime + (lastTime - firstTime) * ratio;

      // Find the word with start time closest to targetTime
      let closestWord = wordsList[0];
      let minDiff = Math.abs(closestWord.start - targetTime);

      for (const word of wordsList) {
        const diff = Math.abs(word.start - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestWord = word;
        }
      }

      timestamps.push(closestWord.start);
    }

    timestamps.push(lastTime); // Last timestamp is last word

    // Remove duplicates and sort
    const uniqueTimestamps = Array.from(new Set(timestamps)).sort((a, b) => a - b);

    return uniqueTimestamps;
  });

  /**
   * Format timestamp in MM:SS format
   */
  formatTimestamp(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} s`;
  }

  // Expose video player service error signal
  videoPlayerError = this.videoService.error;

  hasVideoPlayerError = computed(() => {
    const error = this.videoPlayerError();
    // Only show error if there's an explicit error message
    return error !== null && error.trim() !== '';
  });

  // Get error message
  videoPlayerErrorMessage = computed(() => {
    const error = this.videoPlayerError();
    return error || 'Failed to load video';
  });

  constructor(
    private videoDataService: VideoDataService,
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

    // Effect: Pause video player when tutorial video modal opens
    effect(() => {
      const modalState = this.tutorialService.modalState();
      const isPlaying = this.videoService.isPlaying();

      // If tutorial video modal is opened and video is playing, pause it
      if (modalState === 'video' && isPlaying) {
        this.videoService.pause();
      }
    });
  }

  ngOnInit(): void {
    // STEP 1: Load video metadata JSON first (FEATURE 11)
    this.loadVideoMetadata();

    // Auto-show tutorial tip on initial load (Feature 7)
    this.tutorialService.autoShowOnInit();
  }

  /**
   * Load video metadata JSON file
   * After successful load, proceed to load video and segmentation
   */
  loadVideoMetadata(): void {
    this.videoDataService.loadVideoMetadata().subscribe({
      next: (metadata) => {
        // Video metadata loaded successfully
        // Now load segmentation and initialize video player
        this.loadSegmentation(metadata.segmentationUrl);
        // Video player will be initialized by VideoPlayerComponent after view init
        // We'll pass the hlsPlaylistUrl through a service or signal
      },
      error: () => {
        // Error handling is done by the service
      }
    });
  }

  /**
   * Load segmentation data from URL (from JSON metadata)
   * @param segmentationUrl URL from video metadata JSON
   */
  loadSegmentation(segmentationUrl: string): void {
    this.segmentationService.loadSegmentation(segmentationUrl).subscribe({
      next: () => {
        // Initialize editor state with loaded words
        const loadedWords = this.segmentationService.words();

        // Check if words array is empty
        if (!loadedWords || loadedWords.length === 0) {
          // Don't initialize editor state with empty array - this will cause issues
          // The error state is already set in the service
          return;
        }

        this.editorState.initializeWords(loadedWords);

        // STEP 1: Save initial empty state (after words are loaded)
        // This state is stored separately and will be pushed to undo stack when first action occurs
        const initialSnapshot = this.editorState.captureState(
          this.timelineService.startHandle(),
          this.timelineService.endHandle()
        );
        this.historyService.setInitialState(initialSnapshot);
      },
      error: () => {
        // Error handling is done by the service
      }
    });
  }

  /**
   * Retry loading video metadata and segmentation after error
   */
  retryLoad(): void {
    this.videoDataService.reset();
    this.segmentationService.reset();
    this.editorState.reset();
    this.loadVideoMetadata();
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
      // STEP 2: Save previous state (initial empty state) BEFORE selecting first word
      // The pushState method will automatically push the initial state to undo stack if needed
      const previousSnapshot = this.editorState.captureState(
        this.timelineService.startHandle(),
        this.timelineService.endHandle()
      );
      this.historyService.pushState(previousSnapshot);

      this.editorState.selectWord(word);
      // Current state (w_1, null) is NOT saved - it's the current viewing state

      // Play 3 seconds forward from start
      this.videoService.playWordPreview(word.start, false);
      return;
    }

    // Scenario 2A: Has start, no end - clicked SAME word (toggle to end)
    if (currentStart && !currentEnd && word.index === currentStart.index) {
      // Save previous state (w_1, null) BEFORE selecting end
      const previousSnapshot = this.editorState.captureState(
        this.timelineService.startHandle(),
        this.timelineService.endHandle()
      );
      this.historyService.pushState(previousSnapshot);

      this.editorState.selectWord(word); // This will make it both start and end
      // Current state (w_1, w_1) is NOT saved - it's the current viewing state

      // Play 3 seconds backward ending at word end
      this.videoService.playWordPreview(word.start, true, word.end);
      return;
    }

    // Scenario 2B: Has start, no end - clicked DIFFERENT word (becomes end)
    if (currentStart && !currentEnd && word.index > currentStart.index) {
      // STEP 3: Save previous state (w_1, null) BEFORE selecting end word
      const previousSnapshot = this.editorState.captureState(
        this.timelineService.startHandle(),
        this.timelineService.endHandle()
      );
      this.historyService.pushState(previousSnapshot);

      this.editorState.selectWord(word);
      // Current state (w_1, w_2) is NOT saved - it's the current viewing state

      // Play 3 seconds backward ending at word end
      this.videoService.playWordPreview(word.start, true, word.end);
      return;
    }

    // Scenario 3A: Complete selection with SAME word (start === end), clicking again
    if (currentStart && currentEnd &&
      currentStart.index === currentEnd.index &&
      word.index === currentStart.index) {
      // Save previous state (w_1, w_1) BEFORE resetting
      const previousSnapshot = this.editorState.captureState(
        this.timelineService.startHandle(),
        this.timelineService.endHandle()
      );
      this.historyService.pushState(previousSnapshot);

      // Reset to just start (toggle back)
      this.editorState.clearSelection();
      this.editorState.selectWord(word);
      // Current state (w_1, null) is NOT saved - it's the current viewing state
      // Play 3 seconds forward from start
      this.videoService.playWordPreview(word.start, false);
      return;
    }

    // Scenario 3B: Complete selection with DIFFERENT words, clicking on the END word
    if (currentStart && currentEnd && word.index === currentEnd.index) {
      // Save previous state (w_1, w_2) BEFORE resetting
      const previousSnapshot = this.editorState.captureState(
        this.timelineService.startHandle(),
        this.timelineService.endHandle()
      );
      this.historyService.pushState(previousSnapshot);

      // Reset selection and make end word the new start
      this.editorState.clearSelection();
      this.editorState.selectWord(word);
      // Current state (w_2, null) is NOT saved - it's the current viewing state
      // Play 3 seconds forward from new start
      this.videoService.playWordPreview(word.start, false);
      return;
    }

    // All other cases: Complete selection, clicking on different word → reset and start new selection
    // This includes clicking on a word outside the selection
    if (currentStart && currentEnd) {
      // Save previous state (w_1, w_2) BEFORE resetting
      const previousSnapshot = this.editorState.captureState(
        this.timelineService.startHandle(),
        this.timelineService.endHandle()
      );
      this.historyService.pushState(previousSnapshot);
    }

    this.editorState.selectWord(word);
    // Current state (w_new, null) is NOT saved - it's the current viewing state

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

  // Removed captureState() - now we explicitly capture and push state before actions

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
    this.editorState.restoreState(snapshot);

    // IMPORTANT: Restore handles from snapshot to preserve fine-tuning positions
    // The snapshot contains the exact handle positions (with sub-word precision)
    // that were set when the state was captured. We need to restore these exact positions,
    // not just rely on the timeline effect which would snap handles to word boundaries.
    this.timelineService.restoreHandles(snapshot.startHandle, snapshot.endHandle);
  }
}