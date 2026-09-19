// moose-stash — a small Mustache template engine, drop-in for mustache.js.
//
// A scanner splits the template on its delimiters into tokens (handling standalone
// lines); the tokens nest into a tree on section boundaries; the renderer walks the
// tree over a stack of context frames. The public surface (render/parse/escape/tags/
// clearCache/templateCache/Writer/Context/Scanner/version) mirrors mustache.js.

export class Decline extends Error {
  constructor(what: string) {
    super(`DECLINE: ${what} is not supported`);
    this.name = "Decline";
  }
}

// Partials may be a name→source map or a resolver function (both, like mustache.js).
export type PartialsMap = Record<string, string>;
export type PartialsFn = (name: string) => string | null | undefined;
export type Partials = PartialsMap | PartialsFn;

function getPartial(partials: Partials | undefined, name: string): string | undefined {
  if (partials == null) return undefined;
  if (typeof partials === "function") {
    const r = partials(name);
    return r == null ? undefined : String(r);
  }
  const r = (partials as PartialsMap)[name];
  return r == null ? undefined : r;
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#x60;",
  "=": "&#x3D;",
  "/": "&#x2F;", // escape / too, matching mustache.js's default entity map
};

const HTML_SPECIAL = /[&<>"'`=/]/;
const HTML_SPECIAL_G = /[&<>"'`=/]/g;

// the built-in escape; assignable via the public `escape` property (mustache.js parity)
function escapeHtml(s: unknown): string {
  const str = typeof s === "string" ? s : String(s);
  // skip the replace when there is nothing to escape
  return HTML_SPECIAL.test(str) ? str.replace(HTML_SPECIAL_G, (c) => HTML_ESCAPE[c]) : str;
}

function isWhitespace(s: string): boolean {
  return /^\s*$/.test(s);
}

// A token: [type, value, start, end, subTokens?, openingTagIndex?]
type Token = [string, string, number, number, Token[]?, number?];

// ---- render-time defaults (mutable, mirrored by the public surface) ----

// The default delimiters and escape function. The public object exposes these as
// `tags` and `escape`; assigning to them changes what a bare render()/parse() uses.
let DEFAULT_TAGS: [string, string] = ["{{", "}}"];
let DEFAULT_ESCAPE: (s: unknown) => string = escapeHtml;

// The escape function and parse cache active for the current render/parse. Set at
// entry and restored on exit, so a Writer's own escape/cache (or a per-call escape)
// applies to the whole synchronous render tree — including partials and lambdas —
// at zero per-node cost, and nested public calls (e.g. a lambda calling render) save
// and restore around themselves.
let activeEscape: (s: unknown) => string = escapeHtml;
let activeParseCache: Map<string, Token[]> | null = null;

// ---- scanner ----

// Parsed templates are cached by (delimiters, template). Render never mutates the
// tree, so a cached parse is identical to a fresh one. A null active cache disables
// caching (mustache.js: `templateCache = undefined`).
const DEFAULT_CACHE = new Map<string, Token[]>();

function parse(template: string, tags: [string, string] = DEFAULT_TAGS): Token[] {
  const cache = activeParseCache;
  if (cache) {
    const key = tags[0] + "" + tags[1] + "" + template;
    let cached = cache.get(key);
    if (cached === undefined) {
      cached = parseTemplate(template, tags);
      cache.set(key, cached);
    }
    return cached;
  }
  return parseTemplate(template, tags);
}

function parseTemplate(template: string, tags: [string, string] = ["{{", "}}"]): Token[] {
  if (!template) return [];

  let lineHasNonSpace = false;
  const sections: Token[] = []; // stack of open section tokens
  const tokens: Token[] = []; // buffer of scanned tokens
  let spaces: number[] = []; // indices into tokens of whitespace on the current line
  let hasTag = false; // current line has a tag
  let nonSpace = false; // current line has a non-space, non-tag token
  let indentation = "";
  let tagIndex = 0;
  let lineTags: Token[] = []; // tag tokens emitted on the current line

  function stripSpace() {
    if (hasTag && !nonSpace) {
      // standalone line: mark its tag tokens (a block needs to know it opened
      // standalone, for reindentation), then strip the line's whitespace
      for (const t of lineTags) (t as unknown as unknown[])[10] = 1;
      while (spaces.length) tokens.splice(spaces.pop()!, 1);
    } else {
      spaces = [];
    }
    lineTags = [];
    hasTag = false;
    nonSpace = false;
  }

  let openTag = tags[0];
  let closeTag = tags[1];

  let pos = 0;
  const len = template.length;

  while (pos < len) {
    const start = pos;
    // scan literal text up to the next open tag
    const openerIdx = template.indexOf(openTag, pos);
    const textEnd = openerIdx === -1 ? len : openerIdx;
    let value = template.slice(pos, textEnd);
    if (value) {
      for (let i = 0; i < value.length; i++) {
        const chr = value.charAt(i);
        if (isWhitespace(chr)) {
          spaces.push(tokens.length);
          indentation += chr;
        } else {
          nonSpace = true;
          lineHasNonSpace = true;
          indentation += " ";
        }
        tokens.push(["text", chr, pos + i, pos + i + 1]);
        if (chr === "\n") {
          stripSpace();
          indentation = "";
          tagIndex = 0;
          lineHasNonSpace = false;
        }
      }
    }
    pos = textEnd;
    if (openerIdx === -1) break;

    // consume the open delimiter (plus following whitespace)
    if (!template.startsWith(openTag, pos)) break;
    pos += openTag.length;
    hasTag = true;

    // determine tag type
    let type = template.charAt(pos) || "name";
    let tagStart = pos;
    let content: string;

    if (type === "=") {
      // set delimiters: {{=<% %>=}}
      pos += 1;
      const endEq = template.indexOf("=" + closeTag, pos);
      if (endEq === -1) throw new Error("Unclosed tag at " + tagStart);
      content = template.slice(pos, endEq);
      pos = endEq + 1 + closeTag.length;
      const parts = content.trim().split(/\s+/);
      openTag = parts[0];
      closeTag = parts[parts.length - 1];
      tokens.push(["=", content.trim(), tagStart, pos]);
    } else if (type === "{") {
      // triple mustache {{{ }}} — an interpolation tag, never standalone
      const close = "}" + closeTag;
      const endIdx = template.indexOf(close, pos + 1);
      if (endIdx === -1) throw new Error("Unclosed tag at " + tagStart);
      content = template.slice(pos + 1, endIdx);
      pos = endIdx + close.length;
      tokens.push(["&", content.trim(), tagStart, pos]);
      nonSpace = true;
    } else {
      // sigils: # ^ section, / close, > partial, & unescaped, ! comment,
      // < parent (parametric partial), $ block (inheritance)
      const isSigil = "#^/>&!<$".includes(type);
      const contentStart = isSigil ? pos + 1 : pos;
      const endIdx = template.indexOf(closeTag, contentStart);
      if (endIdx === -1) {
        // unterminated tag — mustache.js throws here rather than emitting text
        throw new Error("Unclosed tag at " + tagStart);
      }
      content = template.slice(contentStart, endIdx).trim();
      pos = endIdx + closeTag.length;

      const norm = isSigil ? type : "name";
      // A partial (`>`), a parent (`<`), and a block (`$`) carry their line
      // indentation, whether the line had non-space content, and their per-line
      // tag index — for standalone detection and per-line indentation of the
      // injected/reindented template. Stored at high indices so the children slot
      // (token[4]) stays free for `<`/`$`.
      const token: Token = [norm, content, tagStart, pos];
      if (norm === ">" || norm === "<" || norm === "$") {
        (token as unknown as unknown[])[5] = lineHasNonSpace ? 1 : 0;
        (token as unknown as unknown[])[6] = tagIndex;
        (token as unknown as unknown[])[9] = indentation;
      }
      tokens.push(token);
      lineTags.push(token);

      if (norm === "#" || norm === "^" || norm === "<" || norm === "$") {
        // record the delimiters active at this section, for section-lambda re-parse
        (token as unknown as unknown[])[8] = [openTag, closeTag];
        sections.push(token);
      } else if (norm === "/") {
        // capture the section's RAW inner text (open-tag end → close-tag start)
        // for section lambdas, which receive the unrendered body
        const open = sections.pop();
        if (open) {
          (open as unknown as unknown[])[7] = template.slice(open[3], tagStart - openTag.length);
        }
      } else if (norm === "name" || norm === "&") {
        // interpolation tags are content, never standalone
        nonSpace = true;
      }
    }

    tagIndex++; // count tags per line; reset to 0 on each newline

    if (start === pos) break; // no progress guard
  }
  stripSpace();

  return nestTokens(squashTokens(tokens));
}

// merge adjacent text tokens
function squashTokens(tokens: Token[]): Token[] {
  const squashed: Token[] = [];
  let lastText: Token | null = null;
  for (const token of tokens) {
    if (token[0] === "text") {
      if (lastText) {
        lastText[1] += token[1];
        lastText[3] = token[3];
      } else {
        lastText = token;
        squashed.push(token);
      }
    } else {
      lastText = null;
      squashed.push(token);
    }
  }
  return squashed;
}

// nest section tokens into trees
function nestTokens(tokens: Token[]): Token[] {
  const root: Token[] = [];
  const collector: Token[][] = [root];
  const sections: Token[] = [];
  for (const token of tokens) {
    const target = collector[collector.length - 1];
    switch (token[0]) {
      case "#":
      case "^":
      case "<": // parent (parametric partial)
      case "$": // block
        target.push(token);
        sections.push(token);
        token[4] = [];
        collector.push(token[4]!);
        break;
      case "/": {
        // A close tag must match the innermost open section. An unmatched or
        // mismatched close means malformed input (or a tag not implemented); fail
        // closed with a Decline rather than crashing.
        const open = sections.pop();
        if (!open || open[1] !== token[1]) {
          throw new Decline(`section "${token[1]}" (unbalanced, or an unsupported block tag)`);
        }
        collector.pop();
        break;
      }
      default:
        target.push(token);
    }
  }
  if (sections.length) {
    throw new Decline(`section "${sections[sections.length - 1][1]}" is never closed`);
  }
  return root;
}

// ---- renderer ----

const hasOwn = Object.prototype.hasOwnProperty;

// names that must never resolve, even if present on the chain
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// A name is lookable if it is an own property, or one inherited from the view's own
// prototypes — but the walk stops before Object/Function/Array, so their built-ins
// (toString, constructor, …) never become template-visible, and the pollution keys
// are denied outright.
function hasProp(obj: object, name: string): boolean {
  if (DANGEROUS_KEYS.has(name)) return false;
  if (hasOwn.call(obj, name)) return true;
  let p = Object.getPrototypeOf(obj);
  while (p && p !== Object.prototype && p !== Function.prototype && p !== Array.prototype) {
    if (hasOwn.call(p, name)) return true;
    p = Object.getPrototypeOf(p);
  }
  return false;
}

// A dotted name's segments never change, so split once and memoize. Single-segment
// names (the common case) never reach here — they skip the split entirely.
const DOTTED = new Map<string, string[]>();
function dottedParts(name: string): string[] {
  let p = DOTTED.get(name);
  if (p === undefined) {
    p = name.split(".");
    DOTTED.set(name, p);
  }
  return p;
}

function lookup(name: string, stack: unknown[]): unknown {
  if (name === ".") return stack[stack.length - 1];
  // single-segment names (the common case) skip the split; dotted names take their
  // segments from the memo, so no substring/array is allocated per render.
  const parts = name.indexOf(".") === -1 ? null : dottedParts(name);
  const first = parts === null ? name : parts[0];
  let value: unknown;
  let found = false;
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    // named lookup only against object/function frames; a pushed string/number is
    // reachable via `{{.}}` but not by property name (so a section over "hello"
    // doesn't let `{{length}}` resolve to the string's 5)
    if (frame != null && (typeof frame === "object" || typeof frame === "function") && hasProp(frame, first)) {
      value = (frame as Record<string, unknown>)[first];
      found = true;
      break;
    }
  }
  if (!found) return undefined;
  if (parts !== null) {
    // dotted remainder: walk the rest by property access
    for (let i = 1; i < parts.length; i++) {
      if (value == null) return undefined;
      value = (value as Record<string, unknown>)[parts[i]];
    }
  }
  // a zero-argument function value is called here and its result used; a function
  // that takes arguments is left for the section handler to drive. The result is
  // used as text, never re-parsed.
  if (typeof value === "function" && (value as Function).length === 0) {
    value = (value as () => unknown).call(stack[stack.length - 1]);
  }
  return value;
}

function isFalsy(v: unknown): boolean {
  // falsy for a section: any JS-falsy value (incl. 0 and NaN) or an empty array.
  // The array clause is explicit because `![]` is false. Sections only — `{{0}}`
  // still prints "0".
  return !v || (Array.isArray(v) && v.length === 0);
}

// The common leading whitespace shared by every non-blank line.
function commonIndent(s: string): string {
  const lines = s.split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return "";
  let common: string | null = null;
  for (const l of lines) {
    const m = /^[ \t]*/.exec(l)![0];
    if (common === null || m.length < common.length) common = m;
  }
  return common ?? "";
}

// Reindent a standalone block's content: drop the leading newline, remove the
// content's own common indentation (its definition column), and prepend the target
// indentation `I` (its expansion column), restoring the trailing newline.
function reindentBlock(content: string, I: string): string {
  if (content.startsWith("\n")) content = content.slice(1);
  const lines = content.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const ci = commonIndent(lines.join("\n"));
  return lines.map((l) => (l.trim() === "" ? l : I + l.slice(ci.length))).join("\n") + "\n";
}

// Call an interpolation function; its return value is used as literal text and is
// never re-parsed as a template (so a returned `{{tag}}` cannot read the context).
function callInterpolationLambda(fn: unknown, stack: unknown[]): string {
  return String((fn as () => unknown).call(stack[stack.length - 1]));
}

// Inheritance: a map of block-name -> the overriding `$` block TOKEN (keeping the
// whole token, not just its children, so its standalone flag + indentation are
// available at the expansion site for reindentation).
type Blocks = Map<string, Token>;

function collectBlocks(childTokens: Token[], blocks: Blocks): Blocks {
  // outer overrides win, so only add a name not already present
  for (const t of childTokens) {
    if (t[0] === "$" && !blocks.has(t[1])) blocks.set(t[1], t);
  }
  return blocks;
}

function renderTokens(
  tokens: Token[],
  stack: unknown[],
  partials: Partials | undefined,
  indent: string,
  blocks: Blocks = new Map(),
): string {
  let out = "";
  for (const token of tokens) {
    const [type, value] = token;
    switch (type) {
      case "text":
        out += value;
        break;
      case "$": {
        // block: render the child's override if one exists, else the default
        const override = blocks.get(value);
        const source = override ?? token;
        const content = renderTokens(source[4] ?? [], stack, partials, indent, blocks);
        // Reindent when the expansion site OR the override source opened standalone.
        const expStandalone = Boolean((token as unknown as unknown[])[10]);
        const srcStandalone = Boolean((source as unknown as unknown[])[10]);
        if (expStandalone || srcStandalone) {
          // target indent I = the intrinsic indent of the expansion block's own
          // default content, else its line indent. Inner standalone blocks in
          // `content` have already reindented themselves; reindentBlock dedents the
          // whole to its common indent (definition removed) and prepends I.
          const def = renderTokens(token[4] ?? [], stack, partials, "", blocks);
          const lineIndent = String((token as unknown as unknown[])[9] ?? "");
          const I = commonIndent(def) || lineIndent;
          out += reindentBlock(content, I);
        } else {
          out += content;
        }
        break;
      }
      case "<": {
        // parent (parametric partial): expand the named partial with the child's
        // `$` blocks layered over any inherited overrides. When standalone, indent
        // each line of the parent source (spec: parent tags indent like partials).
        const tpl = getPartial(partials, value);
        if (tpl == null) break;
        const childBlocks = collectBlocks(token[4] ?? [], new Map(blocks));
        const ind = String((token as unknown as unknown[])[9] ?? "");
        const lineHasNonSpace = Boolean(token[5]);
        const tagIndex = Number((token as unknown as unknown[])[6] ?? 0);
        const src = tagIndex === 0 && ind ? indentPartial(tpl, ind, lineHasNonSpace) : tpl;
        out += renderTokens(parse(src, ["{{", "}}"]), stack, partials, "", childBlocks);
        break;
      }
      case "name": {
        let v = lookup(value, stack);
        if (typeof v === "function") v = callInterpolationLambda(v, stack);
        if (v != null) out += activeEscape(v);
        break;
      }
      case "&": {
        let v = lookup(value, stack);
        if (typeof v === "function") v = callInterpolationLambda(v, stack);
        if (v != null) out += String(v);
        break;
      }
      case "#": {
        const v = lookup(value, stack);
        if (typeof v === "function") {
          // Section value is a function: call it with the section's raw inner text
          // and a render callback. The callback (the lambda's own choice) may render
          // author text; the engine never re-parses the return value itself.
          const rawInner = String((token as unknown as unknown[])[7] ?? "");
          const delims = ((token as unknown as unknown[])[8] as [string, string]) ?? ["{{", "}}"];
          const subrender = (tpl: string): string =>
            renderTokens(parse(String(tpl), delims), stack, partials, "");
          // Call it with (rawInner, subrender); while the result is still a
          // function, call that the same way. A normal section function returns a
          // string on the first call; a double-wrapped function unwraps to its inner
          // one. The final non-function value is emitted as text, never re-parsed.
          let r: unknown = v;
          for (let guard = 0; typeof r === "function" && guard < 64; guard++) {
            r = (r as (t: string, cb: (s: string) => string) => unknown).call(
              stack[stack.length - 1],
              rawInner,
              subrender,
            );
          }
          if (r != null) out += String(r);
          break;
        }
        if (isFalsy(v)) break;
        // push/pop the shared stack (depth-first + synchronous) instead of copying it
        if (Array.isArray(v)) {
          const children = token[4]!;
          for (const item of v) {
            stack.push(item);
            out += renderTokens(children, stack, partials, indent, blocks);
            stack.pop();
          }
        } else if (typeof v === "object" || typeof v === "string" || typeof v === "number") {
          // truthy object/string/number is pushed onto the context stack, so `{{.}}`
          // and `{{foo}}` resolve against it (Mustache "Variable test").
          stack.push(v);
          out += renderTokens(token[4]!, stack, partials, indent, blocks);
          stack.pop();
        } else {
          // a boolean (or other non-object) is not pushed — its body renders in the
          // current frame, so a lambda inside a `{{#bool}}` keeps its `this`
          out += renderTokens(token[4]!, stack, partials, indent, blocks);
        }
        break;
      }
      case "^": {
        const v = lookup(value, stack);
        if (isFalsy(v)) out += renderTokens(token[4]!, stack, partials, indent, blocks);
        break;
      }
      case ">": {
        let name = value;
        if (name.charAt(0) === "*") {
          // dynamic partial: the name is resolved from the context
          const resolved = lookup(name.slice(1).trim(), stack);
          if (resolved == null) break;
          name = String(resolved);
        }
        const tpl = getPartial(partials, name);
        if (tpl == null) break;
        const ind = String((token as unknown as unknown[])[9] ?? "");
        const lineHasNonSpace = Boolean(token[5]);
        const tagIndex = Number((token as unknown as unknown[])[6] ?? 0);
        // indent only a partial that is the first tag on its line (reference guard)
        const src = tagIndex === 0 && ind ? indentPartial(tpl, ind, lineHasNonSpace) : tpl;
        out += renderTokens(parse(src, ["{{", "}}"]), stack, partials, "", blocks);
        break;
      }
      case "=":
      case "!":
        break;
    }
  }
  return out;
}

function indentPartial(partial: string, indentation: string, lineHasNonSpace: boolean): string {
  // Prepend the (space/tab-filtered) indentation to each non-empty line of the
  // partial source before it is parsed. The first line is indented only when the
  // partial tag's own line had no non-space content before it.
  const filtered = indentation.replace(/[^ \t]/g, "");
  const lines = partial.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length && (i > 0 || !lineHasNonSpace)) {
      lines[i] = filtered + lines[i];
    }
  }
  return lines.join("\n");
}

