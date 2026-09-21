"use strict";

/* ===== ثوابت ===== */
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OR_BASE = "https://openrouter.ai/api/v1";
const GEMINI_DEFAULT = "gemini-2.5-flash";
const OR_DEFAULT = "google/gemma-4-31b-it:free";
const MAX_FILE_MB = 15;
const SRC_STORE_CAP = 40000; /* أقصى عدد حروف من النص الأصلي تُحفظ مع السجل */

const LS = {
  provider: "qa_provider",
  fallback: "qa_fallback",
  keyGemini: "qa_key_gemini",
  keyOR: "qa_key_openrouter",
  modelGemini: "qa_model_gemini",
  modelOR: "qa_model_openrouter",
  history: "qa_history"
};

const $ = (id) => document.getElementById(id);

let attached = null; /* { mime, name, text?, data?, dataUrl?, url? } */
let last = { summary: "", translation: "" };
let currentSource = { kind: "none" }; /* { kind: "text"|"pdf"|"image"|"none", text?, url?, name? } */
let currentCites = []; /* نصوص الاقتباسات بترتيب أرقام المصادر */
let running = false;

const PROMPT = `أنت مساعد قانوني محترف يعمل لمحامٍ مصري.

المطلوب منك شيئان معًا:

1) الملخص: اكتب ملخصًا قانونيًا بالعربية الفصحى للوثيقة، على شكل أقسام بهذا الترتيب:

### نوع القضية والأطراف
- (نقاط)
### الوقائع
- (نقاط)
### الطلبات أو المطالب
- (نقاط)
### التواريخ والمواعيد المهمة
- (نقاط)
### المبالغ المالية
- (نقاط)
### نقاط قانونية أو إجراءات مطلوبة
- (نقاط)

كن دقيقًا ولا تضف معلومات غير موجودة في الوثيقة. إذا لم يتوفر بند، اكتب "غير مذكور".
استخدم عناوين الأقسام بعلامة ### والنقاط بشرطة فقط، ولا تستخدم أي رموز تنسيق أخرى.

قواعد الاقتباس (مهمة جدًا):
- بعد كل نقطة، أضف الجزء الدال من نص الوثيقة الذي تدعمه هذه النقطة، منسوخًا حرفيًا كما هو.
- ضع الاقتباس بين علامتي ‹ و › هكذا: - (النقطة) ‹النص الحرفي من الوثيقة›
- الاقتباس قصير: من 5 إلى 20 كلمة، بدون تغيير أو تلخيص أو نقاط حذف، وفي سطر واحد.
- لا تختلق اقتباسات أبدًا. إذا لم تجد نصًا حرفيًا يدعم النقطة، اكتب النقطة بدون اقتباس.

2) الترجمة: ترجم الوثيقة كاملة إلى اللغة الأخرى: إذا كانت الوثيقة بالعربية فترجمها إلى الإنجليزية، وإذا كانت بالإنجليزية فترجمها إلى العربية، وإذا كانت بلغة أخرى فترجمها إلى العربية. الترجمة كاملة ودقيقة وبأسلوب قانوني رسمي، مع الحفاظ على أسماء الأطراف والمحاكم والتواريخ والأرقام كما هي، ولا تختصر أي جزء، وبدون أي علامات ‹ › أو اقتباسات في هذا القسم.

أخرج النتيجة بهذا الشكل بالضبط، دون أي مقدمات:

## الملخص
(الملخص هنا)

## الترجمة
(الترجمة الكاملة هنا)`;

/* ===== أدوات عامة ===== */
class ApiError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = !!retryable;
  }
}

