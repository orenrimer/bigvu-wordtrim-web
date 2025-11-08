import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../button/button.component';

/**
 * Action Bar Component
 * Container for segment action buttons (Remove, Keep Only, Restore, Unselect)
 * Based on PRD: Component Architecture & DESIGN_GUIDE.md specifications
 * 
 * Actions will be added in Feature 6
 */
@Component({
    selector: 'app-action-bar',
    standalone: true,
    imports: [CommonModule, ButtonComponent],
    templateUrl: './action-bar.component.html',
    styleUrl: './action-bar.component.scss'
})
export class ActionBarComponent {
    // Placeholder action handlers (will be properly implemented in Feature 6)
    onFixStartEnd(): void {
        console.log('Fix Start/End clicked');
    }

    onRemoveGaps(): void {
        console.log('Remove Gaps clicked');
    }

    onOpenSegment(): void {
        console.log('Open Segment clicked');
    }

    onRemove(): void {
        console.log('Remove This clicked');
    }

    onKeepOnly(): void {
        console.log('Keep Only This clicked');
    }

    onUnselect(): void {
        console.log('Unselect clicked');
    }

    onTutorial(): void {
        console.log('Tutorial clicked');
    }
}

