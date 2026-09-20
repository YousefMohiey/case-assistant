"use strict";

/* ===== ثوابت ===== */
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OR_BASE = "https://openrouter.ai/api/v1";
const GEMINI_DEFAULT = "gemini-2.5-flash";
const OR_DEFAULT = "google/gemma-4-31b-it:free";
const MAX_FILE_MB = 15;

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

let attached = null; /* { mime, name, text?, data?, dataUrl? } */
let last = { summary: "", translation: "" };
let running = false;

const PROMPT = `أنت مساعد قانوني محترف يعمل لمحامٍ مصري.

المطلوب منك شيئان معًا:

1) الملخص: اكتب ملخصًا قانونيًا بالعربية الفصحى للوثيقة المرفقة، تحت هذه العناوين وبهذا الترتيب:
- نوع القضية والأطراف
- الوقائع
- الطلبات أو المطالب
- التواريخ والمواعيد المهمة
- المبالغ المالية (إن وجدت)
- نقاط قانونية أو إجراءات مطلوبة (إن وجدت)
كن دقيقًا ولا تضف معلومات غير موجودة في الوثيقة. إذا لم يتوفر بند، اكتب "غير مذكور".

2) الترجمة: ترجم الوثيقة كاملة إلى اللغة الأخرى: إذا كانت الوثيقة بالعربية فترجمها إلى الإنجليزية، وإذا كانت بالإنجليزية فترجمها إلى العربية، وإذا كانت بلغة أخرى فترجمها إلى العربية. الترجمة تكون كاملة ودقيقة وبأسلوب قانوني رسمي، مع الحفاظ على أسماء الأطراف والمحاكم والتواريخ والأرقام كما هي، ولا تختصر أي جزء.

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

    last = result.parsed;
    renderOutput(last);
    saveHistory(text || (attached && attached.name) || "بدون عنوان", last, result.model);
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

/* ===== عرض النتائج ===== */
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

function renderOutput(p) {
  $("summaryOut").textContent = p.summary;
  $("transOut").textContent = p.translation || "(لا توجد ترجمة)";
  show($("output"), true);
  $("output").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ===== السجل ===== */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS.history) || "[]"); } catch (e) { return []; }
}
function saveHistory(src, parsed, model) {
  const h = loadHistory();
  h.unshift({
    t: Date.now(),
    title: String(src || "").replace(/\s+/g, " ").slice(0, 80),
    summary: parsed.summary,
    translation: parsed.translation,
    model
  });
  localStorage.setItem(LS.history, JSON.stringify(h.slice(0, 30)));
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
      last = { summary: it.summary || "", translation: it.translation || "" };
      renderOutput(last);
    });
    const d = document.createElement("span");
    d.className = "muted";
    try { d.textContent = new Date(it.t).toLocaleString("ar-EG"); } catch (e) { d.textContent = ""; }
    li.appendChild(b);
    li.appendChild(d);
    list.appendChild(li);
  });
}

/* ===== تصدير ===== */
function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}
function exportWord() {
  const html = '<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>القضية</title></head>' +
    '<body style="font-family:Segoe UI,Tahoma,sans-serif;direction:rtl;line-height:1.9">' +
    "<h2>الملخص</h2><div>" + escHtml(last.summary) + "</div><hr>" +
    "<h2>الترجمة</h2><div>" + escHtml(last.translation) + "</div></body></html>";
  const blob = new Blob(["\ufeff" + html], { type: "application/msword" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "قضية-" + new Date().toISOString().slice(0, 10) + ".doc";
  document.body.appendChild(a);
  a.click();
  a.remove();
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
      attached = { mime: "application/pdf", data: await toB64(f), name };
    } else if (/^image\//.test(f.type)) {
      attached = { mime: f.type, data: await toB64(f), dataUrl: await toDataUrl(f), name };
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
      const t = b.getAttribute("data-copy") === "summary" ? last.summary : last.translation;
      try {
        await navigator.clipboard.writeText(t);
        const old = b.textContent;
        b.textContent = "تم النسخ";
        setTimeout(() => { b.textContent = old; }, 1200);
      } catch (e) {}
    });
  });

  $("btnWord").addEventListener("click", exportWord);
  $("btnPrint").addEventListener("click", () => window.print());
  $("btnClearHistory").addEventListener("click", () => {
    localStorage.removeItem(LS.history);
    renderHistory();
  });

  renderHistory();
  if (keyFor(provider())) refreshModels(true);
}

document.addEventListener("DOMContentLoaded", init);
