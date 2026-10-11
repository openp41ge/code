// Local Storybook addon preset — wires manager panel only.
// Preview decorators are in .storybook/preview.ts
const path = require("path");

export const managerEntries = [path.join(__dirname, "manager.tsx")];
