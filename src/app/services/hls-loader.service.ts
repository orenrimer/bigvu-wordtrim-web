import { Injectable, inject } from '@angular/core';
import Hls, { ErrorData } from 'hls.js';

/**
 * HLS Error Data
 * Union type that accepts either HLS.js ErrorData or a simple error object
 * Used for both HLS.js errors (ErrorData) and native HLS errors ({ message: string })
 */
export type HlsErrorData = ErrorData | { message: string };

/**
 * HLS Event Callbacks
 */
export interface HlsLoaderCallbacks {
    onManifestParsed?: () => void;
    onError?: (event: string, data: HlsErrorData) => void;
}

/**
 * HLS Loader Service
 * Centralized service for loading HLS videos
 * Handles both HLS.js and native HLS (Safari) support
 */
@Injectable()
export class HlsLoaderService {
    // Track event listeners for native HLS cleanup
    private nativeHlsListeners = new Map<HTMLVideoElement, Array<{ event: string; listener: EventListener }>>();
    /**
     * Check if HLS.js is supported in the current browser
     */
    public isHlsSupported(): boolean {
        return Hls.isSupported();
    }

    /**
     * Check if native HLS is supported (Safari)
     */
    public isNativeHlsSupported(videoElement: HTMLVideoElement): boolean {
        return videoElement.canPlayType('application/vnd.apple.mpegurl') !== '';
    }

    /**
     * Resolve video URL (handles both absolute and relative paths)
     * @param url Video URL
     * @returns Resolved absolute URL
     */
    public resolveUrl(url: string): string {
        // If already absolute (http/https), return as-is
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }

        // For relative paths, prepend origin
        const path = url.startsWith('/') ? url : `/${url}`;
        return `${window.location.origin}${path}`;
    }

    /**
     * Initialize HLS.js player
     * @param videoElement HTML video element
     * @param videoUrl HLS video URL (m3u8)
     * @param callbacks Optional callbacks for HLS events
     * @returns HLS instance or null if not supported
     */
    public initializeHls(
        videoElement: HTMLVideoElement,
        videoUrl: string,
        callbacks?: HlsLoaderCallbacks
    ): Hls | null {
        if (!this.isHlsSupported()) {
            return null;
        }

        // Resolve URL (convert relative paths to absolute)
        const resolvedUrl = this.resolveUrl(videoUrl);

        // Create HLS instance with configuration
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false
        });

        // Bind HLS to video element
        hls.loadSource(resolvedUrl);
        hls.attachMedia(videoElement);

        // HLS event handlers
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            callbacks?.onManifestParsed?.();
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
            callbacks?.onError?.(event, data);
        });

        return hls;
    }

    /**
     * Initialize native HLS support (Safari)
     * @param videoElement HTML video element
     * @param videoUrl HLS video URL (m3u8)
     * @param callbacks Optional callbacks
     * @returns true if initialized successfully, false otherwise
     */
    public initializeNativeHls(
        videoElement: HTMLVideoElement,
        videoUrl: string,
        callbacks?: HlsLoaderCallbacks
    ): boolean {
        if (!this.isNativeHlsSupported(videoElement)) {
            return false;
        }

        // Resolve URL (convert relative paths to absolute)
        const resolvedUrl = this.resolveUrl(videoUrl);

        videoElement.src = resolvedUrl;

        // Ensure video loads
        videoElement.load();

        // Clear any existing listeners for this element
        this.removeNativeHlsListeners(videoElement);

        // Store listeners for cleanup
        const listeners: Array<{ event: string; listener: EventListener }> = [];

        const onLoadedMetadata = () => {
            callbacks?.onManifestParsed?.();
        };
        videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        listeners.push({ event: 'loadedmetadata', listener: onLoadedMetadata });

        const onError = () => {
            const error = videoElement.error;
            const errorMessage = error ? `Video Error: ${error.message}` : 'Unknown video error';
            callbacks?.onError?.('error', { message: errorMessage });
        };
        videoElement.addEventListener('error', onError);
        listeners.push({ event: 'error', listener: onError });

        // Store listeners for this element
        this.nativeHlsListeners.set(videoElement, listeners);

        return true;
    }

    /**
     * Remove native HLS event listeners for a video element
     * @param videoElement Video element to clean up
     */
    private removeNativeHlsListeners(videoElement: HTMLVideoElement): void {
        const listeners = this.nativeHlsListeners.get(videoElement);
        if (listeners) {
            listeners.forEach(({ event, listener }) => {
                videoElement.removeEventListener(event, listener);
            });
            this.nativeHlsListeners.delete(videoElement);
        }
    }

    /**
     * Initialize HLS video (tries HLS.js first, then native HLS)
     * @param videoElement HTML video element
     * @param videoUrl HLS video URL (m3u8)
     * @param callbacks Optional callbacks for HLS events
     * @returns HLS instance if using HLS.js, null if using native HLS, or null if not supported
     */
    public initialize(
        videoElement: HTMLVideoElement,
        videoUrl: string,
        callbacks?: HlsLoaderCallbacks
    ): Hls | null {
        // Try HLS.js first
        const hls = this.initializeHls(videoElement, videoUrl, callbacks);
        if (hls) {
            return hls;
        }

        // Fall back to native HLS (Safari)
        if (this.initializeNativeHls(videoElement, videoUrl, callbacks)) {
            return null; // Native HLS doesn't return an HLS instance
        }

        // Not supported
        callbacks?.onError?.('unsupported', { message: 'HLS is not supported in this browser' });
        return null;
    }

    /**
     * Destroy HLS instance and clean up event listeners
     * @param hls HLS instance to destroy
     * @param videoElement Optional video element to clean up native HLS listeners
     */
    public destroy(hls: Hls | null, videoElement?: HTMLVideoElement | null): void {
        if (hls) {
            hls.destroy();
        }

        // Clean up native HLS event listeners if video element is provided
        if (videoElement) {
            this.removeNativeHlsListeners(videoElement);
        }
    }
}

