import { Component, OnInit, computed, effect, AfterViewInit, OnDestroy, ViewChild, ElementRef, signal, afterNextRender, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { SegmentationLoaderService } from '../../services/segmentation-loader.service';
import { EditorStateService } from '../../services/editor-state.service';
import { VideoPlayerService } from '../../services/video-player.service';
import { TimelineService } from '../../services/timeline.service';
import { TutorialService } from '../../services/tutorial.service';
import { HistoryService } from '../../services/history.service';
import { VideoDataService } from '../../services/video-data.service';
import { HlsLoaderService } from '../../services/hls-loader.service';
import { OutputGeneratorService } from '../../services/output-generator.service';
import { SkeletonLoaderComponent } from '../skeleton-loader/skeleton-loader.component';
import { WordChipComponent } from '../word-chip/word-chip.component';
import { ActionBarComponent } from '../action-bar/action-bar.component';
import { VideoPlayerComponent } from '../video-player/video-player.component';
import { TimelineComponent } from '../timeline/timeline.component';
import { TutorialModalComponent } from '../tutorial-modal/tutorial-modal.component';
import { Word, WordState, EditorStateSnapshot } from '../../models';

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
  providers: [
    EditorStateService,
    VideoPlayerService,
    TimelineService,
    TutorialService,
    HistoryService,
    VideoDataService,
    HlsLoaderService,
    OutputGeneratorService,
    SegmentationLoaderService
  ],
  templateUrl: './main-editor-container.component.html',
  styleUrl: './main-editor-container.component.scss'
})
export class MainEditorContainerComponent implements OnInit, AfterViewInit, OnDestroy {
  // ViewChild reference to words-container for CSS custom property positioning
  @ViewChild('wordsContainer', { static: false }) wordsContainerRef!: ElementRef<HTMLElement>;

  // ViewChild reference to transcript-content for preview tip modal positioning (Feature 13.11)
  @ViewChild('transcriptContent', { static: false }) transcriptContentRef!: ElementRef<HTMLElement>;

  // Auto-scroll tracking
  private autoScrollPaused = false; // Whether auto-scroll is paused due to manual scroll
  private isProgrammaticScroll = false; // Flag to distinguish programmatic scrolls from manual ones
  private programmaticScrollEndTime = 0; // Timestamp when programmatic scroll should end

  // RxJS Subject for debouncing auto-scroll resume
  private autoScrollResumeSubject = new Subject<void>();
  private destroy$ = new Subject<void>();

  // Window resize event listener reference for cleanup
  private windowResizeListener: (() => void) | null = null;

  // Track timeouts and animation frames for cleanup
  private activeTimeouts: number[] = [];
  private activeAnimationFrames: number[] = [];

  // Feature 13: Preview mode state for start/end trimming
  private readonly _isPreviewMode = signal<boolean>(false);
  public readonly isPreviewMode = this._isPreviewMode.asReadonly();

