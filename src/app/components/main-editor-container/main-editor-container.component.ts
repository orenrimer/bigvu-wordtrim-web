import { Component, OnInit, computed, effect, AfterViewInit, OnDestroy, ViewChild, ElementRef, signal, afterNextRender, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, Subscription, fromEvent } from 'rxjs';
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
import { TimestampService } from '../../services/timestamp.service';
import { GapDetectionService } from '../../services/gap-detection.service';
import { GapSegmentMergerService } from '../../services/gap-segment-merger.service';
import { ScrollService } from '../../services/scroll.service';
import { SkeletonLoaderComponent } from '../skeleton-loader/skeleton-loader.component';
import { WordChipComponent } from '../word-chip/word-chip.component';
import { GapBracketComponent } from '../gap-bracket/gap-bracket.component';
import { ActionBarComponent } from '../action-bar/action-bar.component';
import { VideoPlayerComponent } from '../video-player/video-player.component';
import { TimelineComponent } from '../timeline/timeline.component';
import { TutorialModalComponent } from '../tutorial-modal/tutorial-modal.component';
import { Word, WordState, EditorStateSnapshot } from '../../models';
import { Gap, GapState } from '../../models/gap.interface';

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
  imports: [CommonModule, SkeletonLoaderComponent, WordChipComponent, GapBracketComponent, ActionBarComponent, VideoPlayerComponent, TimelineComponent, TutorialModalComponent],
  providers: [
    EditorStateService,
    VideoPlayerService,
    TimelineService,
    TutorialService,
    HistoryService,
    VideoDataService,
    HlsLoaderService,
    OutputGeneratorService,
    SegmentationLoaderService,
    GapDetectionService,
    GapSegmentMergerService
  ],
  templateUrl: './main-editor-container.component.html',
  styleUrl: './main-editor-container.component.scss'
})
export class MainEditorContainerComponent implements OnInit, AfterViewInit, OnDestroy {
  // Constants
  private static readonly TIMESTAMP_INTERVAL_SECONDS = 10; // Target interval between timestamps

  // ViewChild reference to words-container for CSS custom property positioning
  @ViewChild('wordsContainer', { static: false }) wordsContainerRef!: ElementRef<HTMLElement>;

  // ViewChild reference to transcript-content for preview tip modal positioning (Feature 13.11)
  @ViewChild('transcriptContent', { static: false }) transcriptContentRef!: ElementRef<HTMLElement>;

  // ViewChild reference to timestamps-container for row alignment
  @ViewChild('timestampsContainer', { static: false }) timestampsContainerRef!: ElementRef<HTMLElement>;

  // Scroll service for managing all scrolling behavior
  private readonly scrollService = inject(ScrollService);

  // Track scroll listener cleanup function
  private scrollListenerCleanup: (() => void) | null = null;
  private scrollListenerAttached = false; // Track if scroll listener has been attached

  private destroy$ = new Subject<void>();

  // RxJS for window resize handling
  private resizeSubscription: Subscription | null = null;
  private static readonly RESIZE_DEBOUNCE_MS = 100; // Debounce time for resize events

  // Track timeouts and animation frames for cleanup
  private activeTimeouts: number[] = [];
  private activeAnimationFrames: number[] = [];

  // Memoization cache for wordsWithGaps interleaving
  private _memoizedWordsWithGaps: Array<{ type: 'word'; word: Word } | { type: 'gap'; gap: Gap }> | null = null;
  private _memoizedWordsArrayRef: Word[] | null = null;
  private _memoizedGapsArrayRef: Gap[] | null = null;


  // Feature 13: Preview mode state (managed by EditorStateService)
  public readonly isPreviewMode = this.editorState.isPreviewMode;

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

  // Feature 13: Computed signal for intro/outro gaps in preview mode
  introOutroGaps = computed((): { intro: Gap | null; outro: Gap | null } => {
    const isPreview = this.isPreviewMode();

    if (!isPreview) {
      return { intro: null, outro: null };
    }

    // Get intro and outro gaps directly from gap detection service
    const introGap = this.gapDetectionService.getIntroGap();
    const outroGap = this.gapDetectionService.getOutroGap();

    return {
      intro: introGap || null,
      outro: outroGap || null
    };
  });

