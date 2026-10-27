// HTML + CSS scaffold from a decoded Pixso tree (selectTree output, icons collapsed).
// Auto layout -> flexbox, everything else -> absolute positioning; paints, borders,
// radii, shadows, blur, rotation, clipping and text styles -> CSS; icons/vectors ->
// inline SVG; images -> grey placeholders. Identical rule bodies share one class.
// A starting point for an agent to refactor into components, not pixel-perfect output.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { decodeDocument, selectTree, collapseRepeats } from "./pixso-kiwi.mjs";
import { iconize } from "./pixso-svg.mjs";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const px = (v) => `${Math.round(v * 100) / 100}px`;
const VECTORISH = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "REGULAR_POLYGON"]);

// "#rrggbb[aa]" + paint opacity -> CSS color
function cssColor(hex, opacity = 1) {
  if (!hex) return "transparent";
  const a = (hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1) * opacity;
  if (a >= 0.999) return hex.slice(0, 7);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}
function paintCSS(p, st, styleName) {
  if (!p) return null;
  if (typeof p === "string") return { color: tokenized(cssColor(p), styleName, st) };
  const op = p.opacity ?? 1;
  if (p.color) return { color: tokenized(cssColor(p.color, op), p.var || styleName, st) };
  const stops = (p.stops || []).map((s) => `${cssColor(s.color, op)} ${Math.round(s.at * 1000) / 10}%`).join(", ");
  if (p.type === "GRADIENT_LINEAR") return { image: `linear-gradient(${p.angle ?? 180}deg, ${stops})` };
  if (p.type === "GRADIENT_RADIAL" || p.type === "GRADIENT_DIAMOND") return { image: `radial-gradient(circle at ${Math.round((p.from?.[0] ?? 0.5) * 100)}% ${Math.round((p.from?.[1] ?? 0.5) * 100)}%, ${stops})` };
  if (p.type === "GRADIENT_ANGULAR") return { image: `conic-gradient(${stops})` };
  if (p.type === "IMAGE") { st.images++; return { color: "#d9d9d9", image: null, comment: `image ${p.hash || ""} ${p.scaleMode || ""}`.trim() }; }
  return null;
}
// Color bound to a variable / named style -> var(--name), declared once in :root.
const varSlug = (name) => "--" + String(name).toLowerCase().replace(/[а-яё]/g, (ch) => TR[ch]).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function tokenized(css, name, st) {
  if (!name || !css || !st?.vars) return css;
  const v = varSlug(name);
  if (!st.vars.has(v)) st.vars.set(v, css);
  return `var(${v})`;
}
const solid = (p) => !p ? null : typeof p === "string" ? cssColor(p) : p.color ? cssColor(p.color, p.opacity ?? 1) : p.stops?.[0] ? cssColor(p.stops[0].color) : null;

const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", "space-between": "space-between" };
const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const CASE = { upper: "uppercase", lower: "lowercase", title: "capitalize", small_caps: "small-caps" };

function fontCSS(t, out, st) {
  if (t.fontFamily) out["font-family"] = `"${t.fontFamily}", sans-serif`;
  if (t.fontSize) out["font-size"] = px(t.fontSize);
  if (t.fontWeight) out["font-weight"] = t.fontWeight;
  if (t.italic) out["font-style"] = "italic";
  if (t.lineHeight != null) out["line-height"] = typeof t.lineHeight === "number" ? px(t.lineHeight) : t.lineHeight;
  if (t.letterSpacing != null) out["letter-spacing"] = typeof t.letterSpacing === "number" ? px(t.letterSpacing) : t.letterSpacing;
  if (t.textDecoration) out["text-decoration"] = t.textDecoration === "strikethrough" ? "line-through" : t.textDecoration;
  if (t.textCase) { if (t.textCase.startsWith("small_caps")) out["font-variant"] = "small-caps"; else out["text-transform"] = CASE[t.textCase]; }
  const f0 = t.fills?.[0], c = solid(f0); if (c) out.color = tokenized(c, f0?.var || t.fillStyle, st);
  return out;
}

