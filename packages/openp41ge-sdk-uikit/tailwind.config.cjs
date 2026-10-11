/** @type {import("tailwindcss").Config} */
module.exports = {
  presets: [require("../../tailwind.preset.js")],
  content: [
    "./src/**/*.{ts,html}",
    "./stories/**/*.{ts,html}",
    "../openp41ge/src/renderer/**/*.ts",
    "../openp41ge/src/renderer/**/*.html",
    "../openp41ge/src/layout/**/*.ts",
    "../openp41ge/src/main/**/*.ts",
  ],
};
