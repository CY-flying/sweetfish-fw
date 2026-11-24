/* bar.js —— 信息条的像素级绘制（网页预览与固件版式同构）
 *
 * 坐标对应 sdcard/layout/B.json（横屏 800×480）与 Bp.json（竖屏 480×800）：
 *   横屏：画布 800×480，信息条 y=440 高 40，顶部 2px 分隔线
 *   竖屏：画布 480×800，信息条 y=760 高 40（落屏时随整幅旋转 90°，贴在物理边缘）
 * 布局都是「条内相对坐标」，y 从 0 到 40，两个方向只是几何参数不同。
 *
 * 文字用 mono16 / mono24 的真实点阵，图标用 1bpp 位图，逐像素落墨，
 * 所以调 InfoBar.paint() 画出来的就是屏上像素，不存在"预览好看、实物难看"的偏差。
 *
 * 生日彩蛋：每年 11-23，信息条上方多一条 28px 白色横幅写 HAPPY BIRTHDAY!
 * （对应版式里的 "when": "bday" 图层）。
 *
 * 时间前的标记是四态互斥的（对应版式里的 hour_odd / hour_even / lowbat / dnd_last）：
 *   奇数小时 → 小水怪（黑）；偶数小时 → 印章（朱红）；电量低于 10% → 空电池；
 *   免打扰前最后一次刷新 → 黄色弯月（这一帧要在屏上挂满整个免打扰时段）。
 * 优先级：低电量 > 免打扰 > 几点钟。低电量比"在静音"更要紧。
 */
