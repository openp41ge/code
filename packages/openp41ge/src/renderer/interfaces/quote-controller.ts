/**
 * Quote controller — manages empty-cell movie quotes.
 */

export interface IQuoteController {
  /** Start the quote rotation timer. */
  start(): void;

  /** Stop the quote rotation timer. */
  stop(): void;

  /** Get the quote for a specific column, with rotation offset. */
  getQuote(col: number): string;
}
