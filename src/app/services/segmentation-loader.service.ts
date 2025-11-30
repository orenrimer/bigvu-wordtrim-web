import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, retry, tap, throwError, Observable, map, switchMap, of } from 'rxjs';
import { Word, Segment, WordState } from '../models';

/**
 * Service responsible for loading and processing video segmentation data
 * Based on PRD: Loading State & Segmentation Loader
 */
@Injectable()
export class SegmentationLoaderService {
    // Constants for retry logic
    private static readonly RETRY_COUNT = 3;
    private static readonly RETRY_BASE_DELAY_MS = 1000; // Base delay for exponential backoff
    private static readonly RETRY_EXPONENTIAL_BASE = 2; // Exponential multiplier
    private static readonly RETRY_MAX_DELAY_MS = 10000; // Maximum delay cap (10 seconds)

    // Signal-based state management for reactive UI updates
    private _loadingState = signal<'idle' | 'loading' | 'success' | 'error'>('idle');
    private _words = signal<Word[]>([]);
    private _fillerWords = signal<Word[]>([]); // Separate array for filler words
    private _error = signal<string | null>(null);

    // Public read-only signals
    readonly loadingState = this._loadingState.asReadonly();
    readonly words = this._words.asReadonly();
    readonly fillerWords = this._fillerWords.asReadonly();
    readonly error = this._error.asReadonly();

    constructor(private http: HttpClient) { }

    /**
     * Load segmentation data from provided URL
     * @param url URL to segmentation JSON file
     * @returns Observable that completes after loading
     */
    loadSegmentation(url: string): Observable<Segment[]> {
        // Reset state
        this._loadingState.set('loading');
        this._error.set(null);

        return this.http.get<Segment[]>(url).pipe(
            // Retry failed requests with exponential backoff
            retry({
                count: SegmentationLoaderService.RETRY_COUNT,
                delay: (_error, retryCount) => {
                    const delayMs = Math.min(
                        SegmentationLoaderService.RETRY_BASE_DELAY_MS * Math.pow(SegmentationLoaderService.RETRY_EXPONENTIAL_BASE, retryCount - 1),
                        SegmentationLoaderService.RETRY_MAX_DELAY_MS
                    );
                    return new Observable<void>(subscriber => {
                        const timeoutId = window.setTimeout(() => {
                            subscriber.next();
                            subscriber.complete();
                        }, delayMs);
                        // Cleanup timeout on unsubscribe
                        return () => {
                            window.clearTimeout(timeoutId);
                        };
                    });
                }
            }),

            // Validate and transform segmentation data
            switchMap((segments: Segment[]) => {
                // Check if segments array is empty
                if (!segments || segments.length === 0) {
                    const errorMsg = 'Segmentation data is empty - no words found in the video';
                    this._error.set(errorMsg);
                    this._loadingState.set('error');
                    this._words.set([]);
                    this._fillerWords.set([]);
                    return throwError(() => new Error(errorMsg));
                }

                const { words: flattenedWords, fillerWords } = this.flattenSegments(segments);

                // Check if flattened words array is empty
                if (!flattenedWords || flattenedWords.length === 0) {
                    const errorMsg = 'Segmentation data contains no valid words';
                    this._error.set(errorMsg);
                    this._loadingState.set('error');
                    this._words.set([]);
                    this._fillerWords.set([]);
                    return throwError(() => new Error(errorMsg));
                }

                this._words.set(flattenedWords);
                this._fillerWords.set(fillerWords);
                this._loadingState.set('success');

                return of(segments);
            }),

            // Handle errors (both HTTP errors and validation errors)
            catchError((error: HttpErrorResponse | Error) => {
                // If it's already a validation error (Error instance), handle it directly
                if (error instanceof Error && !(error instanceof HttpErrorResponse)) {
                    // Error state already set in switchMap, just return the error
                    return throwError(() => error);
                }
                // Otherwise, it's an HTTP error, use the standard handler
                return this.handleError(error as HttpErrorResponse);
            })
        );
    }

    /**
     * Flatten nested segment structure into a single array of words
     * Based on PRD: Processing Requirements - Flatten structure into single array
     * Separates filler words from regular words
     * @param segments Array of segments from JSON
     * @returns Object containing regular words and filler words arrays
     */
    private flattenSegments(segments: Segment[]): { words: Word[]; fillerWords: Word[] } {
        const words: Word[] = [];
        const fillerWords: Word[] = [];
        let globalIndex = 0;
        let fillerIndex = 0; // Separate index counter for filler words

        for (const segment of segments) {
            if (!segment.words || segment.words.length === 0) {
                continue;
            }

            for (const rawWord of segment.words) {
                // Create Word object preserving timing and adding state management
                const word: Word = {
                    word: rawWord.word,
                    start: rawWord.start,
                    end: rawWord.end,
                    confidence: rawWord.confidence,
                    state: WordState.NORMAL, // Default state
                    index: rawWord.filler ? -1000 - fillerIndex++ : globalIndex++ // Use negative IDs for filler words
                };

                // Separate filler words from regular words
                if (rawWord.filler === true) {
                    fillerWords.push(word);
                } else {
                    words.push(word);
                }
            }
        }

        return { words, fillerWords };
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
        } else if (error.status) {
            // Backend error with status
            errorMessage = `Server error: ${error.status} - ${error.statusText || 'Unknown'}`;
        } else {
            // Unknown error (could be CORS, network failure, etc.)
            errorMessage = `Failed to load segmentation: ${error.message || 'Unknown error'}`;
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
        this._words.set([]);
        this._fillerWords.set([]);
        this._error.set(null);
    }
}