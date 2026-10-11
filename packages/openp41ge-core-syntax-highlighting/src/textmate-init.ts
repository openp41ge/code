/**
 * TextMate initialization — loads oniguruma WASM and creates a vscode-textmate Registry.
 *
 * The oniguruma WASM file is bundled alongside the grammars and loaded via fetch.
 *
 * Usage:
 *   const { registry, onigLib } = await initTextMate();
 *   const grammar = await registry.loadGrammar('source.js');
 */

import { Registry } from "vscode-textmate";
import { loadWASM, createOnigScanner, createOnigString } from "vscode-oniguruma";
import type { IOnigLib, IRawGrammar } from "vscode-textmate";

import jsGrammar from "./grammars/javascript.tmLanguage.json?raw";
import jsxGrammar from "./grammars/javascriptreact.tmLanguage.json?raw";
import tsGrammar from "./grammars/typescript.tmLanguage.json?raw";
import tsxGrammar from "./grammars/typescriptreact.tmLanguage.json?raw";
import jsonGrammar from "./grammars/json.tmLanguage.json?raw";
import htmlGrammar from "./grammars/html.tmLanguage.json?raw";
import cssGrammar from "./grammars/css.tmLanguage.json?raw";
import yamlGrammar from "./grammars/yaml.tmLanguage.json?raw";
import markdownGrammar from "./grammars/markdown.tmLanguage.json?raw";
import shellGrammar from "./grammars/shell-unix-bash.tmLanguage.json?raw";
import pythonGrammar from "./grammars/python.tmLanguage.json?raw";
import rustGrammar from "./grammars/rust.tmLanguage.json?raw";
import goGrammar from "./grammars/go.tmLanguage.json?raw";
import javaGrammar from "./grammars/java.tmLanguage.json?raw";
import cGrammar from "./grammars/c.tmLanguage.json?raw";
import cppGrammar from "./grammars/cpp.tmLanguage.json?raw";
import rubyGrammar from "./grammars/ruby.tmLanguage.json?raw";
import phpGrammar from "./grammars/php.tmLanguage.json?raw";
import sqlGrammar from "./grammars/sql.tmLanguage.json?raw";
import tomlGrammar from "./grammars/toml.tmLanguage.json?raw";
import dockerfileGrammar from "./grammars/docker.tmLanguage.json?raw";
import hclGrammar from "./grammars/hcl.tmLanguage.json?raw";
import terraformGrammar from "./grammars/terraform.tmLanguage.json?raw";
import { getOnigWasmBase64 } from "./grammars/onig-data";
import type { IRawTheme } from "vscode-textmate";

function loadGrammarText(raw: string): IRawGrammar {
  return JSON.parse(raw) as IRawGrammar;
}

/**
 * The IOnigLib implementation that vscode-textmate needs.
 */
class OnigLib implements IOnigLib {
  createOnigScanner(patterns: string[]) {
    return createOnigScanner(patterns);
  }
  createOnigString(s: string) {
    return createOnigString(s);
  }
}

let _initPromise: Promise<{ registry: Registry; onigLib: IOnigLib }> | null = null;

/**
 * Load the oniguruma WASM and create a vscode-textmate Registry.
 *
 * Returns the same singleton on subsequent calls.
 */
export async function initTextMate(
  theme?: IRawTheme,
): Promise<{ registry: Registry; onigLib: IOnigLib }> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // Load oniguruma WASM — decode base64 directly (avoids CSP issues with fetch(data:))
    const wasmBase64 = getOnigWasmBase64();
    const binaryString = atob(wasmBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    await loadWASM(bytes.buffer);

    const onigLib = new OnigLib();

    const registry = new Registry({
      onigLib: Promise.resolve(onigLib),
      loadGrammar: async (scopeName: string) => {
        return loadGrammarJson(scopeName);
      },
      theme: theme ?? undefined,
    });

    // Pre-register all grammars
    for (const [_scopeName, rawGrammar] of GRAMMAR_MAP) {
      if (rawGrammar) {
        await registry.addGrammar(rawGrammar);
      }
    }

    return { registry, onigLib };
  })();

  return _initPromise;
}

const GRAMMAR_MAP: Array<[string, IRawGrammar | null]> = [
  ["source.js", loadGrammarText(jsGrammar)],
  ["source.js.jsx", loadGrammarText(jsxGrammar)],
  ["source.ts", loadGrammarText(tsGrammar)],
  ["source.tsx", loadGrammarText(tsxGrammar)],
  ["source.json", loadGrammarText(jsonGrammar)],
  ["text.html.basic", loadGrammarText(htmlGrammar)],
  ["source.css", loadGrammarText(cssGrammar)],
  ["source.yaml", loadGrammarText(yamlGrammar)],
  ["text.html.markdown", loadGrammarText(markdownGrammar)],
  ["source.shell", loadGrammarText(shellGrammar)],
  ["source.python", loadGrammarText(pythonGrammar)],
  ["source.rust", loadGrammarText(rustGrammar)],
  ["source.go", loadGrammarText(goGrammar)],
  ["source.java", loadGrammarText(javaGrammar)],
  ["source.c", loadGrammarText(cGrammar)],
  ["source.cpp", loadGrammarText(cppGrammar)],
  ["source.ruby", loadGrammarText(rubyGrammar)],
  ["source.php", loadGrammarText(phpGrammar)],
  ["source.sql", loadGrammarText(sqlGrammar)],
  ["source.toml", loadGrammarText(tomlGrammar)],
  ["source.dockerfile", loadGrammarText(dockerfileGrammar)],
  ["source.hcl", loadGrammarText(hclGrammar)],
  ["source.hcl.terraform", loadGrammarText(terraformGrammar)],
];

function loadGrammarJson(scopeName: string): IRawGrammar | null {
  for (const [name, grammar] of GRAMMAR_MAP) {
    if (name === scopeName) return grammar;
  }
  return null;
}

/**
 * Reset the TextMate initialization (for testing).
 */
export function resetTextMateInit(): void {
  _initPromise = null;
}
