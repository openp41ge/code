/**
 * Shared search-bar toggle icons.
 *
 * The Workspace Manager search bar and the search drawer use these identical
 * glyphs so the regex / match-case controls look the same everywhere. The case icon always keeps its "on" glyph; the on/off state
 * is conveyed purely by colour (see each consumer's toggle styling).
 */

/** Regex search glyph. */
export const REGEX_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentColor"><path d="M197-199q-56-57-86.5-130T80-482q0-80 30-153t87-130l57 57q-46 45-70 103.5T160-482q0 64 24.5 122.5T254-256l-57 57Zm140.5-58.5Q320-275 320-300t17.5-42.5Q355-360 380-360t42.5 17.5Q440-325 440-300t-17.5 42.5Q405-240 380-240t-42.5-17.5ZM519-440v-71l-61 36-40-70 61-35-61-35 40-70 61 36v-71h80v71l61-36 40 70-61 35 61 35-40 70-61-36v71h-80Zm244 241-57-57q46-45 70-103.5T800-482q0-80-30-153t-87-130l57-57q56 57 86.5 130T880-482q0 80-30 153t-87 130Z"/></svg>';

/** Match-case glyph — always the "on"/case-sensitive variant, coloured by state. */
export const CASE_ON_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentColor"><path d="m131-252 165-440h79l165 440h-76l-39-112H247l-40 112h-76Zm139-176h131l-64-182h-4l-63 182Zm395 186q-51 0-81-27.5T554-342q0-44 34.5-72.5T677-443q23 0 45 4t38 11v-12q0-29-20.5-47T685-505q-23 0-42 9.5T610-468l-47-35q24-29 54.5-43t68.5-14q69 0 103 32.5t34 97.5v178h-63v-37h-4q-14 23-38 35t-53 12Zm12-54q35 0 59.5-24t24.5-56q-14-8-33.5-12.5T689-393q-32 0-50 14t-18 37q0 20 16 33t40 13Z"/></svg>';