// CSS declarations for one node, given its parent (for positioning).
function nodeCSS(n, parent, st) {
  const c = {};
  const flexChild = parent?.autoLayout && n.position !== "absolute";
  const isText = n.type === "TEXT";
  const al = n.autoLayout;
  // --- box / position
  if (!parent) c.position = "relative";
  else if (!flexChild) { c.position = "absolute"; c.left = px(n.x || 0); c.top = px(n.y || 0); }
  const horizParent = parent?.autoLayout?.mode === "horizontal";
  const mainGrow = flexChild && n.layoutGrow, crossStretch = flexChild && n.alignSelf === "stretch";
  const hugW = (al && al.width === "hug") || (isText && n.textResize === "hug");
  const hugH = (al && al.height === "hug") || (isText && n.textResize !== "fixed");
  const setW = !(hugW || (mainGrow && horizParent) || (crossStretch && !horizParent));
  const setH = !(hugH || (mainGrow && !horizParent) || (crossStretch && horizParent));
  if (setW && n.w != null) c.width = px(n.w);
  if (setH && n.h != null) c.height = px(n.h);
  if (mainGrow) { c.flex = "1 1 0"; c[horizParent ? "min-width" : "min-height"] = 0; }
  else if (flexChild) c["flex-shrink"] = 0;
  if (crossStretch) c["align-self"] = "stretch";
  if (n.min) { c["min-width"] = px(n.min[0]); c["min-height"] = px(n.min[1]); }
  if (n.max) { c["max-width"] = px(n.max[0]); c["max-height"] = px(n.max[1]); }
  if (n.rotation && !flexChild) { c.transform = `rotate(${n.rotation}deg)`; c["transform-origin"] = "0 0"; }
  // --- auto layout container
  if (al) {
    c.display = "flex";
    c["flex-direction"] = al.mode === "vertical" ? "column" : "row";
    if (al.gap) c.gap = px(al.gap);
    if (al.wrap) { c["flex-wrap"] = "wrap"; if (al.rowGap) c["row-gap"] = px(al.rowGap); }
    if (al.padding) c.padding = al.padding.map(px).join(" ");
    if (al.justify) c["justify-content"] = JUSTIFY[al.justify] || "flex-start";
    c["align-items"] = ALIGN[al.align] || "flex-start";
  } else if (n.children?.length) c.position ??= "relative";
  // --- paint (vector/icon nodes are drawn by their svg)
  const drawnBySvg = !!n.svg;
  if (!isText && !drawnBySvg) {
    const layers = [...(n.fills || [])].reverse().map((p, i, a) => paintCSS(p, st, i === a.length - 1 ? n.fillStyle : null)).filter(Boolean); // CSS: first layer on top
    if (n.background) layers.push({ color: cssColor(n.background) });
    const colorLayer = layers.filter((l) => l.color && !l.image).pop();
    const images = layers.filter((l) => l.image).map((l) => l.image);
    if (images.length) c["background-image"] = images.join(", ");
    if (colorLayer) c["background-color"] = colorLayer.color;
    const note = layers.find((l) => l.comment); if (note) c["/*"] = `${note.comment} */`;
    if (n.type === "ELLIPSE") c["border-radius"] = "50%";
    const s = n.strokes?.[0];
    if (s) {
      const col = tokenized(solid(s), s.var || n.strokeStyle, st), w = n.strokeWeight || 1, style = n.dash ? "dashed" : "solid";
      if (n.borderWeights) { const [t, r, b, l] = n.borderWeights; c["border-style"] = style; c["border-color"] = col; c["border-width"] = [t, r, b, l].map(px).join(" "); }
      else if (n.strokeAlign === "outside") { c.outline = `${px(w)} ${style} ${col}`; }
      else c.border = `${px(w)} ${style} ${col}`;
    }
  }
  if (n.cornerRadius && n.type !== "ELLIPSE") c["border-radius"] = Array.isArray(n.cornerRadius) ? n.cornerRadius.map(px).join(" ") : px(n.cornerRadius);
  const shadows = (n.effects || []).filter((e) => e.type?.includes("SHADOW"))
    .map((e) => `${e.type === "INNER_SHADOW" ? "inset " : ""}${px(e.x || 0)} ${px(e.y || 0)} ${px(e.blur || 0)} ${px(e.spread || 0)} ${cssColor(e.color || "#00000040", e.opacity ?? 1)}`);
  if (shadows.length && !isText) c["box-shadow"] = shadows.join(", ");
  for (const e of n.effects || []) {
    if (e.type === "FOREGROUND_BLUR" || e.type === "LAYER_BLUR") c.filter = `blur(${px((e.blur || 0) / 2)})`;
    if (e.type === "BACKGROUND_BLUR") c["backdrop-filter"] = `blur(${px((e.blur || 0) / 2)})`;
  }
  if (n.opacity != null) c.opacity = n.opacity;
  if (n.blendMode) c["mix-blend-mode"] = n.blendMode.replace(/_/g, "-");
  if (n.scroll) c.overflow = n.scroll === "vertical" ? "hidden auto" : n.scroll === "horizontal" ? "auto hidden" : "auto";
  else if (n.clipsContent && n.children?.length) c.overflow = "hidden";
  if (n.fixedOnScroll && c.position === "absolute") c.position = "sticky";
  if (n.interactions?.some((i) => i.on === "click" || i.on === "press" || i.on === "dblclick")) c.cursor = "pointer";
  // --- text
  if (isText) {
    fontCSS(n, c, st);
    if (n.textAlign) c["text-align"] = n.textAlign === "justified" ? "justify" : n.textAlign;
    c["white-space"] = n.textResize === "hug" ? "pre" : "pre-wrap";
    if (n.verticalAlign && n.textResize === "fixed") { c.display = "flex"; c["flex-direction"] = "column"; c["justify-content"] = n.verticalAlign === "bottom" ? "flex-end" : "center"; }
    if (n.paragraphSpacing) c["--paragraph-spacing"] = px(n.paragraphSpacing);
    if (n.truncate) {
      c.overflow = "hidden"; c["text-overflow"] = "ellipsis";
      if (typeof n.truncate === "number" && n.truncate > 1) { c.display = "-webkit-box"; c["-webkit-box-orient"] = "vertical"; c["-webkit-line-clamp"] = n.truncate; c["white-space"] = "pre-wrap"; }
      else c["white-space"] = "nowrap";
    }
  }
  if (n.svg && !c.position) c.position = "relative"; // anchor for the absolutely placed <svg>
  if (n.mask) { c.display = "none"; st.masks++; }
  return c;
}

