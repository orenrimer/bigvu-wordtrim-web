import { Injectable, signal, OnDestroy } from '@angular/core';
import { Subject, Subscription, timer } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { Word } from '../models';

/**
 * Timestamp Service
 * Handles calculation and positioning of timestamps for word rows
 */
@Injectable({
  providedIn: 'root'
})
export class TimestampService implements OnDestroy {
  // Constants
  private static readonly ROW_THRESHOLD = 5; // Pixels tolerance for considering words on the same row
  private static readonly TIMESTAMP_ROW_INTERVAL = 3; // Show timestamp every N rows (e.g., every 3rd row)
  private static readonly RESIZE_DEBOUNCE_MS = 100; // Debounce time for ResizeObserver callbacks

  // Row timestamps signal (time and top position)
  private _rowTimestamps = signal<Array<{ time: number; top: number }>>([]);
  public readonly rowTimestamps = this._rowTimestamps.asReadonly();

  // ResizeObserver for tracking layout changes
  private resizeObserver: ResizeObserver | null = null;

  // RxJS Subject for debouncing ResizeObserver callbacks
  private resizeSubject = new Subject<void>();
  private destroy$ = new Subject<void>();
  private resizeSubscription: Subscription | null = null;

  /**
   * Calculate timestamps based on first word in each row
   * @param wordsList Array of words
   * @param wordsContainer DOM element containing word chips
   * @param timestampsContainer DOM element for timestamps
   * @param isRTL Whether the layout is RTL
   */
  calculateRowTimestamps(
    wordsList: Word[],
    wordsContainer: HTMLElement,
    timestampsContainer: HTMLElement,
    isRTL: boolean
  ): void {
    if (!wordsList || wordsList.length === 0) {
      this._rowTimestamps.set([]);
      return;
    }

    const wordsContainerRect = wordsContainer.getBoundingClientRect();
    const timestampsContainerRect = timestampsContainer.getBoundingClientRect();

    // Get all word chip elements
    const wordChips = wordsContainer.querySelectorAll<HTMLElement>('app-word-chip .word-chip');

    if (wordChips.length === 0) {
      // If no chips are rendered yet, try again after a short delay
      // Use RxJS timer for consistency
      const timerSubscription = timer(50).pipe(
        takeUntil(this.destroy$)
      ).subscribe(() => {
        this.calculateRowTimestamps(wordsList, wordsContainer, timestampsContainer, isRTL);
      });
      // Note: Subscription will auto-cleanup via takeUntil
      return;
    }

    // Group words by row (based on top position)
    // Map key is rounded top position, value contains row info
    const rows: Map<number, { top: number; firstWordIndex: number; left: number }> = new Map();

    // First pass: collect all chips with their positions
    const chipsData: Array<{ chip: HTMLElement; top: number; left: number; wordIndex: number }> = [];

    for (let i = 0; i < wordChips.length; i++) {
      const chip = wordChips[i];
      const chipRect = chip.getBoundingClientRect();

      // Calculate center position of chip relative to timestamps container
      const chipTopRelativeToWords = chipRect.top - wordsContainerRect.top;
      const chipCenterRelativeToTimestamps = chipTopRelativeToWords + (chipRect.height / 2) + (wordsContainerRect.top - timestampsContainerRect.top);
      const chipLeft = chipRect.left - wordsContainerRect.left;

      // Get the word index from the chip's data-index attribute
      const wordIndex = parseInt(chip.getAttribute('data-index') || '-1', 10);

      chipsData.push({
        chip,
        top: chipCenterRelativeToTimestamps,
        left: chipLeft,
        wordIndex
      });
    }

    // Second pass: group chips by row and find first word in each row
    for (const chipData of chipsData) {
      // Skip intro/outro chips (index < 0) - we only want real words for timestamps
      if (chipData.wordIndex < 0) {
        continue;
      }

      // Find existing row with similar top position
      let foundRow = false;
      let rowKey = -1;

      for (const [key, row] of rows.entries()) {
        if (Math.abs(row.top - chipData.top) <= TimestampService.ROW_THRESHOLD) {
          foundRow = true;
          rowKey = key;
          // Update first word index if this chip is more to the left (first in row)
          // In RTL mode, we need to check right instead of left
          const isFirstInRow = isRTL
            ? chipData.left > row.left
            : chipData.left < row.left;

          if (isFirstInRow) {
            rows.set(key, {
              top: row.top,
              firstWordIndex: chipData.wordIndex,
              left: chipData.left
            });
          }
          break;
        }
      }

      // If no matching row found, create a new row
      if (!foundRow && chipData.wordIndex >= 0 && chipData.wordIndex < wordsList.length) {
        // Use top position as key (rounded to nearest threshold)
        const roundedTop = Math.round(chipData.top / TimestampService.ROW_THRESHOLD) * TimestampService.ROW_THRESHOLD;
        rows.set(roundedTop, {
          top: chipData.top,
          firstWordIndex: chipData.wordIndex,
          left: chipData.left
        });
      }
    }

    // Convert map to array and sort rows by top position
    const rowsArray = Array.from(rows.values()).sort((a, b) => a.top - b.top);

    // Filter rows to show timestamps only every N rows
    // Always include the first row, then every TIMESTAMP_ROW_INTERVAL rows
    const filteredRows = rowsArray.filter((row, index) => {
      // Always show first row
      if (index === 0) return true;
      // Show every Nth row (e.g., every 3rd row: index 2, 5, 8, etc.)
      return index % TimestampService.TIMESTAMP_ROW_INTERVAL === 0;
    });

    // Calculate timestamps for filtered rows based on first word's start time
    const rowTimestamps: Array<{ time: number; top: number }> = filteredRows.map(row => {
      const word = wordsList[row.firstWordIndex];
      return {
        time: word ? word.start : 0,
        top: row.top
      };
    });

    this._rowTimestamps.set(rowTimestamps);
  }

  /**
   * Setup ResizeObserver to detect when word layout changes and recalculate rows
   * Uses RxJS debouncing for better performance
   * @param wordsContainer DOM element to observe
   * @param calculateCallback Callback function to recalculate timestamps
   */
  setupRowDetection(
    wordsContainer: HTMLElement,
    calculateCallback: () => void
  ): void {
    // Clean up existing observer and subscription if any
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.resizeSubscription) {
      this.resizeSubscription.unsubscribe();
    }

    // Set up RxJS debounced callback using Subject
    this.resizeSubscription = this.resizeSubject.pipe(
      debounceTime(TimestampService.RESIZE_DEBOUNCE_MS),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      calculateCallback();
    });

    // Create ResizeObserver to watch for layout changes
    // Emit to Subject instead of calling callback directly
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeSubject.next();
    });

    // Observe the words container
    this.resizeObserver.observe(wordsContainer);
  }

  /**
   * Clean up ResizeObserver and RxJS subscriptions
   */
  cleanup(): void {
    // Clean up ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up RxJS subscription
    if (this.resizeSubscription) {
      this.resizeSubscription.unsubscribe();
      this.resizeSubscription = null;
    }
  }

  /**
   * Cleanup on service destroy
   */
  ngOnDestroy(): void {
    this.cleanup();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Clear row timestamps
   */
  clear(): void {
    this._rowTimestamps.set([]);
  }
}