function show(el, on) { el.classList.toggle("hidden", !on); }
function short(s) { s = String(s || ""); return s.length > 200 ? s.slice(0, 200) + "..." : s; }
function labelOf(p) { return p === "gemini" ? "Gemini" : "OpenRouter"; }
function setStatus(msg, isErr) {
  const el = $("runStatus");
  el.textContent = msg || "";
  el.classList.toggle("err", !!isErr);
}
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function dateAr() {
  try { return new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" }); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}

function provider() { return localStorage.getItem(LS.provider) || "gemini"; }
function keyFor(p) { return (localStorage.getItem(p === "gemini" ? LS.keyGemini : LS.keyOR) || "").trim(); }
function modelFor(p) { return localStorage.getItem(p === "gemini" ? LS.modelGemini : LS.modelOR) || (p === "gemini" ? GEMINI_DEFAULT : OR_DEFAULT); }
function saveModelFor(p, id) { localStorage.setItem(p === "gemini" ? LS.modelGemini : LS.modelOR, id); }

/* ===== قراءة الملفات ===== */
async function toB64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
async function toDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function b64ToBlobUrl(b64, mime) {
  try {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([u8], { type: mime }));
  } catch (e) { return null; }
}

/* ===== الإعدادات ===== */
function addModelOption(id, select) {
  const sel = $("modelSel");
  if (![...sel.options].some(o => o.value === id)) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
  if (select) sel.value = id;
}

function syncSettingsToProvider() {
  const p = provider();
  $("apiKey").value = keyFor(p);
  $("apiKey").placeholder = p === "gemini" ? "AIza..." : "sk-or-v1-...";
  const sel = $("modelSel");
  sel.innerHTML = "";
  addModelOption(modelFor(p), true);
  $("saveStatus").textContent = "";
  $("saveStatus").classList.remove("err");
}

async function saveKey() {
  const p = provider();
  const k = $("apiKey").value.trim();
  if (!k) { $("saveStatus").textContent = "اكتب المفتاح أولًا"; return; }
  localStorage.setItem(p === "gemini" ? LS.keyGemini : LS.keyOR, k);
  $("saveStatus").textContent = "تم الحفظ على هذا الجهاز";
  $("saveStatus").classList.remove("err");
  refreshModels(false);
}

function cmpGeminiScore(id) {
  let s = 0;
  if (/flash-lite/.test(id)) s -= 1; else if (/flash/.test(id)) s += 1;
  if (/preview|exp/.test(id)) s -= 2;
  if (/pro/.test(id)) s -= 1;
  return s;
}
function geminiVer(id) {
  const m = id.match(/^gemini-(\d+)(?:\.(\d+))?/);
  return m ? parseInt(m[1], 10) * 1000 + (m[2] ? parseInt(m[2], 10) : 0) : 0;
}
function pickGeminiDefault(ids) {
  if (ids.includes("gemini-2.5-flash")) return "gemini-2.5-flash";
  if (ids.includes("gemini-3-flash")) return "gemini-3-flash";
  const plain = ids.filter(id => /^gemini-[\d.]+-flash$/.test(id));
  if (plain.length) return plain.sort((a, b) => geminiVer(b) - geminiVer(a))[0];
  return ids[0];
}

function isFreeOR(m) {
  const pr = m.pricing || {};
  return String(pr.prompt) === "0" && String(pr.completion) === "0";
}
function isChatOR(m) {
  const id = m.id || "";
  return !/lyria|content-safety|whisper|embed|moderation|safety/.test(id);
}
function scoreOR(id) {
  let s = 0;
  if (/qwen|gemma|glm|mistral|llama|nemotron|kimi/.test(id)) s += 3;
  if (/550b|120b|70b|32b|31b|27b/.test(id)) s += 2;
  if (/mini|nano|small|flash|lite/.test(id)) s -= 1;
  return s;
}
function pickORDefault(ids) {
  const g = ids.find(id => /gemma-4-31b/.test(id)); if (g) return g;
  const q = ids.find(id => /qwen/.test(id)); if (q) return q;
  return ids[0];
}

async function refreshModels(quiet) {
  const p = provider();
  const key = keyFor(p);
  if (!quiet) { $("saveStatus").textContent = "جاري تحديث القائمة..."; $("saveStatus").classList.remove("err"); }
  try {
    let ids = [];
    if (p === "gemini") {
      if (!key) { if (!quiet) $("saveStatus").textContent = "ضع المفتاح أولًا"; return; }
      const res = await fetch(`${GEMINI_BASE}/models`, { headers: { "x-goog-api-key": key } });
      let data = null; try { data = await res.json(); } catch (e) {}
      if (!res.ok) throw new ApiError(apiErrorMessage(res.status, data, false), false);
      ids = (data.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map(m => (m.name || "").replace(/^models\//, ""))
        .filter(id => id.startsWith("gemini") && !/(embedding|aqa|imagen|tts|image|live|audio|native|robotics)/.test(id));
      ids.sort((a, b) => cmpGeminiScore(b) - cmpGeminiScore(a) || geminiVer(b) - geminiVer(a));
    } else {
      const res = await fetch(`${OR_BASE}/models`);
      let data = null; try { data = await res.json(); } catch (e) {}
      if (!res.ok) throw new ApiError("تعذر جلب قائمة موديلات OpenRouter", false);
      ids = (data.data || []).filter(m => isFreeOR(m) && isChatOR(m)).map(m => m.id);
      ids.sort((a, b) => scoreOR(b) - scoreOR(a));
    }
    if (!ids.length) throw new ApiError("لا توجد موديلات متاحة", false);
    const sel = $("modelSel");
    sel.innerHTML = "";
    ids.forEach(id => addModelOption(id, false));
    const saved = modelFor(p);
    sel.value = ids.includes(saved) ? saved : (p === "gemini" ? pickGeminiDefault(ids) : pickORDefault(ids));
    saveModelFor(p, sel.value);
    if (!quiet) { $("saveStatus").textContent = "تم تحديث القائمة"; $("saveStatus").classList.remove("err"); }
  } catch (e) {
    if (!quiet) {
      $("saveStatus").textContent = e && e.message ? e.message : "تعذر تحديث القائمة";
      $("saveStatus").classList.add("err");
    }
  }
}

/* ===== النداءات ===== */
function apiErrorMessage(status, data, isOR) {
  const err = (data && data.error) || {};
  const msg = String(err.message || "");
  const st = String(err.status || "");
  if (isOR) {
    if (status === 401) return "مفتاح OpenRouter غير صحيح. راجع الإعدادات.";
    if (status === 402) return "رصيد OpenRouter غير كافٍ.";
    if (status === 429) return "الحد المجاني لـ OpenRouter غير متاح حاليًا. جرب بعد شوية.";
    if (status === 404) return "الموديل غير متاح حاليًا. اختر موديلًا آخر من الإعدادات.";
    if (status >= 500) return "خدمة OpenRouter مشغولة حاليًا. جرب تاني بعد شوية.";
    return "خطأ من OpenRouter: " + short(msg || status);
  }
  if (status === 400 && /api key/i.test(msg + st)) return "مفتاح Gemini غير صحيح. راجع الإعدادات.";
  if (status === 400) return "الطلب غير صالح: " + short(msg);
  if (status === 403) return "المفتاح ممنوع أو الخدمة غير متاحة لحسابك.";
  if (status === 404) return "الموديل غير متاح. اضغط تحديث القائمة واختر موديلًا آخر.";
  if (status === 429) return "الحد المجاني لـ Gemini غير متاح حاليًا. استنى دقيقة وجرب تاني.";
  if (status >= 500) return "خدمة Gemini مشغولة حاليًا. جرب تاني بعد شوية.";
  return "خطأ من الخدمة: " + short(msg || status);
}
function isRetryable(status) { return status === 429 || status >= 500; }

async function callGemini(key, text) {
  const model = modelFor("gemini");
  const parts = [{ text: PROMPT }];
  if (attached && attached.mime === "text/plain") parts.push({ text: "\n\nنص الوثيقة:\n" + attached.text });
  else if (attached) parts.push({ inlineData: { mimeType: attached.mime, data: attached.data } });
  if (text) parts.push({ text: "\n\nنص الوثيقة:\n" + text });

  const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 32768 }
    })
  });
  let data = null; try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new ApiError(apiErrorMessage(res.status, data, false), isRetryable(res.status));
  const cand = data && data.candidates && data.candidates[0];
  const outText = ((cand && cand.content && cand.content.parts) || []).map(x => x.text || "").join("").trim();
  if (!outText) {
    const reason = (cand && cand.finishReason) || "";
    throw new ApiError("لم يرجع الموديل أي نتيجة" + (reason ? " (" + reason + ")" : ""), false);
  }
  return { parsed: parseOutput(outText), model, provider: "gemini", truncated: cand.finishReason === "MAX_TOKENS" };
}

