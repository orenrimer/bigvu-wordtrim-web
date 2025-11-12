import { Injectable } from '@angular/core';
import Hls from 'hls.js';

/**
 * HLS Event Callbacks
 */
export interface HlsLoaderCallbacks {
    onManifestParsed?: () => void;
    onError?: (event: string, data: any) => void;
}

/**
 * HLS Loader Service
 * Centralized service for loading HLS videos
 * Handles both HLS.js and native HLS (Safari) support
 */
@Injectable({
    providedIn: 'root'
})
export class HlsLoaderService {
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
            if (data.fatal) {
                console.error('❌ HLS fatal error:', {
                    type: data.type,
                    details: data.details,
                    fatal: data.fatal,
                    url: data.url,
                    error: data.error,
                    response: data.response
                });
            } else {
                console.warn('⚠️ HLS non-fatal error:', {
                    type: data.type,
                    details: data.details,
                    fatal: data.fatal,
                    url: data.url
                });
            }
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

        videoElement.addEventListener('loadedmetadata', () => {
            callbacks?.onManifestParsed?.();
        });

        videoElement.addEventListener('error', () => {
            const error = videoElement.error;
            const errorMessage = error ? `Video Error: ${error.message}` : 'Unknown video error';
            console.error('❌ Native HLS error:', errorMessage);
            callbacks?.onError?.('error', { message: errorMessage });
        });

        return true;
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
        console.error('HLS is not supported in this browser');
        callbacks?.onError?.('unsupported', { message: 'HLS is not supported in this browser' });
        return null;
    }

    /**
     * Destroy HLS instance
     * @param hls HLS instance to destroy
     */
    public destroy(hls: Hls | null): void {
        if (hls) {
            hls.destroy();
        }
    }
}

