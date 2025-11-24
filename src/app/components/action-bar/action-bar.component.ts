import { Component, computed, inject, signal, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../button/button.component';
import { EditorStateService } from '../../services/editor-state.service';
import { TutorialService } from '../../services/tutorial.service';
import { HistoryService } from '../../services/history.service';
import { TimelineService } from '../../services/timeline.service';
import { OutputGeneratorService } from '../../services/output-generator.service';
import { VideoPlayerService } from '../../services/video-player.service';
import { GapDetectionService } from '../../services/gap-detection.service';
import { WordState, EditorStateSnapshot } from '../../models';
import { MainEditorContainerComponent } from '../main-editor-container/main-editor-container.component';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';

/**
 * Action Bar Component
 * Container for segment action buttons (Remove, Keep Only, Restore, Unselect)
 * Based on PRD: Segment Actions (Feature 6)
 * 
 * Button States Logic:
 * - Remove: Disabled if all selected words are already deleted
 * - Keep Only: Enabled when there's a complete selection
 * - Restore: Visible only when selection contains deleted words
 * - Unselect: Enabled when there's any selection
 */
@Component({
    selector: 'app-action-bar',
    standalone: true,
    imports: [CommonModule, ButtonComponent],
    templateUrl: './action-bar.component.html',
    styleUrl: './action-bar.component.scss'
})
export class ActionBarComponent implements OnInit, OnDestroy {
    // Inject services
    private readonly editorState = inject(EditorStateService);
    private readonly tutorialService = inject(TutorialService);
    private readonly historyService = inject(HistoryService);
    private readonly timelineService = inject(TimelineService);
    private readonly outputGenerator = inject(OutputGeneratorService);
    private readonly videoPlayerService = inject(VideoPlayerService);
    private readonly gapDetectionService = inject(GapDetectionService);

    // Feature 14: Threshold slider debounce
    private readonly thresholdSubject = new Subject<number>();
    private readonly destroy$ = new Subject<void>();

    // Reference to main editor container for preview mode toggle
    @Input() mainEditorContainer?: MainEditorContainerComponent;

    // Signal for ARIA live region announcements
    public readonly actionAnnouncement = signal<string>('');

    // Feature 13: Track preview mode state
    protected readonly isPreviewModeActive = computed(() => {
        return this.mainEditorContainer?.isPreviewMode() ?? false;
    });

    // Feature 14: Track gap review mode state
    protected readonly isGapReviewModeActive = computed(() => {
        return this.mainEditorContainer?.isGapReviewMode() ?? false;
    });

    // Feature 14: Gap detection signals
    protected readonly gapsWithStates = computed(() => {
        if (!this.isGapReviewModeActive()) {
            return [];
        }
        return this.gapDetectionService.gapsWithStates();
    });

    protected readonly gapThreshold = this.gapDetectionService.threshold;
    protected readonly activeGapsCount = this.gapDetectionService.activeGapsCount;

    // Computed signals for button states based on selection

    /**
     * Whether there's any selection (start word set)
     */
    protected readonly hasSelection = this.editorState.hasSelection;

    /**
     * Whether there's a complete selection (both start and end)
     */
    protected readonly hasCompleteSelection = this.editorState.hasCompleteSelection;

    /**
     * Selected words array
     */
    protected readonly selectedWords = this.editorState.selectedWords;

    /**
     * Number of deleted words in current selection
     */
    protected readonly deletedWordsInSelection = this.editorState.deletedWordsInSelection;

    /**
     * Show Remove Button - visible only when there's at least a start word selected
     */
    protected readonly showRemove = computed(() => {
        return this.hasSelection();
    });

    /**
     * Can Remove - enabled only when there's a complete selection and not all words are deleted
     */
    protected readonly canRemove = computed(() => {
        if (!this.hasCompleteSelection()) return false;

        const selected = this.selectedWords();
        const deletedCount = this.deletedWordsInSelection();

        // Disable if ALL selected words are already deleted
        return deletedCount < selected.length;
    });

    /**
     * Show Keep Only Button - visible only when there's at least a start word selected
     */
    protected readonly showKeepOnly = computed(() => {
        return this.hasSelection();
    });

    /**
     * Can Keep Only - enabled when there's a complete selection
     */
    protected readonly canKeepOnly = computed(() => {
        return this.hasCompleteSelection();
    });

    /**
     * Can Restore - visible only when selection contains deleted words
     */
    protected readonly canRestore = computed(() => {
        return this.deletedWordsInSelection() > 0;
    });

    /**
     * Can Unselect - enabled when there's any selection
     */
    protected readonly canUnselect = computed(() => {
        return this.hasSelection();
    });

    // ========== Feature 13: Preview Start/End Button States ==========

    /**
     * Show Preview Start/End Button - hidden when there's any selection
     */
    protected readonly showPreviewStartEnd = computed(() => {
        return !this.hasSelection();
    });

    /**
     * Can Preview Start/End - always enabled (pauses video if playing)
     */
    protected readonly canPreviewStartEnd = computed(() => {
        return true;
    });

    // ========== Feature 8: Undo/Redo Button States ==========

    /**
     * Can Undo - enabled when history stack has states
     */
    protected readonly canUndo = this.historyService.canUndo;

    /**
     * Can Redo - enabled when redo stack has states
     */
    protected readonly canRedo = this.historyService.canRedo;

    // ========== Feature 6 Action Handlers ==========

    /**
     * Remove This Segment
     * Marks selected words as deleted
     * Based on PRD: Segment Actions
     * Captures state for undo/redo (Feature 8)
     * Saves fine-tuned handle times for proper output generation
     */
    onRemove(): void {
        if (!this.canRemove()) return;

        // Save previous state BEFORE action
        this.capturePreviousState();

        // Get fine-tuned handle positions before deleting
        const startHandle = this.timelineService.startHandle();
        const endHandle = this.timelineService.endHandle();

        // If handles exist, use fine-tuned times; otherwise use word boundaries
        let fineTunedStart: number | undefined;
        let fineTunedEnd: number | undefined;

        if (startHandle && endHandle) {
            // Use fine-tuned handle times (sub-word precision)
            fineTunedStart = startHandle.time;
            fineTunedEnd = endHandle.time;
        } else {
            // No handles - use word boundaries (fallback)
            const selected = this.editorState.selectedWords();
            if (selected.length > 0) {
                const firstWord = selected[0];
                const lastWord = selected[selected.length - 1];
                fineTunedStart = firstWord.start;
                fineTunedEnd = lastWord.end;
            }
        }

        // deleteSelectedWords will save the fine-tuned segment internally
        this.editorState.deleteSelectedWords(fineTunedStart, fineTunedEnd);
        // Current state (after action) is NOT saved - it's the current viewing state

        // Log deleted segments array after remove action
        const deletedSegments = this.editorState.deletedSegments();
        console.log('Deleted Segments after Remove:', JSON.stringify(deletedSegments, null, 2));

        // Announce action for screen readers
        const wordCount = this.selectedWords().length;
        this.actionAnnouncement.set(`Removed ${wordCount} ${wordCount === 1 ? 'word' : 'words'} from selection`);
    }

    /**
     * Keep Only This Segment
     * Marks all non-selected words as deleted
     * Restores selected deleted words if any
     * Based on PRD: Segment Actions
     * Captures state for undo/redo (Feature 8)
     */
    onKeepOnly(): void {
        if (!this.canKeepOnly()) return;

        // Save previous state BEFORE action
        this.capturePreviousState();

        // Get fine-tuned handle positions if available
        const startHandle = this.timelineService.startHandle();
        const endHandle = this.timelineService.endHandle();
        const fineTunedStart = startHandle?.time;
        const fineTunedEnd = endHandle?.time;

        // keepOnlySelectedWords will create deleted segments for non-selected words
        // Pass fine-tuned handle times if available to ensure correct deleted segments
        this.editorState.keepOnlySelectedWords(fineTunedStart, fineTunedEnd);
        // Current state (after action) is NOT saved - it's the current viewing state

        // Log deleted segments array after keep only action
        const deletedSegments = this.editorState.deletedSegments();
        console.log('Deleted Segments after Keep Only:', JSON.stringify(deletedSegments, null, 2));

        // Announce action for screen readers
        const wordCount = this.selectedWords().length;
        this.actionAnnouncement.set(`Kept only ${wordCount} ${wordCount === 1 ? 'word' : 'words'}, removed all others`);
    }

    /**
     * Restore Segment
     * Restores deleted words within current selection
     * Based on PRD: Segment Actions
     * Captures state for undo/redo (Feature 8)
     * Removes deleted segments that overlap with restored words
     * Uses fine-tuned handle positions if available
     */
    onRestore(): void {
        if (!this.canRestore()) return;

        // Save previous state BEFORE action
        this.capturePreviousState();

        // Get fine-tuned handle positions if available
        const startHandle = this.timelineService.startHandle();
        const endHandle = this.timelineService.endHandle();
        const fineTunedStart = startHandle?.time;
        const fineTunedEnd = endHandle?.time;

        // restoreSelectedWords will remove deleted segments internally
        // Pass fine-tuned handle times to ensure correct deleted segments are removed
        this.editorState.restoreSelectedWords(fineTunedStart, fineTunedEnd);
        // Current state (after action) is NOT saved - it's the current viewing state

        // Log deleted segments array after restore action
        const deletedSegments = this.editorState.deletedSegments();
        console.log('Deleted Segments after Restore:', JSON.stringify(deletedSegments, null, 2));

        // Announce action for screen readers
        const restoredCount = this.deletedWordsInSelection();
        this.actionAnnouncement.set(`Restored ${restoredCount} ${restoredCount === 1 ? 'word' : 'words'}`);
    }

    /**
     * Unselect
     * Clears current selection without affecting deleted state
     * Based on PRD: Segment Actions
     * Captures state for undo/redo (Feature 8)
     */
    onUnselect(): void {
        if (!this.canUnselect()) return;

        // Save previous state BEFORE action
        this.capturePreviousState();

        this.editorState.clearSelection();
        // Current state (after action) is NOT saved - it's the current viewing state

        // Announce action for screen readers
        this.actionAnnouncement.set('Selection cleared');
    }

    // ========== Feature 13: Fix Start/End Handlers ==========

    /**
     * Fix Start/End (Feature 13)
     * Pauses video and toggles preview mode to show seconds until first and last words
     * Shows tip modal when opening preview mode (Feature 13.11)
     */
    onFixStartEnd(): void {
        // Pause video if playing
        if (this.videoPlayerService.isPlaying()) {
            this.videoPlayerService.pause();
        }

        if (this.mainEditorContainer) {
            // Just toggle preview mode - tip modal will show when clicking words-container
            this.mainEditorContainer.togglePreviewMode();
        }
    }

    /**
     * Preview Start/End Button Click (Feature 13.9)
     * Plays preview of start and end of unremoved segments
     */
    onPreviewStartEndClick(): void {
        this.videoPlayerService.playPreviewStartEnd();
    }

    /**
     * Confirm Preview Start/End (Feature 13.8)
     * Adds intro and outro segments to deleted segments array
     * This makes them skip during playback like any other deleted segment
     * Note: This action is NOT added to history stack (undo/redo does not affect it)
     */
    onConfirmPreview(): void {
        // Note: We intentionally do NOT capture state here
        // Fix start/end actions are not part of the undo/redo history

        // Get video duration
        const videoDuration = this.videoPlayerService.duration();
        if (!videoDuration || videoDuration <= 0) {
            console.warn('Cannot confirm preview: invalid video duration');
            return;
        }

        // Calculate intro and outro lengths before adding segments
        const nonDeletedWords = this.editorState.getNonDeletedWords();
        if (nonDeletedWords.length === 0) {
            console.warn('Cannot confirm preview: no non-deleted words found');
            return;
        }

        const firstWord = nonDeletedWords[0];
        const lastWord = nonDeletedWords[nonDeletedWords.length - 1];
        const introLength = firstWord.start; // From 0 to first word start
        const outroLength = videoDuration - lastWord.end; // From last word end to video duration

        // Add intro and outro segments to deleted segments
        this.editorState.addIntroOutroSegments(videoDuration);

        // Update effective duration in video player (Feature 13)
        this.videoPlayerService.updateEffectiveDuration(introLength, outroLength);

        // Close preview mode
        if (this.mainEditorContainer) {
            this.mainEditorContainer.togglePreviewMode();
        }

        // Announce action for screen readers
        this.actionAnnouncement.set('Intro and outro segments added to deleted sections');
    }

    /**
     * Reject Preview Start/End (Feature 13.8)
     * Removes intro and outro segments from deleted segments array
     * Note: This action is NOT added to history stack (undo/redo does not affect it)
     */
    onRejectPreview(): void {
        // Note: We intentionally do NOT capture state here
        // Fix start/end actions are not part of the undo/redo history

        // Get video duration
        const videoDuration = this.videoPlayerService.duration();
        if (!videoDuration || videoDuration <= 0) {
            console.warn('Cannot reject preview: invalid video duration');
            return;
        }

        // Remove intro and outro segments from deleted segments
        this.editorState.removeIntroOutroSegments(videoDuration);

        // Reset effective duration to original video duration (Feature 13)
        this.videoPlayerService.resetEffectiveDuration();

        // Close preview mode
        if (this.mainEditorContainer) {
            this.mainEditorContainer.togglePreviewMode();
        }

        // Announce action for screen readers
        this.actionAnnouncement.set('Intro and outro segments removed from deleted sections');
    }

    // ========== Placeholder handlers for future features ==========

    // ========== Feature 14: Gap Review Mode ==========

    /**
     * Initialize component - set up threshold slider debounce
     */
    ngOnInit(): void {
        // Feature 14: Set up debounced threshold updates (300ms debounce)
        this.thresholdSubject
            .pipe(
                debounceTime(300),
                takeUntil(this.destroy$)
            )
            .subscribe(threshold => {
                this.gapDetectionService.setThreshold(threshold);
                // On threshold change, recalculate all gaps and reset manual selections
                this.gapDetectionService.markAllGapsAsActive();
            });
    }

    /**
     * Cleanup on component destroy
     */
    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    /**
     * Feature 14: Show Remove Gaps button - visible when not in preview mode and not in gap review mode
     */
    protected readonly showRemoveGaps = computed(() => {
        return !this.isPreviewModeActive() && !this.isGapReviewModeActive();
    });

    /**
     * Feature 14: Enter Gap Review Mode
     */
    onRemoveGaps(): void {
        if (!this.mainEditorContainer) return;

        // Enter gap review mode
        this.mainEditorContainer.enterGapReviewMode();

        // Mark all gaps ≥ threshold as ACTIVE (initial state)
        this.gapDetectionService.markAllGapsAsActive();

        // Announce action for screen readers
        const gapsCount = this.gapsWithStates().length;
        this.actionAnnouncement.set(`Entered gap review mode. Found ${gapsCount} ${gapsCount === 1 ? 'gap' : 'gaps'}`);
    }

    /**
     * Feature 14: Handle threshold slider change
     */
    onThresholdChange(value: number): void {
        // Emit to debounced subject
        this.thresholdSubject.next(value);
    }

    /**
     * Feature 14: Apply gap removal
     */
    onApplyGapRemoval(): void {
        if (!this.mainEditorContainer) return;

        // Exit gap review mode
        this.mainEditorContainer.exitGapReviewMode();

        // Gap removal is applied when generating output (useGapRemoval = true)
        // The gaps marked for removal are already stored in GapDetectionService

        // Announce action for screen readers
        const activeGaps = this.activeGapsCount();
        this.actionAnnouncement.set(`Applied gap removal. ${activeGaps} ${activeGaps === 1 ? 'gap' : 'gaps'} will be removed`);
    }

    /**
     * Feature 14: Cancel gap removal
     */
    onCancelGapRemoval(): void {
        if (!this.mainEditorContainer) return;

        // Exit gap review mode
        this.mainEditorContainer.exitGapReviewMode();

        // Reset gap states (discard temporary changes)
        this.gapDetectionService.resetGapStates();

        // Announce action for screen readers
        this.actionAnnouncement.set('Cancelled gap removal. All changes discarded');
    }

    /**
     * Feature 14: Remove all gaps (mark all as ACTIVE)
     */
    onRemoveAllGaps(): void {
        // Mark all gaps as ACTIVE (for removal)
        this.gapDetectionService.markAllGapsAsActive();

        // Announce action for screen readers
        const gapsCount = this.gapsWithStates().length;
        this.actionAnnouncement.set(`Marked all ${gapsCount} ${gapsCount === 1 ? 'gap' : 'gaps'} for removal`);
    }

    /**
     * Feature 14: Open gap settings (threshold slider)
     * This could open a settings modal or show threshold slider
     * For now, we'll show threshold slider inline or could be a modal
     */
    onGapSettings(): void {
        // TODO: Could open settings modal with threshold slider
        // For now, threshold slider is always visible in the layout
        // This method can be used to toggle visibility or open modal
        this.actionAnnouncement.set('Gap settings');
    }

    /**
     * Tutorial (Feature 7)
     * Opens tutorial video modal in bottom-left corner
     */
    onTutorial(): void {
        this.tutorialService.showVideo();
    }

    // ========== Feature 9: Save & Output Generation ==========

    /**
     * Save output
     * Generates output array and logs to console
     * Based on PRD Section 9: Save & Output
     */
    onSave(): void {
        const output = this.outputGenerator.generateOutput();
        // Output to console.log for Phase 1
        console.log('Output:', JSON.stringify(output, null, 2));
    }

    // ========== Feature 8: Undo/Redo Functionality ==========

    /**
     * Capture previous editor state snapshot (before action)
     * Called BEFORE segment actions to save the state that existed before the action
     */
    private capturePreviousState(): void {
        const previousSnapshot = this.editorState.captureState(
            this.timelineService.startHandle(),
            this.timelineService.endHandle()
        );
        this.historyService.pushState(previousSnapshot);
    }

    /**
     * Perform undo operation
     * Restores previous editor state
     */
    onUndo(): void {
        const currentSnapshot = this.editorState.captureState(
            this.timelineService.startHandle(),
            this.timelineService.endHandle()
        );

        const previousState = this.historyService.undo(currentSnapshot);

        if (previousState) {
            this.restoreState(previousState);
            this.actionAnnouncement.set('Undo completed');
        }
    }

    /**
     * Perform redo operation
     * Reapplies undone state
     */
    onRedo(): void {
        const currentSnapshot = this.editorState.captureState(
            this.timelineService.startHandle(),
            this.timelineService.endHandle()
        );

        const nextState = this.historyService.redo(currentSnapshot);

        if (nextState) {
            this.restoreState(nextState);
            this.actionAnnouncement.set('Redo completed');
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