async function callOpenRouter(key, text) {
  const model = modelFor("openrouter");
  if (attached && attached.mime === "application/pdf") {
    throw new ApiError("قراءة ملفات PDF متاحة على Gemini فقط. اختر Gemini أو الصق نص الوثيقة.", false);
  }
  const base = PROMPT + (text ? "\n\nنص الوثيقة:\n" + text : "");
  let content;
  if (attached && attached.mime === "text/plain") content = base + "\n\nنص الوثيقة:\n" + attached.text;
  else if (attached) content = [{ type: "text", text: base }, { type: "image_url", image_url: { url: attached.dataUrl } }];
  else content = base;

  const res = await fetch(`${OR_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature: 0.2,
      max_tokens: 8192
    })
  });
  let data = null; try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new ApiError(apiErrorMessage(res.status, data, true), isRetryable(res.status));
  const ch = data && data.choices && data.choices[0];
  const outText = String((ch && ch.message && ch.message.content) || "").trim();
  if (!outText) throw new ApiError("لم يرجع الموديل أي نتيجة", false);
  return { parsed: parseOutput(outText), model, provider: "openrouter", truncated: ch.finish_reason === "length" };
}

async function callProvider(p, key, text) {
  return p === "gemini" ? callGemini(key, text) : callOpenRouter(key, text);
}

/* ===== تحليل مخرجات الموديل ===== */
function parseOutput(t) {
  t = String(t || "").trim();
  const m = t.match(/##\s*الملخص\s*([\s\S]*?)\s*##\s*الترجمة\s*([\s\S]*)$/);
  if (m) return { summary: m[1].trim(), translation: m[2].trim() };
  const i = t.indexOf("## الترجمة");
  if (i >= 0) {
    return {
      summary: t.slice(0, i).replace(/##\s*الملخص/, "").trim(),
      translation: t.slice(i + "## الترجمة".length).trim()
    };
  }
  return { summary: t, translation: "" };
}

function stripCiteMarks(t) { return String(t || "").replace(/[‹›]/g, ""); }
function stripCitesForCopy(t) {
  return String(t || "").replace(/‹[^›]*›/g, "").replace(/[‹›]/g, "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

/* ===== تحويل الماركداون إلى كتل ===== */
/* كتلة: { kind: "h2"|"h3"|"p"|"li"|"oli"|"hr", num?, spans: [{ t, b?, i?, code?, cite?, ci? }] } */
function inlineSpans(text, ctx) {
  const spans = [];
  const re = /‹([^›]+)›|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let lastIdx = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > lastIdx) spans.push({ t: text.slice(lastIdx, m.index) });
    if (m[1] != null) {
      const span = { t: m[1].trim(), cite: true, ci: ctx.n++ };
      ctx.quotes.push(span.t);
      spans.push(span);
    } else if (m[2] != null) spans.push({ t: m[2], b: true });
    else if (m[3] != null) spans.push({ t: m[3], i: true });
    else if (m[4] != null) spans.push({ t: m[4], code: true });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) spans.push({ t: text.slice(lastIdx) });
  return spans.map(s => {
    if (!s.cite && s.t != null) s.t = s.t.replace(/\*+/g, "").replace(/[‹›]/g, "");
    return s;
  }).filter(s => s.cite || s.t);
}

function parseBlocksMd(md, ctx) {
  let s = String(md || "").replace(/\r\n?/g, "\n");
  /* اقتباس يمتد على أكثر من سطر: نضمه في سطر واحد */
  s = s.replace(/‹([^›]*\n[^›]*)›/g, (all, inner) => "‹" + inner.replace(/\s+/g, " ").trim() + "›");
  const lines = s.split("\n");
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) { blocks.push({ kind: "p", spans: inlineSpans(para.join(" "), ctx) }); para = []; }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      blocks.push({ kind: m[1].length <= 2 ? "h2" : "h3", spans: inlineSpans(m[2], ctx) });
      continue;
    }
    if (/^(---+|\*\*\*+|___+)$/.test(line)) { flush(); blocks.push({ kind: "hr" }); continue; }
    if ((m = line.match(/^[-*•]\s+(.*)$/))) { flush(); blocks.push({ kind: "li", spans: inlineSpans(m[1], ctx) }); continue; }
    if ((m = line.match(/^(\d+)[.)]\s+(.*)$/))) { flush(); blocks.push({ kind: "oli", num: m[1], spans: inlineSpans(m[2], ctx) }); continue; }
    para.push(line);
  }
  flush();
  return blocks;
}

function spansHtml(spans, mode) {
  return spans.map(s => {
    if (s.cite) {
      if (mode === "print") return '<sup class="refn">[' + (s.ci + 1) + "]</sup>";
      return '<button type="button" class="cite" data-i="' + s.ci + '" title="الانتقال إلى الاقتباس في النص الأصلي">' + (s.ci + 1) + "</button>";
    }
    let t = escapeHtml(s.t);
    if (s.b) t = "<strong>" + t + "</strong>";
    if (s.i) t = "<em>" + t + "</em>";
    if (s.code) t = "<code>" + t + "</code>";
    return t;
  }).join("");
}

function blocksToHtml(blocks, mode, autoDir) {
  const ad = autoDir ? ' dir="auto"' : "";
  let html = "";
  let list = null;
  const closeList = () => { if (list) { html += "</" + list + ">"; list = null; } };
  for (const b of blocks) {
    if (b.kind === "hr") { closeList(); html += mode === "print" ? '<hr class="pr-sep">' : '<hr class="out-hr">'; continue; }
    if (b.kind === "li" || b.kind === "oli") {
      if (mode === "print") {
        const mark = b.kind === "oli" ? escapeHtml(b.num || "1") + "." : "•";
        html += '<div class="pr-li"' + ad + '><span class="pr-b">' + mark + "</span> " + spansHtml(b.spans, mode) + "</div>";
        continue;
      }
      const type = b.kind === "oli" ? "ol" : "ul";
      if (list !== type) { closeList(); html += "<" + type + ">"; list = type; }
      html += "<li>" + spansHtml(b.spans, mode) + "</li>";
      continue;
    }
    closeList();
    if (b.kind === "h2") html += mode === "print" ? '<div class="pr-h4">' + spansHtml(b.spans, mode) + "</div>" : '<h2 class="out-h2">' + spansHtml(b.spans, mode) + "</h2>";
    else if (b.kind === "h3") html += mode === "print" ? '<div class="pr-h4">' + spansHtml(b.spans, mode) + "</div>" : "<h3>" + spansHtml(b.spans, mode) + "</h3>";
    else html += mode === "print" ? '<p class="pr-p"' + ad + ">" + spansHtml(b.spans, mode) + "</p>" : "<p" + ad + ">" + spansHtml(b.spans, mode) + "</p>";
  }
  closeList();
  return html;
}

function blocksToDocxBlocks(blocks) {
  return blocks.map(b => {
    const runs = b.spans.map(s => s.cite ? { t: "[" + (s.ci + 1) + "]", sup: true } : { t: s.t, b: s.b, i: s.i, c: s.code ? "666666" : undefined });
    if (b.kind === "h2") return { k: "h3", runs: runs.map(r => ({ t: r.t, b: true })) };
    if (b.kind === "h3") return { k: "h4", runs: runs.map(r => ({ t: r.t, b: true })) };
    if (b.kind === "li") return { k: "li", runs: [{ t: "• ", b: true }].concat(runs) };
    if (b.kind === "oli") return { k: "li", runs: [{ t: (b.num || "1") + ". ", b: true }].concat(runs) };
    if (b.kind === "hr") return { k: "sep" };
    return { k: "p", runs };
  });
}

/* ===== البحث عن الاقتباس في النص الأصلي ===== */
const SKIP_RE = /[\u064B-\u0652\u0670\u0640\u200B-\u200F\uFEFF]/;
const PUNCT_RE = /[«»"'“”‘’`()\[\]{}.,،؛;:!?؟•\u2013\u2014-]/;

function normalizeWithMap(s) {
  const out = [];
  const map = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    if (SKIP_RE.test(ch)) continue;
    if (ch === "\u0623" || ch === "\u0625" || ch === "\u0622" || ch === "\u0671") ch = "\u0627";
    else if (ch === "\u0649") ch = "\u064A";
    else if (ch === "\u0629") ch = "\u0647";
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      prevSpace = true;
      out.push(" ");
      map.push(i);
      continue;
    }
    if (PUNCT_RE.test(ch)) continue;
    prevSpace = false;
    out.push(ch.toLowerCase());
    map.push(i);
  }
  return { s: out.join(""), map };
}

