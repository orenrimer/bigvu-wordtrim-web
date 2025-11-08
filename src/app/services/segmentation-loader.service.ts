import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, retry, tap, throwError, Observable } from 'rxjs';
import { Word, Segment, WordState } from '../models';

/**
 * Service responsible for loading and processing video segmentation data
 * Based on PRD: Loading State & Segmentation Loader
 */
@Injectable({
    providedIn: 'root'
})
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
                    console.info(`Retry attempt ${retryCount} after ${delayMs}ms`);
                    return new Observable<void>(subscriber => {
                        setTimeout(() => {
                            subscriber.next();
                            subscriber.complete();
                        }, delayMs);
                    });
                }
            }),

            // Transform and update state on success
            tap((segments: Segment[]) => {
                const flattenedWords = this.flattenSegments(segments);
                this._words.set(flattenedWords);
                this._loadingState.set('success');
            }),

            // Handle errors
            catchError((error: HttpErrorResponse) => {
                return this.handleError(error);
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
        } else {
            // Backend error
            errorMessage = `Server error: ${error.status} - ${error.statusText}`;
        }

        console.error('Segmentation loading failed:', errorMessage, error);

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