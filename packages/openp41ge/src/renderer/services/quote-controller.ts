import type { IQuoteController } from "../interfaces/quote-controller";

/**
 * Empty-cell movie quotes.
 *
 * Manages a rotating set of movie quotes displayed in empty grid cells.
 * The cycle rotates automatically on a timer.
 */

const EMPTY_QUOTES = [
  "You shall not pass!",
  "I'll be back.",
  "To boldly go where no one has gone before.",
  "May the Force be with you.",
  "Go ahead, make my day.",
  "You can't handle the truth!",
  "My precious.",
  "Why so serious?",
  "You're gonna need a bigger boat.",
  "I see dead people.",
  "Keep your friends close, but your enemies closer.",
  "Hasta la vista, baby.",
  "One does not simply walk into Mordor.",
  "Live long and prosper.",
  "Make it so.",
  "I am your father.",
  "Resistance is futile.",
  "I'm sorry, Dave. I'm afraid I can't do that.",
  "Do or do not. There is no try.",
  "There's no place like home.",
  "You talkin' to me?",
  "Houston, we have a problem.",
  "A wizard is never late, nor is he early.",
  "I feel the need—the need for speed!",
  "E.T. phone home.",
  "After all, tomorrow is another day.",
  "I'm the king of the world!",
  "Elementary, my dear Watson.",
  "Bond. James Bond.",
  "They may take our lives, but they'll never take our freedom!",
];

export class QuoteController implements IQuoteController {
  private _offset: number;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _started = false;

  constructor() {
    this._offset = Math.floor(Math.random() * EMPTY_QUOTES.length);
  }

  start(): void {
    if (this._started) return;
    this._started = true;
    this._scheduleNext();
  }

  stop(): void {
    this._started = false;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  getQuote(col: number): string {
    const idx = (col + this._offset) % EMPTY_QUOTES.length;
    return EMPTY_QUOTES[idx] ?? "Hello, world.";
  }

  private _scheduleNext(): void {
    if (!this._started) return;
    const delay = 55000 + Math.random() * 30000;
    this._timer = setTimeout(() => {
      if (!this._started) return;
      this._offset++;
      // Update all visible quotes
      document.querySelectorAll("tab-grid .openp41ge-empty-quote").forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        const col = parseInt(el.dataset.col ?? "0", 10);
        const quote = this.getQuote(col);
        el.style.opacity = "0";
        setTimeout(() => {
          el.textContent = `\u201c${quote}\u201d`;
          el.style.opacity = "1";
        }, 350);
      });
      this._scheduleNext();
    }, delay);
  }
}
