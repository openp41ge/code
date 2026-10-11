/**
 * <tab-view> — renders tab content with preserve-on-inactive behavior.
 *
 * Light DOM for compatibility with elementFromPoint and query selectors.
 * Only the active tab is visible; inactive tabs remain in the DOM (hidden)
 * so their state is preserved when switching back.
 */

import { LitElement, html } from "lit";
import { property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

const _emojiPool = [
  // Faces
  "😀",
  "😃",
  "😄",
  "😁",
  "😆",
  "😅",
  "🤣",
  "😂",
  "🙂",
  "🙃",
  "😉",
  "😊",
  "😇",
  "🥰",
  "😍",
  "🤩",
  "😘",
  "😗",
  "😚",
  "😋",
  "😛",
  "😜",
  "🤪",
  "😝",
  "🤑",
  "🤗",
  "🤭",
  "🫢",
  "🫣",
  "🤫",
  "🤔",
  "😐",
  "😑",
  "😶",
  "🫥",
  "😏",
  "😒",
  "🙄",
  "😬",
  "🤥",
  "😌",
  "😔",
  "😪",
  "🤤",
  "😴",
  "😷",
  "🤒",
  "🤕",
  "🤢",
  "🤮",
  "🤧",
  "🥵",
  "🥶",
  "🥴",
  "😵",
  "🤯",
  "🤠",
  "🥳",
  "🥸",
  "😎",
  "🤓",
  "🧐",
  "😕",
  "😟",
  "🙁",
  "😮",
  "😯",
  "😲",
  "😳",
  "🥺",
  "😦",
  "😧",
  "😨",
  "😰",
  "😥",
  "😢",
  "😭",
  "😱",
  "😖",
  "😣",
  "😞",
  "😓",
  "😩",
  "😫",
  "🥱",
  "😤",
  "😡",
  "😠",
  "🤬",
  // Gestures & body
  "👍",
  "👎",
  "👊",
  "✊",
  "🤛",
  "🤜",
  "👏",
  "🙌",
  "👐",
  "🤲",
  "🤝",
  "🙏",
  "✌️",
  "🤞",
  "🫰",
  "🤟",
  "🤘",
  "🤙",
  "👈",
  "👉",
  "👆",
  "🖕",
  "👇",
  "☝️",
  "🖐️",
  "✋",
  "🤚",
  "🫱",
  "🫲",
  "🫳",
  "🫴",
  "👋",
  "🤙",
  "🖖",
  "🫶",
  "💪",
  "🦵",
  "🦶",
  "👂",
  "🦻",
  "👃",
  "🧠",
  "🫀",
  "🫁",
  "🦷",
  "🦴",
  "👀",
  "👁️",
  "👅",
  "👄",
  // Animals
  "🐶",
  "🐱",
  "🐭",
  "🐹",
  "🐰",
  "🦊",
  "🐻",
  "🐼",
  "🐻‍❄️",
  "🐨",
  "🐯",
  "🦁",
  "🐮",
  "🐷",
  "🐸",
  "🐵",
  "🙈",
  "🙉",
  "🙊",
  "🐒",
  "🐔",
  "🐧",
  "🐦",
  "🐤",
  "🐣",
  "🐥",
  "🦆",
  "🦅",
  "🦉",
  "🦇",
  "🐺",
  "🐗",
  "🐴",
  "🦄",
  "🐝",
  "🐛",
  "🦋",
  "🐌",
  "🐞",
  "🐜",
  "🦟",
  "🦗",
  "🐢",
  "🐍",
  "🦎",
  "🦖",
  "🦕",
  "🐙",
  "🦑",
  "🦐",
  "🦞",
  "🦀",
  "🐡",
  "🐠",
  "🐟",
  "🐬",
  "🐳",
  "🐋",
  "🦈",
  "🐊",
  "🐅",
  "🐆",
  "🦓",
  "🦍",
  "🐘",
  "🦣",
  "🐪",
  "🐫",
  "🦙",
  "🦒",
  "🐃",
  "🐂",
  "🐄",
  "🐎",
  "🐖",
  "🐏",
  "🐑",
  "🦌",
  "🐕",
  "🐩",
  "🦮",
  "🐕‍🦺",
  "🐈",
  "🐈‍⬛",
  "🐓",
  "🦃",
  "🦤",
  "🦚",
  "🦜",
  "🦢",
  "🦩",
  "🕊️",
  "🐇",
  "🦝",
  "🦨",
  "🦡",
  "🦫",
  "🦦",
  "🦥",
  "🐁",
  "🐀",
  "🐿️",
  "🦔",
  // Nature & popular
  "🌟",
  "🔥",
  "🌈",
  "☀️",
  "🌙",
  "⭐",
  "💫",
  "⚡",
  "🌊",
  "🌸",
  "🌺",
  "🌻",
  "🌷",
  "🌹",
  "🍀",
  "🌿",
  "🍄",
  "🌵",
  "🎄",
  "🌲",
  "🌳",
  "🌴",
  "🍁",
  "🍂",
  "🍃",
  // Food
  "🍕",
  "🍔",
  "🌭",
  "🍟",
  "🥨",
  "🥯",
  "🥞",
  "🧇",
  "🧀",
  "🥚",
  "🍳",
  "🥓",
  "🥩",
  "🍗",
  "🍖",
  "🦴",
  "🌮",
  "🌯",
  "🫔",
  "🥗",
  "🥘",
  "🫕",
  "🥫",
  "🍝",
  "🍜",
  "🍲",
  "🍛",
  "🍣",
  "🍱",
  "🥟",
  "🦪",
  "🍤",
  "🍙",
  "🍚",
  "🍘",
  "🍥",
  "🥠",
  "🥮",
  "🍢",
  "🍡",
  "🍧",
  "🍨",
  "🍦",
  "🍰",
  "🎂",
  "🧁",
  "🥧",
  "🍫",
  "🍬",
  "🍭",
  "🍮",
  "🍯",
  "☕",
  "🍵",
  "🧋",
  "🥤",
  "🍺",
  "🍻",
  "🥂",
  "🍷",
  "🥃",
  "🍸",
  "🍹",
  // Activities & objects
  "🚀",
  "🎉",
  "🎊",
  "🎈",
  "🎁",
  "🎀",
  "🪅",
  "🎃",
  "🎄",
  "🎆",
  "🎇",
  "✨",
  "🎶",
  "🎵",
  "🎸",
  "🎺",
  "🎻",
  "🥁",
  "🪘",
  "🎮",
  "🕹️",
  "🎲",
  "♟️",
  "🧩",
  "🧸",
  "🪀",
  "🪁",
  "📚",
  "📖",
  "🔮",
  "💎",
  "🕶️",
  "👑",
  "🎒",
  "🧳",
  "🌍",
  "🌎",
  "🌏",
  "🗺️",
  "🧭",
  "⏰",
  "⌚",
  "📱",
  "💻",
  "⌨️",
  "🖥️",
  "🖨️",
  "🖱️",
  "🖲️",
  "💾",
  "💿",
  "📀",
  "📸",
  "📹",
  "🎥",
  "📽️",
  "🎞️",
  "📞",
  "☎️",
  "📟",
  "📠",
  "🔊",
  "🔔",
  "🎵",
  "🎶",
];

function _randomGrid(): string[] {
  const grid: string[] = [];
  for (let i = 0; i < 9; i++) {
    grid.push(_emojiPool[Math.floor(Math.random() * _emojiPool.length)]);
  }
  return grid;
}

function _mutateGrid(grid: string[]): string[] {
  const next = [...grid];
  const count = 1 + Math.floor(Math.random() * 3); // 1–3 positions change
  for (let i = 0; i < count; i++) {
    next[Math.floor(Math.random() * 9)] = _emojiPool[Math.floor(Math.random() * _emojiPool.length)];
  }
  return next;
}

export class TabView extends LitElement {
  @property({ type: Array }) tabIds: string[] = [];
  @property({ type: String }) activeTabId: string = "";
  @property({ type: Object }) tabs: Record<string, { content: string }> = {};

  @state() private _emojiGrid: string[] = _randomGrid();
  private _timer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this._scheduleTick();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _scheduleTick(): void {
    this._timer = setTimeout(
      () => {
        if (!this.isConnected) return;
        this._emojiGrid = _mutateGrid(this._emojiGrid);
        this._scheduleTick();
      },
      5000 + Math.random() * 10000,
    ); // 5–15 seconds
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (this.tabIds.length === 0) {
      return html`
        <div
          style="display:grid;grid-template-columns:repeat(3,auto);place-content:center;place-items:center;gap:12px;height:100%;color:#666;font-size:2.5rem;"
        >
          ${this._emojiGrid.map((e) => html`<span>${e}</span>`)}
        </div>
      `;
    }
    return html`
      ${this.tabIds.map(
        (id) => html`
          <div
            data-tab-id=${id}
            ?hidden=${id !== this.activeTabId}
            style="padding:16px;overflow-y:auto;height:100%;box-sizing:border-box;"
          >
            ${this.tabs[id] ? unsafeHTML(this.tabs[id].content) : ""}
          </div>
        `,
      )}
    `;
  }
}

if (!customElements.get("tab-view")) {
  customElements.define("tab-view", TabView);
}
