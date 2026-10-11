/** Rendered HTML for the Welcome tab's single intro page. */
import page1 from "./welcome/01-welcome.md?raw";
import { renderMarkdown } from "./render-markdown";

/** One page of rendered Welcome HTML (just the intro, plus the dismiss card
 *  that the window-manager renders alongside it). */
export const welcomePages: string[] = [renderMarkdown(page1)];