function findQuote(source, quote) {
  const q0 = String(quote || "").trim();
  if (!q0) return null;
  const srcN = normalizeWithMap(source);
  const tryFind = (cand) => {
    const n = normalizeWithMap(cand).s.trim();
    if (n.length < 6) return null;
    const idx = srcN.s.indexOf(n);
    if (idx < 0) return null;
    return { start: srcN.map[idx], end: srcN.map[idx + n.length - 1] + 1 };
  };
  const segments = q0.split(/[…]+|\.{3,}/).map(x => x.trim()).filter(Boolean);
  const tries = [q0].concat(segments);
  for (const t of tries) {
    const r = tryFind(t);
    if (r) return r;
  }
  for (const t of tries) {
    const words = t.split(/\s+/);
    for (const k of [10, 7, 5, 3]) {
      if (words.length > k) {
        const r = tryFind(words.slice(0, k).join(" "));
        if (r) return r;
      }
    }
  }
  return null;
}

/* ===== الاقتباسات والتنقل ===== */
function clearBubbles() {
  document.querySelectorAll(".bubble").forEach(b => b.remove());
}
function showBubble(btn, q, labelText) {
  const span = document.createElement("span");
  span.className = "bubble";
  span.appendChild(Object.assign(document.createElement("span"), { className: "bubble-label", textContent: labelText }));
  span.appendChild(document.createTextNode(" «" + q + "»"));
  btn.after(span);
}
function highlightSource(start, end) {
  const box = $("sourceBody").querySelector(".srctext");
  if (!box || !currentSource.text) return;
  const t = currentSource.text;
  box.innerHTML =
    escapeHtml(t.slice(0, start)) +
    '<mark id="hlmark" class="hl">' + escapeHtml(t.slice(start, end)) + "</mark>" +
    escapeHtml(t.slice(end));
  const mk = box.querySelector("#hlmark");
  if (mk) {
    mk.scrollIntoView({ behavior: "smooth", block: "center" });
    mk.classList.add("flash");
    setTimeout(() => { mk.classList.remove("flash"); }, 2200);
  }
}
function jumpToCite(btn) {
  const i = Number(btn.getAttribute("data-i"));
  const q = currentCites[i];
  if (!q) return;
  if (btn.nextElementSibling && btn.nextElementSibling.classList.contains("bubble")) {
    btn.nextElementSibling.remove();
    return;
  }
  clearBubbles();
  const src = currentSource || { kind: "none" };
  if (src.kind === "text" && src.text) {
    const hit = findQuote(src.text, q);
    if (hit) { highlightSource(hit.start, hit.end); return; }
    showBubble(btn, q, "لم يُعثر على الاقتباس حرفيًا في النص. نص الاقتباس:");
    return;
  }
  if ((src.kind === "pdf" || src.kind === "image") && src.url) {
    $("sourceCard").scrollIntoView({ behavior: "smooth", block: "center" });
    showBubble(btn, q, src.kind === "pdf" ? "الاقتباس من ملف الـPDF الأصلي:" : "الاقتباس من الصورة الأصلية:");
    return;
  }
  showBubble(btn, q, "النص الأصلي غير متاح في هذه الجلسة. نص الاقتباس:");
}

