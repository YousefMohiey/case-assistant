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
  history: "qa_history",
  users: "qa_users",
  activeUser: "qa_active_user",
  adminFlag: "qa_admin",
  draft: "qa_draft"
};

/* رقم الإصدار: يُقارن مع version.json لتنبيه المستخدم إذا وُجد تحديث جديد */
const APP_VER = "2026-09-22f";

const BRAND = {
  name: "محمد محي",
  nameEn: "Mohamed Mohiey",
  tag: "محامي ومستشار قانوني",
  tagEn: "Attorney at Law and Legal Counsel"
};
/* وضع المدير محمي برمز سري: البصمة فقط موجودة هنا، والرمز نفسه لا يُخزَّن في أي مكان. */
const ADMIN_HASH = "SERVER_SIDE";

const $ = (id) => document.getElementById(id);

let attached = null; /* { mime, name, text?, data?, dataUrl?, url? } */
let last = { summary: "", summaryEn: "", translation: "" };
let currentSource = { kind: "none" }; /* { kind: "text"|"pdf"|"image"|"none", text?, url?, name? } */
let currentCites = []; /* [{ text, pg }] نصوص الاقتباسات وأرقام صفحاتها إن وُجدت */
let running = false;

const PROMPT = `أنت مساعد قانوني محترف يعمل لمحامٍ عربي مقيم في دولة الإمارات العربية المتحدة، ويتعامل مع وثائق وقضايا عربية وإنجليزية.

المطلوب منك ثلاثة أشياء معًا:

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

قواعد الدقة (مهمة جدًا، التزم بها حرفيًا):
- اكتب فقط ما هو موجود في نص الوثيقة نفسها. ممنوع منعًا باتًا إضافة أي معلومة من عندك: لا أسماء ولا تواريخ ولا مبالغ ولا أرقام ولا مواد قانونية ولا مبادئ عامة غير مذكورة في الوثيقة.
- انقل الأسماء والتواريخ والمبالغ والأرقام كما هي بالضبط، دون تقريب أو تغيير أو تخمين.
- إذا لم يتوفر بند، اكتب "غير مذكور". ولا تخمن ما ليس في الوثيقة أبدًا.
استخدم عناوين الأقسام بعلامة ### والنقاط بشرطة فقط، ولا تستخدم أي رموز تنسيق أخرى. اكتب كل نقطة في سطر واحد متصل، ولا تقسم النقاط على أكثر من سطر.

قواعد الاقتباس (مهمة جدًا):
- بعد كل نقطة، أضف الجزء الدال من نص الوثيقة الذي تدعمه هذه النقطة، منسوخًا حرفيًا كما هو.
- ضع الاقتباس بين علامتي ‹ و › هكذا: - (النقطة) ‹النص الحرفي من الوثيقة›
- الاقتباس قصير: من 5 إلى 20 كلمة، بدون تغيير أو تلخيص أو نقاط حذف، وفي سطر واحد.
- إذا كان المستند ملف PDF وأمكنك تحديد الصفحة، أضف رقم الصفحة في نهاية الاقتباس هكذا: ‹النص الحرفي|صفحة 3›. إذا لم تكن متأكدًا فاتركه بدون رقم صفحة.
- لا تختلق اقتباسات أبدًا. إذا لم تجد نصًا حرفيًا يدعم النقطة، اكتب النقطة بدون اقتباس.

2) الملخص بالإنجليزية: اكتب لنفس الوثيقة ملخصًا بالإنجليزية الفصحى بنفس الترتيب (نوع القضية والأطراف، الوقائع، الطلبات، التواريخ، المبالغ، النقاط القانونية)، مع عناوين إنجليزية واضحة مثل:
### Case Type and Parties
### Facts
### Claims or Requests
### Key Dates
### Amounts
### Legal Points and Actions
اكتب هذا الملخص بالكامل بالحروف الإنجليزية وبدون أي حروف عربية: انقل أسماء الأشخاص والمحاكم والجهات بالحروف اللاتينية (نقل صوتي).
وبدون أي علامات ‹ › أو اقتباسات في هذا القسم.

3) الترجمة: ترجم الوثيقة كاملة إلى اللغة الأخرى: إذا كانت الوثيقة بالعربية فترجمها إلى الإنجليزية، وإذا كانت بالإنجليزية فترجمها إلى العربية، وإذا كانت بلغة أخرى فترجمها إلى العربية. الترجمة كاملة ودقيقة وبأسلوب قانوني رسمي، مع الحفاظ على دقة أسماء الأطراف والمحاكم والتواريخ والأرقام، ولا تختصر أي جزء، ولا تنسخ النص الأصلي ولا تكرره، ولا تترك الترجمة بلغة الوثيقة نفسها أبدًا، وبدون أي علامات ‹ › أو اقتباسات في هذا القسم. وإذا كانت الترجمة إلى الإنجليزية فلا تكتب فيها أي حروف عربية: انقل الأسماء العربية بالحروف اللاتينية (نقل صوتي). واكتب الترجمة فقرات متصلة دون تقسيم يدوي للأسطر.

أخرج النتيجة بهذا الشكل بالضبط، دون أي مقدمات:

## الملخص
(الملخص هنا)

## الملخص بالإنجليزية
(English summary here)

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
function isoDate() { return new Date().toISOString().slice(0, 10); }
function dateEn() {
  try { return new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
/* لغة نص الترجمة: عربي أو إنجليزي */
function trLang() {
  const t = String((last && last.translation) || "").slice(0, 3000);
  if (!t.trim()) return "ar";
  let ar = 0, lat = 0;
  for (const ch of t) {
    if (/[\u0600-\u06FF]/.test(ch)) ar++;
    else if (/[A-Za-z]/.test(ch)) lat++;
  }
  return (ar > 0 && ar >= lat * 0.2) ? "ar" : "en";
}

/* تحديد لغة نص: عربي أو إنجليزي أو null لو غير واضح */
function detectTextLang(str) {
  str = String(str || "").slice(0, 4000);
  let ar = 0, lat = 0;
  for (const ch of str) {
    if (/[\u0600-\u06FF]/.test(ch)) ar++;
    else if (/[A-Za-z]/.test(ch)) lat++;
  }
  if (ar >= 30 && ar > lat * 0.6) return "ar";
  if (lat >= 50 && lat > ar * 2) return "en";
  return null;
}
/* لغة الوثيقة الأصلية: من النص الملصوق أو من الاقتباسات الحرفية */
function guessSourceLang(text, quotes) {
  if (text && text.trim()) return detectTextLang(text);
  const joined = (quotes || []).map(q => q.text || "").join(" ");
  if (joined.trim()) return detectTextLang(joined);
  return null;
}
const TR_PROMPT = (target) => `أنت مترجم قانوني محترف. ترجم النص المرفق بالكامل إلى اللغة ${target === "en" ? "الإنجليزية" : "العربية"} ترجمة قانونية رسمية دقيقة.
- الترجمة كاملة من أول النص إلى آخره، دون اختصار أو تلخيص، ودون تكرار النص الأصلي.
- حافظ على دقة أسماء الأطراف والمحاكم والتواريخ والأرقام.
${target === "en" ? "- اكتب كل شيء بالحروف الإنجليزية فقط، وممنوع أي حرف عربي: انقل الأسماء العربية بالحروف اللاتينية (نقل صوتي).\n" : ""}- اكتب النص فقرات متصلة دون تقسيم يدوي للأسطر.
- لا تكتب أي عناوين أو مقدمات أو شرح، أخرج الترجمة فقط.`;
async function translateWithGemini(key, text, target) {
  const model = modelFor("gemini");
  const parts = [{ text: TR_PROMPT(target) }];
  if (attached && attached.mime === "text/plain") parts.push({ text: "\n\nالنص:\n" + attached.text });
  else if (attached) parts.push({ inlineData: { mimeType: attached.mime, data: attached.data } });
  if (text) parts.push({ text: "\n\nالنص:\n" + text });
  const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.1, maxOutputTokens: 32768 } })
  });
  let data = null; try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new ApiError(apiErrorMessage(res.status, data, false), isRetryable(res.status));
  const cand = data && data.candidates && data.candidates[0];
  return (((cand && cand.content && cand.content.parts) || []).map(x => x.text || "").join("")).trim();
}
async function translateWithOpenRouter(key, text, target) {
  const model = modelFor("openrouter");
  if (attached && attached.mime === "application/pdf") return "";
  const base = TR_PROMPT(target) + (text ? "\n\nالنص:\n" + text : "");
  let content;
  if (attached && attached.mime === "text/plain") content = base + "\n\nالنص:\n" + attached.text;
  else if (attached) content = [{ type: "text", text: base }, { type: "image_url", image_url: { url: attached.dataUrl } }];
  else content = base;
  const res = await fetch(`${OR_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0.1, max_tokens: 8192 })
  });
  let data = null; try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new ApiError(apiErrorMessage(res.status, data, true), isRetryable(res.status));
  const ch = data && data.choices && data.choices[0];
  return String((ch && ch.message && ch.message.content) || "").trim();
}
/* أقسام اللغة الإنجليزية تُعرض باتجاه إنجليزي: العنوان يسار وزر Copy يمين */
function updateCardHeads() {
  const trEn = trLang() === "en";
  const trRow = document.getElementById("trRow");
  if (trRow) {
    trRow.classList.toggle("head-ltr", trEn);
    const bt = trRow.querySelector("[data-copy='translation']");
    if (bt) bt.textContent = trEn ? "Copy" : "نسخ";
  }
  const h2 = document.getElementById("transTitle");
  if (h2) {
    const hasTr = !!(last.translation && last.translation.trim());
    h2.textContent = hasTr ? (trEn ? "الترجمة إلى الإنجليزية" : "الترجمة إلى العربية") : "الترجمة";
  }
}
/* بيانات رأس المستند (عنوان/تاريخ/فوتر) حسب لغة الملف */
function chromeFor(which) {
  const en = which === "summaryEn" || (which === "translation" && trLang() === "en");
  const lang = en ? "en" : "ar";
  const date = lang === "en" ? dateEn() : dateAr();
  /* لا يظهر اسم ملف المصدر داخل المستندات (طلب المستخدم) */
  const meta = date;
  const title = which === "summary" ? "ملخص القضية"
    : which === "summaryEn" ? "English Summary"
    : which === "translation" ? (lang === "en" ? "Case Translation" : "ترجمة القضية")
    : "ملف القضية الكامل";
  return {
    lang,
    meta,
    date,
    title,
    brandLine: lang === "en" ? BRAND.nameEn : BRAND.name,
    brandSub: lang === "en" ? BRAND.tagEn : BRAND.tag,
    trHead: lang === "en" ? "English Translation" : "الترجمة"
  };
}

