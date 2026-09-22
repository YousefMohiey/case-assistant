/* pdfgen.js - توليد PDF حقيقي (نص حقيقي قابل للبحث والنسخ) داخل المتصفح.
   لا يستخدم نافذة الطباعة إطلاقًا: نبني الملف وننزّله مباشرة.
   يعتمد على pdfkit (خطوط مضمّنة) + bidi-js (ترتيب ثنائي الاتجاه) + خطوط Noto مصغّرة محليًا. */
(function () {
  "use strict";

  /* ===== قياسات الصفحة والتصميم (مطابقة لملف الطباعة) ===== */
  var PAGE = { w: 595.28, h: 841.89, mt: 45, mb: 54, ml: 43, mr: 43 };
  var CW = PAGE.w - PAGE.ml - PAGE.mr;
  var LT = PAGE.ml;                    /* حد يسار منطقة المحتوى */
  var RT = PAGE.w - PAGE.mr;           /* حد يمين منطقة المحتوى */
  var Y_BOTTOM = PAGE.h - PAGE.mb;

  var C = {
    title: "#17140f", body: "#17140f", h4: "#33302a", h5: "#4b463f",
    muted: "#605c56", faint: "#9a958d", accent: "#1f3d7a",
    refInk: "#33302a", sep: "#cfc9c0", ruleGold: "#d9c9a3"
  };

  var FONT_FILES = {
    nr: "./vendor/fonts/naskh-r.ttf",
    nb: "./vendor/fonts/naskh-b.ttf",
    lr: "./vendor/fonts/serif-r.ttf",
    lb: "./vendor/fonts/serif-b.ttf"
  };

  var LEAD = 1.95;          /* معامل ارتفاع السطر */
  var B_FACTOR = 0.72;      /* موضع خط الأساس داخل السطر */

  /* ===== أدوات تصنيف الأحرف ===== */
  var RE_AR = /[\u0620-\u064A\u066E-\u06D5\u06FA-\u06FF\u0671\u0640\u0622\u0623\u0625\u0627\u062F\u0629\u0649\u064A]/;
  var RE_MARK = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u200C\u200D\u200E\u200F]/;
  var RE_ARANY = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
  var RE_AR_DIG = /[\u0660-\u0669\u06F0-\u06F9]/;
  var RE_LAT = /[A-Za-z\u00C0-\u024F]/;
  var RE_DIG = /[0-9\u0660-\u0669\u06F0-\u06F9]/;
  var MIRROR = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "\u00AB": "\u00BB", "\u00BB": "\u00AB", "\u2039": "\u203A", "\u203A": "\u2039", "<": ">", ">": "<" };

  function cls(ch) {
    if (RE_AR.test(ch)) return "ar";
    if (RE_MARK.test(ch)) return "ar";
    if (RE_AR_DIG.test(ch)) return "adig";
    if (RE_LAT.test(ch)) return "lat";
    if (RE_DIG.test(ch)) return "dig";
    return "neu";
  }

  /* ===== تحميل المكتبات والخطوط (مرة واحدة) ===== */
  var _deps = null;
  var _bufs = null;

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error("تعذر تحميل " + src)); };
      document.head.appendChild(s);
    });
  }
  function fetchBuf(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("تعذر تحميل الخط " + url);
      return r.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    });
  }

  function ensure() {
    if (_deps) return _deps;
    _deps = (function () {
      var chain = Promise.resolve();
      if (!window.PDFDocument) chain = chain.then(function () { return loadScript("./vendor/pdfkit.standalone.js"); });
      if (!window.bidi_js) chain = chain.then(function () { return loadScript("./vendor/bidi.js"); });
      return chain.then(function () {
        return Promise.all([fetchBuf(FONT_FILES.nr), fetchBuf(FONT_FILES.nb), fetchBuf(FONT_FILES.lr), fetchBuf(FONT_FILES.lb)]);
      }).then(function (arr) {
        _bufs = { nr: arr[0], nb: arr[1], lr: arr[2], lb: arr[3] };
        return true;
      });
    })();
    _deps.catch(function () { _deps = null; });
    return _deps;
  }

  /* ===== تحويل كتل المحتوى إلى مقاطع نصية منسّقة ===== */
  /* segments: { t, b?, i?, cite?, sz?, c? } */

  function spansToSegments(spans) {
    var out = [];
    (spans || []).forEach(function (s) {
      if (!s) return;
      if (s.cite) {
        out.push({ t: "[" + (s.ci + 1) + "]", cite: true });
        return;
      }
      if (!s.t) return;
      out.push({ t: s.t, b: !!s.b, i: !!s.i });
    });
    return out;
  }

  /* تقسيم المقاطع إلى قطع بأصناف موحدة، مع نمط لكل قطعة */
  function segmentsToChunks(segs, base) {
    var chunks = [];
    segs.forEach(function (seg) {
      var text = String(seg.t == null ? "" : seg.t).replace(/[\t\u00A0]+/g, " ");
      var cur = null;
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        var c = cls(ch);
        if (cur && (cur.c === c || (c === "neu" && cur.c === "neu"))) cur.t += ch;
        else { cur = { t: ch, c: c }; chunks.push(cur); }
      }
    });
    /* نمط كل قطعة */
    var si = 0, segIdx = [];
    var idx = 0;
    // نعيد ربط المقاطع بالقطع: نحسب حدود المقاطع على النص الكامل
    var full = segs.map(function (s) { return String(s.t == null ? "" : s.t); });
    var bounds = [], pos = 0;
    full.forEach(function (t) {
      bounds.push([pos, pos + t.length]);
      pos += t.replace(/[\t\u00A0]+/g, " ").length;
    });
    var cpos = 0;
    chunks.forEach(function (ck) {
      var start = cpos;
      cpos += ck.t.length;
      var segi = 0;
      for (var k = 0; k < bounds.length; k++) { if (start >= bounds[k][0] && start < bounds[k][1]) { segi = k; break; } }
      var sg = segs[segi] || {};
      var bold = !!(sg.b || base.bold);
      var fam;
      if (base.lang === "en") fam = bold ? "lb" : "lr";
      else if (ck.c === "ar" || ck.c === "adig") fam = bold ? "nb" : "nr";
      else fam = bold ? "lb" : "lr";
      ck.fam = fam;
      ck.sz = sg.sz || base.sz;
      ck.color = sg.c || base.color;
      ck.bold = bold;
      if (sg.cite) { ck.sz = base.sz * 0.72; ck.raise = base.sz * 0.30; }
    });
    return chunks;
  }

  /* ===== قياس عرض قطعة ===== */
  function chunkWidth(doc, ck) {
    doc.font(ck.fam).fontSize(ck.sz);
    return doc.widthOfString(ck.t);
  }
  function chunksWidth(doc, chunks) {
    var w = 0;
    for (var i = 0; i < chunks.length; i++) w += chunkWidth(doc, chunks[i]);
    return w;
  }
  function isSpaceChunk(ck) { return ck.c === "neu" && /^\s+$/.test(ck.t); }

  /* ===== لف السطور ===== */
  function wrapChunks(doc, chunks, mw1, mw2) {
    var lines = [];
    var cur = [], cw = 0;
    var maxw = mw1;
    function push() { if (cur.length) { lines.push(cur); cur = []; cw = 0; maxw = mw2; } }
    var i = 0, n = chunks.length;
    while (i < n) {
      var ck = chunks[i];
      if (isSpaceChunk(ck)) {
        if (cur.length) {
          var spw = chunkWidth(doc, ck);
          if (cw + spw > maxw && cw > 0) { push(); i++; continue; }
          cur.push(ck); cw += spw;
        }
        i++;
        continue;
      }
      var w = chunkWidth(doc, ck);
      if (cw + w > maxw && cur.length) { push(); continue; }
      cur.push(ck); cw += w;
      i++;
    }
    push();
    /* إزالة الفراغات في أطراف السطور */
    lines.forEach(function (ln) {
      while (ln.length && isSpaceChunk(ln[0])) ln.shift();
      while (ln.length && isSpaceChunk(ln[ln.length - 1])) ln.pop();
    });
    return lines.filter(function (l) { return l.length; });
  }

  /* ===== ترتيب ثنائي الاتجاه (UBA L2 على مستوى القطع) + عكس الأقواس ===== */
  function visualOrder(bidi, chunks, baseDir) {
    if (!chunks.length) return chunks;
    var text = chunks.map(function (c) { return c.t; }).join("");
    var levels;
    try {
      levels = bidi.getEmbeddingLevels(text, baseDir).levels;
    } catch (e) {
      return chunks.slice();
    }
    var pos = 0;
    chunks.forEach(function (c) { c.level = levels[pos] | 0; pos += c.t.length; });
    var maxL = 0, minOdd = 255;
    chunks.forEach(function (c) { if (c.level > maxL) maxL = c.level; if ((c.level & 1) && c.level < minOdd) minOdd = c.level; });
    if (minOdd === 255) minOdd = maxL + 1;
    for (var lvl = maxL; lvl >= minOdd; lvl--) {
      var i = 0;
      while (i < chunks.length) {
        if (chunks[i].level >= lvl) {
          var j = i;
          while (j + 1 < chunks.length && chunks[j + 1].level >= lvl) j++;
          var sub = chunks.slice(i, j + 1).reverse();
          for (var k = 0; k < sub.length; k++) chunks[i + k] = sub[k];
          i = j + 1;
        } else i++;
      }
    }
    /* عكس أزواج الأقواس للأجزاء ذات المستوى الفردي */
    chunks.forEach(function (c) {
      if ((c.level & 1) && c.c === "neu") {
        var out = "";
        for (var i = 0; i < c.t.length; i++) out += (MIRROR[c.t[i]] || c.t[i]);
        c.t = out;
      }
    });
    return chunks;
  }

  /* ===== رسم سطر ===== */
  function drawLine(doc, chunks, y, startX, justifyExtra) {
    var x = startX;
    for (var i = 0; i < chunks.length; i++) {
      var ck = chunks[i];
      var w = chunkWidth(doc, ck);
      if (!isSpaceChunk(ck)) {
        doc.font(ck.fam).fontSize(ck.sz).fillColor(ck.color);
        doc.text(ck.t, x, y - (ck.raise || 0), { lineBreak: false });
      }
      x += w + (isSpaceChunk(ck) ? (justifyExtra || 0) : 0);
    }
  }

  function mkPlain(str, base) {
    return segmentsToChunks([{ t: str }], base);
  }

  /* ===== بناء عناصر التخطيط من الأقسام ===== */
  function buildItems(model) {
    var items = [];
    var lang = model.lang === "en" ? "en" : "ar";

    var titleBase = { lang: lang, sz: 16.5, bold: true, color: C.title };
    var metaBase = { lang: lang, sz: 10, bold: false, color: C.muted };
    var h3Base = { lang: lang, sz: 14.5, bold: true, color: C.accent };
    var h4Base = { lang: lang, sz: 12.5, bold: true, color: C.h4 };
    var h5Base = { lang: lang, sz: 11.5, bold: true, color: C.h5 };
    var pBase = { lang: lang, sz: 11.5, bold: false, color: C.body };

    function direct(s) { return RE_ARANY.test(String(s || "")) ? "rtl" : "ltr"; }

    items.push({ kind: "title", chunks: mkPlain(model.title || "", titleBase), baseDir: direct(model.title), align: "center", sz: titleBase.sz, mb: 4.25, mt: 0 });
    items.push({ kind: "meta", chunks: mkPlain(model.meta || "", metaBase), baseDir: direct(model.meta), align: "center", sz: metaBase.sz, mb: 19.8, mt: 0 });

    (model.sections || []).forEach(function (sec) {
      if (sec.pageBreakBefore) items.push({ kind: "pagebreak" });
      if (sec.head) {
        items.push({ kind: "h3", chunks: mkPlain(sec.head, h3Base), baseDir: direct(sec.head), align: direct(sec.head) === "rtl" ? "rtl" : "ltr", sz: h3Base.sz, mb: 13, mt: 19.8, rule: true, keepNext: true });
      }
      (sec.blocks || []).forEach(function (b) {
        if (b.kind === "hr") { items.push({ kind: "sep" }); return; }
        var base = pBase, kind = "p", sz = pBase.sz, mb = 7.4, marker = null, indent = 0, justify = true;
        if (b.kind === "h2" || b.kind === "h3") { base = h4Base; kind = "h4"; mb = 5.7; justify = false; }
        var segs = spansToSegments(b.spans);
        var text0 = segs.map(function (s) { return s.t; }).join("");
        var bd = direct(text0);
        if (b.kind === "li" || b.kind === "oli") {
          kind = "li"; mb = 6.2; indent = 17;
          marker = b.kind === "oli" ? String(b.num || "1") + "." : "\u2022";
        }
        items.push({
          kind: kind, chunks: segmentsToChunks(segs, base), baseDir: bd,
          align: bd === "rtl" ? "rtl" : "ltr", sz: sz || base.sz, mb: mb,
          mt: (kind === "h4" ? 14.2 : 0), marker: marker, indent: indent,
          justify: justify, keepNext: kind === "h4"
        });
      });
      if (sec.refs && sec.refs.length) {
        var isEn = lang === "en";
        items.push({ kind: "h5", chunks: mkPlain(isEn ? "References (quotes from the source)" : "المراجع (اقتباسات من النص الأصلي)", h5Base), baseDir: isEn ? "ltr" : "rtl", align: isEn ? "ltr" : "rtl", sz: h5Base.sz, mb: 5.7, mt: 17, keepNext: true });
        sec.refs.forEach(function (r) {
          var segs = [
            { t: "[" + r.n + "]", b: true, c: C.accent },
            { t: " " },
            { t: "\u00AB" + r.text + "\u00BB", c: C.refInk },
            r.pg ? { t: " " } : null,
            r.pg ? { t: "(صفحة " + r.pg + ")", c: C.muted, sz: 9.5 } : null
          ].filter(Boolean);
          items.push({
            kind: "ref", chunks: segmentsToChunks(segs, { lang: lang, sz: 10.5, bold: false, color: C.refInk }),
            baseDir: "rtl", align: "rtl", sz: 10.5, mb: 5.7, mt: 0, indent: 17, justify: false, keepTogether: true
          });
        });
      }
    });
    return items;
  }

  /* ===== ترقيم الصفحات ===== */
  function paginate(doc, items) {
    /* كسوة السطور لكل العناصر أولًا (كي تعمل قواعد التقارب بين الكتل) */
    items.forEach(function (it) {
      if (it.kind === "pagebreak" || it.kind === "sep") return;
      if (!it.lines) it.lines = wrapChunks(doc, it.chunks, CW - (it.indent || 0), CW - (it.indent || 0));
    });
    var pages = [];
    var page = [], y = PAGE.mt;

    function newPage() { pages.push(page); page = []; y = PAGE.mt; }

    for (var idx = 0; idx < items.length; idx++) {
      var it = items[idx];
      if (it.kind === "pagebreak") { if (page.length) newPage(); continue; }
      if (it.kind === "sep") {
        var sepH = 34;
        if (y + sepH > Y_BOTTOM && page.length) newPage();
        page.push({ item: it, y0: y + 17, from: 0, to: 0 }); y += sepH;
        continue;
      }
      var lines = it.lines;
      var leading = it.sz * LEAD;
      var total = lines.length * leading + it.mb;

      /* لا تقطع عنوانًا عن أول سطر يتبعه */
      var need = total;
      if (it.keepNext) {
        var nxt = items[idx + 1];
        var nxtLead = nxt && nxt.lines ? nxt.lines.length * (nxt.sz * LEAD) : 0;
        need += (nxt && nxt.kind === "pagebreak") ? 0 : Math.min(nxtLead, 40);
      }
      if (y + it.mt + need > Y_BOTTOM && page.length) { newPage(); }

      if (it.keepTogether && lines.length * leading + it.mb < (Y_BOTTOM - PAGE.mt)) {
        if (y + it.mt + total > Y_BOTTOM && page.length) newPage();
        page.push({ item: it, y0: y + it.mt, from: 0, to: lines.length - 1 });
        y += it.mt + total;
        continue;
      }

      /* كتلة قابلة للانقسام بين الصفحات */
      var from = 0;
      while (from < lines.length) {
        var avail = Y_BOTTOM - (y + it.mt);
        var canLines = Math.floor((avail - (from === 0 ? 0 : 0)) / leading);
        if (canLines <= 0 || (from === lines.length - 1 && from === 0 && canLines <= 0)) {
          if (page.length) { newPage(); continue; }
          canLines = 1;
        }
        var to = Math.min(lines.length - 1, from + canLines - 1);
        page.push({ item: it, y0: y + it.mt, from: from, to: to });
        y += it.mt + (to - from + 1) * leading;
        from = to + 1;
        if (from < lines.length) {
          y += it.mb; /* المسافة قبل الانتقال */
          newPage();
        }
      }
      y += it.mb;
    }
    pages.push(page);
    return pages.filter(function (p, i) { return p.length || i === 0; });
  }

  /* ===== الرسم النهائي ===== */
  function drawItems(doc, pages, lang) {
    var bidi = window.bidi_js();

    function lineAlignX(chunks, maxW, align, indent, justifyExtra) {
      var total = chunksWidth(doc, chunks) + (justifyExtra || 0) * countSpaces(chunks);
      if (align === "center") return (PAGE.w - total) / 2;
      if (align === "rtl") return RT - (indent || 0) - total;
      return LT + (indent || 0);
    }
    function countSpaces(chunks) {
      var n = 0; chunks.forEach(function (c) { if (isSpaceChunk(c)) n++; }); return n;
    }

    pages.forEach(function (page, pi) {
      if (pi > 0) doc.addPage();
      page.forEach(function (pl) {
        var it = pl.item;
        if (it.kind === "sep") {
          doc.moveTo(LT, pl.y0).lineTo(RT, pl.y0).lineWidth(0.8).strokeColor(C.sep).stroke();
          return;
        }
        var lines = it.lines || [];
        var leading = it.sz * LEAD;
        for (var li = pl.from; li <= pl.to; li++) {
          var chunks = lines[li];
          if (!chunks) continue;
          var yTop = pl.y0 + (li - pl.from) * leading;
          var yBase = yTop + leading * B_FACTOR;
          var visual = visualOrder(bidi, chunks.slice(), it.baseDir);
          var maxw = CW - (it.indent || 0);
          var justifyExtra = 0;
          var isLast = li === lines.length - 1;
          if (it.justify && !isLast) {
            var nat = chunksWidth(doc, visual);
            var nsp = countSpaces(visual);
            if (nsp > 0 && nat < maxw) justifyExtra = (maxw - nat) / nsp;
          }
          var startX = lineAlignX(visual, maxw, it.align, it.indent || 0, justifyExtra);
          drawLine(doc, visual, yBase, startX, justifyExtra);
          if (it.marker && li === 0) {
            var mbase = { lang: lang, sz: it.sz, bold: true, color: it.kind === "li" ? C.body : C.muted };
            var mch = segmentsToChunks([{ t: it.marker }], mbase);
            var mvis = visualOrder(bidi, mch, it.baseDir);
            var mwid = chunksWidth(doc, mvis);
            var mx = it.align === "rtl" ? RT - mwid : LT;
            drawLine(doc, mvis, yBase, mx, 0);
          }
        }
        /* خط عنوان القسم */
        if (it.rule) {
          var yLine = pl.y0 + (pl.to - pl.from + 1) * leading + 13.5;
          doc.moveTo(LT, yLine).lineTo(RT, yLine).lineWidth(1.2).strokeColor(C.ruleGold).stroke();
        }
      });
    });

    /* التذييل: رقم الصفحة يمين الوسط + الاسم بخط صغير يسار كل صفحة */
    var total = pages.length;
    var nameStr = lang === "en" ? "Mohamed Mohiey" : "محمد محي";
    var numLabel = lang === "en" ? "Page " : "صفحة ";
    var ofLabel = lang === "en" ? " of " : " من ";
    for (var i = 0; i < total; i++) {
      doc.switchToPage(i);
      var y = PAGE.h - 34;
      var nText = numLabel + (i + 1) + ofLabel + total;
      var nb = { lang: lang, sz: 9, bold: false, color: C.muted };
      var nch = visualOrder(bidi, mkPlain(nText, nb), lang === "en" ? "ltr" : "rtl");
      var nw = chunksWidth(doc, nch);
      drawLine(doc, nch, y, (PAGE.w - nw) / 2, 0);
      var fb = { lang: lang, sz: 7.5, bold: false, color: C.faint };
      var fch = visualOrder(bidi, mkPlain(nameStr, fb), lang === "en" ? "ltr" : "rtl");
      drawLine(doc, fch, y, LT, 0);
    }
  }

  /* ===== الواجهة ===== */
  function render(model) {
    return ensure().then(function () {
      return new Promise(function (resolve, reject) {
        try {
          var doc = new window.PDFDocument({ size: "A4", bufferPages: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, autoFirstPage: true, info: { Title: model.title || "", Author: "Mohamed Mohiey", Creator: "Mohamed Mohiey" } });
          doc.registerFont("nr", _bufs.nr);
          doc.registerFont("nb", _bufs.nb);
          doc.registerFont("lr", _bufs.lr);
          doc.registerFont("lb", _bufs.lb);
          var items = buildItems(model);
          var pages = paginate(doc, items);
          drawItems(doc, pages, model.lang === "en" ? "en" : "ar");
          var chunks = [];
          doc.on("data", function (c) { chunks.push(c); });
          doc.on("end", function () {
            resolve(new Blob(chunks, { type: "application/pdf" }));
          });
          doc.on("error", reject);
          doc.end();
        } catch (e) { reject(e); }
      });
    });
  }

  window.QAPDF = { ensure: ensure, render: render };
})();
