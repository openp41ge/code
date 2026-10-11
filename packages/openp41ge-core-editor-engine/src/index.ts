/**
 * openp41ge-core-editor-engine — Pure engine logic for the file editor.
 *
 * Contains model, view, cursor, input, rendering, themes, and services.
 * Does not include the Lit web component (<file-editor>) — that lives in
 * openp41ge-sdk-uikit (src/components/file-editor/) and imports from this package.
 */

// Event types (for host applications to listen)
export {
  EVENT_TITLE_CHANGED,
  EVENT_DIRTY_CHANGED,
  EVENT_FILE_SAVED,
  EVENT_REQUEST_CLOSE,
} from "./events";

export type {
  TitleChangedDetail,
  DirtyChangedDetail,
  FileSavedDetail,
  RequestCloseDetail,
} from "./events";

// Service interfaces (for custom implementations / testing)
export type {
  IFileReader,
  IFileWriter,
  FileReadResult,
  ISyntaxHighlighter,
  IGrammar,
  IGrammarRegistry,
  IFormatter,
  IFormatterRegistry,
  IUndoManager,
  ICursorTracker,
  IStatusBar,
} from "./interfaces";

// Service implementations
export {
  ExtensionGrammarRegistry,
  ExtensionFormatterRegistry,
  registerBuiltinFormatters,
} from "./services";

// Model
export { PieceTreeTextContentModel, ViewModel, CoordinatesConverter } from "./model";
export type {
  TextPosition,
  TextRange,
  TextSelection,
  TextEditOperation,
  TextContentChange,
  TextContentChangeEvent,
  TextDecorationOptions,
  TextDecoration,
  ITextDecorationProvider,
  CursorStateComputer,
  ModelOptions,
  EOL,
} from "./model";

// Tokenization
export {
  TokenRegistry,
  LazyTokenizationManager,
  ContiguousTokensStore,
  TextMateTokenizer,
  BUILTIN_LANGUAGES,
  decodeTokens,
  StandardTokenType,
  FontStyle,
  initTextMate,
  resetTextMateInit,
} from "openp41ge-core-syntax-highlighting";
export type {
  ITokenizer,
  LanguageDefinition,
  TokenizationConfig,
  IToken,
  ITokenizeLineResult,
} from "openp41ge-core-syntax-highlighting";

// View
export {
  StringBuilder,
  FastDomNode,
  createFastDomNode,
  RenderedLinesCollection,
  ViewLines,
  ScrollManager,
} from "./view";
export type {
  IRenderedLine,
  IRenderedLinesCollection,
  IViewLinesEvent,
  ViewLinesConfig,
  ScrollState,
  ScrollEventHandler,
} from "./view";

// Rendering
export {
  renderViewLine,
  ViewLine,
  LineNumbersOverlay,
  CursorRenderer,
  SelectionRenderer,
  FindMatchRenderer,
  toFindViewSpans,
  CurrentLineHighlight,
  IndentationGuides,
  findMatchingBracket,
} from "./rendering";
export type {
  BracketMatch,
  IndentationGuidesConfig,
  FindViewSpan,
  IFindViewConverter,
} from "./rendering";
export type { RenderLineOutput, LineNumbersOverlayConfig, LineNumberMode } from "./rendering";

// Input
export {
  TextAreaInput,
  TextAreaState,
  KeyboardHandler,
  ClipboardHandler,
  CompositionHandler,
} from "./input";
export { checkAutoClose, shouldSkipClose, FindInEditor, DragDropHandler } from "./input";
export type {
  AutoClosingPair,
  AutoCloseResult,
  CompositionState,
  ClipboardHandlerConfig,
  FindMatch,
  FindOptions,
} from "./input";
export type {
  TextAreaInputConfig,
  OnTypeCallback,
  OnNewLineCallback,
  OnDeleteLeftCallback,
  OnDeleteRightCallback,
  OnReplaceSelectionCallback,
  OnCompositionCallback,
  OnPasteCallback,
  OnCutCallback,
  OnKeyCallback,
} from "./input";

// Cursor
export { CursorController } from "./cursor";
export type { CursorState, CursorEvent, CursorEventHandler } from "./cursor";

// Syntax themes
export {
  darkPlusTheme,
  lightPlusTheme,
  monokaiTheme,
  githubDarkTheme,
  githubLightTheme,
  BUILTIN_THEMES,
  ALL_THEMES,
  getThemeById,
  generateThemeCSS,
  generateGlobalEditorCSS,
} from "./themes";
export type { SyntaxTheme, SyntaxScopeColors } from "./themes";

// Cursor operations (for testing)
export {
  moveLeft,
  moveRight,
  moveUp,
  moveDown,
  moveToLineStart,
  moveToLineEnd,
  moveWordLeft,
  moveWordRight,
  movePageUp,
  movePageDown,
  insertChar,
  insertNewLine,
  insertTab,
  deleteLeft,
  deleteRight,
} from "./cursor";