function provider() { return localStorage.getItem(LS.provider) || "gemini"; }
function keyFor(p) { return (localStorage.getItem(p === "gemini" ? LS.keyGemini : LS.keyOR) || "").trim(); }
function modelFor(p) { return localStorage.getItem(p === "gemini" ? LS.modelGemini : LS.modelOR) || (p === "gemini" ? GEMINI_DEFAULT : OR_DEFAULT); }
function saveModelFor(p, id) { localStorage.setItem(p === "gemini" ? LS.modelGemini : LS.modelOR, id); }

/* ===== المستخدمون ووضع المدير ===== */
const USER_HIST_PREFIX = "qa_history_u_";

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(LS.users) || "[]"); } catch (e) { return []; }
}
function saveUsers(list) { localStorage.setItem(LS.users, JSON.stringify(list)); }
function currentUser() {
  const id = localStorage.getItem(LS.activeUser) || "";
  return loadUsers().find(u => u.id === id) || null;
}
async function sha256hex(s) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return "djb2_" + h.toString(16);
  }
}
function newSalt() {
  const a = new Uint8Array(8);
  try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
  return Array.from(a).map(b => b.toString(16).padStart(2, "0")).join("");
}
/* الرمز يُخزَّن مجزَّأ مع ملح خاص لكل مستخدم */
async function hashPin(pin, salt) {
  return salt ? sha256hex(salt + "::" + pin) : sha256hex("qa::" + pin);
}
async function verifyPin(u, v) {
  const h = await hashPin(v, u.salt);
  return !!u.pin && h === u.pin;
}
function userHistoryKey() { const u = currentUser(); return u ? USER_HIST_PREFIX + u.id : null; }
let pendingUser = null;

function setLoginMsg(msg, isErr) {
  const el = $("loginMsg");
  el.textContent = msg || "";
  el.classList.toggle("err", !!isErr);
}
function showLogin() { renderLogin(); show($("login"), true); }
function hideLogin() { show($("login"), false); }
function renderLogin() {
  pendingUser = null;
  show($("loginPinWrap"), false);
  setLoginMsg("");
  const admin = isAdmin();
  show($("newUserForm"), admin);
  const list = loadUsers();
  const wrap = $("loginUsers");
  wrap.innerHTML = "";
  if (list.length) {
    show($("loginUsersWrap"), true);
    show($("loginEmpty"), false);
    list.forEach((u) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "login-user";
      b.innerHTML = '<span class="avatar">' + escapeHtml((u.name || "?").trim().charAt(0)) + '</span><span class="lu-name">' + escapeHtml(u.name) + '</span>' + (u.pin ? '<span class="lu-lock">محمي برمز</span>' : "") + '<svg class="lu-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
      b.addEventListener("click", () => {
        if (u.pin) {
          pendingUser = u;
          show($("loginUsersWrap"), false);
          show($("newUserForm"), false);
          show($("loginPinWrap"), true);
          $("pinWho").textContent = u.name;
          $("loginPin").value = "";
          setLoginMsg("");
          $("loginPin").focus();
        } else {
          loginUser(u);
        }
      });
      wrap.appendChild(b);
    });
  } else {
    show($("loginUsersWrap"), false);
    show($("loginEmpty"), !admin);
  }
}
function renderLoginIfVisible() {
  const l = $("login");
  if (l && !l.classList.contains("hidden")) renderLogin();
}
/* إنشاء الحسابات من وضع المدير فقط، والرمز مطلوب دائمًا */
async function addUserCore(name, pin) {
  name = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  pin = String(pin || "").trim();
  if (!name) return { err: "اكتب الاسم أولًا" };
  if (!/^\d{4,8}$/.test(pin)) return { err: "رمز الدخول مطلوب: من 4 إلى 8 أرقام" };
  const list = loadUsers();
  if (list.some(u => u.name === name)) return { err: "الاسم موجود بالفعل. اختره من القائمة أو اكتب اسمًا آخر" };
  const salt = newSalt();
  const u = { id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, salt, pin: await hashPin(pin, salt), t: Date.now() };
  list.push(u);
  saveUsers(list);
  migrateOldHistory(u.id);
  return { u };
}
async function createUser() {
  if (!isAdmin()) { setLoginMsg("إضافة المستخدمين متاحة من وضع المدير فقط", true); return; }
  const r = await addUserCore($("newUserName").value, $("newUserPin").value);
  if (r.err) { setLoginMsg(r.err, true); return; }
  $("newUserName").value = "";
  $("newUserPin").value = "";
  loginUser(r.u);
}
async function adminAddUser() {
  const msg = $("admUserMsg");
  const r = await addUserCore($("admUserName").value, $("admUserPin").value);
  if (r.err) { msg.textContent = r.err; msg.classList.add("err"); return; }
  msg.textContent = "أُضيف " + r.u.name;
  msg.classList.remove("err");
  $("admUserName").value = "";
  $("admUserPin").value = "";
  renderUsersAdmin();
  renderLoginIfVisible();
}
function deleteUser(id) {
  const u = loadUsers().find(x => x.id === id);
  if (!u) return;
  if (!window.confirm('حذف المستخدم "' + u.name + '"؟ سيُحذف سجله أيضًا من هذا الجهاز.')) return;
  saveUsers(loadUsers().filter(x => x.id !== id));
  try { localStorage.removeItem(USER_HIST_PREFIX + id); } catch (e) {}
  if ((localStorage.getItem(LS.activeUser) || "") === id) logoutUser();
  renderUsersAdmin();
  renderLoginIfVisible();
}
function renderUsersAdmin() {
  const wrap = $("usersAdmin");
  if (!wrap) return;
  const list = loadUsers();
  wrap.innerHTML = "";
  if (!list.length) {
    wrap.innerHTML = '<p class="muted">لا يوجد مستخدمون على هذا الجهاز بعد.</p>';
    return;
  }
  list.forEach(u => {
    const row = document.createElement("div");
    row.className = "ua-row";
    let ds = "";
    try { ds = new Date(u.t || Date.now()).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" }); } catch (e) {}
    row.innerHTML = '<div class="ua-info"><span class="ua-name">' + escapeHtml(u.name) + '</span><span class="ua-meta">' + (u.pin ? "محمي برمز" : "بدون رمز") + (ds ? " • " + ds : "") + "</span></div>";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghost small danger";
    b.textContent = "حذف";
    b.addEventListener("click", () => deleteUser(u.id));
    row.appendChild(b);
    wrap.appendChild(row);
  });
}
function migrateOldHistory(uid) {
  try {
    const old = localStorage.getItem(LS.history);
    if (old && old !== "[]") {
      const k = USER_HIST_PREFIX + uid;
      if (!localStorage.getItem(k)) localStorage.setItem(k, old);
      localStorage.removeItem(LS.history);
    }
  } catch (e) {}
}
async function submitPin() {
  if (!pendingUser) return;
  const v = $("loginPin").value.trim();
  if (!v) return;
  if (await verifyPin(pendingUser, v)) loginUser(pendingUser);
  else setLoginMsg("الرمز غير صحيح، حاول مرة أخرى", true);
}
function loginUser(u) {
  localStorage.setItem(LS.activeUser, u.id);
  pendingUser = null;
  hideLogin();
  applyUserUI();
  /* لا تبقى نتيجة مستخدم آخر ظاهرة بعد التبديل */
  last = { summary: "", summaryEn: "", translation: "" };
  currentSource = { kind: "none" };
  currentCites = [];
  show($("output"), false);
  setStatus("");
  renderHistory();
}
function logoutUser() {
  localStorage.removeItem(LS.activeUser);
  showLogin();
}
function applyUserUI() {
  const u = currentUser();
  show($("userChip"), !!u);
  if (u) {
    $("userAva").textContent = (u.name || "؟").trim().charAt(0);
    $("userName").textContent = u.name;
  }
}
/* وضع المدير: محمي برمز سري، وبدونه لا وصول للإعدادات أو إدارة المستخدمين */
function isAdmin() {
  try { return sessionStorage.getItem(LS.adminFlag) === "1"; } catch (e) { return false; }
}
let gatePushed = false;
function openAdminGate() {
  if (isAdmin()) { applyAdminUI(); show($("settings"), true); return; }
  show($("adminGate"), true);
  if (!gatePushed) { try { history.pushState({ qaGate: 1 }, ""); gatePushed = true; } catch (e) {} }
  $("adminCode").value = "";
  const m = $("adminMsg");
  if (m) { m.textContent = ""; m.classList.remove("err"); }
  setTimeout(() => { try { $("adminCode").focus(); } catch (e) {} }, 40);
}
function closeAdminGate(fromBack) {
  show($("adminGate"), false);
  if (fromBack === true) { gatePushed = false; return; }
  if (gatePushed) { gatePushed = false; try { history.back(); } catch (e) {} }
}
async function submitAdminCode() {
  const v = $("adminCode").value.trim();
  if (!v) return;
  const h = await sha256hex("qa::admin::" + v);
  if (h !== ADMIN_HASH) {
    const m = $("adminMsg");
    if (m) { m.textContent = "رمز المسؤول غير صحيح"; m.classList.add("err"); }
    $("adminCode").value = "";
    $("adminCode").focus();
    return;
  }
  try { sessionStorage.setItem(LS.adminFlag, "1"); } catch (e) {}
  closeAdminGate();
  applyAdminUI();
  renderLoginIfVisible();
  show($("settings"), true);
}
function enterAdmin() { openAdminGate(); }
function exitAdmin() {
  try { sessionStorage.removeItem(LS.adminFlag); } catch (e) {}
  show($("settings"), false);
  applyAdminUI();
  renderLoginIfVisible();
}
function applyAdminUI() {
  const on = isAdmin();
  show($("adminPill"), on);
  show($("btnSettings"), on);
  if (!on) show($("settings"), false);
  else renderUsersAdmin();
}

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
  const heads = [];
  const re = /^##\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(t))) heads.push({ title: m[1], start: m.index, bodyStart: re.lastIndex });
  if (!heads.length) {
    const i = t.indexOf("## الترجمة");
    if (i >= 0) {
      return {
        summary: t.slice(0, i).replace(/##\s*الملخص/, "").trim(),
        summaryEn: "",
        translation: t.slice(i + "## الترجمة".length).trim()
      };
    }
    return { summary: t, summaryEn: "", translation: "" };
  }
  const secs = heads.map((h, i) => ({
    title: h.title,
    body: t.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].start : t.length).trim()
  }));
  let summary = "", summaryEn = "", translation = "";
  for (const s of secs) {
    if (/ترجم|translat/i.test(s.title)) translation = s.body;
    else if (/إنجليز|english/i.test(s.title)) summaryEn = s.body;
    else summary = summary ? summary + "\n\n" + s.body : s.body;
  }
  if (!summary && !summaryEn && !translation && secs.length) {
    summary = secs.map(s => "## " + s.title + "\n" + s.body).join("\n\n");
  }
  return { summary, summaryEn, translation };
}

