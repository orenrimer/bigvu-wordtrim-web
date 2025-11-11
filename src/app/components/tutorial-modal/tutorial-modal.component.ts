import { Component, inject, HostListener, Pipe, PipeTransform } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TutorialService } from '../../services/tutorial.service';

/**
 * Safe Pipe - Sanitizes URLs for iframe usage
 */
@Pipe({
    name: 'safe',
    standalone: true
})
export class SafePipe implements PipeTransform {
    constructor(private sanitizer: DomSanitizer) {}

    transform(url: string, type: string): SafeResourceUrl {
        if (type === 'resourceUrl') {
            return this.sanitizer.bypassSecurityTrustResourceUrl(url);
        }
        return url;
    }
}

/**
 * Tutorial Modal Component
 * Displays tutorial content in two modes: tip and video
 * Based on PRD: Tutorial System (Section 7)
 */
@Component({
    selector: 'app-tutorial-modal',
    standalone: true,
    imports: [CommonModule, SafePipe],
    templateUrl: './tutorial-modal.component.html',
    styleUrls: ['./tutorial-modal.component.scss']
})
export class TutorialModalComponent {
    // Inject TutorialService
    protected readonly tutorialService = inject(TutorialService);

    // Tutorial video URL (placeholder for now)
    protected readonly tutorialVideoUrl = 'https://www.youtube.com/embed/dQw4w9WgXcQ';

    /**
     * Handle ESC key press to close modal
     */
    @HostListener('document:keydown.escape', ['$event'])
    onEscapeKey(event: KeyboardEvent): void {
        const modalState = this.tutorialService.modalState();
        if (modalState !== 'hidden') {
            event.preventDefault();
            this.close();
        }
    }

    /**
     * Close the modal
     */
    close(): void {
        this.tutorialService.hide();
    }

    /**
     * Switch from tip mode to video mode
     */
    showVideo(): void {
        this.tutorialService.showVideo();
    }

    /**
     * Handle backdrop click (close modal)
     * Only used in video mode
     */
    onBackdropClick(event: MouseEvent): void {
        this.close();
    }
}

