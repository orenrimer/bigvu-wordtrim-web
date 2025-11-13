import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../button/button.component';
import { EditorStateService } from '../../services/editor-state.service';
import { TutorialService } from '../../services/tutorial.service';
import { HistoryService } from '../../services/history.service';
import { TimelineService } from '../../services/timeline.service';
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
     */
    onRemove(): void {
        if (!this.canRemove()) return;

        // Capture state BEFORE action (for undo to restore to this state)
        this.captureState();

        this.editorState.deleteSelectedWords();

        // Capture state AFTER action (for incremental undo)
        this.captureState();
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

        // Capture state BEFORE action (for undo to restore to this state)
        this.captureState();

        this.editorState.keepOnlySelectedWords();

        // Capture state AFTER action (for incremental undo)
        this.captureState();
    }

    /**
     * Restore Segment
     * Restores deleted words within current selection
     * Based on PRD: Segment Actions
     * Captures state for undo/redo (Feature 8)
     */
    onRestore(): void {
        if (!this.canRestore()) return;

        // Capture state BEFORE action (for undo to restore to this state)
        this.captureState();

        this.editorState.restoreSelectedWords();

        // Capture state AFTER action (for incremental undo)
        this.captureState();
    }

    /**
     * Unselect
     * Clears current selection without affecting deleted state
     * Based on PRD: Segment Actions
     * Captures state for undo/redo (Feature 8)
     */
    onUnselect(): void {
        if (!this.canUnselect()) return;

        // Capture state BEFORE action (for undo to restore to this state)
        this.captureState();

        this.editorState.clearSelection();

        // Capture state AFTER action (for incremental undo)
        this.captureState();
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

    // ========== Feature 8: Undo/Redo Functionality ==========

    /**
     * Capture current editor state snapshot
     * Called after segment actions
     * Marks the snapshot as an action bar action
     */
    private captureState(): void {
        const snapshot = this.editorState.captureState(
            this.timelineService.startHandle(),
            this.timelineService.endHandle()
        );
        // Mark as action bar action - this will be checked in undo to clear redo stack
        this.historyService.pushState(snapshot, true);
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