/* ===== عرض النتائج ===== */
function renderSource(src) {
  const card = $("sourceCard");
  const body = $("sourceBody");
  const open = $("btnSrcOpen");
  const note = $("srcNote");
  src = src || { kind: "none" };
  if (src.kind === "none") { show(card, false); return; }
  body.innerHTML = "";
  note.classList.add("hidden");
  open.classList.add("hidden");
  if (src.kind === "text" && src.text) {
    const d = document.createElement("div");
    d.className = "srctext";
    d.setAttribute("dir", "auto");
    d.textContent = src.text;
    body.appendChild(d);
    note.textContent = "هذا هو النص الأصلي الذي تم التحليل منه. أرقام المصادر في الملخص تنقلك إلى الموضع هنا.";
    note.classList.remove("hidden");
  } else if (src.url && src.kind === "pdf") {
    const f = document.createElement("iframe");
    f.className = "srcpdf";
    f.title = "الملف الأصلي PDF";
    f.src = src.url + "#view=FitH";
    body.appendChild(f);
    open.classList.remove("hidden");
    open.onclick = () => window.open(src.url, "_blank");
  } else if (src.url && src.kind === "image") {
    const img = document.createElement("img");
    img.className = "srcimg";
    img.alt = src.name || "الملف الأصلي";
    img.src = src.url;
    body.appendChild(img);
    open.classList.remove("hidden");
    open.onclick = () => window.open(src.url, "_blank");
  } else {
    note.textContent = "الملف الأصلي غير محفوظ في السجل. أعد رفع الملف لعرضه والتنقل منه.";
    note.classList.remove("hidden");
  }
  show(card, true);
}

