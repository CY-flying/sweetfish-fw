/* icons.js —— 信息条图标，与固件 /icons/*.bin 用同一份数据
 *
 * 两种格式都支持：
 *   ICO1 = 1bpp 单色线稿，落墨颜色由版式里的 color 决定
 *   ICO4 = 4bpp 六色索引，0xF 表示透明，颜色写在图里（图层 color 不再生效）
 *
 * monster 已改成 ICO4 彩色版（tools/gen_monster4.py 从 128px 原图量化而来），
 * 其余仍是 1bpp。新增图标请改 tools/gen_assets.py 后重新生成，勿手改数据。
 */
var Icons = (function () {
  'use strict';
  var RAW = {
    thermo: { w: 24, h: 24, data: "SUNPMRgAGAAAAAAAAAAAPAAAZgAAQgAAQgAAQnAAQgAAQgAAQnAAQgAAQgAAQnAAZgAAZgAAwwABgYABAIABAIABAIABgIAAgYAA4wAAPgA=" },
    drop: { w: 24, h: 24, data: "SUNPMRgAGAAAAAAAAAAAGAAAGAAAHAAANAAANgAAIgAAYwAAQYAAQIAAwMAAgEAAgGABgGABACABAGADAGADAEADAMABw4AAfgAAAAAAAAA=" },
    monster: { w: 33, h: 34, data: "SUNPNCEAIgD///////////////////////////AAD//////////////////wVVVVD////////////////wVVVVVQ///////////////wVVUFVVD//////////////wVVVQUlVf//////////////8FVVVTNV//////D/////////AAVVVVX///8ARA//////////8FVVVf//BURF////////////BVVQ//BERFD///////////8FVVD/BEREQP///////////wVVX/BEREAP////////////BVUP9EREX//wAAD///////8FVQ8AAA//8FREQP///////1VVDw////BEREQP///////wVVUP///wVERERQ////////BVVQ///wBEREQP////////AFVVD///AAAAUP////////8AVVVQ////////////////8AVVVVUP/wAP///////////wVVVVVVVVVVUP//////////VQVVVVVVVVVVUP////////9UBVVVVVVVVVVVD////////0QFVVVVVVVVVVVQ////////UQVVVVVVVVVVVVD///////9RAFVVVVVVVVVVVQ//////8AEQVVVVVVVVVVVVUA////8FARUFVVVVVVVVVVVVVQ//8FVQEQVVUAVVVVBVVVVVD/8FURABBFVVBVVVVQVQAAD//wURUPABFVVQVVVSAP//////8AD//wURFVAFVVUP////////////8AAAD//w///////////////////////////////w==" },
    seal: { w: 30, h: 30, data: "SUNPMR4AHgAAAAAAAD/wAAD//AAB8D4AB8APgA8AA8AOAAHAHAAA4DgAAHA4AABwcA4AOHB/wzhg/+8YYZ//GGOf/xhj//8YYf//GGD/7xhwf8M4cA4AODgAAHA4AABwHAAA4A4AAcAPAAPAB8APgAHwPgAA//wAAD/wAAAAAAA=" },
    bat0: { w: 24, h: 24, data: "SUNPMRgAGAAAAAAAAAAAAAAAAAAAAAAAAAAP/8Af/+A4AHAwAHAwAHwwAHwwAHwwAHwwAHA4AHA//+Af/8AAAAAAAAAAAAAAAAAAAAAAAAA=" },
    /* 免打扰：弯月。1bpp + 版式 color=2（黄），由 tools/gen_moon.py 生成 */
    moon: { w: 30, h: 30, data: "SUNPMR4AHgAAAAAAAB/gAAB//AAB/8AAA/4AAAf8AAAP+AAAH/AAAB/gAAA/wAAAP8AAAH/AAAB/gAAAf4AAAH+AAAB/gAAAf4AAAH+AAAB/wAAAP8AAAD/AAAA/4AAAH/AAAA/4AAAH/AAAA/4AAAH/gAAA//wAAB/gAAAAAAA=" }
  };

  var cache = {};

  function b64ToBytes(b) {
    var s = atob(b), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  /* 返回 { w, h, bpp, bits } 或 { w, h, bpp, idx }
   *   bpp=1 → bits 为 0/1 数组（行主序）
   *   bpp=4 → idx 为 0..5 调色板索引、15 透明（行主序） */
  function get(name) {
    if (cache[name]) return cache[name];
    var r = RAW[name];
    if (!r) return null;

    var raw = b64ToBytes(r.data);
    var magic = String.fromCharCode(raw[0], raw[1], raw[2], raw[3]);
    var w = raw[4] | (raw[5] << 8), h = raw[6] | (raw[7] << 8);
    var i, x, y;

    if (magic === 'ICO1') {
      var stride = (w + 7) >> 3;
      var bits = new Uint8Array(w * h);
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          var b = raw[8 + y * stride + (x >> 3)];
          bits[y * w + x] = (b >> (7 - (x & 7))) & 1;
        }
      }
      cache[name] = { w: w, h: h, bpp: 1, bits: bits };
      return cache[name];
    }

    if (magic === 'ICO4') {
      var s4 = (w + 1) >> 1;
      var idx = new Uint8Array(w * h);
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          var byte = raw[8 + y * s4 + (x >> 1)];
          idx[y * w + x] = (x & 1) ? (byte & 0x0F) : (byte >> 4);
        }
      }
      cache[name] = { w: w, h: h, bpp: 4, idx: idx };
      return cache[name];
    }

    return null;
  }

  return { get: get, names: Object.keys(RAW) };
})();