  // Feature 13: Computed signal for words with intro/outro gaps in preview mode
  wordsWithIntroOutroGaps = computed((): Array<{ type: 'word'; word: Word } | { type: 'gap'; gap: Gap }> => {
    const allWords = this.words();
    const isPreview = this.isPreviewMode();

    if (!isPreview || allWords.length === 0) {
      return allWords.map(word => ({ type: 'word' as const, word }));
    }

    // Get gaps from gap detection service and display first and last gap
    const gaps = this.gapDetectionService.gapsWithStates();
    const firstGap = gaps.length > 0 ? gaps[0] : undefined;
    const lastGap = gaps.length > 1 ? gaps[gaps.length - 1] : undefined;

    const result: Array<{ type: 'word'; word: Word } | { type: 'gap'; gap: Gap }> = [];

    // Add first gap if it exists
    if (firstGap) {
      result.push({ type: 'gap', gap: firstGap });
    }

    // Add all words
    allWords.forEach(word => {
      result.push({ type: 'word', word });
    });

    // Add last gap if it exists and is different from first gap
    if (lastGap && lastGap.id !== firstGap?.id) {
      result.push({ type: 'gap', gap: lastGap });
    }

    return result;
  });


  // Feature 14: Computed signal for gaps with states (for display)
  gapsWithStates = computed(() => {
    if (!this.isGapReviewMode()) {
      return [];
    }
    return this.gapDetectionService.gapsWithStates();
  });

  // Feature 14: Selected gap ID (for visual selection only)
  selectedGapId = this.gapDetectionService.selectedGapId;