  // RTL language detection (Arabic, Hebrew)
  public readonly isRTL = computed(() => {
    const wordsList = this.words();
    if (!wordsList || wordsList.length === 0) {
      return false;
    }

    // Check first few words for RTL characters
    // Arabic: U+0600-U+06FF, Hebrew: U+0590-U+05FF
    const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF]/;

    // Sample first 10 words to detect language
    const sampleSize = Math.min(10, wordsList.length);
    for (let i = 0; i < sampleSize; i++) {
      if (rtlRegex.test(wordsList[i].word)) {
        return true;
      }
    }

    return false;
  });

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

  // Expose video aspect ratio for CSS scaling
  videoAspectRatio = this.videoService.aspectRatio;

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
    // Setup scroll event listener after next render
    // Use afterNextRender in constructor (injection context) to ensure DOM is ready
    afterNextRender(() => {
      // Check if element is available (will be set in ngAfterViewInit)
      if (this.transcriptContentRef?.nativeElement) {
        this.transcriptContentRef.nativeElement.addEventListener('scroll', this.onManualScrollBound, { passive: true });
      }
    });
    // Update words-container position when words are loaded AND auto-show tip modal
    // Combined effect to ensure proper sequencing: position calculation -> tip modal display
    effect(() => {
      const words = this.words();
      const loadingState = this.loadingState();
      const hasError = this.hasError();
      const rtl = this.isRTL();

      // Set RTL mode as class on html element for CSS to use
      if (rtl) {
        document.documentElement.classList.add('is-rtl');
      } else {
        document.documentElement.classList.remove('is-rtl');
      }

      // Only proceed if words are loaded and loading is complete
      if (words.length > 0 && loadingState === 'success') {
        // First, update position
        // Use requestAnimationFrame to ensure DOM is updated after Angular change detection
        const rafId = requestAnimationFrame(() => {
          this.tutorialService.updateWordsContainerPosition(
            this.wordsContainerRef,
            words.length,
            rtl
          ).then((positionSuccess) => {
            // Remove from tracking array when completed
            this.activeAnimationFrames = this.activeAnimationFrames.filter(id => id !== rafId);
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
        this.activeAnimationFrames.push(rafId);
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
        this.tutorialService.updatePreviewTipModalPosition(
          this.transcriptContentRef,
          this.wordsContainerRef,
          this.isRTL()
        );
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

    // Effect: Auto-scroll to keep active playback word visible
    effect(() => {
      const playbackWordIndex = this.currentPlaybackWordIndex();
      const isPlaying = this.videoService.isPlaying();

      // Only auto-scroll if:
      // 1. Video is playing
      // 2. There's an active playback word
      // 3. Auto-scroll is not paused (user hasn't manually scrolled recently)
      if (isPlaying && playbackWordIndex !== null && !this.autoScrollPaused) {
        // Use setTimeout to ensure DOM is updated
        const timeoutId = window.setTimeout(() => {
          this.scrollToActiveWord(playbackWordIndex);
          // Remove from tracking array when completed
          this.activeTimeouts = this.activeTimeouts.filter(id => id !== timeoutId);
        }, 0);
        this.activeTimeouts.push(timeoutId);
      }
    });

    // Set up debounced auto-scroll resume using RxJS
    this.autoScrollResumeSubject.pipe(
      debounceTime(5000), // Resume after 5 seconds of no manual scrolling
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.autoScrollPaused = false;
    });

    // Setup scroll event listener after next render
    // Use afterNextRender in constructor (injection context) to ensure DOM is ready
    afterNextRender(() => {
      // Check if element is available (will be set in ngAfterViewInit)
      if (this.transcriptContentRef?.nativeElement) {
        this.transcriptContentRef.nativeElement.addEventListener('scroll', this.onManualScrollBound, { passive: true });
      }
    });
  }

  ngOnInit(): void {
    // STEP 1: Load video metadata JSON first (FEATURE 11)
    this.loadVideoMetadata();

    // Reset page scroll position on init to prevent sticky scroll position
    // This ensures the page starts at the top even if browser remembers scroll position
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
      // Also prevent scroll restoration
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'manual';
      }
    }
  }

  ngAfterViewInit(): void {
    // Note: Position calculation is handled by the effect in constructor
    // which waits for words to be loaded. No need to call it here immediately.
    // The effect will handle initial position calculation when words are ready.

    // Update position on window resize
    if (typeof window !== 'undefined') {
      this.windowResizeListener = () => {
        this.tutorialService.updateWordsContainerPosition(
          this.wordsContainerRef,
          this.words().length,
          this.isRTL()
        );
        // Feature 13.11: Also update preview tip modal position on resize
        if (this.tutorialService.modalState() === 'preview-tip') {
          this.tutorialService.updatePreviewTipModalPosition(
            this.transcriptContentRef,
            this.wordsContainerRef,
            this.isRTL()
          );
        }
      };
      window.addEventListener('resize', this.windowResizeListener);
    }

    // Scroll listener is set up in constructor using afterNextRender
    // If element wasn't ready then, try again here (should be available in ngAfterViewInit)
    // Use requestAnimationFrame to ensure DOM is fully rendered
    const rafId = requestAnimationFrame(() => {
      if (this.transcriptContentRef?.nativeElement) {
        // Check if listener wasn't already added
        if (!this.transcriptContentRef.nativeElement.hasAttribute('data-scroll-listener-added')) {
          this.transcriptContentRef.nativeElement.addEventListener('scroll', this.onManualScrollBound, { passive: true });
          this.transcriptContentRef.nativeElement.setAttribute('data-scroll-listener-added', 'true');
        }
      }
      // Remove from tracking array when completed
      this.activeAnimationFrames = this.activeAnimationFrames.filter(id => id !== rafId);
    });
    this.activeAnimationFrames.push(rafId);
  }

  // Bound scroll handler for cleanup
  private onManualScrollBound = () => {
    this.onManualScroll();
  }

  ngOnDestroy(): void {
    // Clean up scroll event listener
    if (this.transcriptContentRef?.nativeElement) {
      this.transcriptContentRef.nativeElement.removeEventListener('scroll', this.onManualScrollBound);
    }

    // Clean up window resize event listener
    if (this.windowResizeListener && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.windowResizeListener);
      this.windowResizeListener = null;
    }

    // Clean up all active timeouts
    this.activeTimeouts.forEach(timeoutId => {
      clearTimeout(timeoutId);
    });
    this.activeTimeouts = [];

    // Clean up all active animation frames
    this.activeAnimationFrames.forEach(rafId => {
      cancelAnimationFrame(rafId);
    });
    this.activeAnimationFrames = [];

    // Clean up RxJS subscriptions
    this.destroy$.next();
    this.destroy$.complete();
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
      // Use requestAnimationFrame to ensure DOM is updated
      const rafId = requestAnimationFrame(() => {
        this.tutorialService.updatePreviewTipModalPosition(
          this.transcriptContentRef,
          this.wordsContainerRef,
          this.isRTL()
        );
        // Remove from tracking array when completed
        this.activeAnimationFrames = this.activeAnimationFrames.filter(id => id !== rafId);
      });
      this.activeAnimationFrames.push(rafId);
      this.activeAnimationFrames.push(rafId);
    }
  }

  /**
   * Handle click on words-container during preview mode (Feature 13.11)
   * Shows tip modal when clicking on words-container in preview mode
   */
  onWordsContainerClick(event: MouseEvent): void {
    // Only show tip modal if in preview mode and click is not on a word chip
    if (this.isPreviewMode()) {
      // Check if click target is the container itself (not a word chip)
      const target = event.target as HTMLElement;
      const isWordChip = target.closest('app-word-chip');

      // If click is directly on container (not on word chip), show tip modal
      if (!isWordChip) {
        this.tutorialService.showCustomTip(
          'Validate New Start & End',
          'Before editing your video, you must confirm or discard the new start and end positions'
        );
      }
    }
  }

  /**
   * Update preview tip modal position (Feature 13.11)
   * Centers modal horizontally with transcript-content and aligns bottom
   */

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
    const timeoutId = window.setTimeout(() => {
      // Find the word chip element by data-index attribute
      const targetElement = document.querySelector(`[data-index="${targetIndex}"].word-chip`) as HTMLElement;
      if (targetElement) {
        targetElement.focus();
      }
      // Remove from tracking array when completed
      this.activeTimeouts = this.activeTimeouts.filter(id => id !== timeoutId);
    }, 0);
    this.activeTimeouts.push(timeoutId);
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

    // Feature 13.11: Show tip modal when clicking words-container during preview mode
    if (this.isPreviewMode()) {
      this.tutorialService.showCustomTip(
        'Validate New Start & End',
        'Before editing your video, you must confirm or discard the new start and end positions'
      );
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
   * Handle manual scroll event
   * Pauses auto-scroll and schedules resume after 5 seconds (debounced via RxJS)
   */
  private onManualScroll(): void {
    // Ignore programmatic scrolls - check both flag and timestamp
    const now = Date.now();
    if (this.isProgrammaticScroll || now < this.programmaticScrollEndTime) {
      return;
    }

    // Pause auto-scroll immediately
    this.autoScrollPaused = true;

    // Cancel any ongoing programmatic scroll to prevent interference
    this.isProgrammaticScroll = false;
    this.programmaticScrollEndTime = 0;

    // Emit to Subject for debounced resume (5 seconds)
    // This will reset autoScrollPaused to false after 5 seconds of no manual scrolling
    this.autoScrollResumeSubject.next();
  }

  /**
   * Scroll the active playback word into view
   * @param wordIndex Index of the word to scroll to
   */
  private scrollToActiveWord(wordIndex: number): void {
    // Ensure transcript content element is available
    if (!this.transcriptContentRef?.nativeElement || !this.wordsContainerRef?.nativeElement) {
      return;
    }

    // Get the words array (with intro/outro chips in preview mode)
    const wordsWithIntroOutro = this.wordsWithIntroOutro();

    // Find the word in the array that matches the index
    const wordIndexInArray = wordsWithIntroOutro.findIndex(w => w.index === wordIndex);

    if (wordIndexInArray === -1) {
      return; // Word not found (might be intro/outro chip or deleted)
    }

    // Find the word chip element - chips are rendered in the same order as the array
    const wordChips = this.wordsContainerRef.nativeElement.querySelectorAll('app-word-chip');

    if (!wordChips || wordIndexInArray >= wordChips.length) {
      return;
    }

    const targetChip = wordChips[wordIndexInArray] as HTMLElement;

    if (!targetChip) {
      return;
    }

    const scrollContainer = this.transcriptContentRef.nativeElement;
    const chipRect = targetChip.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();

    // Check if chip is already visible (with some padding for better UX)
    const padding = 50; // Padding in pixels
    const isVisible = chipRect.top >= (containerRect.top + padding) &&
      chipRect.bottom <= (containerRect.bottom - padding);

    if (!isVisible) {
      // Don't scroll if auto-scroll is paused (user has manually scrolled)
      if (this.autoScrollPaused) {
        return;
      }

      // Set flag and timestamp BEFORE scrolling to prevent triggering manual scroll detection
      // Smooth scroll animations typically take 500-1000ms, so we'll ignore scroll events for 2000ms
      const scrollStartTime = Date.now();
      this.isProgrammaticScroll = true;
      this.programmaticScrollEndTime = scrollStartTime + 2000; // 2 seconds should cover smooth scroll animation

      // Use requestAnimationFrame to ensure flag is set before scroll happens
      const rafId = requestAnimationFrame(() => {
        // Double-check that auto-scroll is still not paused (user might have scrolled in the meantime)
        if (this.autoScrollPaused) {
          this.isProgrammaticScroll = false;
          this.programmaticScrollEndTime = 0;
          this.activeAnimationFrames = this.activeAnimationFrames.filter(id => id !== rafId);
          return;
        }

        // Calculate scroll position relative to the transcript-content container
        // This ensures we only scroll the container, not the entire page
        const chipOffsetTop = targetChip.offsetTop;
        const containerScrollTop = scrollContainer.scrollTop;
        const containerHeight = scrollContainer.clientHeight;
        const chipHeight = targetChip.offsetHeight;

        // Calculate target scroll position to center the chip in the container
        const targetScrollTop = chipOffsetTop - (containerHeight / 2) + (chipHeight / 2);

        // Ensure we don't scroll beyond container bounds
        const maxScrollTop = scrollContainer.scrollHeight - containerHeight;
        const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));

        // Scroll only the transcript-content container, not the page
        scrollContainer.scrollTo({
          top: clampedScrollTop,
          behavior: 'smooth'
        });

        // Remove RAF from tracking array when completed
        this.activeAnimationFrames = this.activeAnimationFrames.filter(id => id !== rafId);

        // Reset flag after scroll animation completes (typically 500-1000ms for smooth scroll)
        const timeoutId1 = window.setTimeout(() => {
          this.isProgrammaticScroll = false;
          // Keep programmaticScrollEndTime set for a bit longer to catch any delayed scroll events
          const timeoutId2 = window.setTimeout(() => {
            this.programmaticScrollEndTime = 0;
            // Remove from tracking array when completed
            this.activeTimeouts = this.activeTimeouts.filter(id => id !== timeoutId2);
          }, 500);
          this.activeTimeouts.push(timeoutId2);
          // Remove from tracking array when completed
          this.activeTimeouts = this.activeTimeouts.filter(id => id !== timeoutId1);
        }, 2000);
        this.activeTimeouts.push(timeoutId1);
      });
      this.activeAnimationFrames.push(rafId);
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
  private restoreState(snapshot: EditorStateSnapshot): void {
    // Restore editor state (words and selection)
    this.editorState.restoreState(snapshot);

    // IMPORTANT: Restore handles from snapshot to preserve fine-tuning positions
    // The snapshot contains the exact handle positions (with sub-word precision)
    // that were set when the state was captured. We need to restore these exact positions,
    // not just rely on the timeline effect which would snap handles to word boundaries.
    this.timelineService.restoreHandles(snapshot.startHandle, snapshot.endHandle);
  }
}