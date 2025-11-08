import { Component, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SegmentationLoaderService } from '../../services/segmentation-loader.service';
import { EditorStateService } from '../../services/editor-state.service';
import { VideoPlayerService } from '../../services/video-player.service';
import { SkeletonLoaderComponent } from '../skeleton-loader/skeleton-loader.component';
import { WordChipComponent } from '../word-chip/word-chip.component';
import { ActionBarComponent } from '../action-bar/action-bar.component';
import { VideoPlayerComponent } from '../video-player/video-player.component';
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
  imports: [CommonModule, SkeletonLoaderComponent, WordChipComponent, ActionBarComponent, VideoPlayerComponent],
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

  // Computed signals for template conditionals
  isLoading = computed(() => this.loadingState() === 'loading');
  hasError = computed(() => this.loadingState() === 'error');
  hasWords = computed(() => this.words().length > 0);

  constructor(
    private segmentationService: SegmentationLoaderService,
    private editorState: EditorStateService,
    private videoService: VideoPlayerService
  ) { }

  ngOnInit(): void {
    // Load segmentation data from environment URL on component initialization
    this.loadSegmentation();
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
   */
  onWordClick(word: Word): void {
    this.editorState.selectWord(word);

    // Trigger 3-second video preview on word click
    // Based on PRD: Preview on Word Click
    const isEndWord = this.selectionEnd() !== null && word.index === this.selectionEnd()!.index;
    this.videoService.playWordPreview(word.start, isEndWord);

    // Log selection state for debugging
    if (this.hasCompleteSelection()) {
      console.info('Selection complete:', {
        start: this.selectionStart()?.word,
        end: this.selectionEnd()?.word,
        selectedCount: this.selectedWords().length
      });

      // Play selected segment preview
      const start = this.selectionStart();
      const end = this.selectionEnd();
      if (start && end) {
        this.videoService.playSegment(start.start, end.end);
      }
    } else if (this.hasSelection()) {
      console.info('Selection started:', {
        start: this.selectionStart()?.word
      });
    }
  }

  /**
   * Clear current selection
   * Used by action bar buttons in Feature 6
   */
  clearSelection(): void {
    this.editorState.clearSelection();
  }
}