function buildPrintRoot() {
  const root = $("printRoot");
  if (!last.summary && !last.translation) {
    root.innerHTML = '<p class="pr-meta">لا يوجد ملخص بعد. أنشئ ملخصًا أولًا ثم اطبع.</p>';
    return;
  }
  const ctx = { n: 0, quotes: [] };
  const sHtml = blocksToHtml(parseBlocksMd(last.summary, ctx), "print");
  const tctx = { n: 0, quotes: [] };
  const tHtml = blocksToHtml(parseBlocksMd(stripCiteMarks(last.translation), tctx), "print", true);
  let refsHtml = "";
  if (ctx.quotes.length) {
    refsHtml = '<div class="pr-h5">المراجع (اقتباسات من النص الأصلي)</div>' +
      ctx.quotes.map((q, i) => '<div class="pr-ref"><span class="pr-rn">[' + (i + 1) + "]</span> «" + escapeHtml(q) + "»</div>").join("");
  }
  const metaBits = [dateAr()];
  if (currentSource && currentSource.name) metaBits.push("المصدر: " + currentSource.name);
  root.innerHTML =
    '<div class="pr-title">ملخص وترجمة قضية</div>' +
    '<div class="pr-meta">' + escapeHtml(metaBits.join(" | ")) + "</div>" +
    '<div class="pr-h3">الملخص</div>' + sHtml + refsHtml +
    '<hr class="pr-sep">' +
    '<div class="pr-h3">الترجمة</div>' + tHtml;
}