// ---- mustache.js-compatible public surface ----
// render/parse/escape/tags/clearCache/templateCache + the Writer/Context/Scanner classes,
// built on the two render-scoped hooks above (activeEscape/activeParseCache) and getPartial.

// render's optional 4th argument: a delimiter pair, or a config object.
export type RenderConfig = [string, string] | { tags?: [string, string]; escape?: (s: unknown) => string };

function configTags(config?: RenderConfig): [string, string] | undefined {
  if (config == null) return undefined;
  if (Array.isArray(config)) return config;
  return config.tags;
}
function configEscape(config?: RenderConfig): ((s: unknown) => string) | undefined {
  if (config == null || Array.isArray(config)) return undefined;
  return config.escape;
}

// mustache.js allows a Scanner to be used directly. Standard incremental scanner.
export class Scanner {
  string: string;
  tail: string;
  pos: number;
  constructor(string: string) {
    this.string = string;
    this.tail = string;
    this.pos = 0;
  }
  eos(): boolean {
    return this.tail === "";
  }
  // consume and return a leading match of `re`, or "" if it does not match at pos 0
  scan(re: RegExp): string {
    const match = re.exec(this.tail);
    if (!match || match.index !== 0) return "";
    const s = match[0];
    this.tail = this.tail.substring(s.length);
    this.pos += s.length;
    return s;
  }
  // consume up to (not including) the next match of `re`; return the skipped text
  scanUntil(re: RegExp): string {
    const index = this.tail.search(re);
    let match: string;
    if (index === -1) {
      match = this.tail;
      this.tail = "";
    } else if (index === 0) {
      match = "";
    } else {
      match = this.tail.substring(0, index);
      this.tail = this.tail.substring(index);
    }
    this.pos += match.length;
    return match;
  }
}

