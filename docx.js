/* ============================================================
   docx.js - باني ملفات Word ‎(.docx) بدون أي مكتبات خارجية.
   يبني حزمة OOXML صحيحة داخل ملف ZIP (طريقة التخزين بدون ضغط).
   المدخل: { blocks: [ { k: "title"|"meta"|"h2"|"h3"|"h4"|"p"|"li"|"ref"|"sep", runs: [ { t, b, i, sup, c } ] } ] }
   ============================================================ */
(function (root) {
  "use strict";

  var AR_RE = /[\u0600-\u06FF]/;

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function enc(s) { return new TextEncoder().encode(s); }

  function concat(arrs) {
    var total = 0, i;
    for (i = 0; i < arrs.length; i++) total += arrs[i].length;
    var out = new Uint8Array(total), off = 0;
    for (i = 0; i < arrs.length; i++) { out.set(arrs[i], off); off += arrs[i].length; }
    return out;
  }

  /* ZIP بدون ضغط (stored) */
  function zipStore(files) {
    var parts = [], central = [], offset = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var name = enc(f.name);
      var data = f.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + name.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);  /* أسماء UTF-8 */
      lv.setUint16(8, 0, true);       /* stored */
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0x21, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);

      parts.push(local, data);

      var cd = new Uint8Array(46 + name.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(name, 46);
      central.push(cd);

      offset += local.length + data.length;
    }
    var cdSize = 0;
    for (var j = 0; j < central.length; j++) cdSize += central[j].length;
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return concat(parts.concat(central).concat([end]));
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /* أحجام بالأنصاف: la لاتيني، cs للعربي */
  var SZ = {
    title: { la: 32, cs: 34 },
    meta: { la: 20, cs: 22 },
    h2: { la: 30, cs: 32 },
    h3: { la: 26, cs: 28 },
    h4: { la: 24, cs: 26 },
    body: { la: 24, cs: 26 },
    ref: { la: 22, cs: 24 }
  };

  function runXml(r, sz) {
    var arabic = AR_RE.test(r.t);
    var size = arabic ? sz.cs : sz.la;
    var rpr =
      "<w:rPr>" +
      '<w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:cs="Traditional Arabic"/>' +
      (r.b ? "<w:b/><w:bCs/>" : "") +
      (r.i ? "<w:i/><w:iCs/>" : "") +
      (r.sup ? '<w:vertAlign w:val="superscript"/>' : "") +
      (r.c ? '<w:color w:val="' + r.c + '"/>' : "") +
      (arabic ? "<w:rtl/>" : "") +
      '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' +
      "</w:rPr>";
    return "<w:r>" + rpr + '<w:t xml:space="preserve">' + esc(r.t) + "</w:t></w:r>";
  }

  function parXml(runs, o) {
    o = o || {};
    var hasAr = false;
    for (var i = 0; i < runs.length; i++) if (AR_RE.test(runs[i].t)) { hasAr = true; break; }
    var bidi = (o.rtl === undefined) ? hasAr : o.rtl;
    var ppr =
      "<w:pPr>" +
      (bidi ? "<w:bidi/>" : "") +
      (o.jc ? '<w:jc w:val="' + o.jc + '"/>' : "") +
      '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 120 : o.after) + '" w:line="' + (o.line || 320) + '" w:lineRule="auto"/>' +
      (o.ind ? '<w:ind w:right="' + o.ind + '" w:hanging="' + o.ind + '"/>' : "") +
      "</w:pPr>";
    var body = "";
    for (var j = 0; j < runs.length; j++) body += runXml(runs[j], o.sz || SZ.body);
    return "<w:p>" + ppr + body + "</w:p>";
  }

  var SEP_XML = '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>' +
    '<w:spacing w:before="160" w:after="160"/></w:pPr></w:p>';

  function blockXml(b) {
    var runs = b.runs || [];
    switch (b.k) {
      case "title": return parXml(runs.map(function (r) { return { t: r.t, b: true, c: r.c }; }), { sz: SZ.title, jc: "center", after: 60 });
      case "meta": return parXml(runs, { sz: SZ.meta, jc: "center", after: 260, line: 240 });
      case "h2": return parXml(runs.map(function (r) { return { t: r.t, b: true, c: r.c }; }), { sz: SZ.h2, before: 300, after: 140, line: 260 });
      case "h3": return parXml(runs.map(function (r) { return { t: r.t, b: true, c: r.c }; }), { sz: SZ.h3, before: 240, after: 100, line: 260 });
      case "h4": return parXml(runs.map(function (r) { return { t: r.t, b: true, c: r.c }; }), { sz: SZ.h4, before: 200, after: 80, line: 260 });
      case "li": return parXml(runs, { sz: SZ.body, ind: 284 });
      case "ref": return parXml(runs, { sz: SZ.ref, line: 280 });
      case "sep": return SEP_XML;
      default: return parXml(runs, { sz: SZ.body, jc: "both" });
    }
  }

  var CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    "</Types>";

  var RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  var DOC_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";

  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:docDefaults><w:rPrDefault><w:rPr>" +
    '<w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI" w:cs="Traditional Arabic"/>' +
    '<w:sz w:val="24"/><w:szCs w:val="26"/>' +
    "</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>" +
    '<w:spacing w:after="120" w:line="320" w:lineRule="auto"/>' +
    "</w:pPr></w:pPrDefault></w:docDefaults>" +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    "</w:styles>";

  function build(model) {
    var blocks = (model && model.blocks) || [];
    var body = "";
    for (var i = 0; i < blocks.length; i++) body += blockXml(blocks[i]);
    var doc =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body>" + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>' +
      "<w:bidi/></w:sectPr>" +
      "</w:body></w:document>";
    return zipStore([
      { name: "[Content_Types].xml", data: enc(CONTENT_TYPES) },
      { name: "_rels/.rels", data: enc(RELS) },
      { name: "word/document.xml", data: enc(doc) },
      { name: "word/styles.xml", data: enc(STYLES) },
      { name: "word/_rels/document.xml.rels", data: enc(DOC_RELS) }
    ]);
  }

  var api = { build: build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.QADocx = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
