import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment.development';

/**
 * Video Data Service
 * Loads video metadata JSON files from assets/data/videos directory
 * Based on FEATURE 11: Server Integration & Data Loading
 * 
 * Features:
 * - Load JSON file by index (1-20)
 * - Parse JSON structure to extract hlsPlaylistUrl, segmentation URL, and thumbnails
 * - Signal-based state management for loading status
 * - Error handling for missing or invalid JSON files
 */

/**
 * Raw JSON response structure from video data API
 */
interface VideoJsonResponse {
    videos: Array<{
        hlsPlaylistUrl: string;
        duration?: number;
        thumbnails?: Array<{
            width?: number;
            height?: number;
            url?: string;
        }>;
    }>;
    segmentation: Array<{
        url: string;
    }>;
}

export interface VideoMetadata {
    hlsPlaylistUrl: string;
    segmentationUrl: string;
    thumbnails: Array<{ width: number; height: number; url: string }>;
    duration?: number;
    aspectRatio: '16:9' | '1:1' | '9:16'; // Aspect ratio calculated from thumbnails
}

@Injectable()
export class VideoDataService {
    // Signal-based state management
    private _loadingState = signal<'idle' | 'loading' | 'success' | 'error'>('idle');
    private _metadata = signal<VideoMetadata | null>(null);
    private _error = signal<string | null>(null);

    // Public read-only signals
    readonly loadingState = this._loadingState.asReadonly();
    readonly metadata = this._metadata.asReadonly();
    readonly error = this._error.asReadonly();

    constructor(private http: HttpClient) { }

    /**
     * Load video metadata JSON file by index (1-20)
     * @param index Video file index (1-20)
     * @returns Observable that completes after loading
     */
    loadVideoMetadata(index: number = environment.videoDataIndex || 1): Observable<VideoMetadata> {
        // Validate index range
        if (index < 1 || index > 22) {
            const errorMsg = `Invalid video index: ${index}. Must be between 1 and 20.`;
            this._error.set(errorMsg);
            this._loadingState.set('error');
            return throwError(() => new Error(errorMsg));
        }

        // Reset state
        this._loadingState.set('loading');
        this._error.set(null);
        this._metadata.set(null);

        // Construct file path
        const filePath = `assets/data/videos/video_${index}_*.json`;

        // Since we can't use glob patterns in Angular, we'll need to list available files
        // For now, we'll try to load the file directly by constructing the filename
        // Note: This assumes files are named video_1_*.json, video_2_*.json, etc.
        // We'll need to get the actual filename from a list or use a different approach

        // For now, let's use a helper method to get the actual filename
        const fileName = this.getVideoFileName(index);
        const url = `assets/data/videos/${fileName}`;

        return this.http.get<VideoJsonResponse>(url).pipe(
            map((data: VideoJsonResponse) => {
                try {
                    const metadata = this.parseVideoMetadata(data);
                    this._metadata.set(metadata);
                    this._loadingState.set('success');
                    return metadata;
                } catch (parseError) {
                    const errorMsg = `Failed to parse video metadata: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`;
                    this._error.set(errorMsg);
                    this._loadingState.set('error');
                    throw new Error(errorMsg);
                }
            }),
            catchError((error: HttpErrorResponse) => {
                return this.handleError(error);
            })
        );
    }

    /**
     * Get video filename by index
     * Since we can't use glob patterns, we need to know the exact filename
     * This is a temporary solution - in production, we'd have an API endpoint or file list
     */
    private getVideoFileName(index: number): string {
        // This is a placeholder - we'll need to implement a way to get the actual filename
        // For now, we'll try common patterns or use a mapping
        // TODO: Implement proper file discovery mechanism
        const fileNames: { [key: number]: string } = {
            1: 'video_1_68563edbdf2c5f9ae19c116b.json',
            2: 'video_2_6914278f7a9233dc124f1ed4.json',
            3: 'video_3_6913fc377a9233dc124de069.json',
            4: 'video_4_690fc55f886cc3749f63bde0.json',
            5: 'video_5_690bad0a4ae0987678af1103.json',
            6: 'video_6_69004d92886cc3749f9a40c9.json',
            7: 'video_7_68ef4eb6d34c72b3d150f233.json',
            8: 'video_8_68e9f32a415980d3d8fe63aa.json',
            9: 'video_9_68e04caae723a96743899542.json',
            10: 'video_10_68d2fd36d7b7b6597f46a13a.json',
            11: 'video_11_691352487a95cca95211b269.json',
            12: 'video_12_69063b7c4ae09876786889c7.json',
            13: 'video_13_68ff72e44ae09876780d8653.json',
            14: 'video_14_68fe9388886cc3749f83c5e4.json',
            15: 'video_15_68fe7c994ae098767803108d.json',
            16: 'video_16_68f783cef7af1e5bb7a7ac0c.json',
            17: 'video_17_68ea1f19d34c72b3d113d323.json',
            18: 'video_18_68d2b7cad7b7b6597f417c92.json',
            19: 'video_19_68bd7f973618d7dca4a072fa.json',
            20: 'video_20_68b172ca92c2257b94a10c01.json',
            21: 'video_21_68563edbdf2c5f9ae19c116b copy.json',
            22: 'video_22_68563edbdf2c5f9ae19c116b copy.json',
        };

        return fileNames[index] || `video_${index}_unknown.json`;
    }