function stripCiteMarks(t) { return String(t || "").replace(/[‹›]/g, ""); }
function stripCitesForCopy(t) {
  return String(t || "").replace(/‹[^›]*›/g, "").replace(/[‹›]/g, "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

/* ===== تحويل الماركداون إلى كتل ===== */
/* كتلة: { kind: "h2"|"h3"|"p"|"li"|"oli"|"hr", num?, spans: [{ t, b?, i?, code?, cite?, ci? }] } */
function parseCite(inner) {
  let qt = String(inner || "").trim();
  let pg = null;
  const pm = qt.match(/^(.*?)\|\s*(?:صفحة|صفحه|ص|page|p)\s*(\d+)\s*$/i);
  if (pm) { qt = pm[1].trim(); pg = parseInt(pm[2], 10) || null; }
  return { text: qt, pg };
}

function inlineSpans(text, ctx) {
  const spans = [];
  const re = /‹([^›]+)›|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let lastIdx = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > lastIdx) spans.push({ t: text.slice(lastIdx, m.index) });
    if (m[1] != null) {
      const c = parseCite(m[1]);
      const span = { t: c.text, cite: true, ci: ctx.n++, pg: c.pg };
      ctx.quotes.push({ text: c.text, pg: c.pg });
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
    if ((m = line.match(/^[-*•]\s+(.*)$/))) { flush(); blocks.push({ kind: "li", raw: m[1], _snap: { n: ctx.n, len: ctx.quotes.length }, spans: inlineSpans(m[1], ctx) }); continue; }
    if ((m = line.match(/^(\d+)[.)]\s+(.*)$/))) { flush(); blocks.push({ kind: "oli", num: m[1], raw: m[2], _snap: { n: ctx.n, len: ctx.quotes.length }, spans: inlineSpans(m[2], ctx) }); continue; }
    const lastB = blocks[blocks.length - 1];
    if (para.length === 0 && lastB && (lastB.kind === "li" || lastB.kind === "oli") && typeof lastB.raw === "string") {
      /* سطر استكمال لنقطة مقسومة: نلحمه بآخر نقطة بدل أن يصير فقرة منفصلة */
      ctx.n = lastB._snap.n;
      ctx.quotes.length = lastB._snap.len;
      lastB.raw += " " + line;
      lastB.spans = inlineSpans(lastB.raw, ctx);
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

function spansHtml(spans, mode) {
  return spans.map(s => {
    if (s.cite) {
      if (mode === "print") return '<sup class="refn">[' + (s.ci + 1) + "]</sup>";
      const ttl = "الانتقال إلى الاقتباس في الملف الأصلي" + (s.pg ? " (صفحة " + s.pg + ")" : "");
      return '<button type="button" class="cite" data-i="' + s.ci + '" title="' + ttl + '">' + (s.ci + 1) + "</button>";
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
        html += '<div class="pr-li"' + ad + '><span class="pr-b">' + mark + "</span>" + spansHtml(b.spans, mode) + "</div>";
        continue;
      }
      const type = b.kind === "oli" ? "ol" : "ul";
      if (list !== type) { closeList(); html += "<" + type + ">"; list = type; }
      html += "<li>" + spansHtml(b.spans, mode) + "</li>";
      continue;
    }
    closeList();
    if (b.kind === "h2") html += mode === "print" ? '<div class="pr-h4"' + ad + '>' + spansHtml(b.spans, mode) + "</div>" : '<h2 class="out-h2">' + spansHtml(b.spans, mode) + "</h2>";
    else if (b.kind === "h3") html += mode === "print" ? '<div class="pr-h4"' + ad + '>' + spansHtml(b.spans, mode) + "</div>" : "<h3>" + spansHtml(b.spans, mode) + "</h3>";
    else html += mode === "print" ? '<p class="pr-p"' + ad + ">" + spansHtml(b.spans, mode) + "</p>" : "<p" + ad + ">" + spansHtml(b.spans, mode) + "</p>";
  }
  closeList();
  return html;
}

function blocksToDocxBlocks(blocks) {
  return blocks.map(b => {
    const runs = b.spans.map(s => s.cite ? { t: "[" + (s.ci + 1) + "]", sup: true } : { t: s.t, b: s.b, i: s.i, c: s.code ? "666666" : undefined });
    if (b.kind === "h2") return { k: "h2", runs: runs.map(r => ({ t: r.t, b: true })) };
    if (b.kind === "h3") return { k: "h3", runs: runs.map(r => ({ t: r.t, b: true })) };
    if (b.kind === "h4") return { k: "h4", runs: runs.map(r => ({ t: r.t, b: true })) };
    if (b.kind === "li") return { k: "li", runs: [{ t: "• ", b: true }].concat(runs) };
    if (b.kind === "oli") return { k: "li", runs: [{ t: (b.num || "1") + ". ", b: true }].concat(runs) };
    if (b.kind === "hr") return { k: "sep" };
    return { k: "p", runs };
  });
}

/* ===== البحث عن الاقتباس في النص الأصلي ===== */
const SKIP_RE = /[\u064B-\u065F\u0670\u0640\u200B-\u200F\uFEFF]/;
const PUNCT_RE = /[«»"'“”‘’`()\[\]{}.,،؛;:!?؟•\u2013\u2014-]/;

function normalizeWithMap(s) {
  const out = [];
  const map = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    if (SKIP_RE.test(ch)) continue;
    /* وحّد صور الحروف العربية المتصلة (Presentation Forms) والنص المركب */
    try {
      const nf = ch.normalize("NFKC");
      if (nf && nf !== ch) {
        for (let k = 0; k < nf.length; k++) { out.push(nf[k]); map.push(i); }
        prevSpace = false;
        continue;
      }
    } catch (e) {}
    if (ch === "\u0623" || ch === "\u0625" || ch === "\u0622" || ch === "\u0671") ch = "\u0627";
    else if (ch === "\u0626" || ch === "\u06CC") ch = "\u064A";
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

function findNormalized(source, nq) {
  const srcN = normalizeWithMap(source);
  const idx = srcN.s.indexOf(nq);
  if (idx < 0) return null;
  return { start: srcN.map[idx], end: srcN.map[idx + nq.length - 1] + 1 };
}

function findQuote(source, quote) {
  const q0 = String(quote || "").trim();
  if (!q0) return null;
  const tryFind = (cand) => {
    const n = normalizeWithMap(cand).s.trim();
    if (n.length < 6) return null;
    return findNormalized(source, n);
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

/* ===== فهرس صفحات ملف الPDF (pdf.js) ===== */
let pdfjsLib = null;
async function ensurePdfjs() {
  if (!pdfjsLib) {
    const lib = await import("./vendor/pdf.min.mjs");
    lib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";
    pdfjsLib = lib;
  }
  return pdfjsLib;
}

async function ensurePdfDoc(url) {
  if (currentSource._pdfDoc) return currentSource._pdfDoc;
  if (!currentSource._pdfDocP) {
    currentSource._pdfDocP = (async () => {
      const lib = await ensurePdfjs();
      const doc = await lib.getDocument(url).promise;
      currentSource._pdfDoc = doc;
      return doc;
    })();
  }
  return currentSource._pdfDocP;
}

async function buildPdfIndex() {
  if (currentSource._pdfIndex) return currentSource._pdfIndex;
  if (currentSource._pdfIndexP) return currentSource._pdfIndexP;
  currentSource._pdfIndexP = (async () => {
    const doc = await ensurePdfDoc(currentSource.url);
    const pages = [];
    let chars = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const items = [];
      let textA = "", textB = "";
      for (const it of tc.items) {
        const str = it.str || "";
        if (!str) continue;
        const rec = { str, tr: it.transform, w: it.width || 0, h: it.height || 0 };
        rec.startA = textA.length; textA += str; rec.endA = textA.length;
        if (textB) textB += " ";
        rec.startB = textB.length; textB += str; rec.endB = textB.length;
        items.push(rec);
      }
      chars += textA.replace(/\s+/g, "").length;
      pages.push({ textA, textB, items, normA: normalizeWithMap(textA), normB: normalizeWithMap(textB) });
    }
    const idx = { pages, hasText: chars > 40 };
    currentSource._pdfIndex = idx;
    return idx;
  })();
  return currentSource._pdfIndexP;
}

function warmPdfIndex() {
  if (currentSource.kind !== "pdf" || !currentSource.url) return;
  setTimeout(() => { buildPdfIndex().catch(() => {}); }, 400);
}

/* بعض ملفات PDF العربية تخرج بتبادل (أل/لا) واختلاف مسافات بين العناصر.
   نقبل الحالتين عند البحث، مع الاحتفاظ بأرقام المواضع الحقيقية للتظليل. */
function foldAr(s) {
  return String(s || "").split("\u0627\u0627\u0644").join("\u0627\u0644\u0627");
}

function findSpanInNorm(sn, nq) {
  let idx = sn.s.indexOf(nq);
  if (idx >= 0) return { start: sn.map[idx], end: sn.map[idx + nq.length - 1] + 1 };
  const fq = foldAr(nq);
  const fs = foldAr(sn.s);
  if (fs !== sn.s) {
    idx = fs.indexOf(fq);
    if (idx >= 0) return { start: sn.map[idx], end: sn.map[idx + fq.length - 1] + 1 };
  }
  return null;
}

function findQuoteInIndex(idx, quote) {
  if (!idx || !idx.hasText) return null;
  const nq = normalizeWithMap(String(quote || "")).s.trim();
  if (nq.length >= 6) {
    for (let i = 0; i < idx.pages.length; i++) {
      const pg = idx.pages[i];
      if (!pg.normA) continue;
      let hit = findSpanInNorm(pg.normA, nq);
      if (hit) return { page: i + 1, start: hit.start, end: hit.end, variant: "A" };
      hit = findSpanInNorm(pg.normB, nq);
      if (hit) return { page: i + 1, start: hit.start, end: hit.end, variant: "B" };
    }
  }
  for (let i = 0; i < idx.pages.length; i++) {
    const pg = idx.pages[i];
    for (const area of ["textA", "textB"]) {
      const t = pg[area];
      if (!t) continue;
      const hit = findQuote(t, quote);
      if (hit) return { page: i + 1, start: hit.start, end: hit.end, variant: area === "textA" ? "A" : "B" };
    }
  }
  return null;
}

/* رقم الصفحة المعروف لاقتباس (من الفهرس المحسوب أو من رقم الموديل) */
function pageForQuote(quoteText, hintPg) {
  const idx = currentSource && currentSource._pdfIndex;
  if (idx && idx.hasText) {
    const hit = findQuoteInIndex(idx, quoteText);
    if (hit) return hit.page;
  }
  return hintPg || null;
}

/* ===== عارض الملفات (نافذة كبيرة) ===== */
const viewer = { open: false, kind: "pdf", doc: null, page: 1, pages: 0, zoom: 0, base: 0, hl: null, token: 0 };

/* نوافذنا تضيف مدخلًا في تاريخ المتصفح، فيقفلها زر الرجوع بدل أن يخرج من الموقع */
let vwPushed = false;
function openViewerShell() {
  viewer.open = true;
  show($("viewer"), true);
  document.body.classList.add("modal-open");
  if (!vwPushed) { try { history.pushState({ qaViewer: 1 }, ""); vwPushed = true; } catch (e) {} }
  setTimeout(() => { try { $("vwClose").focus(); } catch (e) {} }, 30);
}
function closeViewer(fromBack) {
  if (!viewer.open) return;
  viewer.open = false;
  viewer.token++;
  show($("viewer"), false);
  document.body.classList.remove("modal-open");
  $("vwStage").innerHTML = "";
  if (fromBack === true) { vwPushed = false; return; }
  if (vwPushed) { vwPushed = false; try { history.back(); } catch (e) {} }
}
function setVwQuote(c) {
  const q = $("vwQuote");
  if (c && c.text) {
    q.textContent = "الاقتباس: «" + c.text + "»";
    q.classList.remove("hidden");
  } else {
    q.textContent = "";
    q.classList.add("hidden");
  }
}
function setVwNote(msg) {
  const n = $("vwNote");
  n.textContent = msg || "";
  n.classList.toggle("hidden", !msg);
}

async function openCiteViewer(c) {
  const src = currentSource || {};
  openViewerShell();
  $("vwTitle").textContent = src.name || "الملف الأصلي";
  setVwQuote(c);
  setVwNote("");
  if (src.kind === "image" && src.url) {
    viewer.kind = "image";
    viewer.doc = null;
    viewer.hl = null;
    show($("vwNav"), false);
    show($("vwZoom"), false);
    $("vwStage").innerHTML = '<img class="vwimg" alt="' + escapeHtml(src.name || "الملف الأصلي") + '" src="' + src.url + '">';
    return;
  }
  if (src.kind !== "pdf" || !src.url) {
    $("vwStage").innerHTML = "";
    show($("vwNav"), false);
    show($("vwZoom"), false);
    setVwNote("الملف الأصلي غير محفوظ في هذه الجلسة. نص الاقتباس موجود بالأعلى.");
    return;
  }
  viewer.kind = "pdf";
  show($("vwNav"), true);
  show($("vwZoom"), true);
  try {
    const doc = await ensurePdfDoc(src.url);
    viewer.doc = doc;
    viewer.pages = doc.numPages;
    viewer.zoom = 0;
    viewer.hl = null;
    let page = c && c.pg ? Math.min(c.pg, doc.numPages) : 1;
    try {
      const idx = await buildPdfIndex();
      if (idx && idx.hasText && c && c.text) {
        const hit = findQuoteInIndex(idx, c.text);
        if (hit) {
          viewer.hl = hit;
          page = hit.page;
        } else if (c.pg) {
          setVwNote("تم فتح الصفحة من رقم المصدر، لكن تعذر تحديد الموضع بالضبط داخل الصفحة.");
        } else {
          setVwNote("تعذر تحديد صفحة الاقتباس في الملف. يمكنك التنقل بين الصفحات بالأزرار أعلى العارض.");
        }
      } else if (idx && !idx.hasText) {
        setVwNote("الملف يبدو ممسوحًا ضوئيًا بدون نص قابل للبحث، لذا التنقل هنا يدوي بين الصفحات." + (c && c.pg ? " رقم الصفحة من المصدر: " + c.pg + "." : ""));
      }
    } catch (e) {}
    viewer.page = Math.max(1, Math.min(page || 1, viewer.pages));
    await renderViewerPage(true);
  } catch (e) {
    $("vwStage").innerHTML = "";
    setVwNote("تعذر عرض الملف داخل العارض. جرّب زر فتح الملف في تبويب جديد.");
  }
}

function hlBoxes(hl, vp) {
  const idx = currentSource._pdfIndex;
  if (!idx || !idx.pages[hl.page - 1]) return [];
  const page = idx.pages[hl.page - 1];
  const useB = hl.variant === "B";
  const items = [];
  for (const it of page.items) {
    const s0 = useB ? it.startB : it.startA;
    const e0 = useB ? it.endB : it.endA;
    if (e0 <= hl.start) continue;
    if (s0 >= hl.end) break;
    items.push(it);
  }
  if (!items.length) return [];
  const boxes = items.map((it) => {
    const m = pdfjsLib.Util.transform(vp.transform, it.tr);
    const h = Math.abs(m[3]) || Math.abs(m[1]) || (it.h || 10) * vp.scale;
    const w = Math.max(4, it.w * vp.scale);
    return { x: m[4], y: m[5] - h, w, h };
  });
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const b of boxes) {
    const cy = b.y + b.h / 2;
    const ln = lines.find((l) => Math.abs((l.y + l.h / 2) - cy) < Math.max(6, b.h * 0.7));
    if (ln) {
      const right = Math.max(ln.x + ln.w, b.x + b.w);
      ln.x = Math.min(ln.x, b.x);
      ln.y = Math.min(ln.y, b.y);
      ln.w = right - ln.x;
      ln.h = Math.max(ln.h, (b.y + b.h) - ln.y);
    } else {
      lines.push({ x: b.x, y: b.y, w: b.w, h: b.h });
    }
  }
  return lines.map((l) => ({ x: l.x - 3, y: l.y - 2, w: l.w + 6, h: l.h + 4 }));
}

async function renderViewerPage(resetZoom) {
  if (viewer.kind !== "pdf" || !viewer.doc) return;
  const t = ++viewer.token;
  const stage = $("vwStage");
  let page;
  try { page = await viewer.doc.getPage(viewer.page); } catch (e) { return; }
  if (t !== viewer.token) return;
  const vw = page.getViewport({ scale: 1 });
  const wrapW = Math.max(320, $("vwBody").clientWidth - 28);
  viewer.base = Math.min(wrapW / vw.width, 2.4);
  if (resetZoom || !viewer.zoom) viewer.zoom = viewer.base;
  const vp = page.getViewport({ scale: viewer.zoom });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  stage.innerHTML = "";
  const cv = document.createElement("canvas");
  cv.className = "vwcv";
  cv.width = Math.floor(vp.width * dpr);
  cv.height = Math.floor(vp.height * dpr);
  cv.style.width = vp.width + "px";
  cv.style.height = vp.height + "px";
  stage.appendChild(cv);
  const task = page.render({
    canvasContext: cv.getContext("2d"),
    viewport: vp,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
  });
  try { await task.promise; } catch (e) {}
  if (t !== viewer.token) return;
  if (viewer.hl && viewer.hl.page === viewer.page) {
    for (const b of hlBoxes(viewer.hl, vp)) {
      const d = document.createElement("div");
      d.className = "vwhl";
      d.style.left = b.x + "px";
      d.style.top = b.y + "px";
      d.style.width = b.w + "px";
      d.style.height = b.h + "px";
      stage.appendChild(d);
    }
  }
  $("vwPage").textContent = "صفحة " + viewer.page + " من " + viewer.pages;
  $("vwPrev").disabled = viewer.page <= 1;
  $("vwNext").disabled = viewer.page >= viewer.pages;
}

function viewerGo(delta) {
  const np = Math.max(1, Math.min(viewer.page + delta, viewer.pages));
  if (np === viewer.page) return;
  viewer.page = np;
  renderViewerPage(true);
}
function viewerZoom(mult) {
  if (viewer.kind !== "pdf" || !viewer.doc) return;
  viewer.zoom = Math.max(viewer.base * 0.5, Math.min((viewer.zoom || viewer.base) * mult, viewer.base * 5));
  renderViewerPage(false);
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
  const c = currentCites[i];
  if (!c) return;
  if (btn.nextElementSibling && btn.nextElementSibling.classList.contains("bubble")) {
    btn.nextElementSibling.remove();
    return;
  }
  clearBubbles();
  const src = currentSource || { kind: "none" };
  if (src.kind === "text" && src.text) {
    const hit = findQuote(src.text, c.text);
    if (hit) { highlightSource(hit.start, hit.end); return; }
    showBubble(btn, c.text, "لم يُعثر على الاقتباس حرفيًا في النص. نص الاقتباس:");
    return;
  }
  if (src.kind === "pdf" && src.url) { openCiteViewer(c); return; }
  if (src.kind === "image" && src.url) { openCiteViewer(c); return; }
  showBubble(btn, c.text, "النص الأصلي غير متاح في هذه الجلسة. نص الاقتباس:");
}

/* ===== ملفات Word: استخراج النص داخل المتصفح (بدون مكتبات) ===== */
async function inflateRaw(u8) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* قراءة جزء واحد من أرشيف ZIP الخاص بـdocx اعتمادًا على الفهرس المركزي (وليس الترويسات المحلية) */
function unzipDocxPart(bytes, wanted) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eo = -1;
  const lo = Math.max(0, bytes.length - 66000);
  for (let i = bytes.length - 22; i >= lo; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  }
  if (eo < 0) return Promise.resolve(null);
  const count = dv.getUint16(eo + 10, true);
  let p = dv.getUint32(eo + 16, true);
  const dec = new TextDecoder("utf-8");
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) {
      const lnLen = dv.getUint16(lho + 26, true);
      const leLen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnLen + leLen;
      const data = bytes.subarray(start, start + csize);
      if (method === 0) return Promise.resolve(dec.decode(data));
      if (method !== 8) return Promise.resolve(null);
      return inflateRaw(data).then((u) => dec.decode(u));
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return Promise.resolve(null);
}

/* تحويل XML الوثيقة إلى نص: كل فقرة سطر، والخلايا مسافات */
function docxXmlToText(xml) {
  let t = String(xml || "");
  t = t.replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, "");
  t = t.replace(/<w:tab[^>]*\/>/g, " ");
  t = t.replace(/<w:br[^>]*\/>/g, "\n");
  t = t.replace(/<\/w:p>/g, "\n");
  t = t.replace(/<\/w:tc>/g, "  ");
  t = t.replace(/<\/w:tr>/g, "\n");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  t = t.replace(/&#(\d+);/g, (m, d) => String.fromCharCode(parseInt(d, 10)));
  t = t.replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

async function docxExtract(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const xml = await unzipDocxPart(bytes, "word/document.xml");
  if (!xml) throw new Error("تعذر قراءة ملف Word");
  return docxXmlToText(xml);
}

/* إرفاق ملف واحد من أي مصدر: رفع، كاميرا، لصق، سحب وإفلات */
async function attachFile(f) {
  if (!f) return;
  attached = null;
  const name = f.name || "ملف";
  if (f.size > MAX_FILE_MB * 1024 * 1024) {
    $("fileInfo").textContent = "الملف أكبر من " + MAX_FILE_MB + " ميجا";
    return;
  }
  try {
    if (f.type === "text/plain" || /\.txt$/i.test(name)) {
      attached = { mime: "text/plain", text: await f.text(), name };
    } else if (/\.docx$/i.test(name) || f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const text = await docxExtract(f);
      if (!text || text.length < 10) { $("fileInfo").textContent = "تعذر استخراج نص من ملف Word. تأكد أنه ملف docx حديث."; return; }
      attached = { mime: "text/plain", text, name, fromDocx: true };
    } else if (f.type === "application/pdf" || /\.pdf$/i.test(name)) {
      const b64 = await toB64(f);
      attached = { mime: "application/pdf", data: b64, name, url: b64ToBlobUrl(b64, "application/pdf") };
    } else if (/^image\//.test(f.type)) {
      const b64 = await toB64(f);
      attached = { mime: f.type, data: b64, dataUrl: await toDataUrl(f), name };
    } else {
      $("fileInfo").textContent = "نوع الملف غير مدعوم. المدعوم: PDF أو Word أو صورة أو ملف نصي";
      return;
    }
  } catch (e) {
    $("fileInfo").textContent = "تعذر قراءة الملف. جرّب ملفًا آخر.";
    return;
  }
  $("fileInfo").textContent = name + " (" + (f.size / 1048576).toFixed(1) + " ميجا" + (attached.fromDocx ? ", تم استخراج النص" : "") + ")";
}

/* ===== التحديثات ===== */
async function checkUpdate() {
  try {
    const r = await fetch("version.json?ts=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.v && String(j.v) !== APP_VER) show($("updBar"), true);
  } catch (e) {}
}

/* ===== التحقق الآلي من الاقتباسات ===== */
async function verifyCites() {
  const host = $("summaryOut").closest(".card") || $("summaryOut").parentElement;
  let line = host.querySelector(".checkline");
  const chips = Array.from(document.querySelectorAll("#summaryOut button.cite"));
  /* نقاط بدون اقتباس: كل نقطة يفترض أن يدعمها اقتباس من النص الأصلي */
  const c2 = { n: 0, quotes: [] };
  const liNoQ = [];
  try {
    const bl = parseBlocksMd(last.summary || "", c2);
    for (const b of bl) {
      if (b.kind === "li" || b.kind === "oli") liNoQ.push(!b.spans.some((sp) => sp.cite));
    }
  } catch (e) {}
  const noq = liNoQ.filter(Boolean).length;
  const lis = Array.from(document.querySelectorAll("#summaryOut li"));
  lis.forEach((el, i) => { if (liNoQ[i]) el.classList.add("li-noq"); });
  if (!chips.length && !liNoQ.length) { if (line) line.remove(); return; }
  const cs = currentSource || { kind: "none" };
  let verdicts = null;
  let reason = "";
  try {
    if (cs.kind === "text" && cs.text) {
      verdicts = currentCites.map((q) => !!findQuote(cs.text, q.text));
    } else if (cs.kind === "pdf" && cs.url) {
      const idx = cs._pdfIndex || (await buildPdfIndex());
      if (cs !== currentSource) return;
      if (idx && idx.hasText) verdicts = currentCites.map((q) => !!findQuoteInIndex(idx, q.text));
      else reason = "الملف يبدو ممسوحًا ضوئيًا بدون نص قابل للبحث.";
    } else if (cs.kind === "image") {
      reason = "الملف صورة، والتحقق هنا يدوي بمقارنة العين.";
    } else if (cs.kind === "pdf") {
      reason = "الملف الأصلي غير محفوظ في هذه الجلسة.";
    } else {
      reason = "لا يوجد نص أصلي محفوظ لهذه الجلسة.";
    }
  } catch (e) {
    reason = "تعذر تحليل النص الأصلي.";
  }
  if (cs !== currentSource) return;
  chips.forEach((ch) => {
    const i = +ch.getAttribute("data-i");
    if (verdicts && verdicts[i]) {
      ch.classList.add("cite-v");
      ch.title = "تم العثور على الاقتباس حرفيًا في النص الأصلي. اضغط للانتقال إليه.";
    } else if (verdicts) {
      ch.classList.add("cite-w");
      ch.title = "لم نعثر على هذا الاقتباس حرفيًا في النص المتاح. اضغط للمراجعة اليدوية.";
    }
  });
  if (!line) {
    line = document.createElement("p");
    line.className = "muted checkline";
    host.appendChild(line);
  }
  const noqNote = noq
    ? (noq === 1 ? " نقطة واحدة بدون اقتباس من النص (معلَّمة) يُفضَّل مراجعتها." : " " + noq + " نقاط بدون اقتباس من النص (معلَّمة) يُفضَّل مراجعتها.")
    : "";
  if (verdicts) {
    const ok = verdicts.filter(Boolean).length;
    const total = verdicts.length;
    if (ok === total) line.textContent = "التحقق الآلي: جميع الاقتباسات (" + total + ") موجودة حرفيًا في النص الأصلي." + noqNote;
    else {
      const bad = verdicts.map((v, i) => (!v ? String(i + 1) : null)).filter(Boolean).join("، ");
      line.textContent = "التحقق الآلي: " + ok + " من " + total + " اقتباسات موجودة حرفيًا. راجع المصادر " + bad + " يدويًا." + noqNote;
    }
    line.classList.toggle("warn", ok !== total || noq > 0);
  } else {
    line.textContent = "التحقق الآلي غير متاح: " + reason + noqNote;
    line.classList.toggle("warn", noq > 0);
  }
}

function verifyCitesSafe() {
  setTimeout(() => { verifyCites().catch(() => {}); }, 80);
}

/* ===== عرض النتائج ===== */
function renderSource(src) {
  const card = $("sourceCard");
  const body = $("sourceBody");
  const open = $("btnSrcOpen");
  const big = $("btnSrcViewer");
  const note = $("srcNote");
  src = src || { kind: "none" };
  if (src.kind === "none") { show(card, false); return; }
  body.innerHTML = "";
  note.classList.add("hidden");
  open.classList.add("hidden");
  big.classList.add("hidden");
  if (src.kind === "text" && src.text) {
    const d = document.createElement("div");
    d.className = "srctext";
    d.setAttribute("dir", "auto");
    d.textContent = src.text;
    body.appendChild(d);
    note.textContent = "هذا هو النص الأصلي الذي تم التحليل منه. أرقام المصادر في الملخص تنقلك إلى الموضع هنا.";
    note.classList.remove("hidden");
  } else if (src.url && src.kind === "pdf") {
    const canInline = !window.matchMedia("(max-width: 760px)").matches && (navigator.pdfViewerEnabled !== false);
    if (canInline) {
      const f = document.createElement("iframe");
      f.className = "srcpdf";
      f.title = "الملف الأصلي PDF";
      f.src = src.url + "#view=FitH";
      body.appendChild(f);
    } else {
      /* هواتف أندرويد لا تعرض PDF داخل الصفحة: بديل مرتب بزرين */
      const box = document.createElement("div");
      box.className = "srcpdf-note";
      box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><div><b>عرض PDF داخل الصفحة غير مدعوم على الهاتف.</b><span>افتح الملف في قارئ الجهاز، أو استخدم العارض الكبير للتنقل بين الصفحات والاقتباسات.</span></div>';
      body.appendChild(box);
    }
    open.classList.remove("hidden");
    big.classList.remove("hidden");
    open.onclick = () => window.open(src.url, "_blank");
    big.onclick = () => openCiteViewer(null);
    note.textContent = "اضغط على أي رقم مصدر في الملخص للانتقال إلى صفحة الاقتباس داخل الملف، أو استخدم زر العارض الكبير.";
    note.classList.remove("hidden");
    warmPdfIndex();
  } else if (src.url && src.kind === "image") {
    const img = document.createElement("img");
    img.className = "srcimg";
    img.alt = src.name || "الملف الأصلي";
    img.src = src.url;
    body.appendChild(img);
    open.classList.remove("hidden");
    big.classList.remove("hidden");
    open.onclick = () => window.open(src.url, "_blank");
    big.onclick = () => openCiteViewer(null);
    note.textContent = "اضغط على أي رقم مصدر في الملخص لعرض الصورة في العارض الكبير.";
    note.classList.remove("hidden");
  } else {
    note.textContent = "الملف الأصلي غير محفوظ في السجل. أعد رفع الملف لعرضه والتنقل منه.";
    note.classList.remove("hidden");
  }
  show(card, true);
}

/* ===== بناء المستندات (طباعة / تنسيقات) ===== */
function refLabel(q, i) {
  const pg = pageForQuote(q.text, q.pg);
  return { n: i + 1, text: q.text, pg };
}

function sectionHtml(ctx, blocks, autoDir) {
  return blocksToHtml(blocks, "print", autoDir);
}

function buildPrintRoot(which) {
  which = which || "full";
  const root = $("printRoot");
  if (!last.summary && !last.summaryEn && !last.translation) {
    root.innerHTML = '<p class="pr-meta">لا يوجد ملخص بعد. أنشئ ملخصًا أولًا ثم اطبع.</p>';
    return;
  }
  const sumCtx = { n: 0, quotes: [] };
  const sumBlocks = parseBlocksMd(last.summary, sumCtx);
  const enCtx = { n: 0, quotes: [] };
  const enBlocks = last.summaryEn ? parseBlocksMd(stripCiteMarks(last.summaryEn), enCtx) : [];
  const trCtx = { n: 0, quotes: [] };
  const trBlocks = last.translation ? parseBlocksMd(stripCiteMarks(last.translation), trCtx) : [];

  const c = chromeFor(which);

  let refsHtml = "";
  if ((which === "full" || which === "summary") && sumCtx.quotes.length) {
    refsHtml = '<div class="pr-h5">المراجع (اقتباسات من النص الأصلي)</div>' +
      sumCtx.quotes.map((q, i) => {
        const r = refLabel(q, i);
        return '<div class="pr-ref"><span class="pr-rn">[' + r.n + "]</span> «" + escapeHtml(r.text) + "»" +
          (r.pg ? ' <span class="pr-rpg">(صفحة ' + r.pg + ")</span>" : "") + "</div>";
      }).join("");
  }

  const parts = [];
  if (which === "full" || which === "summary") {
    parts.push('<div class="pr-h3" dir="auto">الملخص</div>' + sectionHtml(sumCtx, sumBlocks) + refsHtml);
  }
  if ((which === "full" || which === "summaryEn") && enBlocks.length) {
    const enHead = '<div class="pr-h3" dir="auto">English Summary</div>' + sectionHtml(enCtx, enBlocks, true);
    parts.push(which === "full" ? '<div class="pr-newpage"></div>' + enHead : enHead);
  }
  if ((which === "full" || which === "translation") && trBlocks.length) {
    const trHead = '<div class="pr-h3" dir="auto">' + c.trHead + "</div>" + sectionHtml(trCtx, trBlocks, true);
    parts.push(which === "full" ? '<div class="pr-newpage"></div>' + trHead : trHead);
  }

  root.classList.toggle("pr-ltr", c.lang === "en");
  /* بلا ترويسة علوية: عنوان المستند ثم التاريخ فقط. الاسم يظهر بخط صغير جدا في تذييل كل صفحة. */
  root.innerHTML =
    '<div class="pr-title">' + escapeHtml(c.title) + "</div>" +
    '<div class="pr-meta">' + escapeHtml(c.date) + "</div>" +
    parts.join("");
}

/* ===== العرض ===== */
function showResult(parsed, source) {
  last = {
    summary: (parsed && parsed.summary) || "",
    summaryEn: (parsed && parsed.summaryEn) || "",
    translation: (parsed && parsed.translation) || ""
  };
  currentSource = source || { kind: "none" };
  const ctx = { n: 0, quotes: [] };
  $("summaryOut").innerHTML = blocksToHtml(parseBlocksMd(last.summary, ctx), "screen");
  currentCites = ctx.quotes;
  const hasEn = !!last.summaryEn.trim();
  show($("enCard"), hasEn);
  $("enOut").innerHTML = hasEn ? blocksToHtml(parseBlocksMd(stripCiteMarks(last.summaryEn), { n: 0, quotes: [] }), "screen", true) : "";
  const trSrc = stripCiteMarks(last.translation) || "(لا توجد ترجمة)";
  $("transOut").innerHTML = blocksToHtml(parseBlocksMd(trSrc, { n: 0, quotes: [] }), "screen", true);
  updateCardHeads();
  show($("citeHint"), ctx.quotes.length > 0);
  renderSource(currentSource);
  verifyCitesSafe();
  refreshDownloadRows();
  buildPrintRoot("full");
  show($("output"), true);
  $("output").scrollIntoView({ behavior: "smooth", block: "start" });
}

function refreshDownloadRows() {
  const hasSum = !!(last.summary && last.summary.trim());
  const hasEn = !!(last.summaryEn && last.summaryEn.trim());
  const hasTr = !!(last.translation && last.translation.trim());
  const row = (w) => document.querySelector('.dl-row[data-w="' + w + '"]');
  show(row("full"), hasSum || hasEn || hasTr);
  show(row("summary"), hasSum);
  show(row("summaryEn"), hasEn);
  show(row("translation"), hasTr);
  const trSub = document.querySelector('.dl-row[data-w="translation"] .dl-sub');
  if (trSub && hasTr) trSub.textContent = trLang() === "en" ? "النص الكامل مترجمًا إلى الإنجليزية، لوحده" : "النص الكامل مترجمًا إلى العربية، لوحده";
}

/* ===== السجل (لكل مستخدم سجله الخاص) ===== */
function loadHistory() {
  const k = userHistoryKey();
  if (!k) return [];
  try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch (e) { return []; }
}
function saveHistory(srcTitle, parsed, model, src) {
  const k = userHistoryKey();
  if (!k) return;
  const h = loadHistory();
  const entry = {
    t: Date.now(),
    title: String(srcTitle || "").replace(/\s+/g, " ").slice(0, 80),
    summary: parsed.summary,
    summaryEn: parsed.summaryEn || "",
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
    localStorage.setItem(k, JSON.stringify(trimmed));
  } catch (e) {
    try {
      trimmed.forEach(x => { delete x.srcText; });
      localStorage.setItem(k, JSON.stringify(trimmed));
    } catch (e2) {}
  }
  renderHistory();
}
function renderHistory() {
  const h = loadHistory();
  const u = currentUser();
  const who = $("histWho");
  if (who) who.textContent = u ? "(" + u.name + ")" : "";
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
      showResult({ summary: it.summary || "", summaryEn: it.summaryEn || "", translation: it.translation || "" }, src);
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
const DL_NAMES = {
  full: { word: "الملف-الكامل", print: "الملف-الكامل" },
  summary: { word: "ملخص-قضية", print: "ملخص-قضية" },
  summaryEn: { word: "English-Summary", print: "English-Summary" },
  translation: { word: "ترجمة-قضية", print: "ترجمة-قضية" }
};

function buildDocxBytes(which) {
  which = which || "full";
  const sumCtx = { n: 0, quotes: [] };
  const sumBlocks = last.summary ? blocksToDocxBlocks(parseBlocksMd(last.summary, sumCtx)) : [];
  const enBlocks = last.summaryEn ? blocksToDocxBlocks(parseBlocksMd(stripCiteMarks(last.summaryEn), { n: 0, quotes: [] })) : [];
  const trBlocks = last.translation ? blocksToDocxBlocks(parseBlocksMd(stripCiteMarks(last.translation), { n: 0, quotes: [] })) : [];

  const c = chromeFor(which);
  const blocks = [
    { k: "title", runs: [{ t: c.title }] },
    { k: "meta", runs: [{ t: c.date }] }
  ];
  if (which === "full" || which === "summary") {
    blocks.push({ k: "h2", runs: [{ t: "الملخص" }] });
    for (const b of sumBlocks) blocks.push(b);
    if (sumCtx.quotes.length) {
      blocks.push({ k: "h3", runs: [{ t: "المراجع (اقتباسات من النص الأصلي)" }] });
      sumCtx.quotes.forEach((q, i) => {
        const r = refLabel(q, i);
        blocks.push({ k: "ref", runs: [{ t: "[" + r.n + "] ", b: true }, { t: "«" + r.text + "»" }].concat(r.pg ? [{ t: " (صفحة " + r.pg + ")", c: "64748B" }] : []) });
      });
    }
  }
  if ((which === "full" || which === "summaryEn") && enBlocks.length) {
    if (which === "full") blocks.push({ k: "brk" });
    blocks.push({ k: "h2", runs: [{ t: "English Summary" }] });
    for (const b of enBlocks) blocks.push(b);
  }
  if ((which === "full" || which === "translation") && trBlocks.length) {
    if (which === "full") blocks.push({ k: "brk" });
    blocks.push({ k: "h2", runs: [{ t: c.trHead }] });
    for (const b of trBlocks) blocks.push(b);
  }
  return QADocx.build({ blocks, lang: c.lang, title: c.title });
}

function anyContent() { return !!(last.summary || last.summaryEn || last.translation); }

function exportWord(which) {
  which = which || "full";
  if (!anyContent()) { setStatus("لا يوجد ملخص للتحميل بعد", true); return; }
  try {
    const bytes = buildDocxBytes(which);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (DL_NAMES[which] || DL_NAMES.full).word + "-" + isoDate() + ".docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    setStatus("تعذر إنشاء ملف Word. حاول تاني.", true);
  }
}

/* تذييل صفحات PDF: صناديق هوامش @page مدعومة في Chrome وEdge الحديثين */
function setPageFootStyle(lang) {
  let el = document.getElementById("pageFootStyle");
  if (!el) {
    el = document.createElement("style");
    el.id = "pageFootStyle";
    document.head.appendChild(el);
  }
  if (lang === "en") {
    el.textContent = '@page { @bottom-center { content: "Page " counter(page) " of " counter(pages); font-family: "Times New Roman", "Tinos", serif; font-size: 9pt; color: #605C56; } @bottom-left { content: "Mohamed Mohiey"; font-family: "Times New Roman", "Tinos", serif; font-size: 7.5pt; color: #9a958d; } }';
  } else {
    el.textContent = '@page { @bottom-center { content: "صفحة " counter(page) " من " counter(pages); font-family: "Noto Naskh Arabic", serif; font-size: 9pt; color: #605C56; } @bottom-left { content: "محمد محي"; font-family: "Noto Naskh Arabic", serif; font-size: 7.5pt; color: #9a958d; } }';
  }
}
/* نموذج المستند لتوليد PDF حقيقي (pdfgen.js) */
function buildDocModel(which) {
  which = which || "full";
  const sumCtx = { n: 0, quotes: [] };
  const sumBlocks = last.summary ? parseBlocksMd(last.summary, sumCtx) : [];
  const enCtx = { n: 0, quotes: [] };
  const enBlocks = last.summaryEn ? parseBlocksMd(stripCiteMarks(last.summaryEn), enCtx) : [];
  const trCtx = { n: 0, quotes: [] };
  const trBlocks = last.translation ? parseBlocksMd(stripCiteMarks(last.translation), trCtx) : [];
  const c = chromeFor(which);
  const sections = [];
  if (which === "full" || which === "summary") {
    sections.push({
      head: "الملخص",
      blocks: sumBlocks,
      refs: sumCtx.quotes.map((q, i) => { const r = refLabel(q, i); return { n: r.n, text: r.text, pg: r.pg }; })
    });
  }
  if ((which === "full" || which === "summaryEn") && enBlocks.length) {
    sections.push({ head: "English Summary", blocks: enBlocks, refs: [], pageBreakBefore: which === "full" });
  }
  if ((which === "full" || which === "translation") && trBlocks.length) {
    sections.push({ head: c.trHead, blocks: trBlocks, refs: [], pageBreakBefore: which === "full" });
  }
  return { lang: c.lang, title: c.title, meta: c.date, sections: sections };
}

/* تنزيل PDF حقيقي (نص حقيقي) بدون نافذة طباعة */
async function pdfExport(which) {
  which = which || "full";
  if (!anyContent()) { setStatus("لا يوجد ملخص للتحميل بعد", true); return; }
  setStatus("جاري تجهيز ملف PDF...");
  try {
    const blob = await QAPDF.render(buildDocModel(which));
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (DL_NAMES[which] || DL_NAMES.full).print + "-" + isoDate() + ".pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus("تم تنزيل ملف PDF.");
  } catch (e) {
    setStatus("تعذر إنشاء ملف PDF: " + ((e && e.message) || e), true);
  }
}

function printExport(which) {
  which = which || "full";
  if (!anyContent()) { setStatus("لا يوجد ملخص للطباعة بعد", true); return; }
  buildPrintRoot(which);
  setPageFootStyle(chromeFor(which).lang);
  const oldTitle = document.title;
  document.title = (DL_NAMES[which] || DL_NAMES.full).print + "-" + isoDate();
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
  if (!currentUser()) { showLogin(); return; }
  const p = provider();
  const key = keyFor(p);
  if (!key) {
    if (isAdmin()) {
      setStatus("ضع مفتاح " + labelOf(p) + " في الإعدادات أولًا", true);
      show($("settings"), true);
    } else {
      setStatus("الخدمة غير مفعّلة على هذا المتصفح بعد. تواصل مع مسؤول النظام لتفعيلها.", true);
    }
    return;
  }
  const text = $("caseText").value.trim();
  if (!text && !attached) { setStatus("الصق نص القضية أو ارفع ملفًا أولًا", true); return; }

  running = true;
  const btn = $("btnRun");
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.classList.add("loading");
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

    /* فحص لغة الترجمة: لو رجعت بنفس لغة الوثيقة نعيد الترجمة تلقائيًا للغة الأخرى */
    let trNote = "";
    const qctx0 = { n: 0, quotes: [] };
    parseBlocksMd(result.parsed.summary || "", qctx0);
    const srcLang = guessSourceLang(text, qctx0.quotes);
    const trRaw = String(result.parsed.translation || "");
    const fixTarget = srcLang === "ar" ? "en" : (srcLang === "en" ? "ar" : null);
    if (fixTarget && (!trRaw.trim() || detectTextLang(trRaw) === srcLang)) {
      setStatus("الترجمة رجعت " + (trRaw.trim() ? "بنفس لغة الوثيقة" : "غير مكتملة") + "، جاري إعادة الترجمة تلقائيًا...");
      try {
        const fixed = usedProvider === "gemini"
          ? await translateWithGemini(keyFor("gemini"), text, fixTarget)
          : await translateWithOpenRouter(keyFor("openrouter"), text, fixTarget);
        if (fixed && fixed.trim()) {
          result.parsed.translation = fixed.trim();
          trNote = " وأُعيدت الترجمة تلقائيًا إلى " + (fixTarget === "en" ? "الإنجليزية" : "العربية");
        } else {
          trNote = " (تعذر تصحيح الترجمة تلقائيًا، أعد المحاولة)";
        }
      } catch (e2) {
        trNote = " (تعذر تصحيح الترجمة تلقائيًا، أعد المحاولة)";
      }
    }

    showResult(result.parsed, src);
    saveHistory(srcTitle, result.parsed, result.model, src);
    let msg = "تم";
    if (usedProvider !== p) msg += " (تم التحويل تلقائيًا إلى " + labelOf(usedProvider) + ")";
    if (trNote) msg += trNote;
    if (result.truncated) msg += ". ملاحظة: النتيجة قد تكون مقطوعة لطول النص، جرب تقسيم القضية.";
    setStatus(msg, false);
  } catch (e) {
    setStatus(e instanceof ApiError ? e.message : "تعذر الاتصال بالخدمة. راجع الإنترنت وحاول تاني.", true);
  } finally {
    running = false;
    btn.disabled = false;
    btn.classList.remove("loading");
    btn.textContent = oldLabel;
  }
}

/* ===== ربط الأحداث ===== */
function init() {
  $("btnSettings").addEventListener("click", () => {
    const willShow = $("settings").classList.contains("hidden");
    show($("settings"), willShow);
    if (willShow) renderUsersAdmin();
  });
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

  const onPicked = async (id) => {
    const inp = $(id);
    const f = inp.files && inp.files[0];
    if (!f) return;
    await attachFile(f);
    try { inp.value = ""; } catch (e) {}
  };
  $("fileInput").addEventListener("change", () => onPicked("fileInput"));
  $("cameraInput").addEventListener("change", () => onPicked("cameraInput"));

  $("btnClear").addEventListener("click", () => {
    $("caseText").value = "";
    attached = null;
    $("fileInput").value = "";
    $("cameraInput").value = "";
    $("fileInfo").textContent = "";
    try { localStorage.removeItem(LS.draft); } catch (e) {}
    setStatus("");
  });

  $("btnRun").addEventListener("click", run);

  /* اختصار Ctrl+Enter للتشغيل */
  $("caseText").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
  });

  /* لصق صورة من الحافظة مباشرة */
  $("caseText").addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && /^image\//.test(it.type)) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); attachFile(f).catch(() => {}); }
        return;
      }
    }
  });

  /* سحب ملف وإفلاته على بطاقة النص */
  const inputCard = $("caseText").closest(".card");
  if (inputCard) {
    inputCard.addEventListener("dragover", (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf("Files") >= 0) { e.preventDefault(); inputCard.classList.add("drop"); }
    });
    inputCard.addEventListener("dragleave", () => inputCard.classList.remove("drop"));
    inputCard.addEventListener("drop", (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      inputCard.classList.remove("drop");
      attachFile(f).catch(() => {});
    });
  }

  /* حفظ مسودة النص تلقائيًا حتى لا تضيع عند التحديث */
  let draftT = null;
  $("caseText").addEventListener("input", () => {
    clearTimeout(draftT);
    draftT = setTimeout(() => {
      try {
        const v = $("caseText").value;
        if (v.trim()) localStorage.setItem(LS.draft, v);
        else localStorage.removeItem(LS.draft);
      } catch (e) {}
    }, 400);
  });

  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", async () => {
      const which = b.getAttribute("data-copy");
      const t = which === "summary" ? stripCitesForCopy(last.summary)
        : which === "summaryEn" ? stripCitesForCopy(last.summaryEn)
        : stripCitesForCopy(last.translation);
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

  /* مركز التحميل */
  const dl = $("downloadCard");
  if (dl) {
    dl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-dl]");
      if (!b) return;
      const which = b.getAttribute("data-dl");
      const fmt = b.getAttribute("data-fmt");
      if (fmt === "word") exportWord(which);
      else if (fmt === "pdf") pdfExport(which);
      else printExport(which);
    });
  }

  /* العارض */
  $("vwClose").addEventListener("click", closeViewer);
  $("vwPrev").addEventListener("click", () => viewerGo(-1));
  $("vwNext").addEventListener("click", () => viewerGo(1));
  $("vwZoomIn").addEventListener("click", () => viewerZoom(1.25));
  $("vwZoomOut").addEventListener("click", () => viewerZoom(0.8));
  $("viewer").addEventListener("click", (e) => { if (e.target === $("viewer")) closeViewer(); });
  document.addEventListener("keydown", (e) => {
    if (!viewer.open) return;
    if (e.key === "Escape") closeViewer();
    else if (e.key === "ArrowLeft") viewerGo(1);
    else if (e.key === "ArrowRight") viewerGo(-1);
  });
  /* زر الرجوع في المتصفح أو الهاتف يقفل النافذة المفتوحة فقط، ولا يخرج من الموقع */
  window.addEventListener("popstate", () => {
    if (viewer.open) { closeViewer(true); return; }
    if (!$("adminGate").classList.contains("hidden")) { closeAdminGate(true); return; }
    vwPushed = false;
    gatePushed = false;
  });

  $("btnClearHistory").addEventListener("click", () => {
    const k = userHistoryKey();
    if (k) localStorage.removeItem(k);
    renderHistory();
  });

  /* المستخدمون والدخول */
  $("btnSwitchUser").addEventListener("click", logoutUser);
  $("btnCreateUser").addEventListener("click", createUser);
  $("newUserName").addEventListener("keydown", (e) => { if (e.key === "Enter") createUser(); });
  $("newUserPin").addEventListener("keydown", (e) => { if (e.key === "Enter") createUser(); });
  $("btnLoginPin").addEventListener("click", submitPin);
  $("loginPin").addEventListener("keydown", (e) => { if (e.key === "Enter") submitPin(); });
  $("btnPinBack").addEventListener("click", renderLogin);
  $("btnExitAdmin").addEventListener("click", exitAdmin);
  $("btnAdminEntry").addEventListener("click", openAdminGate);
  $("btnAdminOk").addEventListener("click", submitAdminCode);
  $("btnAdminCancel").addEventListener("click", closeAdminGate);
  $("adminCode").addEventListener("keydown", (e) => { if (e.key === "Enter") submitAdminCode(); });
  $("btnAdmAddUser").addEventListener("click", adminAddUser);
  $("admUserName").addEventListener("keydown", (e) => { if (e.key === "Enter") adminAddUser(); });
  $("admUserPin").addEventListener("keydown", (e) => { if (e.key === "Enter") adminAddUser(); });

  /* وضع المدير: رابط #admin أو خمس نقرات متتالية على اسم الموقع في الأسفل */
  if ((location.hash || "").toLowerCase() === "#admin") enterAdmin();
  window.addEventListener("hashchange", () => {
    if ((location.hash || "").toLowerCase() === "#admin") enterAdmin();
  });
  let adminTaps = 0, adminTapAt = 0;
  $("adminTap").addEventListener("click", () => {
    const now = Date.now();
    if (now - adminTapAt > 2500) adminTaps = 0;
    adminTapAt = now;
    adminTaps++;
    if (adminTaps >= 5) { adminTaps = 0; enterAdmin(); }
  });

  applyAdminUI();
  if (currentUser()) hideLogin(); else showLogin();
  applyUserUI();
  renderHistory();
  try { const d = localStorage.getItem(LS.draft); if (d) $("caseText").value = d; } catch (e) {}
  buildPrintRoot("full");
  if (keyFor(provider())) refreshModels(true);
  try { if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {}); } catch (e) {}

  /* رقم الإصدار + التنبيه عند توفر تحديث جديد */
  try { $("verTag").textContent = APP_VER; } catch (e) {}
  if ($("updBar")) {
    $("updBar").addEventListener("click", () => {
      try { const u = new URL(location.href); u.searchParams.set("u", String(Date.now())); location.replace(u.toString()); }
      catch (e) { location.reload(); }
    });
  }
  checkUpdate();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
  setInterval(checkUpdate, 15 * 60 * 1000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
