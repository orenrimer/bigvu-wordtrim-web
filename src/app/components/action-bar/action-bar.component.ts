import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

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
    imports: [CommonModule],
    templateUrl: './action-bar.component.html',
    styleUrl: './action-bar.component.scss'
})
export class ActionBarComponent {
    // Action button logic will be implemented in Feature 6
}

