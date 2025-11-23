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
    // Signal-based state management for reactive UI updates
    private _loadingState = signal<'idle' | 'loading' | 'success' | 'error'>('idle');
    private _words = signal<Word[]>([]);
    private _error = signal<string | null>(null);

    // Public read-only signals
    readonly loadingState = this._loadingState.asReadonly();
    readonly words = this._words.asReadonly();
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
            // Retry failed requests up to 3 times with exponential backoff
            retry({
                count: 3,
                delay: (_error, retryCount) => {
                    const delayMs = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
                    return new Observable<void>(subscriber => {
                        setTimeout(() => {
                            subscriber.next();
                            subscriber.complete();
                        }, delayMs);
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
                    return throwError(() => new Error(errorMsg));
                }

                const flattenedWords = this.flattenSegments(segments);

                // Check if flattened words array is empty
                if (!flattenedWords || flattenedWords.length === 0) {
                    const errorMsg = 'Segmentation data contains no valid words';
                    this._error.set(errorMsg);
                    this._loadingState.set('error');
                    this._words.set([]);
                    return throwError(() => new Error(errorMsg));
                }

                this._words.set(flattenedWords);
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
     * @param segments Array of segments from JSON
     * @returns Flat array of Word objects with indices
     */
    private flattenSegments(segments: Segment[]): Word[] {
        const words: Word[] = [];
        let globalIndex = 0;

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
                    index: globalIndex++
                };

                words.push(word);
            }
        }

        return words;
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
        this._error.set(null);
    }
}