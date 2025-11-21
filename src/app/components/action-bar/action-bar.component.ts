import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../button/button.component';
import { EditorStateService } from '../../services/editor-state.service';
import { TutorialService } from '../../services/tutorial.service';
import { HistoryService } from '../../services/history.service';
import { TimelineService } from '../../services/timeline.service';
import { OutputGeneratorService } from '../../services/output-generator.service';
import { WordState } from '../../models';

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
export class ActionBarComponent {
    // Inject services
    private readonly editorState = inject(EditorStateService);
    private readonly tutorialService = inject(TutorialService);
    private readonly historyService = inject(HistoryService);
    private readonly timelineService = inject(TimelineService);
    private readonly outputGenerator = inject(OutputGeneratorService);

    // Signal for ARIA live region announcements
    public readonly actionAnnouncement = signal<string>('');

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
        // console.log('Deleted Segments after Remove:', JSON.stringify(deletedSegments, null, 2));

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
        // console.log('Deleted Segments after Keep Only:', JSON.stringify(deletedSegments, null, 2));

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
        // console.log('Deleted Segments after Restore:', JSON.stringify(deletedSegments, null, 2));

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

    // ========== Placeholder handlers for future features ==========

    /**
     * Fix Start/End (Phase 2 - not implemented yet)
     */
    onFixStartEnd(): void {
    }

    /**
     * Remove Gaps (Phase 2 - not implemented yet)
     */
    onRemoveGaps(): void {
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

