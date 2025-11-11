import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../button/button.component';
import { EditorStateService } from '../../services/editor-state.service';
import { TutorialService } from '../../services/tutorial.service';
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

    // ========== Feature 6 Action Handlers ==========

    /**
     * Remove This Segment
     * Marks selected words as deleted
     * Based on PRD: Segment Actions
     */
    onRemove(): void {
        if (!this.canRemove()) return;

        this.editorState.deleteSelectedWords();
    }

    /**
     * Keep Only This Segment
     * Marks all non-selected words as deleted
     * Restores selected deleted words if any
     * Based on PRD: Segment Actions
     */
    onKeepOnly(): void {
        if (!this.canKeepOnly()) return;

        this.editorState.keepOnlySelectedWords();
    }

    /**
     * Restore Segment
     * Restores deleted words within current selection
     * Based on PRD: Segment Actions
     */
    onRestore(): void {
        if (!this.canRestore()) return;

        this.editorState.restoreSelectedWords();
    }

    /**
     * Unselect
     * Clears current selection without affecting deleted state
     * Based on PRD: Segment Actions
     */
    onUnselect(): void {
        if (!this.canUnselect()) return;

        this.editorState.clearSelection();
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
}