var InfoBar = (function () {
  'use strict';

  var GEO = {
    landscape: {
      w: 800, h: 480, barY: 440, barH: 40,
      dateFmt: 'full',                       /* YYYY-MM-DD WED */
      bday: { y: 412, h: 28 },
      date:    { x: 18,  y: 2, w: 140, h: 38, font: 16 },
      mark:    { x: 361, y: 4, w: 33,  h: 34 },   /* 时间前的标记，三种图标共用这一格 */
      time:    { x: 400, y: 2, w: 52,  h: 38, font: 24 },
      thermo:  { x: 630, y: 9, w: 24,  h: 24 },
      temp:    { x: 660, y: 2, w: 52,  h: 38, font: 16 },
      drop:    { x: 725, y: 9, w: 24,  h: 24 },
      hum:     { x: 755, y: 2, w: 34,  h: 38, font: 16 }
    },
    portrait: {
      w: 480, h: 800, barY: 760, barH: 40,
      dateFmt: 'full',                       /* YYYY-MM-DD WED，竖屏也带年份 */
      bday: { y: 732, h: 28 },
      date:    { x: 12,  y: 2, w: 124, h: 38, font: 16 },
      mark:    { x: 196, y: 3, w: 33,  h: 34 },
      time:    { x: 235, y: 2, w: 44,  h: 38, font: 24 },
      thermo:  { x: 318, y: 8, w: 24,  h: 24 },
      temp:    { x: 348, y: 2, w: 52,  h: 38, font: 16 },
      drop:    { x: 408, y: 8, w: 24,  h: 24 },
      hum:     { x: 438, y: 2, w: 32,  h: 38, font: 16, align: 'right' }
    }
  };

  var WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  /* 与固件调色板对齐：0 黑、3 朱红、1 白。印章在屏上是红色的（版式 color:3） */
  var BLACK = [0, 0, 0];
  var RED = [179, 58, 50];
  /* 纸白取调色板 1 号色，和照片自身的白同色——栏底才不会比照片亮一档 */
  var PAPER = [247, 246, 242];

  /* 四色以上图标（ICO4）按索引取色，顺序与 dither.js 的 RGB 表、
   * 固件 app_config.h 的 PAL_* 完全一致：0 黑 1 白 2 黄 3 红 4 蓝 5 绿 */
  var PAL_RGB = [
    [13, 13, 13], [247, 246, 242], [232, 195, 23],
    [179, 58, 50], [52, 80, 110], [62, 122, 62]
  ];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function geo(mode) { return GEO[mode === 'portrait' ? 'portrait' : 'landscape']; }

  function isBday(now) { return now.getMonth() === 10 && now.getDate() === 23; }

  /* 时间前的标记选哪个图标、什么颜色；opts.batPct 为 0..100，-1/未给表示不知道；
   * opts.dndLast 为 true 表示这一帧是免打扰前最后一次刷新（固件里叫 dnd_last） */
  function markOf(now, batPct, dndLast) {
    var low = typeof batPct === 'number' && batPct >= 0 && batPct < 10;
    if (low) return { icon: 'bat0', rgb: BLACK };
    if (dndLast) return { icon: 'moon', rgb: PAL_RGB[2] };   /* 调色板 2 号 = 黄 */
    if (now.getHours() % 2) return { icon: 'monster', rgb: BLACK };
    return { icon: 'seal', rgb: RED };
  }

  /* 把信息条画进 d（长度 w*barH*4 的 RGBA 缓冲），条内坐标、纸白打底。
   * opts.batPct：电量百分比，决定时间前是水怪、印章还是空电池 */
  function paint(d, now, temp, hum, mode, opts) {
    var g = geo(mode);
    var W = g.w, BAR = g.barH;
    var dark = !!(opts && opts.dark);
    var background = dark ? BLACK : PAPER;
    var foreground = dark ? PAPER : BLACK;

    for (var i = 0; i < d.length; i += 4) {
      d[i] = background[0]; d[i + 1] = background[1]; d[i + 2] = background[2]; d[i + 3] = 255;
    }

    /* 条内坐标 → 落墨；越界丢弃，与固件 set_px 行为一致 */
    function ink(ax, ay, rgb) {
      if (ax < 0 || ax >= W || ay < 0 || ay >= BAR) return;
      var off = (ay * W + ax) * 4;
      var c = rgb || foreground;
      d[off] = c[0]; d[off + 1] = c[1]; d[off + 2] = c[2];
    }

    var x, y;
    for (y = 0; y < 2; y++) {                 /* 顶部 2px 分隔线 */
      for (x = 0; x < W; x++) ink(x, y);
    }

    function icon(name, box, rgb) {
      var ic = Icons.get(name);
      if (!ic) return;
      var ox = box.x + Math.floor((box.w - ic.w) / 2);
      var oy = box.y + Math.floor((box.h - ic.h) / 2);
      for (var r = 0; r < ic.h; r++) {
        for (var c = 0; c < ic.w; c++) {
          if (ic.bpp === 4) {
            var v = ic.idx[r * ic.w + c];
            if (v === 15) continue;                  /* 0xF = 透明，不落墨 */
            ink(ox + c, oy + r, PAL_RGB[v] || rgb);
          } else if (ic.bits[r * ic.w + c]) {
            ink(ox + c, oy + r, rgb);
          }
        }
      }
    }

    function text(str, box) {
      var f = Fonts.get(box.font);
      if (!f || !str) return;
      var ty = box.y + Math.floor((box.h - f.h) / 2);
      /* 右对齐：湿度可能是 100%（4 字），靠右收口才不会顶出画布 */
      var tx = box.align === 'right' ? box.x + box.w - str.length * f.w : box.x;
      for (var n = 0; n < str.length; n++) {
        for (var row = 0; row < f.h; row++) {
          var bits = Fonts.glyphRow(f, str[n], row);
          if (!bits) continue;
          for (var c = 0; c < f.w; c++) {
            if (bits[c]) ink(tx + n * f.w + c, ty + row);
          }
        }
      }
    }

    var wd = WD[now.getDay()];
    var dateStr = g.dateFmt === 'full'
      ? now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + ' ' + wd
      : pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + ' ' + wd;

    var mk = markOf(now, opts && opts.batPct, opts && opts.dndLast);
    if (dark && mk.rgb === BLACK) mk = { icon: mk.icon, rgb: PAPER };
    text(dateStr, g.date);
    icon(mk.icon, g.mark, mk.rgb);
    text(pad2(now.getHours()) + 'H', g.time);
    icon('thermo', g.thermo);
    text(Number(temp).toFixed(1) + 'C', g.temp);
    icon('drop', g.drop);
    text(Math.round(hum) + '%', g.hum);
  }

  /* 生日横幅：画进 d（长度 W*H*4 的 RGBA 缓冲），坐标是横幅内相对坐标 */
  function paintBday(d, W, H) {
    for (var i = 0; i < d.length; i += 4) {
      d[i] = PAPER[0]; d[i + 1] = PAPER[1]; d[i + 2] = PAPER[2]; d[i + 3] = 255;
    }
    function ink(ax, ay) {
      if (ax < 0 || ax >= W || ay < 0 || ay >= H) return;
      var off = (ay * W + ax) * 4;
      d[off] = 0; d[off + 1] = 0; d[off + 2] = 0;
    }
    var x, y;
    for (x = 0; x < W; x++) ink(x, 0);        /* 上沿 1px 细线 */

    var f = Fonts.get(16);
    var s = 'HAPPY BIRTHDAY!';
    if (!f) return;
    var tx = Math.floor((W - s.length * f.w) / 2);
    var ty = 1 + Math.floor((H - 1 - f.h) / 2);
    for (var n = 0; n < s.length; n++) {
      for (var row = 0; row < f.h; row++) {
        var bits = Fonts.glyphRow(f, s[n], row);
        if (!bits) continue;
        for (var c = 0; c < f.w; c++) {
          if (bits[c]) ink(tx + n * f.w + c, ty + row);
        }
      }
    }
  }

  return {
    GEO: GEO, geo: geo, isBday: isBday, markOf: markOf,
    BLACK: BLACK, RED: RED,
    paint: paint, paintBday: paintBday
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = InfoBar;
