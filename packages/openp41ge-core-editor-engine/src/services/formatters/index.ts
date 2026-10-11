/**
 * Formatters index — registers all built-in formatters in the registry.
 *
 * Language to formatter mapping:
 *   JSON/JSONC      → jsonFormat (built-in, registered separately)
 *   JS/TS/JSX/TSX   → BraceIndent (2 spaces)
 *   Java/C/C++/Rust → BraceIndent (4 spaces)
 *   Go/Python/Ruby  → BraceIndent (4 spaces)
 *   HTML/HTM/XHTML  → HtmlIndent
 *   CSS/SCSS/LESS   → CssFormat
 *   YAML/YML        → YamlFormat
 *   MD/Markdown     → Markdown Format
 *   SH/Bash/Zsh     → Shell Format
 *   SQL             → SqlFormat
 *   TOML            → TomlFormat
 *   Dockerfile      → DockerfileFormat
 */

import type { IFormatterRegistry } from "../../interfaces/formatter-registry";
import { createBraceIndentFormatter } from "./brace-indent-formatter";
import { createHtmlFormatter } from "./html-formatter";
import { createCssFormatter } from "./css-formatter";
import { createYamlFormatter } from "./yaml-formatter";
import { createSqlFormatter } from "./sql-formatter";
import { createTomlFormatter } from "./toml-formatter";
import { createDockerfileFormatter } from "./dockerfile-formatter";
import { createMarkdownFormatter } from "./markdown-formatter";
import { createShellFormatter } from "./shell-formatter";
import { createHclFormatter } from "./hcl-formatter";

export function registerBuiltinFormatters(registry: IFormatterRegistry): void {
  // Brace indent (2 spaces) — JS, TS, JSX, TSX, PHP variants
  const brace2 = createBraceIndentFormatter("Brace Indent", 2);
  registry.register(
    ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "php", "phtml", "php3", "php4", "php5"],
    brace2,
  );

  // Brace indent (4 spaces) — Java, C, C++, Rust, Go, Python, Ruby
  const brace4 = createBraceIndentFormatter("Brace Indent", 4);
  registry.register(
    [
      "java",
      "c",
      "h",
      "cpp",
      "hpp",
      "cc",
      "cxx",
      "hxx",
      "c++",
      "h++",
      "rs",
      "go",
      "py",
      "pyw",
      "pyx",
      "pyi",
      "rb",
      "erb",
      "rbi",
    ],
    brace4,
  );

  // HTML (including PHP template variants)
  const html = createHtmlFormatter();
  registry.register(["html", "htm", "xhtml", "php", "phtml", "php3", "php4", "php5"], html);

  // CSS
  const css = createCssFormatter();
  registry.register(["css", "scss", "less"], css);

  // YAML (including lock files like yarn.lock)
  const yaml = createYamlFormatter();
  registry.register(["yaml", "yml", "lock"], yaml);

  // Markdown
  const md = createMarkdownFormatter();
  registry.register(["md", "markdown"], md);

  // Shell
  const sh = createShellFormatter();
  registry.register(["sh", "bash", "zsh"], sh);

  // SQL
  const sql = createSqlFormatter();
  registry.register(["sql"], sql);

  // TOML
  const toml = createTomlFormatter();
  registry.register(["toml"], toml);

  // Dockerfile (both cases)
  const docker = createDockerfileFormatter();
  registry.register(["dockerfile", "Dockerfile"], docker);

  // HCL / Terraform
  const hcl = createHclFormatter();
  registry.register(["hcl", "tf", "tfvars"], hcl);
}