function showResult(parsed, source) {
  last = { summary: (parsed && parsed.summary) || "", translation: (parsed && parsed.translation) || "" };
  currentSource = source || { kind: "none" };
  const ctx = { n: 0, quotes: [] };
  $("summaryOut").innerHTML = blocksToHtml(parseBlocksMd(last.summary, ctx), "screen");
  currentCites = ctx.quotes;
  const tctx = { n: 0, quotes: [] };
  const trSrc = stripCiteMarks(last.translation) || "(لا توجد ترجمة)";
  $("transOut").innerHTML = blocksToHtml(parseBlocksMd(trSrc, tctx), "screen", true);
  show($("citeHint"), ctx.quotes.length > 0);
  renderSource(currentSource);
  buildPrintRoot();
  show($("output"), true);
  $("output").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ===== السجل ===== */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS.history) || "[]"); } catch (e) { return []; }
}
function saveHistory(srcTitle, parsed, model, src) {
  const h = loadHistory();
  const entry = {
    t: Date.now(),
    title: String(srcTitle || "").replace(/\s+/g, " ").slice(0, 80),
    summary: parsed.summary,
    translation: parsed.translation,
    model
  };
  if (src) {
    entry.srcKind = src.kind;
    entry.srcName = src.name || "";
    if (src.kind === "text" && (src.text || "").length <= SRC_STORE_CAP) entry.srcText = src.text;
  }
  h.unshift(entry);
  const trimmed = h.slice(0, 30);
  try {
    localStorage.setItem(LS.history, JSON.stringify(trimmed));
  } catch (e) {
    try {
      trimmed.forEach(x => { delete x.srcText; });
      localStorage.setItem(LS.history, JSON.stringify(trimmed));
    } catch (e2) {}
  }
  renderHistory();
}
function renderHistory() {
  const h = loadHistory();
  const card = $("historyCard");
  const list = $("historyList");
  show(card, h.length > 0);
  list.innerHTML = "";
  h.forEach((it) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "link";
    b.type = "button";
    b.textContent = it.title || "بدون عنوان";
    b.addEventListener("click", () => {
      let src = { kind: "none" };
      if (it.srcKind === "text" && it.srcText) src = { kind: "text", text: it.srcText, name: it.srcName || "" };
      else if (it.srcKind && it.srcKind !== "none") src = { kind: it.srcKind, name: it.srcName || "", url: null };
      showResult({ summary: it.summary || "", translation: it.translation || "" }, src);
    });
    const d = document.createElement("span");
    d.className = "muted";
    try { d.textContent = new Date(it.t).toLocaleString("ar-EG"); } catch (e) { d.textContent = ""; }
    li.appendChild(b);
    li.appendChild(d);
    list.appendChild(li);
  });
}

/* ===== التصدير ===== */
function buildDocxBytes() {
  const ctx = { n: 0, quotes: [] };
  const sumBlocks = blocksToDocxBlocks(parseBlocksMd(last.summary, ctx));
  const tctx = { n: 0, quotes: [] };
  const trBlocks = blocksToDocxBlocks(parseBlocksMd(stripCiteMarks(last.translation), tctx));
  const blocks = [
    { k: "title", runs: [{ t: "ملخص وترجمة قضية" }] },
    { k: "meta", runs: [{ t: dateAr() + (currentSource && currentSource.name ? " | المصدر: " + currentSource.name : "") }] },
    { k: "h2", runs: [{ t: "الملخص" }] }
  ].concat(sumBlocks);
  if (ctx.quotes.length) {
    blocks.push({ k: "h3", runs: [{ t: "المراجع (اقتباسات من النص الأصلي)" }] });
    ctx.quotes.forEach((q, i) => {
      blocks.push({ k: "ref", runs: [{ t: "[" + (i + 1) + "] ", b: true }, { t: "«" + q + "»", i: true }] });
    });
  }
  blocks.push({ k: "sep" });
  blocks.push({ k: "h2", runs: [{ t: "الترجمة" }] });
  return QADocx.build({ blocks: blocks.concat(trBlocks) });
}

function exportWord() {
  if (!last.summary && !last.translation) { setStatus("لا يوجد ملخص للتحميل بعد", true); return; }
  try {
    const bytes = buildDocxBytes();
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ملخص-قضية-" + new Date().toISOString().slice(0, 10) + ".docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    setStatus("تعذر إنشاء ملف Word. حاول تاني.", true);
  }
}