// mustache.js Context: a view plus a parent chain, with name lookup and a per-name
// cache. lookup() is delegated to the engine's own resolver over the flattened chain,
// so a Context passed to render resolves exactly as an equivalent nested view would.
export class Context {
  view: unknown;
  parent: Context | null;
  private cache: Record<string, unknown>;
  constructor(view: unknown, parent?: Context | null) {
    this.view = view;
    this.parent = parent ?? null;
    this.cache = { ".": view };
  }
  push(view: unknown): Context {
    return new Context(view, this);
  }
  // the view chain, root-first (leaf last) — the shape the engine's stack expects
  chain(): unknown[] {
    const arr: unknown[] = [];
    let c: Context | null = this;
    while (c) {
      arr.unshift(c.view);
      c = c.parent;
    }
    return arr;
  }
  lookup(name: string): unknown {
    if (name in this.cache) return this.cache[name];
    const v = lookup(name, this.chain());
    this.cache[name] = v;
    return v;
  }
}

// The shared render/parse core. Every public and Writer entry point calls these, differing
// only in which parse cache is active: the default cache (or none, when templateCache is
// disabled) for the bare functions; the Writer's own cache for a Writer. escape/tags come
// from the config or the module defaults — a Writer carries no escape/tags of its own.
function coreRender(
  cache: Map<string, Token[]> | null,
  template: string,
  view: unknown,
  partials: Partials | undefined,
  config?: RenderConfig,
): string {
  requireString(template);
  const prevE = activeEscape;
  const prevC = activeParseCache;
  activeEscape = configEscape(config) ?? DEFAULT_ESCAPE;
  activeParseCache = cache;
  try {
    const stack = view instanceof Context ? view.chain() : [view];
    return renderTokens(parse(template, configTags(config) ?? DEFAULT_TAGS), stack, partials, "");
  } finally {
    activeEscape = prevE;
    activeParseCache = prevC;
  }
}
function coreParse(cache: Map<string, Token[]> | null, template: string, tags?: [string, string]): Token[] {
  const prev = activeParseCache;
  activeParseCache = cache;
  try {
    return parse(template, tags ?? DEFAULT_TAGS);
  } finally {
    activeParseCache = prev;
  }
}