// Cyrillic -> Latin so class names stay readable for Russian layer names
const TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const slug = (s, fallback) => String(s || "").toLowerCase().replace(/[а-яё]/g, (ch) => TR[ch]).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28).replace(/^(\d)/, "n$1") || fallback;

// tree roots -> {html, css, stats}
export function toHTML(roots, { title = "Pixso export", fonts = true } = {}) {
  const st = { elements: 0, texts: 0, icons: 0, images: 0, masks: 0, classes: 0 };
  Object.defineProperty(st, "vars", { value: new Map(), enumerable: false }); // CSS custom properties
  const rules = new Map(), used = new Set(), families = new Map();
  // one class per (base name, style): "row 0" … "row 299" with equal styles share .row
  const classFor = (n, decl) => {
    const body = Object.entries(decl).map(([k, v]) => k === "/*" ? `/* ${v}` : `${k}: ${v};`).join(" ");
    const base = slug(n.component || n.name, n.type === "TEXT" ? "text" : "el").replace(/-?\d+$/, "") || (n.type === "TEXT" ? "text" : "el");
    const key = base + "|" + body;
    if (rules.has(key)) return rules.get(key).name;
    let name = base, i = 2;
    while (used.has(name)) name = `${base}-${i++}`;
    used.add(name); rules.set(key, { name, body }); st.classes++;
    return name;
  };
  const font = (t) => { if (t.fontFamily) { const w = families.get(t.fontFamily) || families.set(t.fontFamily, new Set()).get(t.fontFamily); w.add(t.fontWeight || 400); } };
  const el = (n, parent, depth) => {
    if (n.type === "REPEAT") { // collapsed list tail
      st.repeated = (st.repeated || 0) + n.repeated;
      const items = n.items.map((t) => "\n" + "  ".repeat(depth + 1) + "- " + t.replace(/--/g, "—")).join("");
      return `${"  ".repeat(depth)}<!-- …${n.repeated} more like data-pixso-id="${esc(n.like)}" (${n.ids.join(" … ")}); their texts:${items}\n${"  ".repeat(depth)}-->`;
    }
    st.elements++;
    const decl = nodeCSS(n, parent, st), cls = classFor(n, decl), pad = "  ".repeat(depth);
    const action = (n.interactions || []).map((i) => `${i.on}→${i.action}${i.to ? " " + (i.to.name || i.to.id) : ""}${i.url ? " " + i.url : ""}`).join("; ");
    const attrs = `class="${cls}" data-pixso-id="${esc(n.id)}"${n.name ? ` data-name="${esc(n.name)}"` : ""}${n.component ? ` data-component="${esc(n.component)}"` : ""}${action ? ` data-action="${esc(action)}"` : ""}`;
    if (n.type === "TEXT") {
      st.texts++; font(n);
      const inner = n.runs ? n.runs.map((r) => {
        font({ ...n, ...r });
        const rc = fontCSS(r, {}, st);
        const style = Object.entries(rc).map(([k, v]) => `${k}: ${v}`).join("; ");
        return style ? `<span style="${esc(style)}">${esc(r.text)}</span>` : esc(r.text);
      }).join("") : esc(n.text || "");
      return `${pad}<p ${attrs}>${inner}</p>`;
    }
    if (n.svg) { // natural size at its viewBox offset: strokes/arrowheads may stick out of a 0-height box
      st.icons++;
      const [vx, vy, vw, vh] = (/viewBox="([^"]+)"/.exec(n.svg)?.[1] || "0 0 0 0").split(" ").map(Number);
      return `${pad}<div ${attrs}>${n.svg.replace("<svg ", `<svg style="position:absolute;left:${px(vx)};top:${px(vy)};width:${px(vw)};height:${px(vh)};overflow:visible" `)}</div>`;
    }
    const kids = (n.children || []).map((k) => el(k, n, depth + 1));
    return kids.length ? `${pad}<div ${attrs}>\n${kids.join("\n")}\n${pad}</div>` : `${pad}<div ${attrs}></div>`;
  };
  // size-less roots (pages) wrap their children on a canvas sized to the content
  const body = roots.map((r) => {
    if (r.w || r.h || !r.children?.length) return el(r, null, 0);
    const minX = Math.min(...r.children.map((k) => k.x || 0)), minY = Math.min(...r.children.map((k) => k.y || 0));
    const shifted = { ...r, w: Math.max(...r.children.map((k) => (k.x || 0) + (k.w || 0))) - minX, h: Math.max(...r.children.map((k) => (k.y || 0) + (k.h || 0))) - minY,
      children: r.children.map((k) => Object.assign(Object.create(Object.getPrototypeOf(k)), k, { x: (k.x || 0) - minX, y: (k.y || 0) - minY })) };
    return el(shifted, null, 0);
  }).join("\n");
  const root = st.vars.size ? `:root { ${[...st.vars].map(([k, v]) => `${k}: ${v};`).join(" ")} }\n` : "";
  const css = root + "*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n" +
    [...rules.values()].map(({ name, body }) => `.${name} { ${body} }`).join("\n");
  const link = fonts && families.size ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${[...families].map(([f, w]) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@${[...w].sort((a, b) => a - b).join(";")}`).join("&")}&display=swap">\n` : "";
  const html = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(title)}</title>\n${link}<style>\n${css}\n</style></head>\n<body>\n${body}\n</body></html>\n`;
  return { html, stats: st };
}

export function documentHTML(rawNodes, node, opts = {}) {
  const roots = iconize(selectTree(rawNodes, node || null, opts));
  if (opts.repeats !== false) collapseRepeats(roots);
  if (node && !roots.length) throw new Error(`node "${node}" not found (use pixso_find to get an id)`);
  return toHTML(roots, { title: roots[0]?.name || "Pixso export", ...opts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nodes = decodeDocument(readFileSync(process.argv[2] || "doc.bin"));
  process.stdout.write(documentHTML(nodes, process.argv[3]).html);
}
