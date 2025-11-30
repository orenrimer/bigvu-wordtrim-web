import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'small' | 'medium' | 'large';

@Component({
    selector: 'app-button',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './button.component.html',
    styleUrl: './button.component.scss'
})
export class ButtonComponent {
    @Input() variant: ButtonVariant = 'primary';
    @Input() size: ButtonSize = 'medium';
    @Input() disabled = false;
    @Input() fullWidth = false;
    @Input() type: 'button' | 'submit' | 'reset' = 'button';
    @Input() ariaLabel?: string;
    @Input() borderRadius?: string; // Allow parent to set border-radius (e.g., '8px', '12px', 'var(--radius-xl)')
    @Input() width?: string; // Allow parent to set width (e.g., '70px', '100%')
    @Input() height?: string; // Allow parent to set height (e.g., '70px', '100%')

    @Output() clicked = new EventEmitter<MouseEvent>();

    onClick(event: MouseEvent): void {
        if (!this.disabled) {
            this.clicked.emit(event);
        }
    }

    get buttonClasses(): string {
        const classes = ['wt-button'];
        classes.push(`wt-button--${this.variant}`);
        classes.push(`wt-button--${this.size}`);

        if (this.disabled) {
            classes.push('wt-button--disabled');
        }

        if (this.fullWidth) {
            classes.push('wt-button--full-width');
        }

        return classes.join(' ');
    }
}