// mustache.js Writer: an isolated engine with its own template cache (no own escape/tags).
// render/parse/clearCache run the shared core against `this.cache`.
export class Writer {
  cache: Map<string, Token[]> | null = new Map();
  clearCache(): void {
    this.cache?.clear();
  }
  parse(template: string, tags?: [string, string]): Token[] {
    return coreParse(this.cache, template, tags);
  }
  render(template: string, view: unknown, partials?: Partials, config?: RenderConfig): string {
    return coreRender(this.cache, template, view, partials, config);
  }
}

function requireString(template: unknown): void {
  if (typeof template !== "string") {
    throw new TypeError(
      'Invalid template! Template should be a "string" ' +
        'but "' +
        (template === null ? "null" : typeof template) +
        '" was given as the first argument for mustache#render(template, view, partials)',
    );
  }
}

// The version reported by the public `version` property (the package version).
const VERSION = "1.0.1";

// A cache wrapper matching mustache.js's templateCache shape (set/get/clear), backed
// by the default parse cache.
const templateCacheWrapper = {
  set(key: string, value: Token[]) {
    DEFAULT_CACHE.set(key, value);
  },
  get(key: string): Token[] | undefined {
    return DEFAULT_CACHE.get(key);
  },
  clear() {
    DEFAULT_CACHE.clear();
  },
};