function printExport() {
  if (!last.summary && !last.translation) { setStatus("لا يوجد ملخص للطباعة بعد", true); return; }
  buildPrintRoot();
  const oldTitle = document.title;
  document.title = "ملخص-قضية-" + new Date().toISOString().slice(0, 10);
  const restore = () => {
    document.title = oldTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  setTimeout(restore, 15000);
  window.print();
}

/* ===== تشغيل ===== */
async function run() {
  if (running) return;
  const p = provider();
  const key = keyFor(p);
  if (!key) {
    setStatus("ضع مفتاح " + labelOf(p) + " في الإعدادات أولًا", true);
    show($("settings"), true);
    return;
  }
  const text = $("caseText").value.trim();
  if (!text && !attached) { setStatus("الصق نص القضية أو ارفع ملفًا أولًا", true); return; }

  running = true;
  const btn = $("btnRun");
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "جاري التحليل...";
  setStatus("قد يستغرق التحليل دقيقة أو أكثر حسب طول القضية.");

  try {
    let result;
    let usedProvider = p;
    try {
      result = await callProvider(p, key, text);
    } catch (e) {
      const fallbackOn = localStorage.getItem(LS.fallback) !== "0";
      const other = p === "gemini" ? "openrouter" : "gemini";
      const otherKey = keyFor(other);
      if (!(e instanceof ApiError) || !e.retryable || !fallbackOn || !otherKey) throw e;
      setStatus("الحد المجاني لـ " + labelOf(p) + " غير متاح حاليًا، جاري التحويل إلى " + labelOf(other) + "...");
      result = await callProvider(other, otherKey, text);
      usedProvider = other;
    }

    const srcTitle = text || (attached && attached.name) || "بدون عنوان";
    let src = { kind: "none" };
    if (text) src = { kind: "text", text: text };
    else if (attached) {
      if (attached.mime === "text/plain") src = { kind: "text", text: attached.text || "", name: attached.name };
      else if (attached.mime === "application/pdf") src = { kind: "pdf", url: attached.url || null, name: attached.name };
      else src = { kind: "image", url: attached.dataUrl || null, name: attached.name };
    }

    showResult(result.parsed, src);
    saveHistory(srcTitle, result.parsed, result.model, src);
    let msg = "تم";
    if (usedProvider !== p) msg += " (تم التحويل تلقائيًا إلى " + labelOf(usedProvider) + ")";
    if (result.truncated) msg += ". ملاحظة: النتيجة قد تكون مقطوعة لطول النص، جرب تقسيم القضية.";
    setStatus(msg, false);
  } catch (e) {
    setStatus(e instanceof ApiError ? e.message : "تعذر الاتصال بالخدمة. راجع الإنترنت وحاول تاني.", true);
  } finally {
    running = false;
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

/* ===== ربط الأحداث ===== */
function init() {
  $("btnSettings").addEventListener("click", () => show($("settings"), $("settings").classList.contains("hidden")));
  $("providerSel").value = provider();
  $("fallbackChk").checked = localStorage.getItem(LS.fallback) !== "0";
  syncSettingsToProvider();

  $("providerSel").addEventListener("change", () => {
    localStorage.setItem(LS.provider, $("providerSel").value);
    syncSettingsToProvider();
  });
  $("fallbackChk").addEventListener("change", () => {
    localStorage.setItem(LS.fallback, $("fallbackChk").checked ? "1" : "0");
  });
  $("btnToggleKey").addEventListener("click", () => {
    const i = $("apiKey");
    i.type = i.type === "password" ? "text" : "password";
  });
  $("btnSave").addEventListener("click", saveKey);
  $("btnRefreshModels").addEventListener("click", () => refreshModels(false));
  $("modelSel").addEventListener("change", () => saveModelFor(provider(), $("modelSel").value));

  $("fileInput").addEventListener("change", async () => {
    const f = $("fileInput").files[0];
    if (!f) return;
    attached = null;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      $("fileInfo").textContent = "الملف أكبر من " + MAX_FILE_MB + " ميجا";
      return;
    }
    const name = f.name || "";
    if (f.type === "text/plain" || /\.txt$/i.test(name)) {
      attached = { mime: "text/plain", text: await f.text(), name };
    } else if (f.type === "application/pdf" || /\.pdf$/i.test(name)) {
      const b64 = await toB64(f);
      attached = { mime: "application/pdf", data: b64, name, url: b64ToBlobUrl(b64, "application/pdf") };
    } else if (/^image\//.test(f.type)) {
      const b64 = await toB64(f);
      attached = { mime: f.type, data: b64, dataUrl: await toDataUrl(f), name };
    } else {
      $("fileInfo").textContent = "نوع الملف غير مدعوم. المدعوم: PDF أو صورة أو ملف نصي";
      return;
    }
    $("fileInfo").textContent = name + " (" + (f.size / 1048576).toFixed(1) + " ميجا)";
  });

  $("btnClear").addEventListener("click", () => {
    $("caseText").value = "";
    attached = null;
    $("fileInput").value = "";
    $("fileInfo").textContent = "";
    setStatus("");
  });

  $("btnRun").addEventListener("click", run);

  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", async () => {
      const which = b.getAttribute("data-copy");
      const t = which === "summary" ? stripCitesForCopy(last.summary) : stripCitesForCopy(last.translation);
      try {
        await navigator.clipboard.writeText(t);
        const old = b.textContent;
        b.textContent = "تم النسخ";
        setTimeout(() => { b.textContent = old; }, 1200);
      } catch (e) {}
    });
  });

  $("summaryOut").addEventListener("click", (e) => {
    const btn = e.target.closest("button.cite");
    if (btn) jumpToCite(btn);
  });

  $("btnWord").addEventListener("click", exportWord);
  $("btnPrint").addEventListener("click", printExport);
  $("btnClearHistory").addEventListener("click", () => {
    localStorage.removeItem(LS.history);
    renderHistory();
  });

  renderHistory();
  buildPrintRoot();
  if (keyFor(provider())) refreshModels(true);
}

document.addEventListener("DOMContentLoaded", init);
