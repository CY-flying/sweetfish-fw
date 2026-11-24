/* api.js —— 设备通信 + 离线只读数据（Mock）
 * 离线可浏览示例；所有设备写操作均拒绝，不模拟成功。
 */

var Api = (function () {
  'use strict';

  var LS_BASE = 'pp_base';
  var LS_MOCK = 'pp_mock_v2';   /* v2：加了竖屏相册的示例，旧缓存作废 */

  var base = '';
  var online = false;
  var mockCount = 0;

  try { base = localStorage.getItem(LS_BASE) || ''; } catch (e) { base = ''; }

  /* ---------------- 工具 ---------------- */

  function req(path, opt) {
    opt = opt || {};
    var url = base.replace(/\/$/, '') + path;
    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, opt.timeout || 20000);
    var init = {
      method: opt.method || 'GET',
      signal: ac.signal,
      headers: opt.headers || {}
    };
    if (opt.body !== undefined) init.body = opt.body;
    return fetch(url, init).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var ct = r.headers.get('content-type') || '';
      if (opt.binary) return r.arrayBuffer();
      if (ct.indexOf('json') >= 0) return r.json();
      return r.text();
    }).catch(function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  function b64FromBytes(u8) {
    var s = '', step = 0x8000;
    for (var i = 0; i < u8.length; i += step) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + step));
    }
    return btoa(s);
  }

  function bytesFromB64(b) {
    var s = atob(b), u8 = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  /* ---------------- Mock ---------------- */

  function seedThumb(seed) {
    var w = 160, h = 96, out = new Uint8Array(w * h);
    var horizon = 0.55 + (seed % 3) * 0.08;
    var sunX = 0.25 + (seed % 4) * 0.16;
    var sunR = 0.09;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var u = x / w, v = y / h;
        var r, g, b;
        if (v < horizon) {
          var t = v / horizon;
          r = 210 - t * 80; g = 226 - t * 60; b = 238 - t * 30;
          var dx = u - sunX, dy = (v - horizon * 0.5) * 0.6;
          if (dx * dx + dy * dy < sunR * sunR) { r = 246; g = 216; b = 120; }
        } else {
          var t2 = (v - horizon) / (1 - horizon);
          r = 60 + t2 * 30; g = 90 + t2 * 40; b = 52 + t2 * 20;
          if (((x * 7 + y * 13) % 23) < 3 && t2 > 0.15) { r = 40; g = 62; b = 38; }
        }
        var n = ((x * 37 + y * 61 + seed * 17) % 17) / 17 - 0.5;
        out[y * w + x] = Dither.nearestIndex(
          r + n * 26 * 0.9, g + n * 26, b + n * 26 * 0.8
        );
      }
    }
    return out;
  }

  function mockInit() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_MOCK) || 'null'); } catch (e) { saved = null; }
    if (saved && saved.items && saved.items.length) {
      mockCount = saved.items.length;
      return saved.items.map(function (it) {
        return {
          id: it.id,
          added: it.added,
          orient: it.orient || 'landscape',
          size: it.size || 192000,
          thumb: it.t ? bytesFromB64(it.t) : seedThumb(+it.id % 9)
        };
      });
    }
    var seeded = [];
    var now = Date.now();
    for (var i = 1; i <= 5; i++) {
      var id = String(1000 + i);
      seeded.push({
        id: id,
        added: new Date(now - (6 - i) * 3600e3).toISOString().slice(0, 16).replace('T', ' '),
        orient: 'landscape',
        size: 192000,
        thumb: seedThumb(i)
      });
    }
    /* 竖屏那本也放两张：这样"切到竖屏相册就变了"在演示模式下也能看见 */
    for (var j = 1; j <= 2; j++) {
      seeded.push({
        id: String(2000 + j),
        added: new Date(now - (3 - j) * 7200e3).toISOString().slice(0, 16).replace('T', ' '),
        orient: j === 2 ? 'portrait_r' : 'portrait_l',
        size: 192000,
        thumb: seedThumb(5 + j)
      });
    }
    mockCount = seeded.length;
    mockPersist(seeded);
    return seeded;
  }

  var mock = null;

  /* 设备把照片分两本相册（/photos/landscape、/photos/portrait），
   * 演示模式也照这个规则分，否则"切方向后相册变化"这一点在演示里看不到。 */
  function groupOf(o) { return (!o || o === 'landscape') ? 'landscape' : 'portrait'; }

  function mockAll() {
    if (!mock) mock = mockInit();
    return mock;
  }

  function mockList(group) {
    var all = mockAll();
    if (!group) return all;
    return all.filter(function (p) { return groupOf(p.orient) === group; });
  }

  function mockCounts() {
    return { landscape: mockList('landscape').length, portrait: mockList('portrait').length };
  }

  function mockPersist(list) {
    try {
      localStorage.setItem(LS_MOCK, JSON.stringify({
        items: list.map(function (p) {
          return {
            id: p.id, added: p.added, size: p.size, orient: p.orient || 'landscape',
            t: p.thumb ? b64FromBytes(p.thumb) : null
          };
        })
      }));
    } catch (e) { /* 容量不足时忽略，内存态仍可用 */ }
  }

  /* 演示模式：next_wake 按"下一个整点"算，跟真机的整点对齐一致 */
  function mockStatus() {
    var t = new Date();
    var next = new Date(t.getTime());
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    var land = mockList('landscape'), port = mockList('portrait');
    var cur = land.length ? land[land.length - 1].id : null;
    return {
      fw: 'demo-1.0.0',
      mode: 'MOCK',
      layout: 'B',
      orientation: 'landscape',
      photo_dir: '/sdcard/photos/landscape',
      counts: mockCounts(),
      photo: cur,
      photo_count: land.length,
      time: Math.floor(t.getTime() / 1000),
      temp_c: 23.4,
      hum_pct: 45,
      last_refresh: Math.floor(t.getTime() / 1000) - 3600,
      next_wake: Math.floor(next.getTime() / 1000),
      awake_remaining_sec: 300,
      wifi: { mode: 'MOCK', ssid: '—', rssi: 0 },
      usb_power: false,
      battery_mv: null,
      sd_used_kb: (land.length + port.length) * 188 + 64,
      sd_total_kb: 30474240
    };
  }

  /* ---------------- 对外接口 ---------------- */

  return {
    getBase: function () { return base; },
    isOnline: function () { return online; },

    setBase: function (url) {
      base = (url || '').trim();
      try { localStorage.setItem(LS_BASE, base); } catch (e) {}
      return this.probe();
    },

    /**
     * 打开页面就自动找设备，不用先点「连接设备」。
     * 顺序：已存的地址 → 页面自身的源（页面常常就是从设备读出来的）→ 设备热点 → mDNS。
     * 已存的地址单独先试，避免手填的地址被热点地址抢走。
     */
    autoConnect: function () {
      var self = this;

      function tryOne(u) {
        var ac = new AbortController();
        var t = setTimeout(function () { ac.abort(); }, 3000);
        return fetch(u.replace(/\/$/, '') + '/api/status', { signal: ac.signal })
          .then(function (r) {
            clearTimeout(t);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return u;
          })
          .catch(function (e) { clearTimeout(t); throw e; });
      }

      function scan() {
        var list = [];
        if (/^https?:$/.test(location.protocol) && location.host) list.push(location.origin);
        list.push('http://192.168.4.1');
        list.push('http://sweetfish.local');
        list = list.filter(function (u, i, a) { return u && a.indexOf(u) === i; });

        return Promise.all(list.map(function (u) {
          return tryOne(u).catch(function () { return null; });
        })).then(function (res) {
          for (var i = 0; i < res.length; i++) {
            if (res[i]) {
              base = res[i];
              try { localStorage.setItem(LS_BASE, base); } catch (e) {}
              online = true;
              return base;
            }
          }
          online = false;
          return '';
        });
      }

      /* 同源优先。
       *
       * 页面既然是从某个地址打开的，设备就在那个地址上。以前先试
       * localStorage 里存的旧地址，于是「换成局域网 IP 打开页面，请求却还发往
       * 192.168.4.1」：手机不在热点上时先白等一次 3 秒超时，运气不好还会被
       * 旧设备地址抢走，页面上一半接口失败。
       * 只有同源试不通（比如页面是 file:// 打开的），才回落到存下来的地址。 */
      var same = (/^https?:$/.test(location.protocol) && location.host) ? location.origin : '';
      var sameUsable = same && (!base || same.replace(/\/$/, '') !== base.replace(/\/$/, ''));

      if (sameUsable) {
        return tryOne(same).then(function (u) {
          base = u;
          try { localStorage.setItem(LS_BASE, base); } catch (e) {}
          online = true;
          return base;
        }).catch(function () {
          if (!base) return scan();
          return self.probe().then(function (ok) { return ok ? base : scan(); });
        });
      }

      if (base) {
        return self.probe().then(function (ok) { return ok ? base : scan(); });
      }
      return scan();
    },

    probe: function () {
      var self = this;
      if (!base) { online = false; return Promise.resolve(false); }
      return req('/api/status', { timeout: 6000 })
        .then(function (s) { online = true; self._last = s; return true; })
        .catch(function () { online = false; return false; });
    },

    status: function () {
      if (!base) return Promise.resolve(mockStatus());
      return req('/api/status');
    },

    listPhotos: function (orient) {
      if (!base) {
        var g = groupOf(orient);
        var items = mockList(g);
        return Promise.resolve({
          dir: '/sdcard/photos/' + g,
          counts: mockCounts(),
          current: items.length ? items[items.length - 1].id : null,
          items: items.map(function (p) {
            return { id: p.id, added: p.added, size: p.size, orient: p.orient || 'landscape' };
          })
        });
      }
      return req('/api/photos' + (orient ? '?orient=' + encodeURIComponent(orient) : ''));
    },

    /* orient 只是告诉设备去哪个文件夹找——竖屏照片不在横屏那本里 */
    thumb: function (id, orient) {
      if (!base) {
        var p = mockAll().filter(function (x) { return x.id === id; })[0];
        return Promise.resolve(p && p.thumb ? p.thumb : null);
      }
      return req('/api/thumb?name=' + encodeURIComponent(id) +
                 (orient ? '&orient=' + encodeURIComponent(orient) : ''), { binary: true })
        .then(function (buf) { return Dither.unpack4(new Uint8Array(buf), 160, 96); })
        .catch(function () { return null; });
    },

    /* 取某张照片的 800×480 4bpp 全帧（192000 字节），返回物理帧的调色板索引。
     * 打开网页时用它还原「屏上现在是什么」，比缩略图清楚得多。 */
    photoFrame: function (id, orient) {
      if (!base) {
        var p = mockAll().filter(function (x) { return x.id === id; })[0];
        return Promise.resolve(p ? p.frame || null : null);
      }
      return req('/api/photo?name=' + encodeURIComponent(id) +
                 (orient ? '&orient=' + encodeURIComponent(orient) : ''), { binary: true })
        .then(function (buf) {
          var u8 = new Uint8Array(buf);
          if (u8.length !== 192000) return null;      /* 不是 4bpp 全帧就作废 */
          return Dither.unpack4(u8, 800, 480);
        })
        .catch(function () { return null; });
    },

    /**
     * @param {string} id 4 位编号
     * @param {Uint8Array} packed 192000 字节 4bpp 帧
     * @param {Uint8Array|null} thumbPacked 7680 字节 160×96 缩略图
     * @param {Uint8Array|null} orig 原始 JPEG（可选）
     * @param {string} orient landscape / portrait_l / portrait_r
     */
    /* 带进度的上传：fetch 拿不到上行进度，这里单独用 XHR。
     * 只用于 192 KB 的主帧；缩略图照样走 uploadPhoto 里那套，失败了也不影响主图。 */
    uploadPhotoProgress: function (id, packed, thumbPacked, onPct, orient) {
      orient = orient || 'landscape';
      if (!base) return Promise.reject(new Error('未连接设备，无法上传照片'));
      var q = '?name=' + encodeURIComponent(id) + '&orient=' + encodeURIComponent(orient);
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', base + '/api/photo' + q, true);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.timeout = 60000;
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable && onPct) onPct(Math.round(e.loaded / e.total * 100));
        };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            if (onPct) onPct(100);
            resolve();
          } else {
            reject(new Error('HTTP ' + xhr.status));
          }
        };
        xhr.onerror = function () { reject(new Error('网络中断')); };
        xhr.ontimeout = function () { reject(new Error('上传超时')); };
        xhr.send(packed);
      }).then(function () {
        if (!thumbPacked) return null;
        /* 缩略图失败不该让整张照片算失败：图已经在卡上了 */
        return req('/api/thumb' + q, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: thumbPacked,
          timeout: 20000
        }).catch(function () { return null; });
      });
    },

    uploadPhoto: function (id, packed, thumbPacked, orig, orient) {
      orient = orient || 'landscape';
      if (!base) return Promise.reject(new Error('未连接设备，无法上传照片'));
      var self = this;
      var q = '?name=' + encodeURIComponent(id) + '&orient=' + encodeURIComponent(orient);
      return req('/api/photo' + q, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: packed,
        timeout: 60000
      }).then(function (res) {
        var jobs = [];
        if (thumbPacked) {
          jobs.push(req('/api/thumb' + q, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: thumbPacked,
            timeout: 20000
          }));
        }
        if (orig) {
          jobs.push(req('/api/photo/orig' + q, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: orig,
            timeout: 60000
          }));
        }
        return Promise.all(jobs).then(function () { return res; });
      });
    },

    deletePhoto: function (id, orient) {
      if (!base) return Promise.reject(new Error('未连接设备，无法删除照片'));
      return req('/api/photo?name=' + encodeURIComponent(id) +
                 (orient ? '&orient=' + encodeURIComponent(orient) : ''), { method: 'DELETE' });
    },

    setCurrent: function (id, orient) {
      if (!base) return Promise.reject(new Error('未连接设备'));
      return req('/api/current?name=' + encodeURIComponent(id) +
                 (orient ? '&orient=' + encodeURIComponent(orient) : ''), { method: 'POST' });
    },

    getConfig: function () {
      if (!base) {
        return Promise.resolve({
          refresh_interval_min: 60,
          dnd: { enabled: true, start: '03:00', end: '08:00' },
          default_layout: 'B',
          orientation: 'landscape',
          upload_apply: 'queue'
        });
      }
      return req('/api/config');
    },

    setConfig: function (cfg) {
      if (!base) return Promise.reject(new Error('未连接设备，无法保存设置'));
      return req('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg)
      });
    },

    getLayout: function (name) {
      if (!base) return Promise.resolve(null);
      return req('/api/layout?name=' + encodeURIComponent(name));
    },

    setLayout: function (name, layout, norefresh) {
      if (!base) return Promise.reject(new Error('未连接设备，无法保存版式'));
      return req('/api/layout?name=' + encodeURIComponent(name) +
                 (norefresh ? '&norefresh=1' : ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(layout)
      });
    },

    setBarTheme: function (theme) {
      if (!base) return Promise.reject(new Error('未连接设备，无法保存信息栏'));
      var self = this;
      var dark = theme === 'black';
      var inkIds = { date: 1, time: 1, temp: 1, hum: 1, i_temp: 1, i_hum: 1, mark_odd: 1, mark_bat: 1 };
      return Promise.all(['B', 'Bp'].map(function (name) {
        return self.getLayout(name).then(function (layout) {
          if (!layout || !layout.layers) return null;
          layout.layers.forEach(function (layer) {
            if (layer.id === 'bar') layer.color = dark ? 0 : 1;
            if (layer.id === 'divider') layer.color = dark ? 1 : 0;
            if (inkIds[layer.id]) layer.color = dark ? 1 : 0;
          });
          return self.setLayout(name, layout, true);
        });
      })).catch(function () {
        /* 版式文件缺失/只读时不要让整个「应用」链断在这里，
         * 否则后面的 refreshNow 永远不执行，用户只看到"保存了但没刷新"。 */
        return null;
      });
    },

    setWifi: function (ssid, pass) {
      if (!base) return Promise.reject(new Error('未连接设备，无法配网'));
      return req('/api/wifi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid: ssid, pass: pass }),
        timeout: 40000
      });
    },

    /* 扫描周边 AP，返回 { networks: [{ssid, rssi, secure, ch}] } */
    scanWifi: function () {
      if (!base) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve({
              networks: [
                { ssid: 'Home_5G', rssi: -42, secure: true, ch: 149 },
                { ssid: 'MERCURY_2.4G', rssi: -58, secure: true, ch: 6 },
                { ssid: 'ChinaNet-8Kx2', rssi: -71, secure: true, ch: 11 },
                /* 演示模式专属的两个"彩蛋"热点，密码见 app.js 的 WIFI_EGGS。
                 * 只在离线演示里出现，真机扫描走固件返回，不会有它们。 */
                { ssid: 'Colloidal', rssi: -18, secure: true, ch: 1 },
                { ssid: 'SaHaRa', rssi: -81, secure: true, ch: 11 }
              ]
            });
          }, 1100);
        });
      }
      return req('/api/wifi/scan', { timeout: 25000 });
    },

    syncTime: function (epoch) {
      if (!base) return Promise.reject(new Error('未连接设备，无法写入时间'));
      return req('/api/time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epoch: epoch,
          /* getTimezoneOffset 返回"UTC - 本地"的分钟数，符号与常规定义相反 */
          offset_min: -new Date().getTimezoneOffset()
        })
      });
    },

    refreshNow: function (layout) {
      /* 离线不能假装成功：以前返回 {ok:true}，界面提示"已触发刷新"，
       * 但屏根本不会动，看起来就是"点了没反应"。 */
      if (!base) return Promise.reject(new Error('未连接设备'));
      return req('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: layout || null }),
        timeout: 45000
      });
    },

    /* 让设备自己去 NTP 校时（设备联网时才有效）。只校内存与 RTC，不动配置。 */
    syncNtp: function () {
      if (!base) return Promise.reject(new Error('未连接设备'));
      return req('/api/time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ntp: true, offset_min: -new Date().getTimezoneOffset() }),
        timeout: 20000
      });
    },

    /* AI 指令：一句话交给设备，设备自己决定本地执行还是转给服务端 */
    aiAsk: function (text) {
      if (!base) return Promise.reject(new Error('未连接设备'));
      return req('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
        timeout: 20000
      });
    },

    /* ---- 在线媒体资源同步 ---- */

    /* 开始同步。url 留空表示用设备里配置的清单地址。 */
    assetsSync: function (url) {
      if (!base) return Promise.reject(new Error('未连接设备'));
      return req('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url || '' }),
        timeout: 15000
      });
    },

    /* 进度：running / total / done / ok / skipped / failed / bytes / current / message */
    assetsState: function () {
      if (!base) return Promise.resolve(null);
      return req('/api/assets', { timeout: 8000 });
    },

    /* 在线更新：检查 manifest（阻塞 1~3 秒，设备要联网去拉） */
    fwCheck: function () {
      if (!base) return Promise.reject(new Error('未连接设备'));
      return req('/api/ota/online', { timeout: 25000 });
    },

    /* 开始下载；立刻返回，进度看 /api/ota 的 active/written/total */
    fwGo: function () {
      if (!base) return Promise.reject(new Error('未连接设备'));
      return req('/api/ota/online', { method: 'POST', timeout: 15000 });
    },

    /* 音乐库：只读列表，选中与模式走 setConfig */
    musicList: function () {
      if (!base) return Promise.resolve({ ok: true, count: 0, index: 0, mode: 0, items: [] });
      return req('/api/music', { timeout: 8000 });
    },

    /* 列出 SD 卡某一层目录 */
    fsList: function (path) {
      if (!base) return Promise.resolve({ ok: true, path: '/', entries: [] });
      return req('/api/files?path=' + encodeURIComponent(path || '/'), { timeout: 10000 });
    },

    fsDelete: function (path) {
      if (!base) return Promise.reject(new Error('未连接设备'));
      return req('/api/files?path=' + encodeURIComponent(path), {
        method: 'DELETE', timeout: 10000
      });
    },

    /* 上传一个文件到指定目录：走通用写文件接口，原始 body */
    fsUpload: function (file, dir, onProgress) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        var p = (dir || '/').replace(/\/$/, '') + '/' + file.name;
        xhr.open('POST', base.replace(/\/$/, '') + '/api/put?path=' +
                 encodeURIComponent(p));
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.timeout = 300000;
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        xhr.onload = function () {
          var body = null;
          try { body = JSON.parse(xhr.responseText); } catch (e) {}
          if (xhr.status >= 200 && xhr.status < 300 && body && body.ok) resolve(body);
          else reject(new Error((body && body.err) || ('HTTP ' + xhr.status)));
        };
        xhr.onerror = function () { reject(new Error('网络错误')); };
        xhr.ontimeout = function () { reject(new Error('上传超时')); };
        xhr.send(file);
      });
    },

    /* 语音包列表：/sdcard/sounds/ 下的每个目录 */
    soundPacks: function () {
      if (!base) return Promise.resolve({ ok: true, current: 'default', packs: ['default'] });
      return req('/api/sound/packs', { timeout: 6000 });
    },

    /* 试听提示音：只响一声、不改配置。音量滑块松手时调它，
     * 让人在调的过程中就听到当前音量，而不是保存后再猜。 */
    previewBeep: function () {
      if (!base) return Promise.reject(new Error('未连接设备'));
      return req('/api/beep', { method: 'POST', timeout: 8000 });
    },

    sleep: function () {
      if (!base) return Promise.reject(new Error('未连接设备'));
      return req('/api/sleep', { method: 'POST' });
    },

    /* 固件与 OTA 槽信息 */
    otaInfo: function () {
      if (!base) {
        return Promise.resolve({
          ver: '—', partition: '—', slot: 0, mock: true,
          rollback_pending: false, active: false, written: 0, total: 0,
          usb_power: false, battery_mv: 0
        });
      }
      return req('/api/ota', { timeout: 8000 });
    },

    /**
     * 上传固件并重启。用 XHR 而非 fetch —— fetch 拿不到上传进度。
     * @param {File} file  build/app.bin
     * @param {(pct:number, phase:string)=>void} onProgress
     */
    flashFirmware: function (file, onProgress) {
      /* 离线时绝不能跑假进度条：以前会走完 100%、提示"固件已更新"并刷新页面，
       * 设备其实一点没变，这是最容易被误判的一条。 */
      if (!base) return Promise.reject(new Error('未连接设备，无法上传固件'));
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', base.replace(/\/$/, '') + '/api/ota');
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.timeout = 180000;
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            onProgress && onProgress(e.loaded / e.total * 100, '上传中');
          }
        };
        xhr.upload.onload = function () {
          onProgress && onProgress(100, '设备写入校验');
        };
        xhr.onload = function () {
          var body = null;
          try { body = JSON.parse(xhr.responseText); } catch (e) { body = null; }
          if (xhr.status >= 200 && xhr.status < 300 && body && body.ok) resolve(body);
          else reject(new Error((body && body.err) || ('HTTP ' + xhr.status)));
        };
        xhr.onerror = function () { reject(new Error('连接中断')); };
        xhr.ontimeout = function () { reject(new Error('超时')); };
        xhr.send(file);
      });
    },

    /* 编号在各自相册内递增：横屏 1001 与竖屏 1001 是两张不同的照片 */
    nextId: function (orient) {
      var list = mockList(groupOf(orient));
      if (!base) {
        var max = 1000;
        list.forEach(function (p) { max = Math.max(max, +p.id); });
        return String(max + 1);
      }
      return null;
    }
  };
})();