// Whether the bare render()/parse() cache templates. `templateCache = undefined`
// disables caching (mustache.js parity); assigning a cache-like object re-enables it.
let defaultCacheEnabled = true;

// Bare render/parse/clearCache: the shared core against the default cache (null when
// disabled via templateCache) — same core as a Writer, different active cache.
function defaultCache(): Map<string, Token[]> | null {
  return defaultCacheEnabled ? DEFAULT_CACHE : null;
}
export function render(template: string, view: unknown, partials?: Partials, config?: RenderConfig): string {
  return coreRender(defaultCache(), template, view, partials, config);
}

// parse (and prime the cache), like mustache.js#parse.
export function parseTemplatePublic(template: string, tags?: [string, string]): Token[] {
  return coreParse(defaultCache(), template, tags);
}

// clearCache empties the default parse cache (and the dotted-name memo), releasing the
// memory the parse cache would otherwise hold unbounded.
export function clearCache(): void {
  DEFAULT_CACHE.clear();
  DOTTED.clear();
}

// The default export mirrors mustache.js's module object: render/parse/clearCache,
// mutable `tags`/`escape`, `templateCache`, the Writer/Context/Scanner classes,
// `version`, and `name`. moose's own `Decline` is carried alongside.
const mustache = {
  // `name` is a string as in mustache.js, but names this engine (not an impersonation).
  name: "moose-stash",
  version: VERSION,
  Scanner,
  Context,
  Writer,
  Decline,
  render,
  parse: parseTemplatePublic,
  clearCache,
  get tags(): [string, string] {
    return DEFAULT_TAGS;
  },
  set tags(v: [string, string]) {
    DEFAULT_TAGS = v;
  },
  get escape(): (s: unknown) => string {
    return DEFAULT_ESCAPE;
  },
  set escape(fn: (s: unknown) => string) {
    DEFAULT_ESCAPE = fn;
  },
  get templateCache(): typeof templateCacheWrapper | undefined {
    return defaultCacheEnabled ? templateCacheWrapper : undefined;
  },
  set templateCache(v: unknown) {
    if (v == null) {
      defaultCacheEnabled = false;
    } else {
      defaultCacheEnabled = true;
    }
  },
};

// `parse` is exported under its mustache name too (the bare-function name above is
// distinct only to avoid colliding with the internal parser).
export { parseTemplatePublic as parse };

export default mustache;