  // Feature 14: Computed signal for words with gaps interleaved (for Gap Review Mode)
  // Optimized: Memoized interleaving result to avoid unnecessary array recreation
  wordsWithGaps = computed((): Array<{ type: 'word'; word: Word } | { type: 'gap'; gap: Gap }> => {
    const words = this.words(); // Use regular words, not wordsWithIntroOutro
    const isGapReview = this.isGapReviewMode();

    // If not in gap review mode, return words as-is
    if (!isGapReview) {
      // Check memoization for non-gap-review mode
      if (
        this._memoizedWordsWithGaps !== null &&
        this._memoizedWordsArrayRef === words &&
        this._memoizedGapsArrayRef === null
      ) {
        return this._memoizedWordsWithGaps;
      }
      const result = words.map(word => ({ type: 'word' as const, word }));
      this._memoizedWordsWithGaps = result;
      this._memoizedWordsArrayRef = words;
      this._memoizedGapsArrayRef = null;
      return result;
    }

    // Get gaps with states
    const gaps = this.gapsWithStates();
    if (gaps.length === 0) {
      // Check memoization for empty gaps case
      if (
        this._memoizedWordsWithGaps !== null &&
        this._memoizedWordsArrayRef === words &&
        this._memoizedGapsArrayRef !== null &&
        this._memoizedGapsArrayRef.length === 0
      ) {
        return this._memoizedWordsWithGaps;
      }
      const result = words.map(word => ({ type: 'word' as const, word }));
      this._memoizedWordsWithGaps = result;
      this._memoizedWordsArrayRef = words;
      this._memoizedGapsArrayRef = [];
      return result;
    }

    // Check if we can use memoized result
    if (
      this._memoizedWordsWithGaps !== null &&
      this._memoizedWordsArrayRef === words &&
      this._memoizedGapsArrayRef === gaps
    ) {
      return this._memoizedWordsWithGaps;
    }

    // Find intro and outro gaps using service constants
    const introGap = this.gapDetectionService.getIntroGap();
    const outroGap = this.gapDetectionService.getOutroGap();

    // Get gap map by beforeWordIndex (excluding intro/outro) from service
    const gapMap = this.gapDetectionService.getGapMapByBeforeWordIndex();

    // Interleave words and gaps
    const items: Array<{ type: 'word'; word: Word } | { type: 'gap'; gap: Gap }> = [];

    // Add intro gap first if it exists
    if (introGap && words.length > 0) {
      items.push({ type: 'gap', gap: introGap });
    }

    // Add words and regular gaps between them
    for (let i = 0; i < words.length; i++) {
      const word = words[i];

      // Add word
      items.push({ type: 'word', word });

      // Check if there's a gap after this word (before next word)
      if (word.index >= 0 && gapMap.has(word.index)) {
        const gap = gapMap.get(word.index)!;
        items.push({ type: 'gap', gap });
      }
    }

    // Add outro gap last if it exists
    if (outroGap && words.length > 0) {
      items.push({ type: 'gap', gap: outroGap });
    }

    // Update memoization cache
    this._memoizedWordsWithGaps = items;
    this._memoizedWordsArrayRef = words;
    this._memoizedGapsArrayRef = gaps;

    return items;
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

  // Dynamic timestamps based on first word in each row
  timestamps = computed(() => {
    const rowData = this.timestampService.rowTimestamps();
    // Return just the time values for the template (for backward compatibility)
    return rowData.map((row: { time: number; top: number }) => row.time);
  });

  // Expose row timestamps for template (includes time and top position)
  public readonly rowTimestampsReadonly = this.timestampService.rowTimestamps;

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

  // Feature 14: Gap Review Mode warning alert state
  private readonly _showGapModeWarning = signal<boolean>(false);
  public readonly showGapModeWarning = this._showGapModeWarning.asReadonly();

  // Feature 14: Gap Review Mode state (managed by EditorStateService)
  public readonly isGapReviewMode = this.editorState.isGapReviewMode;

  constructor(
    private videoDataService: VideoDataService,
    private segmentationService: SegmentationLoaderService,
    private editorState: EditorStateService,
    private videoService: VideoPlayerService,
    public timelineService: TimelineService,
    public tutorialService: TutorialService,
    private historyService: HistoryService,
    private timestampService: TimestampService,
    private gapDetectionService: GapDetectionService
  ) {
    // Update words-container position when words are loaded AND auto-show tip modal
    // Combined effect to ensure proper sequencing: position calculation -> tip modal display
    effect(() => {
      const words = this.words();
      const loadingState = this.loadingState();
      const hasError = this.hasError();
      const rtl = this.isRTL();
      const isGapReview = this.isGapReviewMode();
      const isPreview = this.isPreviewMode();

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
            // 4. User hasn't explicitly closed the tip modal
            // 5. Not in gap review mode
            // 6. Not in preview mode
            if (positionSuccess &&
              !hasError &&
              !this.tutorialService.hasClickedWord() &&
              !this.tutorialService.hasClosedTip() &&
              !isGapReview &&
              !isPreview) {
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

    // Effect: Recalculate row timestamps when words change
    effect(() => {
      const words = this.words();
      const loadingState = this.loadingState();

      if (words.length > 0 && loadingState === 'success') {
        // Use requestAnimationFrame to ensure DOM is updated
        const rafId = requestAnimationFrame(() => {
          this.calculateRowTimestamps();
          this.activeAnimationFrames = this.activeAnimationFrames.filter(id => id !== rafId);
        });
        this.activeAnimationFrames.push(rafId);
      } else {
        this.timestampService.clear();
      }
    }, { allowSignalWrites: true });

    // Feature 14: Effect: Update gap detection service when words change
    effect(() => {
      const words = this.words();
      const loadingState = this.loadingState();

      if (words.length > 0 && loadingState === 'success') {
        // Update gap detection service with current words
        this.gapDetectionService.updateWords(words);
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
      if (isPlaying && playbackWordIndex !== null && !this.scrollService.isAutoScrollPaused()) {
        // Use scroll service to schedule scroll
        if (this.transcriptContentRef?.nativeElement && this.wordsContainerRef?.nativeElement) {
          this.scrollService.scheduleScrollToWord(
            playbackWordIndex,
            this.transcriptContentRef.nativeElement,
            this.wordsContainerRef.nativeElement,
            this.words()
          );
        }
      }
    });

    // Effect: Setup scroll listener when transcriptContent element becomes available
    // This handles the case where the element is conditionally rendered (*ngIf)
    effect(() => {
      const isReady = this.isVideoDataReady();
      if (isReady && !this.scrollListenerAttached) {
        // Use requestAnimationFrame to ensure DOM is updated after Angular change detection
        const rafId = requestAnimationFrame(() => {
          if (this.transcriptContentRef?.nativeElement && !this.scrollListenerAttached) {
            // Clean up any existing listener first
            if (this.scrollListenerCleanup) {
              this.scrollListenerCleanup();
            }
            // Initialize scroll listener via service
            this.scrollListenerCleanup = this.scrollService.initializeScrollListener(
              this.transcriptContentRef.nativeElement
            );
            this.scrollListenerAttached = true;
          }
          // Remove from tracking array when completed
          this.activeAnimationFrames = this.activeAnimationFrames.filter(id => id !== rafId);
        });
        this.activeAnimationFrames.push(rafId);
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

    // Update position on window resize using RxJS with debouncing
    if (typeof window !== 'undefined') {
      this.resizeSubscription = fromEvent<Event>(window, 'resize', { passive: true }).pipe(
        debounceTime(MainEditorContainerComponent.RESIZE_DEBOUNCE_MS),
        takeUntil(this.destroy$)
      ).subscribe(() => {
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
        // Recalculate row timestamps on resize
        this.calculateRowTimestamps();
      });
    }

    // Setup ResizeObserver for words container to detect row changes
    this.setupRowDetection();

    // Fallback: Setup scroll listener if element is already available and listener not attached
    // The effect in constructor should handle this, but this ensures it works even if timing is off
    if (this.isVideoDataReady() && !this.scrollListenerAttached) {
      const rafId = requestAnimationFrame(() => {
        if (this.transcriptContentRef?.nativeElement && !this.scrollListenerAttached) {
          // Clean up any existing listener first
          if (this.scrollListenerCleanup) {
            this.scrollListenerCleanup();
          }
          // Initialize scroll listener via service
          this.scrollListenerCleanup = this.scrollService.initializeScrollListener(
            this.transcriptContentRef.nativeElement
          );
          this.scrollListenerAttached = true;
        }
        this.activeAnimationFrames = this.activeAnimationFrames.filter(id => id !== rafId);
      });
      this.activeAnimationFrames.push(rafId);
    }
  }


  /**
   * Setup ResizeObserver to detect when word layout changes and recalculate rows
   */
  private setupRowDetection(): void {
    if (!this.wordsContainerRef?.nativeElement) {
      return;
    }

    // Setup row detection using timestamp service
    this.timestampService.setupRowDetection(
      this.wordsContainerRef.nativeElement,
      () => this.calculateRowTimestamps()
    );

    // Initial calculation
    const rafId = requestAnimationFrame(() => {
      this.calculateRowTimestamps();
      this.activeAnimationFrames = this.activeAnimationFrames.filter(id => id !== rafId);
    });
    this.activeAnimationFrames.push(rafId);
  }

  /**
   * Calculate timestamps based on first word in each row
   */
  private calculateRowTimestamps(): void {
    if (!this.wordsContainerRef?.nativeElement || !this.timestampsContainerRef?.nativeElement) {
      return;
    }

    const wordsList = this.words();
    if (!wordsList || wordsList.length === 0) {
      this.timestampService.clear();
      return;
    }

    // Use timestamp service to calculate row timestamps
    this.timestampService.calculateRowTimestamps(
      wordsList,
      this.wordsContainerRef.nativeElement,
      this.timestampsContainerRef.nativeElement,
      this.isRTL()
    );
  }

  ngOnDestroy(): void {
    // Clean up scroll event listener
    if (this.scrollListenerCleanup) {
      this.scrollListenerCleanup();
      this.scrollListenerCleanup = null;
      this.scrollListenerAttached = false;
    }

    // Cancel any pending scrolls
    this.scrollService.cancelAllScheduledScrolls();

    // Clean up timestamp service
    this.timestampService.cleanup();

    // Clean up RxJS resize subscription
    if (this.resizeSubscription) {
      this.resizeSubscription.unsubscribe();
      this.resizeSubscription = null;
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
        const fillerWords = this.segmentationService.fillerWords();

        // Check if words array is empty
        if (!loadedWords || loadedWords.length === 0) {
          // Don't initialize editor state with empty array - this will cause issues
          // The error state is already set in the service
          return;
        }

        this.editorState.initializeWords(loadedWords);

        // Feature 14: Initialize gap detection service with words and filler words
        // Filler words will be treated as gaps in gap review mode
        this.gapDetectionService.initializeWords(loadedWords, fillerWords);

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
   * Delegates to EditorStateService to manage preview mode state
   */
  /**
   * Get intro/outro gaps for preview mode
   * Used by action bar to merge gaps with deleted segments
   */
  getIntroOutroGaps(): { intro: Gap | null; outro: Gap | null } {
    return this.introOutroGaps();
  }

  togglePreviewMode(): void {
    // Hide tip modal when entering preview mode
    this.tutorialService.hide();

    // Toggle preview mode in service
    this.editorState.togglePreviewMode();

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
    }
  }

  /**
   * Feature 14: Enter Gap Review Mode
   * Delegates to EditorStateService to manage gap review mode state
   */
  enterGapReviewMode(): void {
    // Get handle positions from timeline service
    const startHandle = this.timelineService.startHandle();
    const endHandle = this.timelineService.endHandle();

    // Hide tip modal when entering gap review mode
    this.tutorialService.hide();

    // Enter gap review mode (manages snapshot and state restoration)
    this.editorState.enterGapReviewMode(startHandle, endHandle);

    // Gaps default to IGNORED state (kept by default)
    // Users can manually mark gaps as ACTIVE if they want to remove them
  }

  /**
   * Feature 14: Exit Gap Review Mode
   * Delegates to EditorStateService to restore state
   */
  exitGapReviewMode(): void {
    // Hide warning alert when exiting gap review mode
    this._showGapModeWarning.set(false);

    // Clear selected gap before resetting states
    this.gapDetectionService.selectGap(null);

    // Save gap states before exiting (so they persist for next gap review mode session)
    this.gapDetectionService.saveGapStates();

    // Exit gap review mode (restores snapshot and state)
    this.editorState.exitGapReviewMode(this.timelineService);

    // Reset gap states after exiting (but keep saved states for next session)
    // Use queueMicrotask to ensure we reset after Angular change detection completes
    queueMicrotask(() => {
      this.gapDetectionService.resetGapStates(false); // false = keep saved states
    });
  }

  /**
   * Feature 14: Dismiss gap review mode warning alert
   */
  dismissGapModeWarning(): void {
    this._showGapModeWarning.set(false);
  }

  /**
   * Feature 14: Handle gap bracket click
   * Feature 13: Gaps are not clickable in preview mode
   */
  onGapClick(gap: Gap): void {
    // Prevent gap clicks in preview mode
    if (this.isPreviewMode() && !this.isGapReviewMode()) {
      return;
    }

    // Regular gap review mode: Select the gap (this will set it to SELECTED and restore previous gap if any)
    this.gapDetectionService.selectGap(gap.id);
  }

  /**
   * Handle click on words-container during preview mode and gap review mode
   * Feature 13.11: Shows tip modal when clicking on words-container in preview mode
   * Feature 14.30: Prevents word selection during gap review mode
   */
  onWordsContainerClick(event: MouseEvent): void {
    // Feature 14.30: Make word-chips-container unclickable during Gap Review Mode
    if (this.isGapReviewMode()) {
      // Check if click target is a gap bracket - if so, don't show warning
      const target = event.target as HTMLElement;
      const isGapBracket = target.closest('app-gap-bracket');

      // If click is on gap bracket, don't show warning (gap brackets handle their own clicks)
      if (isGapBracket) {
        return;
      }

      // If click is not on gap bracket, it means user tried to click on word chip or container
      // (word chips have pointer-events: none, so clicks pass through to container)
      // Show warning alert when user tries to click on word chips
      event.stopPropagation();
      this._showGapModeWarning.set(true);
      return;
    }
    // Feature 13.11: Preview tip modal is now only shown when clicking on word chips
    // (handled in onWordClick), not when clicking on container
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

    // Feature 14.30: Don't allow word selection during gap review mode
    if (this.isGapReviewMode()) {
      // Show warning alert when user tries to select words
      this._showGapModeWarning.set(true);
      return; // Don't process word selection during gap review mode
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
   * Scroll the selected gap into view (for gap review mode navigation)
   * @param gapId ID of the gap to scroll to
   */
  public scrollToGap(gapId: number | null): void {
    if (!this.transcriptContentRef?.nativeElement || !this.wordsContainerRef?.nativeElement) {
      return;
    }

    this.scrollService.scrollToGap(
      gapId,
      this.transcriptContentRef.nativeElement,
      this.wordsContainerRef.nativeElement,
      this.wordsWithGaps()
    );
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