    /**
     * Parse JSON structure to extract required metadata
     * @param data Raw JSON data from server
     * @returns Parsed VideoMetadata object
     */
    private parseVideoMetadata(data: VideoJsonResponse): VideoMetadata {
        // Extract hlsPlaylistUrl from videos[0].hlsPlaylistUrl
        if (!data.videos || !Array.isArray(data.videos) || data.videos.length === 0) {
            throw new Error('Missing videos array in JSON data');
        }

        const video = data.videos[0];
        if (!video.hlsPlaylistUrl) {
            throw new Error('Missing hlsPlaylistUrl in video data');
        }

        // Extract segmentation URL from segmentation[0].url
        if (!data.segmentation || !Array.isArray(data.segmentation) || data.segmentation.length === 0) {
            throw new Error('Missing segmentation array in JSON data');
        }

        const segmentation = data.segmentation[0];
        if (!segmentation || !segmentation.url) {
            throw new Error('Missing segmentation URL in segmentation data');
        }

        // Extract thumbnails array from videos[0].thumbnails
        // Don't throw error if thumbnails are missing - use empty array instead
        let thumbnails: Array<{ width: number; height: number; url: string }> = [];

        if (video.thumbnails && Array.isArray(video.thumbnails) && video.thumbnails.length > 0) {
            // Map thumbnails to our format and validate URLs
            thumbnails = video.thumbnails
                .map((thumb) => ({
                    width: thumb.width || 0,
                    height: thumb.height || 0,
                    url: thumb.url || ''
                }))
                .filter((thumb: { width: number; height: number; url: string }) => {
                    // Filter out thumbnails with invalid URLs
                    return thumb.url &&
                        typeof thumb.url === 'string' &&
                        thumb.url.trim().length > 0 &&
                        this.isValidUrl(thumb.url);
                });
        }

        // Calculate aspect ratio from thumbnails
        let aspectRatio: '16:9' | '1:1' | '9:16' = '16:9'; // Default to 16:9

        if (thumbnails && thumbnails.length > 0) {
            // Use the largest thumbnail for better accuracy
            const thumbnail = thumbnails.reduce((largest, current) => {
                const largestSize = largest.width * largest.height;
                const currentSize = current.width * current.height;
                return currentSize > largestSize ? current : largest;
            });

            if (thumbnail.width > 0 && thumbnail.height > 0) {
                const ratio = thumbnail.width / thumbnail.height;
                const ratio9_16 = 9 / 16; // 0.5625
                const ratio1_1 = 1; // 1.0
                const ratio16_9 = 16 / 9; // 1.777...

                if (Math.abs(ratio - ratio9_16) < 0.1) {
                    aspectRatio = '9:16';
                } else if (Math.abs(ratio - ratio1_1) < 0.1) {
                    aspectRatio = '1:1';
                } else if (Math.abs(ratio - ratio16_9) < 0.1) {
                    aspectRatio = '16:9';
                }
            }
        }

        const metadata: VideoMetadata = {
            hlsPlaylistUrl: video.hlsPlaylistUrl,
            segmentationUrl: segmentation.url,
            thumbnails: thumbnails,
            duration: video.duration,
            aspectRatio: aspectRatio
        };

        return metadata;
    }

    /**
     * Select appropriate thumbnail based on stream size
     * Prefers thumbnail closest to 640x360 (timeline display size)
     * @param thumbnails Array of thumbnail objects
     * @returns Selected thumbnail URL or null if no valid thumbnails available
     */
    selectThumbnail(thumbnails: Array<{ width: number; height: number; url: string }>): string | null {
        if (!thumbnails || thumbnails.length === 0) {
            return null;
        }

        // Filter out thumbnails with invalid URLs
        const validThumbnails = thumbnails.filter(thumb =>
            thumb.url &&
            typeof thumb.url === 'string' &&
            thumb.url.trim().length > 0 &&
            this.isValidUrl(thumb.url)
        );

        if (validThumbnails.length === 0) {
            return null;
        }

        // Target size for timeline (640x360)
        const targetWidth = 640;
        const targetHeight = 360;

        // Find thumbnail closest to target size
        let closestThumbnail = validThumbnails[0];
        let minDistance = Math.abs(validThumbnails[0].width - targetWidth) + Math.abs(validThumbnails[0].height - targetHeight);

        for (const thumb of validThumbnails) {
            const distance = Math.abs(thumb.width - targetWidth) + Math.abs(thumb.height - targetHeight);
            if (distance < minDistance) {
                minDistance = distance;
                closestThumbnail = thumb;
            }
        }

        return closestThumbnail.url;
    }

    /**
     * Validate URL format
     * Checks if URL is a valid HTTP/HTTPS URL or relative path
     * @param url URL string to validate
     * @returns true if URL is valid, false otherwise
     */
    private isValidUrl(url: string): boolean {
        if (!url || typeof url !== 'string') {
            return false;
        }

        try {
            // Check if it's a valid absolute URL (http/https)
            if (url.startsWith('http://') || url.startsWith('https://')) {
                new URL(url);
                return true;
            }

            // Check if it's a valid relative path (starts with / or ./)
            if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
                return true;
            }

            // Check if it's a data URL
            if (url.startsWith('data:')) {
                return true;
            }

            return false;
        } catch {
            return false;
        }
    }

    /**
     * Handle HTTP errors with appropriate error messages
     * @param error HttpErrorResponse from failed request
     * @returns Observable that throws formatted error
     */
    private handleError(error: HttpErrorResponse): Observable<never> {
        let errorMessage: string;

        if (error.error instanceof ErrorEvent) {
            // Client-side or network error
            errorMessage = `Network error: ${error.error.message}`;
        } else {
            // Backend error
            errorMessage = `Server error: ${error.status} - ${error.statusText}`;
        }

        this._loadingState.set('error');
        this._error.set(errorMessage);

        return throwError(() => new Error(errorMessage));
    }

    /**
     * Reset service state
     */
    reset(): void {
        this._loadingState.set('idle');
        this._metadata.set(null);
        this._error.set(null);
    }
}

