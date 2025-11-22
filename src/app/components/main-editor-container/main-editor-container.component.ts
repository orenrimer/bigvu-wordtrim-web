import { Component, OnInit, computed, effect, AfterViewInit, ViewChild, ElementRef, signal } from '@angular/core';
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
import { Word, WordState } from '../../models';

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
export class MainEditorContainerComponent implements OnInit, AfterViewInit {
  // ViewChild reference to words-container for CSS custom property positioning
  @ViewChild('wordsContainer', { static: false }) wordsContainerRef!: ElementRef<HTMLElement>;

  // ViewChild reference to transcript-content for preview tip modal positioning (Feature 13.11)
  @ViewChild('transcriptContent', { static: false }) transcriptContentRef!: ElementRef<HTMLElement>;

  // Track if position calculation is in progress to prevent multiple simultaneous calls
  private isPositionCalculating = false;

  // Feature 13: Preview mode state for start/end trimming
  private readonly _isPreviewMode = signal<boolean>(false);
  public readonly isPreviewMode = this._isPreviewMode.asReadonly();

  // Feature 13.11: Track if preview tip modal has been shown (only show once)
  private hasShownPreviewTip = false;

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

  // Feature 13: Computed signal for words with intro/outro chips in preview mode
  wordsWithIntroOutro = computed(() => {
    const allWords = this.words();
    const isPreview = this.isPreviewMode();

    if (!isPreview || allWords.length === 0) {
      return allWords;
    }

    // Always use the VERY FIRST and VERY LAST words in the video (regardless of deletion status)
    // This ensures intro/outro chips show the actual silence before/after ALL words
    const firstWord = allWords[0];
    const lastWord = allWords[allWords.length - 1];
    const videoDuration = this.videoService.duration() || 0;

    // Calculate intro and outro durations
    // Intro: time from video start (0) until first word starts
    const introDuration = firstWord.start;
    // Outro: time from last word ends until video end
    const outroDuration = videoDuration - lastWord.end;

    // Create intro and outro chips
    const introChip: Word = {
      word: introDuration > 0 ? `(${introDuration.toFixed(1)})` : '(0)',
      start: 0,
      end: firstWord.start,
      confidence: 0,
      state: WordState.NORMAL,
      index: -1 // Special index for intro chip
    };

    const outroChip: Word = {
      word: outroDuration > 0 ? `(${outroDuration.toFixed(1)})` : '(0)',
      start: lastWord.end,
      end: videoDuration,
      confidence: 0,
      state: WordState.NORMAL,
      index: -2 // Special index for outro chip
    };

    // Combine: intro chip + all words + outro chip
    return [introChip, ...allWords, outroChip];
  });

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
    public tutorialService: TutorialService,
    private historyService: HistoryService
  ) {
    // Update words-container position when words are loaded AND auto-show tip modal
    // Combined effect to ensure proper sequencing: position calculation -> tip modal display
    effect(() => {
      const words = this.words();
      const loadingState = this.loadingState();
      const hasError = this.hasError();

      // Only proceed if words are loaded and loading is complete
      if (words.length > 0 && loadingState === 'success') {
        // First, update position
        // Use requestAnimationFrame to ensure DOM is updated after Angular change detection
        requestAnimationFrame(() => {
          this.updateWordsContainerPosition().then((positionSuccess) => {
            // Only show tip modal if:
            // 1. Position was calculated successfully
            // 2. No error occurred
            // 3. User hasn't clicked a word before (first visit)
            if (positionSuccess &&
              !hasError &&
              !this.tutorialService.hasClickedWord()) {
              // Show modal immediately - position is already calculated and set
              this.tutorialService.showTip();
            }
          });
        });
      }
    });
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

    // Effect: Stop video player when tutorial video modal opens
    effect(() => {
      const modalState = this.tutorialService.modalState();

      // If tutorial video modal is opened, stop all video playback and clear preview states
      // This prevents the video from crashing when modal opens with active selection/preview
      if (modalState === 'video') {
        this.videoService.stop();
      }

      // Feature 13.11: Update preview tip modal position when preview tip is shown
      if (modalState === 'preview-tip') {
        this.updatePreviewTipModalPosition();
      }

      // Note: Position is already calculated by the words loading effect above
      // No need to recalculate when tip modal opens - it causes unnecessary jumps
    }, { allowSignalWrites: true });

    // Feature 13.11: Hide preview tip modal when preview mode is closed
    effect(() => {
      const isPreview = this.isPreviewMode();
      const modalState = this.tutorialService.modalState();

      // If preview mode is closed and preview tip modal is showing, hide it
      if (!isPreview && modalState === 'preview-tip') {
        this.tutorialService.hide();
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    // STEP 1: Load video metadata JSON first (FEATURE 11)
    this.loadVideoMetadata();
  }

  ngAfterViewInit(): void {
    // Note: Position calculation is handled by the effect in constructor
    // which waits for words to be loaded. No need to call it here immediately.
    // The effect will handle initial position calculation when words are ready.

    // Update position on window resize
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this.updateWordsContainerPosition();
        // Feature 13.11: Also update preview tip modal position on resize
        if (this.tutorialService.modalState() === 'preview-tip') {
          this.updatePreviewTipModalPosition();
        }
      });
    }
  }

  private updateWordsContainerPosition(): Promise<boolean> {
    // Prevent multiple simultaneous position calculations
    if (this.isPositionCalculating) {
      // Return a promise that resolves when current calculation completes
      return new Promise((resolve) => {
        // Poll until calculation is done
        const checkDone = () => {
          if (!this.isPositionCalculating) {
            resolve(true);
          } else {
            setTimeout(checkDone, 50);
          }
        };
        setTimeout(checkDone, 50);
      });
    }

    this.isPositionCalculating = true;
    return new Promise((resolve) => {
      // Retry mechanism in case ViewChild isn't immediately available
      // Also wait for word chips to be rendered in DOM
      let retryCount = 0;
      const maxRetries = 40; // Max 40 retries (2000ms total) - increased to wait for word chips rendering

      const tryUpdate = () => {
        if (this.wordsContainerRef?.nativeElement) {
          const rect = this.wordsContainerRef.nativeElement.getBoundingClientRect();

          // Only update if element has valid dimensions
          if (rect.width > 0 && rect.height > 0) {
            // Check if word chips are actually rendered
            const wordChips = this.wordsContainerRef.nativeElement.querySelectorAll('app-word-chip');


            // If we have words in the signal but no chips rendered yet, wait a bit more
            if (this.words().length > 0 && wordChips.length === 0 && retryCount < maxRetries - 10) {
              retryCount++;
              setTimeout(tryUpdate, 50);
              return;
            }

            // Calculate position based on first word chip element (not container)
            // This ensures the modal aligns with the actual first word, not the container edge
            const firstWordChip = wordChips.length > 0 ? wordChips[0] as HTMLElement : null;
            if (firstWordChip) {
              // Use single requestAnimationFrame to ensure layout is stable
              requestAnimationFrame(() => {
                const firstChipRect = firstWordChip.getBoundingClientRect();

                // Verify the chip has valid dimensions and is actually visible
                if (firstChipRect.width > 0 && firstChipRect.height > 0 && firstChipRect.left > 0) {
                  // Use first chip's left position for horizontal alignment
                  // This aligns the modal with the first word, not the container edge
                  const leftPosition = firstChipRect.left;
                  document.documentElement.style.setProperty('--words-container-left', `${leftPosition}px`);

                  // Calculate top position based on first word chip element
                  const lineHeight = parseFloat(getComputedStyle(this.wordsContainerRef.nativeElement).lineHeight) ||
                    parseFloat(getComputedStyle(firstWordChip).lineHeight) ||
                    (window.innerWidth <= 768 ? 1.75 * 16 : 2.5 * 16); // fallback based on screen size
                  const spacing = 16; // var(--spacing-4)
                  const topPosition = firstChipRect.top + lineHeight + spacing;
                  document.documentElement.style.setProperty('--words-container-top', `${topPosition}px`);

                  // Set transform to none when using custom property (for responsive breakpoints)
                  document.documentElement.style.setProperty('--words-container-transform', 'none');
                  // Set animation name based on whether we're using custom positioning
                  document.documentElement.style.setProperty('--tip-modal-animation', 'slideInFromBelowNoTransform');

                  // Position successfully updated
                  this.isPositionCalculating = false;
                  resolve(true);
                } else {
                  // Retry if chip dimensions are invalid
                  if (retryCount < maxRetries) {
                    retryCount++;
                    setTimeout(tryUpdate, 50);
                  } else {
                    this.isPositionCalculating = false;
                    resolve(false);
                  }
                }
              });
              return; // Exit early, will resolve in requestAnimationFrame
            } else {
              // Fallback: use container position
              // Only use fallback if we don't have words (empty state)
              if (this.words().length === 0) {
                // Use container position as fallback when no words are available
                document.documentElement.style.setProperty('--words-container-left', `${rect.left}px`);

                const lineHeight = parseFloat(getComputedStyle(this.wordsContainerRef.nativeElement).lineHeight) ||
                  (window.innerWidth <= 768 ? 1.75 * 16 : 2.5 * 16);
                const spacing = 16;
                const topPosition = rect.top + lineHeight + spacing;
                document.documentElement.style.setProperty('--words-container-top', `${topPosition}px`);

                // Set transform to none when using custom property (for responsive breakpoints)
                document.documentElement.style.setProperty('--words-container-transform', 'none');
                // Set animation name based on whether we're using custom positioning
                document.documentElement.style.setProperty('--tip-modal-animation', 'slideInFromBelowNoTransform');


                // Position successfully updated
                this.isPositionCalculating = false;
                resolve(true);
                return;
              } else {
                // We have words but chips aren't rendered yet, retry
                if (retryCount < maxRetries) {
                  retryCount++;
                  setTimeout(tryUpdate, 50);
                  return;
                }
              }
            }
          }
        }

        // Element not ready yet, retry
        if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(tryUpdate, 50);
        } else {
          // If element not found after retries, reset to fallback (centered)
          document.documentElement.style.removeProperty('--words-container-left');
          document.documentElement.style.removeProperty('--words-container-top');
          document.documentElement.style.removeProperty('--words-container-transform');
          this.isPositionCalculating = false;
          resolve(false);
        }
      };
      setTimeout(tryUpdate, 0);
    });
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
   * Toggle preview mode for start/end trimming (Feature 13)
   */
  togglePreviewMode(): void {
    this._isPreviewMode.update(mode => !mode);
    
    // Feature 13.11: Update preview tip modal position when preview mode changes
    if (this.tutorialService.modalState() === 'preview-tip') {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        this.updatePreviewTipModalPosition();
      }, 0);
    }
  }

  /**
   * Handle click on words-container during preview mode (Feature 13.11)
   * Shows tip modal only the first time user clicks on words-container in preview mode
   */
  onWordsContainerClick(event: MouseEvent): void {
    // Only show tip modal if in preview mode, not already shown, and click is not on a word chip
    if (this.isPreviewMode() && !this.hasShownPreviewTip) {
      // Check if click target is the container itself (not a word chip)
      const target = event.target as HTMLElement;
      const isWordChip = target.closest('app-word-chip');
      
      // If click is directly on container (not on word chip), show tip modal
      if (!isWordChip) {
        this.tutorialService.showCustomTip(
          'Validate New Start & End',
          'Before editing your video, you must confirm or discard the new start and end positions'
        );
        this.hasShownPreviewTip = true; // Mark as shown
      }
    }
  }

  /**
   * Update preview tip modal position (Feature 13.11)
   * Centers modal horizontally with transcript-content and aligns bottom
   */
  private updatePreviewTipModalPosition(): void {
    if (!this.transcriptContentRef?.nativeElement) {
      return;
    }

    const transcriptElement = this.transcriptContentRef.nativeElement;
    const rect = transcriptElement.getBoundingClientRect();

    // Calculate center X position of transcript-content
    const centerX = rect.left + rect.width / 2;

    // Calculate bottom Y position of transcript-content
    const bottomY = rect.bottom;

    // Set CSS custom properties for modal positioning
    document.documentElement.style.setProperty('--preview-tip-modal-center-x', `${centerX}px`);
    document.documentElement.style.setProperty('--preview-tip-modal-bottom', `${bottomY}px`);
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
   * Handle arrow key navigation between words
   * Moves focus to the next or previous word chip
   * @param currentWord The word that currently has focus
   * @param direction 'left' for previous word, 'right' for next word
   */
  onArrowKeyPressed(currentWord: Word, direction: 'left' | 'right'): void {
    // Feature 13.10: Prevent arrow key navigation during preview mode
    if (this.isPreviewMode()) {
      return;
    }

    // Feature 13: Ignore arrow keys on intro/outro chips (they're display-only)
    if (currentWord.index === -1 || currentWord.index === -2) {
      return;
    }

    const words = this.words();
    if (words.length === 0) return;

    const currentIndex = currentWord.index;
    let targetIndex: number;

    if (direction === 'right') {
      // Find next word (wrap to first if at end)
      targetIndex = currentIndex + 1;
      if (targetIndex >= words.length) {
        targetIndex = 0; // Wrap to first word
      }
    } else {
      // Find previous word (wrap to last if at start)
      targetIndex = currentIndex - 1;
      if (targetIndex < 0) {
        targetIndex = words.length - 1; // Wrap to last word
      }
    }

    // Find the corresponding word chip element and focus it
    // Use setTimeout to ensure DOM is updated after Angular change detection
    setTimeout(() => {
      // Find the word chip element by data-index attribute
      const targetElement = document.querySelector(`[data-index="${targetIndex}"].word-chip`) as HTMLElement;
      if (targetElement) {
        targetElement.focus();
      }
    }, 0);
  }

  /**
   * Handle word click event
   * Delegates to EditorStateService for selection logic
   * Also triggers 3-second video preview based on PRD
   * Also dismisses tutorial tip on first word click (Feature 7)
   * Also captures state for undo/redo when complete selection is made (Feature 8)
   */
  onWordClick(word: Word): void {
    // Feature 13: Ignore clicks on intro/outro chips (they're display-only)
    if (word.index === -1 || word.index === -2) {
      return;
    }

    // Feature 13.11: Show tip modal only the first time when clicking word chips during preview mode
    if (this.isPreviewMode()) {
      if (!this.hasShownPreviewTip) {
        this.tutorialService.showCustomTip(
          'Validate New Start & End',
          'Before editing your video, you must confirm or discard the new start and end positions'
        );
        this.hasShownPreviewTip = true; // Mark as shown
      }
      return; // Don't process word selection during preview mode
    }

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