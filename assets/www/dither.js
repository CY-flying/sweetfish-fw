/* dither.js —— 六色 E6 抖动与 4bpp 打包
 * 与固件契约：800×480，4bpp，每字节 2 像素（高半字节为左侧偶数像素），
 * 行字节数 400，全帧 192000 字节。
 *
 * 六色墨水屏的难点不在于"找最近色"，而在于调色板里没有灰：
 *   1) 中性色只能靠黑+白像素混合表达，必须禁止彩色参与，否则灰会发绿；
 *   2) 误差扩散会把像素值推离原色，色相一漂就会解锁补色，
 *      导致墨绿森林里冒出红蓝噪点。
 * 解法：在抖动之前，按**源像素**的饱和度与色相预计算"允许使用的墨"位掩码，
 * 扩散过程中只在该掩码内选择，色相就再也漂不走了。
 */

var Dither = (function () {
  'use strict';

  // 颜料实际观感（不是纯 RGB 原色）。既用于选色，也用于预览渲染。
  var RGB = [
    [13, 13, 13],     // 0 黑
    [247, 246, 242],  // 1 白
    [232, 195, 23],   // 2 黄
    [179, 58, 50],    // 3 红
    [52, 80, 110],    // 4 蓝
    [62, 122, 62]     // 5 绿
  ];

  var PALETTE = [
    { key: 'black',  hex: '#0D0D0D' },
    { key: 'white',  hex: '#F7F6F2' },
    { key: 'yellow', hex: '#E8C317' },
    { key: 'red',    hex: '#B33A32' },
    { key: 'blue',   hex: '#34506E' },
    { key: 'green',  hex: '#3E7A3E' }
  ];

  var PAL_HUE = [-1, -1, 47, 4, 211, 120];   // 黑/白为无彩色

  var BAYER8 = [
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21
  ];

  var WR = 0.30, WG = 0.59, WB = 0.11;

  var NEUTRAL_GATE = 0.12;   // 饱和度低于此值：只准黑白
  var STRONG_SAT = 0.45;     // 高饱和像素：抑制黑白候选
  var HUE_GATE = 62;         // 色相偏离超过此值：不许参与

  // 纯色（如 #0000FF）在 RGB 距离下反而更接近黑，会被整片吞成黑色。
  // 高饱和像素给黑白候选加惩罚，把它逼回同色相的墨，亮度交给误差扩散去补。
  var ACHROMATIC_PENALTY = 3;

  /* ---------- 色彩工具 ---------- */

  function hueOf(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return -1;
    var h;
    if (mx === r)      h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else               h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return h;
  }

  function hueGap(a, b) {
    var d = Math.abs(a - b);
    return d > 180 ? 360 - d : d;
  }

  var MASK_STRONG = 0x80;

  function maskFor(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var sat = (mx - mn) / 255;
    var m = 0x03;                                    // 黑白永远可用
    if (sat < NEUTRAL_GATE) return m;                // 中性色：只给黑白

    if (sat >= STRONG_SAT) m |= MASK_STRONG;

    var h = hueOf(r, g, b);
    if (h < 0) return m;
    for (var k = 2; k < 6; k++) {
      if (hueGap(h, PAL_HUE[k]) <= HUE_GATE) m |= (1 << k);
    }
    return m;
  }

  function nearestMasked(r, g, b, mask) {
    var strong = (mask & MASK_STRONG) !== 0;
    var best = 1, bd = Infinity;
    for (var k = 0; k < 6; k++) {
      if (!(mask & (1 << k))) continue;
      var c = RGB[k];
      var dr = r - c[0], dg = g - c[1], db = b - c[2];
      var d = WR * dr * dr + WG * dg * dg + WB * db * db;
      if (strong && k < 2) d *= ACHROMATIC_PENALTY;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  function nearestIndex(r, g, b) {
    return nearestMasked(r, g, b, maskFor(r, g, b));
  }

  /* ---------- 预处理：饱和度/对比度 + 位掩码 ---------- */

  function preprocess(imageData, sat, contrast) {
    var w = imageData.width, h = imageData.height;
    var src = imageData.data;
    var n = w * h;
    var buf = new Float32Array(n * 3);
    var mask = new Uint8Array(n);

    var sMul = 1 + sat / 100;
    var cMul = 1 + contrast / 100;

    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var r = src[p], g = src[p + 1], b = src[p + 2];

      var gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * sMul;
      g = gray + (g - gray) * sMul;
      b = gray + (b - gray) * sMul;
      r = (r - 128) * cMul + 128;
      g = (g - 128) * cMul + 128;
      b = (b - 128) * cMul + 128;

      r = r < 0 ? 0 : r > 255 ? 255 : r;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      b = b < 0 ? 0 : b > 255 ? 255 : b;

      buf[i * 3] = r; buf[i * 3 + 1] = g; buf[i * 3 + 2] = b;
      mask[i] = maskFor(r, g, b);
    }
    return { buf: buf, mask: mask, w: w, h: h };
  }

  /* ---------- 抖动算法 ---------- */

  function diffuse(pp, strength, w1, w2, w3, w4) {
    var w = pp.w, h = pp.h, buf = pp.buf, mask = pp.mask;
    var out = new Uint8Array(w * h);

    function add(x, y, er, eg, eb, f) {
      if (x < 0 || x >= w || y >= h) return;
      var j = (y * w + x) * 3;
      var r = buf[j] + er * f;
      var g = buf[j + 1] + eg * f;
      var b = buf[j + 2] + eb * f;
      buf[j]     = r < 0 ? 0 : r > 255 ? 255 : r;
      buf[j + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      buf[j + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }

    for (var y = 0; y < h; y++) {
      var ltr = (y & 1) === 0;
      for (var k = 0; k < w; k++) {
        var x = ltr ? k : w - 1 - k;
        var i = y * w + x;
        var j = i * 3;

        var r = buf[j], g = buf[j + 1], b = buf[j + 2];
        var pi = nearestMasked(r, g, b, mask[i]);
        out[i] = pi;

        var c = RGB[pi];
        var er = (r - c[0]) * strength;
        var eg = (g - c[1]) * strength;
        var eb = (b - c[2]) * strength;
        var dir = ltr ? 1 : -1;

        add(x + dir, y,     er, eg, eb, w1);
        add(x - dir, y + 1, er, eg, eb, w2);
        add(x,       y + 1, er, eg, eb, w3);
        if (w4 > 0) add(x + dir, y + 1, er, eg, eb, w4);
      }
    }
    return out;
  }

  function ordered(pp, spread) {
    var w = pp.w, h = pp.h, buf = pp.buf, mask = pp.mask;
    var out = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x, j = i * 3;
        var t = (BAYER8[(y & 7) * 8 + (x & 7)] / 64 - 0.5) * spread;
        out[i] = nearestMasked(buf[j] + t, buf[j + 1] + t, buf[j + 2] + t, mask[i]);
      }
    }
    return out;
  }

  function direct(pp) {
    var n = pp.w * pp.h;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var j = i * 3;
      out[i] = nearestMasked(pp.buf[j], pp.buf[j + 1], pp.buf[j + 2], pp.mask[i]);
    }
    return out;
  }

  /**
   * @param {ImageData} imageData 800×480 源图
   * @param {object} opt {algo, strength, sat, contrast}
   * @returns {Uint8Array} 384000 字节的调色板索引
   */
  function convert(imageData, opt) {
    opt = opt || {};
    var pp = preprocess(imageData, opt.sat || 0, opt.contrast || 0);
    var algo = opt.algo || 'fs';
    var st = (opt.strength === undefined ? 1 : opt.strength);

    if (algo === 'none')   return direct(pp);
    if (algo === 'bayer')  return ordered(pp, 56);
    if (algo === 'sierra') return diffuse(pp, st, 0.5, 0.25, 0.25, 0);
    return diffuse(pp, st, 7 / 16, 3 / 16, 5 / 16, 1 / 16);
  }

  /* ---------- 打包 / 解包 ---------- */

  function pack4(idx) {
    var n = idx.length;
    var out = new Uint8Array(n >> 1);
    for (var i = 0; i < n; i += 2) {
      out[i >> 1] = ((idx[i] & 0x0F) << 4) | (idx[i + 1] & 0x0F);
    }
    return out;
  }

  function unpack4(buf, w, h) {
    var n = w * h;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var byte = buf[i >> 1];
      out[i] = (i & 1) ? (byte & 0x0F) : (byte >> 4);
    }
    return out;
  }

  /* ---------- 渲染 ---------- */

  function toImageData(idx, w, h) {
    var img = new ImageData(w, h);
    var d = img.data;
    for (var i = 0, p = 0; i < idx.length; i++, p += 4) {
      var c = RGB[idx[i]] || RGB[0];
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    }
    return img;
  }

  function hexOf(i) { return PALETTE[i] ? PALETTE[i].hex : '#000'; }

  return {
    PALETTE: PALETTE,
    convert: convert,
    pack4: pack4,
    unpack4: unpack4,
    toImageData: toImageData,
    nearestIndex: nearestIndex,
    hexOf: hexOf
  };
})();
