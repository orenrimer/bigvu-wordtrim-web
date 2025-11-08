import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VideoPlayerService } from '../../services/video-player.service';
import { environment } from '../../../environments/environment.development';

/**
 * Video Player Component
 * Custom video player with HLS.js support and playback controls
 * Based on PRD: Video Player Component
 * 
 * Features:
 * - Responsive to aspect ratios (16:9, 1:1, 9:16)
 * - Playback controls (play/pause, progress bar, time display)
 * - HLS video streaming
 * - Preview and full playback modes
 */
@Component({
    selector: 'app-video-player',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './video-player.component.html',
    styleUrl: './video-player.component.scss',
    encapsulation: ViewEncapsulation.None // Disable view encapsulation to check if that's the issue
})
export class VideoPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
    @ViewChild('videoElement', { static: false }) videoElementRef!: ElementRef<HTMLVideoElement>;

    // Expose service signals to template
    isPlaying = this.videoService.isPlaying;
    currentTime = this.videoService.currentTime;
    duration = this.videoService.duration;
    isLoading = this.videoService.isLoading;
    error = this.videoService.error;
    aspectRatio = this.videoService.aspectRatio;
    formattedCurrentTime = this.videoService.formattedCurrentTime;
    formattedDuration = this.videoService.formattedDuration;

    constructor(public videoService: VideoPlayerService) { }

    ngOnInit(): void {
        // Initialization logic
    }

    ngAfterViewInit(): void {
        // Initialize video player after view is ready
        if (this.videoElementRef?.nativeElement) {
            this.videoService.initializePlayer(
                this.videoElementRef.nativeElement,
                environment.videoUrl
            );
        }
    }

    ngOnDestroy(): void {
        // Cleanup player on component destroy
        this.videoService.destroy();
    }

    /**
     * Toggle play/pause
     */
    onTogglePlayPause(): void {
        this.videoService.togglePlayPause();
    }

    /**
     * Handle progress bar click for seeking
     * @param event Mouse event on progress bar
     */
    onProgressBarClick(event: MouseEvent): void {
        const progressBar = event.currentTarget as HTMLElement;
        const rect = progressBar.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const percentage = clickX / rect.width;
        const seekTime = percentage * this.duration();

        this.videoService.seek(seekTime);
    }

    /**
     * Calculate progress percentage for progress bar
     */
    getProgressPercentage(): number {
        const current = this.currentTime();
        const total = this.duration();
        if (total === 0) return 0;
        return (current / total) * 100;
    }

    /**
     * Get CSS class for aspect ratio container
     */
    getAspectRatioClass(): string {
        const ratio = this.aspectRatio();
        return `video-container--${ratio.replace(':', '-')}`;
    }
}

