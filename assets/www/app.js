/* app.js —— 銜玉珍函控制台 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function toast(msg, isErr) {
    var el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity .2s';
      setTimeout(function () { el.remove(); }, 220);
    }, 2600);
  }

  /* ================= 标签页 ================= */

  var PAGE_META = {
    upload: ['CREATE', '创作与上屏', ''],
    gallery: ['COLLECTION', '相册管理', ''],
    files: ['STORAGE', '文件管理', ''],
    settings: ['DEVICE', '设备设置', '']
  };

  function activateTab(t, moveFocus) {
    if (location.hash !== '#' + t.dataset.tab) {
      try { history.replaceState(null, '', '#' + t.dataset.tab); } catch (e) {}
    }
    $$('.tab').forEach(function (x) {
      var active = x === t;
      x.classList.toggle('active', active);
      x.setAttribute('aria-selected', active ? 'true' : 'false');
      x.tabIndex = active ? 0 : -1;
    });
    $$('.panel').forEach(function (x) {
      var active = x.id === 'tab-' + t.dataset.tab;
      x.classList.toggle('active', active);
      x.hidden = !active;
    });
    var meta = PAGE_META[t.dataset.tab];
    if (meta) $('#pageTitle').textContent = meta[1];
    if (moveFocus) t.focus();
    if (t.dataset.tab === 'gallery') renderGallery();
    /* 进设置页时顺手读一次音乐库：曲目列表依赖 SD 卡，开机时读没意义
     * （那时可能还没连上），进页面时读最稳。 */
    if (t.dataset.tab === 'settings' && typeof loadMusic === 'function') loadMusic(false);
    if (t.dataset.tab === 'settings') loadSettings();
    if (t.dataset.tab === 'files') loadFiles(FS_PATH);
  }

  $$('.tab').forEach(function (t, index, tabs) {
    t.addEventListener('click', function () { activateTab(t, false); });
    t.addEventListener('keydown', function (e) {
      var next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (index + 1) % tabs.length :
        e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (index + tabs.length - 1) % tabs.length : -1;
      if (next >= 0) { e.preventDefault(); activateTab(tabs[next], true); }
    });
  });

  /* ================= 状态栏 ================= */

  function setConn(on, text) {
    var pill = $('#pillConn');
    pill.classList.toggle('online', on);
    $('#pillText').textContent = text;
    /* 顶部已经有三处离线标识（状态胶囊、设备地址、连接按钮），
     * 页面里不再重复一条横幅打断创作流程。 */
  }

  function refreshStatus() {
    Api.status().then(function (s) {
      if (s && s.orientation && s.orientation !== S.devOrient) {
        S.devOrient = s.orientation;
        S.devIdx = null;                       /* 方向变了，解码缓存作废 */
        if (S.devPhys) paintScreenView();
      }
      $('#statIp').textContent = Api.isOnline() ? (Api.getBase().replace(/^https?:\/\//, '')) : '本地';
      /* 这里是恒定的用法说明（sweetfish.local），当前实际地址由右上角「设备地址」负责显示，
       * 不再跟着连接状态改写文案，避免同一信息两处出现且互相矛盾。 */
      var pct = batPctOf(s);
      var changed = pct !== BAT_PCT;
      BAT_PCT = pct;
      $('#statBatt').textContent = s.battery_mv
        ? (s.battery_mv / 1000).toFixed(2) + 'V' + (pct >= 0 ? ' · ' + pct + '%' : '')
        : '—';
      $('#statBatt').classList.toggle('low', pct >= 0 && pct < 10);
      /* -1 表示"有人在用，不倒数"（USB 供电 / 手机连着热点 / 网页刚操作）。
       * 以前直接 -1/60 会显示成 "-1m"。 */
      $('#statAwake').textContent = s.awake_remaining_sec > 0
        ? Math.floor(s.awake_remaining_sec / 60) + 'm'
        : (s.awake_remaining_sec < 0 ? '使用中' : '—');
      if (s.temp_valid) {
        TEMP_SAMPLE = s.temp_c;
        HUM_SAMPLE = s.hum_pct;
      }
      if ($('#sensRaw') && $('#sensAdj')) {
        if (s.temp_valid) {
          var rt = (typeof s.temp_raw_c === 'number') ? s.temp_raw_c : s.temp_c;
          var rh = (typeof s.hum_raw_pct === 'number') ? s.hum_raw_pct : s.hum_pct;
          $('#sensRaw').textContent = rt.toFixed(1) + ' ℃ · ' + Math.round(rh) + ' %';
          $('#sensAdj').textContent = s.temp_c.toFixed(1) + ' ℃ · ' + Math.round(s.hum_pct) + ' %';
        } else {
          $('#sensRaw').textContent = '—';
          $('#sensAdj').textContent = '—';
        }
      }
      /* 天气与上一次读数：温湿度版式的预览要用它们决定画哪一套图层 */
      WX_LIVE = (s.weather && s.weather.ok) ? s.weather : null;
      PREV_T = (typeof s.prev_temp_c === 'number') ? s.prev_temp_c : null;
      PREV_H = (typeof s.prev_hum_pct === 'number') ? s.prev_hum_pct : null;
      /* 近 24 小时温度（旧→新，缺数据的位置是 null）。工作台折线图直接画它，
       * 这样"预览"和屏上用的是同一份数据，不会各画各的。 */
      TEMP_HIST = (s && s.temp_hist && s.temp_hist.length === 24) ? s.temp_hist : null;
      HUM_HIST  = (s && s.hum_hist  && s.hum_hist.length  === 24) ? s.hum_hist  : null;
      if ((s.temp_valid || changed) && S.idx && currentLayout() === 'B') {
        drawInfoBar();
        drawBdayBanner();
      }
      if (S.idx && currentLayout() === 'C') {
        drawClimatePreview(pv.width, pv.height);
      }
      fillDeviceInfo(s);
      autoFixDeviceTime(s);
    }).catch(function () {
      setConn(false, '已断开');
    });
  }

  /* 设备时间跑偏就顺手校准一次。两种情况都会偏：
   *   1) 没配网时拿不到 NTP，RTC 停走以后只能自己慢慢停着；
   *   2) RTC 芯片的秒针被屏满刷打断（固件里已有守护，这里兜底）。
   * 只在偏差超过 90 秒时推，10 分钟内不重复，免得和 NTP 抢着写。 */
  function autoFixDeviceTime(s) {
    if (!Api.isOnline() || !s || !s.now_epoch) return;
    var nowSec = Math.floor(Date.now() / 1000);
    var drift = nowSec - s.now_epoch;
    if (Math.abs(drift) <= 90 || nowSec - LAST_TIME_SYNC <= 600) return;
    LAST_TIME_SYNC = nowSec;
    Api.syncTime(nowSec).then(function () {
      if (TIME_SYNC_TOLD) return;
      TIME_SYNC_TOLD = true;
      var mins = Math.round(Math.abs(drift) / 60);
      toast('设备时间比本机' + (drift > 0 ? '慢' : '快') + ' ' + mins +
            ' 分钟，已按本机时间校准');
      /* 差得离谱（5 分钟以上）说明屏上那行时间明显是错的，顺手重刷一次，
       * 否则要等到下一个整点才看得见。30 秒全刷，期间别断电。 */
      if (Math.abs(drift) > 300) {
        Api.refreshNow().then(function () {
          toast('已按校准后的时间重刷屏幕（约 30 秒）');
        }).catch(function () {});
      }
    }).catch(function () {});
  }

  /* 容量一律带单位：以前「已用」按 KB 除 1024 却标成 GB，看着像整盘只剩几百 MB。
   * 小于 1 GB 用 MB 报，免得一律显示成 "0.3 GB" 这种没法估算的数。 */
  function fmtSize(kb) {
    if (typeof kb !== 'number' || kb < 0) return '—';
    if (kb < 1024) return kb + ' KB';
    if (kb < 1048576) return (kb / 1024).toFixed(1) + ' MB';
    return (kb / 1048576).toFixed(2) + ' GB';
  }

  function fillDeviceInfo(s) {
    var m = {
      infoSn: s.sn || '—',
      infoFw: s.fw || '—',
      infoMode: s.mode || '—',
      infoIp: (function () {
        /* 优先显示设备在家里的局域网地址（STA 接口），而不是浏览器当前访问的
         * 地址：手机开着热点时后者是 192.168.4.1，一切回家里那张网就没用了。 */
        if (s.wifi && s.wifi.ip) return s.wifi.ip;
        if (Api.isOnline()) return Api.getBase().replace(/^https?:\/\//, '') + '（未连路由）';
        return '离线';
      })(),
      infoRssi: s.wifi && s.wifi.rssi ? s.wifi.rssi + ' dBm' : '—',
      infoBatt: s.battery_mv
        ? (s.battery_mv / 1000).toFixed(2) + ' V' + (batPctOf(s) >= 0 ? ' · ' + batPctOf(s) + '%' : '')
        : '硬件未提供',
      infoSd: (function () {
        if (!s.sd_total_kb) return '—';
        var used = s.sd_used_kb || 0;
        var pct = used / s.sd_total_kb * 100;
        /* 百分比按量级取位：小卡占几个百分点时给两位小数才有意义，
         * 大卡几十 MB 只占 0.0x%，一位小数会全变成 0.0%。 */
        var pe = pct >= 10 ? pct.toFixed(0) + '%'
               : pct >= 1  ? pct.toFixed(1) + '%'
               : pct > 0   ? pct.toFixed(2) + '%'
               : '0%';
        return fmtSize(used) + ' / ' + fmtSize(s.sd_total_kb) + '（' + pe + '）';
      })(),
      infoCount: (s.photo_count || 0) + ' 张',
      infoMusic: (typeof s.music_count === 'number' ? s.music_count : 0) + ' 首',
      infoLast: fmtTime(s.last_refresh),
      infoWifi: (function () {
        var w = s.wifi || {};
        if (w.mode === 'STA') return '已连接' + (w.ssid ? ' · ' + w.ssid : '');
        if (w.mode === 'AP') return '未连接（仅在热点模式）';
        return '未连接';
      })(),
      infoNext: (function () {
        var t = fmtTime(s.next_wake);
        if (t === '—') return '—';
        /* 插着 USB 时设备根本不会深睡，这个时刻只是「要是现在拔电会几点醒」，
         * 不写清楚会让人以为设备马上要睡、网页要断。 */
        return t + (s.usb_power ? '（插电不休眠）' : '');
      })()
    };
    Object.keys(m).forEach(function (k) {
      var el = document.getElementById(k);
      if (el) el.textContent = m[k];
    });

    /* 网络连接卡片：已经连上路由器就把当前 SSID / IP / 信号摆出来，
     * 没连上就只说「连上之后能干什么」。以前这块是写死在 HTML 里的静态文案，
     * 配好网之后既不显示连了哪个网，也看不到该访问哪个地址。 */
    var wifi = s.wifi || {};
    /* 连接弹窗的「局域网地址」快捷填入：拿到 IP 就写进去，点一下就能填。 */
    S.lanIp = wifi.ip || '';
    if ($('#quickLan')) {
      $('#quickLan').dataset.address = S.lanIp ? ('http://' + S.lanIp) : '';
      $('#quickLan').classList.toggle('disabled', !S.lanIp);
      /* 按钮文字不显示 IP（用户要求）：地址藏在 data-address 里，点一下填进输入框 */
      $('#quickLan').textContent = '局域网';
    }
    /* 只要 STA 连上了就算已配网：ip 偶尔会晚一拍拿到，不必拿它当门槛 ——
     * 否则刚连上那几秒会显示成「未连接」，看着像配网失败。 */
    var linked = wifi.mode === 'STA';
    if ($('#connNow')) $('#connNow').hidden = !linked;
    /* 配好网之后只留当前连接信息：扫描列表、SSID、密码这些是「还没配好」时才要用的，
     * 收起来换成「更换网络」，要改再展开。 */
    if ($('#wifiManual')) $('#wifiManual').hidden = linked;
    if ($('#wifiChangeRow')) $('#wifiChangeRow').hidden = !linked || !!wxManualOpen;
    if (linked) {
      if ($('#connSsid')) $('#connSsid').textContent = wifi.ssid || '—';
      if ($('#connIp')) $('#connIp').textContent = 'http://' + wifi.ip;
      if ($('#connRssi')) $('#connRssi').textContent = wifi.rssi ? wifi.rssi + ' dBm' : '—';
      if ($('#wifiHint')) {
        $('#wifiHint').innerHTML = '同一局域网内的手机或电脑打开 <code>http://' + esc(wifi.ip) +
          '</code> 即可登录管理界面。';
      }
    } else if ($('#wifiHint')) {
      $('#wifiHint').textContent = '连接网络后，可通过局域网访问管理相册，并获取在线服务。';
    }

    /* 天气：自动定位取到的是英文地名（IP 库返回什么就显示什么），
     * 没取到时给一句说明，别只留一个破折号让人以为是坏了。 */
    if ($('#wxPlaceNote')) {
      var place = (s.weather && s.weather.place) ? String(s.weather.place) : '';
      var wxOk = !!(s.weather && s.weather.ok);
      $('#wxPlaceNote').textContent = place
        ? ('定位到 ' + place + (wxOk ? '' : '（天气数据未取到）'))
        : '定位到 —';
    }
    var dt = $('#devTime');
    if (dt) dt.textContent = fmtTime(s.time);
    /* 用户没动过那六格时，跟着设备时间走；动过就别抢他手里的值 */
    if (!TIME_TOUCHED) fillTimeByEpoch(s.time || s.epoch);
  }

  /* 设备返回的是 Unix 秒（epoch），直接 new Date(1794894000) 会被当成毫秒 → 1970 年。
   * 这里统一识别：数字或纯数字字符串且 < 1e12 视作秒。 */
  function toDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);
    var s = String(v).trim();
    if (/^\d{9,13}$/.test(s)) {
      var n = parseInt(s, 10);
      return new Date(n < 1e12 ? n * 1000 : n);
    }
    return new Date(s);
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = toDate(iso);
    if (!d || isNaN(d.getTime())) return String(iso);
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* 连接弹窗：地址可编辑、可快捷填入，失败时保留输入方便修正。 */
  var connectDialog = $('#connectDialog');

  function openConnect() {
    /* 默认填「上手就能用」的那个地址：配过网就是路由器分配的局域网地址，
     * 没配过就是热点 192.168.4.1。sweetfish.local 在安卓上多半不解析，别拿它当默认。 */
    $('#connUrl').value = Api.getBase() || (S.lanIp ? 'http://' + S.lanIp : 'http://192.168.4.1');
    if (connectDialog.showModal) connectDialog.showModal();
    else connectDialog.setAttribute('open', '');
    setTimeout(function () { $('#connUrl').focus(); $('#connUrl').select(); }, 30);
  }

  function closeConnect() {
    if (connectDialog.close) connectDialog.close();
    else connectDialog.removeAttribute('open');
  }

  function connectDevice(raw) {
    var url = raw.trim();
    var submit = $('#btnConnectSubmit');
    submit.disabled = true;
    if (url && !/^https?:\/\//.test(url)) url = 'http://' + url;
    return Api.setBase(url).then(function (ok) {
      var connected = !!url && ok;
      setConn(connected, !url ? '离线模式' : connected ? '已连接' : '连接失败');
      toast(!url ? '已切换到离线模式' : connected ? '设备连接成功' : '连不上设备，请检查地址与 WiFi', !!url && !connected);
      /* 设备处在热点模式时没有路由器可连，拿不到 NTP，时间只能靠这边推过去。
       * 顺手把本机时区一起带上，保证面板和手机显示一致。 */
      if (connected) {
        /* 设备开着在线对时的话，手机这一下写入会被 NTP 覆盖，而且接口会直接拒绝；
         * 只有明确关掉时才把本机时间推过去。 */
        if (cfgCache && cfgCache.ntp_enabled === false) {
          Api.syncTime(Math.floor(Date.now() / 1000)).catch(function () {}).then(refreshStatus);
        } else {
          refreshStatus();
        }
      } else {
        refreshStatus();
      }
      refreshOtaInfo();
      return connected || !url;
    }).then(function (done) {
      submit.disabled = false;
      return done;
    });
  }

  $('#btnConnect').addEventListener('click', openConnect);
  /* 页内已不再放「连接设备」横幅，这里保留兼容：万一以后某处加了 data-open-connect 也不会报错 */
  $$('[data-open-connect]').forEach(function (el) {
    el.addEventListener('click', openConnect);
  });
  $('#btnCloseConnect').addEventListener('click', closeConnect);
  $('#connectForm').addEventListener('submit', function (e) {
    e.preventDefault();
    connectDevice($('#connUrl').value).then(function (done) { if (done) closeConnect(); });
  });
  $('#btnUseDemo').addEventListener('click', function () {
    connectDevice('').then(function () { closeConnect(); });
  });
  $$('[data-address]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!b.dataset.address) {
        toast('还没有拿到局域网地址：先连上热点，配好网后这里会自动填上', true);
        return;
      }
      $('#connUrl').value = b.dataset.address;
      $('#connUrl').focus();
    });
  });
  connectDialog.addEventListener('click', function (e) {
    if (e.target === connectDialog) closeConnect();
  });

  /* ================= 裁剪编辑器 ================= */

  var S = {
    bitmap: null,
    crop: null,
    drag: null,
    view: { s: 1, ox: 0, oy: 0 },
    idx: null,
    packed: null,
    thumb: null,
    devPhys: null,            /* 设备当前照片的物理帧（打开网页时拉下来，用于登录即显示） */
    devOrient: null,          /* 设备渲染这一帧时用的方向 */
    devId: null,              /* 设备当前照片的编号 */
    devPhotoOrient: null,     /* 这张照片存盘时的方位：解码必须按它，不能按设备站姿 */
    devIdx: null,             /* 设备画面的解码缓存：方向/照片没变就不用重算 */
    devIdxUse: null, devIdxDec: null,
    lanIp: '',                /* 设备在家里的局域网地址，连接弹窗的快捷填入用它 */
    orient: 'landscape',      /* 本次裁剪/预览的方向 */
    cropMode: 'fit',
    fill: 'white',
    cw: 760, ch: 456
  };

  /* 设备当前设定方向，从 /api/config 读；相册里把图推上屏前用它判断是否要提醒 */
  var DEV_ORIENT = 'landscape';
  /* 设置页里已选、还没保存的方向 */
  /* 'auto' = 按照片宽高自动决定横/竖相册；'landscape' / 'portrait_r' 是人手动指定的。
   * 默认自动：绝大多数人只想知道"这张会不会被裁"，不想先想相册。 */
  var PICK_ORIENT = 'auto';
  var BAR_THEME = 'white';
  try { BAR_THEME = localStorage.getItem('pp_bar_theme') === 'black' ? 'black' : 'white'; } catch (e) {}
  /* 工作台（布局 C）配色：白天 / 黑夜。存 config.json 的 wb_theme（day / night）。
   * 黑夜不是"压成黑白"—— 是白底黑字整体反转，红蓝黄这些彩色保留。 */
  var WB_THEME = 'day';
  try {
    var _wbt = localStorage.getItem('pp_wb_theme');
    WB_THEME = (_wbt === 'night' || _wbt === 'mono') ? 'night' : 'day';
  } catch (e) {}

  function isPortrait(o) { return !!o && o !== 'landscape'; }

  /* 构图与裁剪里竖屏只给「竖屏」一个选项，落盘方位固定用 portrait_r（正立）。
   * 倒立已经从上位机界面去掉，历史配置里的 portrait_l 一律当正立处理。 */
  function resolveOrient(o) {
    if (o === 'landscape') return 'landscape';
    return 'portrait_r';
  }

  /* 逻辑画布 = 设计画布。竖屏 480×800，落屏时整幅旋转 90° 成 800×480。 */
  function logiSize(o) { return isPortrait(o) ? { w: 480, h: 800 } : { w: 800, h: 480 }; }

  function cropRatio() { var L = logiSize(S.orient); return L.w / L.h; }

  var cv = $('#cropCanvas');
  var ctx = cv.getContext('2d');
  var dpr = window.devicePixelRatio || 1;

  function layoutCanvas() {
    var wrap = $('#cropWrap');
    var w = wrap.clientWidth || 760;
    /* 竖屏裁区是竖的，画布也要竖起来 */
    var h = clamp(Math.round(w * (isPortrait(S.orient) ? 1.16 : 0.62)), 300, 760);
    if (w === S.cw && h === S.ch && cv.width === Math.round(w * dpr)) return;
    S.cw = w; S.ch = h;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    drawCrop();
  }

  function centeredCrop(iw, ih, ratio) {
    var w = iw, h = w / ratio;
    if (h > ih) { h = ih; w = h * ratio; }
    return { x: (iw - w) / 2, y: (ih - h) / 2, w: w, h: h };
  }

  function initCrop() {
    var iw = S.bitmap.width, ih = S.bitmap.height;
    S.crop = S.cropMode === 'free'
      ? { x: 0, y: 0, w: iw, h: ih }
      : centeredCrop(iw, ih, cropRatio());
  }

  function drawCrop() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S.cw, S.ch);
    if (!S.bitmap) return;

    var iw = S.bitmap.width, ih = S.bitmap.height;
    var s = Math.min(S.cw / iw, S.ch / ih);
    var dw = iw * s, dh = ih * s;
    var ox = (S.cw - dw) / 2, oy = (S.ch - dh) / 2;
    S.view = { s: s, ox: ox, oy: oy };

    ctx.drawImage(S.bitmap, ox, oy, dw, dh);

    var c = S.crop;
    var cx = ox + c.x * s, cy = oy + c.y * s, cw = c.w * s, ch = c.h * s;

    ctx.fillStyle = 'rgba(12,12,14,.58)';
    ctx.fillRect(ox, oy, dw, cy - oy);
    ctx.fillRect(ox, cy + ch, dw, dh - (cy - oy) - ch);
    ctx.fillRect(ox, cy, cx - ox, ch);
    ctx.fillRect(cx + cw, cy, dw - (cx - ox) - cw, ch);

    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);

    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 1;
    for (var i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + cw * i / 3, cy); ctx.lineTo(cx + cw * i / 3, cy + ch);
      ctx.moveTo(cx, cy + ch * i / 3); ctx.lineTo(cx + cw, cy + ch * i / 3);
      ctx.stroke();
    }

    var hs = 5;
    [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]].forEach(function (p) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(p[0] - hs, p[1] - hs, hs * 2, hs * 2);
      ctx.strokeStyle = '#16161a';
      ctx.lineWidth = 1;
      ctx.strokeRect(p[0] - hs + 0.5, p[1] - hs + 0.5, hs * 2 - 1, hs * 2 - 1);
    });

    $('#cropReadout').textContent =
      Math.round(c.w) + ' × ' + Math.round(c.h) + ' px  ·  源图 ' + iw + ' × ' + ih;
  }

  function toImage(e) {
    var r = cv.getBoundingClientRect();
    var x = (e.clientX - r.left) * (S.cw / r.width);
    var y = (e.clientY - r.top) * (S.ch / r.height);
    return { x: (x - S.view.ox) / S.view.s, y: (y - S.view.oy) / S.view.s };
  }

  function hitTest(pt) {
    if (!S.crop) return null;
    var c = S.crop;
    var tol = 16 / S.view.s;
    var nearL = Math.abs(pt.x - c.x) < tol;
    var nearR = Math.abs(pt.x - (c.x + c.w)) < tol;
    var nearT = Math.abs(pt.y - c.y) < tol;
    var nearB = Math.abs(pt.y - (c.y + c.h)) < tol;
    if (nearL && nearT) return 'nw';
    if (nearR && nearT) return 'ne';
    if (nearL && nearB) return 'sw';
    if (nearR && nearB) return 'se';
    if (pt.x > c.x && pt.x < c.x + c.w && pt.y > c.y && pt.y < c.y + c.h) return 'move';
    return null;
  }

  function doResize(mode, pt) {
    var o = S.drag.orig;
    var iw = S.bitmap.width, ih = S.bitmap.height;
    var R = cropRatio();
    var ax, ay, sx, sy;
    if (mode === 'se') { ax = o.x; ay = o.y; sx = 1; sy = 1; }
    else if (mode === 'nw') { ax = o.x + o.w; ay = o.y + o.h; sx = -1; sy = -1; }
    else if (mode === 'ne') { ax = o.x; ay = o.y + o.h; sx = 1; sy = -1; }
    else { ax = o.x + o.w; ay = o.y; sx = -1; sy = 1; }

    var maxWX = sx > 0 ? iw - ax : ax;
    var maxHY = sy > 0 ? ih - ay : ay;

    if (S.cropMode === 'free') {
      var minW = Math.min(64, maxWX), minH = Math.min(64, maxHY);
      var fw = clamp(Math.abs(pt.x - ax), Math.max(1, minW), Math.max(1, maxWX));
      var fh = clamp(Math.abs(pt.y - ay), Math.max(1, minH), Math.max(1, maxHY));
      S.crop = {
        x: sx > 0 ? ax : ax - fw,
        y: sy > 0 ? ay : ay - fh,
        w: fw, h: fh
      };
      return;
    }

    var wByX = Math.abs(pt.x - ax);
    var wByY = Math.abs(pt.y - ay) * R;
    var w = Math.max(wByX, wByY);
    var maxW = Math.min(maxWX, maxHY * R);
    var minW = Math.min(240, iw * 0.15);
    w = clamp(w, Math.max(64, minW), Math.max(64, maxW));
    var h = w / R;
    S.crop = {
      x: sx > 0 ? ax : ax - w,
      y: sy > 0 ? ay : ay - h,
      w: w, h: h
    };
  }

  cv.addEventListener('pointerdown', function (e) {
    if (!S.bitmap) return;
    var pt = toImage(e);
    var mode = hitTest(pt);
    if (!mode) return;
    cv.setPointerCapture(e.pointerId);
    S.drag = { mode: mode, orig: { x: S.crop.x, y: S.crop.y, w: S.crop.w, h: S.crop.h }, start: pt };
  });

  cv.addEventListener('pointermove', function (e) {
    if (!S.bitmap) return;
    var pt = toImage(e);
    if (!S.drag) {
      var m = hitTest(pt);
      cv.style.cursor = m === 'move' ? 'move' :
        (m === 'nw' || m === 'se') ? 'nwse-resize' :
        m ? 'nesw-resize' : 'crosshair';
      return;
    }
    if (S.drag.mode === 'move') {
      var dx = pt.x - S.drag.start.x, dy = pt.y - S.drag.start.y;
      S.crop.x = clamp(S.drag.orig.x + dx, 0, S.bitmap.width - S.crop.w);
      S.crop.y = clamp(S.drag.orig.y + dy, 0, S.bitmap.height - S.crop.h);
    } else {
      doResize(S.drag.mode, pt);
    }
    drawCrop();
  });

  cv.addEventListener('pointerup', function (e) {
    if (!S.drag) return;
    S.drag = null;
    schedulePreview();
  });

  cv.addEventListener('wheel', function (e) {
    if (!S.bitmap) return;
    e.preventDefault();
    var c = S.crop;
    var R = S.cropMode === 'free' ? c.w / c.h : cropRatio();
    var cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    var f = e.deltaY > 0 ? 1.04 : 0.96;
    var w = clamp(c.w * f, 200, S.bitmap.width);
    var h = w / R;
    if (h > S.bitmap.height) { h = S.bitmap.height; w = h * R; }
    S.crop = { x: clamp(cx - w / 2, 0, S.bitmap.width - w), y: clamp(cy - h / 2, 0, S.bitmap.height - h), w: w, h: h };
    drawCrop();
    schedulePreview();
  }, { passive: false });

  cv.addEventListener('dblclick', function () {
    if (!S.bitmap) return;
    initCrop(); drawCrop(); schedulePreview();
  });

  /* ================= 图像载入 ================= */

  var fileInput = $('#fileInput');
  $('#btnPick').addEventListener('click', function (e) { e.stopPropagation(); fileInput.click(); });
  $('#btnPick2').addEventListener('click', function (e) { e.stopPropagation(); fileInput.click(); });
  $('#dropzone').addEventListener('click', function () { fileInput.click(); });

  /* 手机连热点后，系统会自己弹一个「联网检测」窗口把本页塞进去。那个窗口
   * （iOS 的 CNA、安卓的登录 WebView）不提供文件选择器，fileInput.click()
   * 在里面静默失效——表现就是所有上传入口都点不动。识别出来就直接挂个
   * 横幅说明，别让人对着按钮反复戳。
   *
   * 判据别用 "; wv)"：那是「安卓 WebView」的通用标记，微信/QQ/支付宝内置
   * 浏览器全都有。配好网之后人在局域网里用微信打开管理页，会被误判成
   * 「你正在系统联网窗口里」，横幅一直挂着，还让人跑去连热点。 */
  (function markCaptiveWebview() {
    var ua = (navigator.userAgent || '').toLowerCase();
    var host = location.hostname || '';
    /* from=portal 是门户页那一下带来的：从系统登录小窗点进来的一定带它，
     * 而人自己在浏览器里敲 192.168.4.1 不会带 —— 比 UA 判定精确得多。
     * 原来的 UA 判据保留，用来兜「直接打开探测域名」的情况。 */
    var inPortal = location.search.indexOf('from=portal') >= 0 ||
                   ua.indexOf('captivenetworksupport') >= 0 ||
                   ua.indexOf('dalvik') >= 0 ||
                   /connectivitycheck|connecttest|msftncsi|gstatic/i.test(host);
    var el = $('#captiveHint');
    if (el && inPortal) el.hidden = false;

    /* 横幅里的「复制地址」：小窗里唯一 100% 能走通的路 */
    var cp = $('#btnCopyPortal');
    if (cp) {
      cp.addEventListener('click', function () {
        var addr = 'http://' + (location.hostname || '192.168.4.1') + '/app';
        var self = this;
        function done() { self.textContent = '已复制'; }
        function fb() {
          try {
            var t = document.createElement('textarea');
            t.value = addr; t.style.position = 'fixed'; t.style.top = '-1000px';
            document.body.appendChild(t); t.select();
            var r = document.execCommand('copy');
            document.body.removeChild(t);
            if (r) done(); else toast('复制失败，请手动输入 ' + addr, true);
          } catch (e) { toast('复制失败，请手动输入 ' + addr, true); }
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(addr).then(done, fb);
          } else { fb(); }
        } catch (e) { fb(); }
      });
    }
  })();


  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]);
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    $('#cropWrap').addEventListener(ev, function (e) {
      e.preventDefault(); $('#dropzone').classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    $('#cropWrap').addEventListener(ev, function (e) {
      e.preventDefault(); $('#dropzone').classList.remove('drag');
    });
  });
  $('#cropWrap').addEventListener('drop', function (e) {
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  function loadFile(file) {
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|bmp|heic|heif)$/i.test(file.name)) {
      toast('不是可识别的图片文件', true); return;
    }
    createImageBitmap(file, { imageOrientation: 'from-image' })
      .then(function (bmp) {
        S.bitmap = bmp;
        S.origBlob = file;
        if (PICK_ORIENT === 'auto') autoOrientFor(bmp);
        if ($('#btnPick2')) $('#btnPick2').textContent = '更换照片';
        $('#dropzone').style.display = 'none';
        $('#previewEmpty').hidden = true;
        $('#btnUpload').disabled = false;
        $('#btnSaveOnly').disabled = false;
        initCrop();
        layoutCanvas();
        /* layoutCanvas() 在画布尺寸没变时会提前 return，把 drawCrop() 一起跳过，
         * 结果是「选了照片但裁剪区还是空白，拖一下才出图」。这里补一次强制重绘。 */
        drawCrop();
        schedulePreview();
        toast('已载入 ' + bmp.width + ' × ' + bmp.height +
              (PICK_ORIENT === 'auto' ? (isPortrait(S.orient) ? ' · 竖图进竖屏相册' : ' · 横图进横屏相册') : ''));
      })
      .catch(function () {
        toast('这张图浏览器无法解码（HEIC 需转换）', true);
      });
  }

  /* ================= 抖动与预览 ================= */

  /* 两块画布，用途分开：
   *   pv/pctx  —— 创作预览：选了本地照片才有内容，没选就显示「等待选择图片」；
   *   dc/dctx  —— 屏幕显示：设备里当前那张照片，按现在选的版式/方向画出来。
   *
   * 下面的绘制函数（信息条、月历、天气版式）都是直接写 pctx/pv/S.idx 的，
   * 不打算为了两块画布给每个函数都加参数 —— 用 withTarget() 临时换目标，
   * 画完自动换回来，效果一样，改动面小得多。 */
  var pv = $('#previewCanvas');
  var pctx = pv.getContext('2d', { willReadFrequently: true });
  var dc = $('#devCanvas');
  var dctx = dc ? dc.getContext('2d', { willReadFrequently: true }) : null;
  var timer = null;

  function withTarget(ctx, canvas, idx, fn) {
    var oc = pctx, ov = pv, oi = S.idx;
    pctx = ctx; pv = canvas; S.idx = idx;
    try { fn(); } finally { pctx = oc; pv = ov; S.idx = oi; }
  }

  function currentLayout() {
    return $('#layoutPick').dataset.value || 'B';
  }

  function schedulePreview() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      renderPreview();     /* 有本地照片就画创作预览，没有就留空态 */
      paintScreenView();   /* 屏幕显示永远按当前「布局 / 方向 / 信息栏」重画 */
    }, 90);
  }

  function sampleCrop(bmp, crop, W, H, mode, fill) {
    mode = mode || S.cropMode;
    fill = fill || S.fill;
    var mid = document.createElement('canvas');
    mid.width = W * 2; mid.height = H * 2;
    var m = mid.getContext('2d');
    m.imageSmoothingEnabled = true;
    m.imageSmoothingQuality = 'high';
    if (mode === 'free') {
      m.fillStyle = fill === 'black' ? '#000000' : '#ffffff';
      m.fillRect(0, 0, mid.width, mid.height);
      var scale = Math.min(mid.width / crop.w, mid.height / crop.h);
      var dw = crop.w * scale, dh = crop.h * scale;
      m.drawImage(bmp, crop.x, crop.y, crop.w, crop.h,
        (mid.width - dw) / 2, (mid.height - dh) / 2, dw, dh);
    } else {
      m.drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, mid.width, mid.height);
    }

    var out = document.createElement('canvas');
    out.width = W; out.height = H;
    var o = out.getContext('2d', { willReadFrequently: true });
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = 'high';
    o.drawImage(mid, 0, 0, W, H);
    return o.getImageData(0, 0, W, H);
  }

  /* 逻辑索引 → 物理帧索引（800×480）。
   * 竖屏整幅旋转 90°，方向与固件 frame_rotate() 完全一致：
   *   顺时针（portrait_l）：物理(x,y) = 逻辑(u=y, v=lh-1-x)
   *   逆时针（portrait_r）：物理(x,y) = 逻辑(u=lw-1-y, v=x) */
  function toPhysical(idx, w, h, orient) {
    if (!isPortrait(orient)) return idx;
    var pw = h, ph = w;
    var out = new Uint8Array(pw * ph);
    var cw = orient === 'portrait_r' ? 3 : 1;
    for (var y = 0; y < ph; y++) {
      for (var x = 0; x < pw; x++) {
        var su, sv;
        if (cw === 1) { su = y; sv = h - 1 - x; }
        else          { su = w - 1 - y; sv = x; }
        out[y * pw + x] = idx[sv * w + su];
      }
    }
    return out;
  }

  /* 物理帧 → 逻辑帧，toPhysical() 的逆运算。
   * 设备存的是物理帧（屏怎么排就怎么存），竖屏照片在横屏网格里是躺着的；
   * 想让预览"正着看"，就得按相反方向转回来。 */
  function toLogical(phys, orient) {
    if (!isPortrait(orient)) return phys;
    var w = 480, h = 800;                    /* 竖屏逻辑尺寸 */
    var out = new Uint8Array(w * h);
    var cw = orient === 'portrait_r' ? 3 : 1;
    for (var y = 0; y < 480; y++) {           /* 物理 y */
      for (var x = 0; x < 800; x++) {         /* 物理 x */
        var lx = (cw === 1) ? y : (479 - y);
        var ly = (cw === 1) ? (799 - x) : x;
        out[ly * w + lx] = phys[y * 800 + x];
      }
    }
    return out;
  }

  /* ================= 打开网页先看「屏上现在是什么」 =================
   *
   * 以前预览区是一块「等待照片」的空白，登录进来完全看不出设备当前显示什么，
   * 要等自己选了照片才知道排版对不对。现在改用设备里那张当前照片的 4bpp 全帧，
   * 再叠一层信息条 —— 与真机落屏同构，登录即见当前画面。
   *
   * 一旦用户选了新照片（S.bitmap 有值），这条路径就让位，不再覆盖。 */
  function setPreviewEmpty(title, sub) {
    var el = $('#previewEmpty');
    if (!el) return;
    var strong = el.querySelector('strong');
    if (strong) strong.textContent = title || '等待照片';
    var sp = el.querySelector('span');
    if (sub) {
      if (!sp) { sp = document.createElement('span'); el.appendChild(sp); }
      sp.textContent = sub;
    } else if (sp) {
      sp.textContent = '';
    }
    el.hidden = false;
  }

  /* 用缓存下来的设备帧重画一遍（换版式、换方向时都走这里） */
  /* 屏幕显示：把设备当前那张照片按**现在选的布局/方向**画出来。
   *
   * 解码方向按照片自己的存盘方位（S.devPhotoOrient），画布尺寸与信息栏位置
   * 跟当前选的站姿（S.orient）。解码一次要扫 38 万像素，所以缓存住，
   * 只有「照片换了 / 方向换了」才重算。 */
  function paintScreenView() {
    if (!dctx) return false;

    if (!S.devPhys) {
      if ($('#devEmpty')) {
        $('#devEmpty').hidden = false;
        var st = $('#devEmpty strong');
        if (st) st.textContent = Api.isOnline() ? '读不到屏幕画面' : '未连接设备';
      }
      if ($('#devMeta')) $('#devMeta').textContent = '—';
      return false;
    }
    if ($('#devEmpty')) $('#devEmpty').hidden = true;

    var use = S.orient;
    var dec = S.devPhotoOrient || use;
    if (isPortrait(dec) !== isPortrait(use)) dec = use;   /* 跨相册时以画布为准 */

    if (!S.devIdx || S.devIdxUse !== use || S.devIdxDec !== dec) {
      S.devIdx = toLogical(S.devPhys, dec);
      S.devIdxUse = use;
      S.devIdxDec = dec;
    }

    var L = logiSize(use);
    if (dc.width !== L.w || dc.height !== L.h) {
      dc.width = L.w;
      dc.height = L.h;
    }
    dctx.putImageData(Dither.toImageData(S.devIdx, L.w, L.h), 0, 0);

    withTarget(dctx, dc, S.devIdx, function () {
      if (currentLayout() === 'B') {
        drawInfoBar();
        drawBdayBanner();
      } else if (currentLayout() === 'C') {
        drawClimatePreview(L.w, L.h);
      }
    });

    if ($('#devFrame')) $('#devFrame').classList.toggle('portrait', isPortrait(use));
    if ($('#devMeta')) {
      $('#devMeta').textContent = L.w + ' × ' + L.h + ' · 设备当前照片';
    }
    return true;
  }

  /* 兼容旧名字：external 还有几处调 paintDeviceScreen */
  function paintDeviceScreen() { return paintScreenView(); }

  function loadDeviceScreen() {
    if (!Api.isOnline() || S.bitmap) return Promise.resolve();
    return Api.listPhotos(S.orient).then(function (res) {
      var id = res && res.current;
      if (!id) {
        S.devPhys = null; S.devIdx = null;
        paintScreenView();                 /* 显示「读不到屏幕画面」占位 */
        return null;
      }
      /* 这张照片存盘时的方位（landscape / portrait_l / portrait_r），
       * 解码要按它来，不能按设备现在站在哪一边。 */
      var po = null;
      (res.items || []).forEach(function (it) { if (it && it.id === id) po = it.orient; });
      return Api.photoFrame(id, S.orient).then(function (phys) {
        if (!phys) { S.devPhys = null; S.devIdx = null; paintScreenView(); return; }
        if (S.bitmap) return;                 /* 拉取期间用户已选了新照片，别覆盖 */
        S.devPhys = phys;
        S.devId = id;
        S.devOrient = S.orient;
        S.devPhotoOrient = po;
        S.devIdx = null;
        paintScreenView();
      });
    }).catch(function () {});
  }

  function renderPreview() {
    if (!S.bitmap) return;
    var opt = {
      algo: $('#optAlgo').value,
      strength: parseFloat($('#optStrength').value),
      sat: parseFloat($('#optSat').value),
      contrast: parseFloat($('#optContrast').value)
    };
    $('#valStrength').textContent = opt.strength.toFixed(2);
    $('#valSat').textContent = (opt.sat > 0 ? '+' : '') + opt.sat + '%';
    $('#valContrast').textContent = (opt.contrast > 0 ? '+' : '') + opt.contrast + '%';

    var L = logiSize(S.orient);
    if (pv.width !== L.w || pv.height !== L.h) {
      pv.width = L.w;
      pv.height = L.h;
    }

    var src = sampleCrop(S.bitmap, S.crop, L.w, L.h);
    var t0 = performance.now();
    S.idx = Dither.convert(src, opt);
    var ms = Math.round(performance.now() - t0);
    S.phys = toPhysical(S.idx, L.w, L.h, S.orient);
    S.packed = Dither.pack4(S.phys);
    S.thumb = makeThumb(S.phys);

    pctx.putImageData(Dither.toImageData(S.idx, L.w, L.h), 0, 0);
    if (currentLayout() === 'B') {
      drawInfoBar();
      drawBdayBanner();
    } else if (currentLayout() === 'C') {
      drawClimatePreview(L.w, L.h);
    }
    if ($('#previewEmpty')) $('#previewEmpty').hidden = true;
    $('#previewFrame').classList.toggle('portrait', isPortrait(S.orient));

    $('#metaPixels').textContent = L.w + ' × ' + L.h + ' · ' + ms + ' ms';
  }

  /* 缩略图恒为 160×96（5:1 抽样物理帧），与固件 frame_make_thumb 同一规则 */
  function makeThumb(physIdx) {
    var tw = 160, th = 96;
    var out = new Uint8Array(tw * th);
    for (var y = 0; y < th; y++) {
      for (var x = 0; x < tw; x++) {
        out[y * tw + x] = physIdx[(y * 5) * 800 + x * 5];
      }
    }
    return Dither.pack4(out);
  }

  /* 预览信息条：交给 bar.js 逐像素绘制，与固件版式 B / Bp 同构 */
  var TEMP_SAMPLE = 23.4;
  var HUM_SAMPLE = 45;
  /* 电量百分比：-1 / null 表示不知道（硬件没做 ADC）。信息条靠它决定
   * 时间前是画水怪、画印章，还是画一个空电池 */
  var BAT_PCT = -1;
  /* 上次把本机时间推给设备的时刻（秒），以及本次打开页面是否已提示过 */
  var LAST_TIME_SYNC = 0, TIME_SYNC_TOLD = false;
  /* 想看生日横幅长什么样：页面地址加 ?bday=1 */
  var FORCE_BDAY = /[?&]bday=1/.test(location.search);

  function barMode() { return isPortrait(S.orient) ? 'portrait' : 'landscape'; }

  /* 与固件 power_bat_pct() 同一组折点。老固件（不返回 battery_pct）时用它兜底，
   * 保证"演示预览"和"真机"在同一个电压下选同一个图标。 */
  var BAT_CURVE = [
    [4200, 100], [4100, 94], [4020, 84], [3950, 72], [3880, 58],
    [3800, 42], [3740, 30], [3680, 18], [3600, 9], [3500, 4], [3300, 0]
  ];

  function batPctOf(s) {
    if (s && typeof s.battery_pct === 'number') return s.battery_pct;   /* -1 = 不支持 */
    var mv = s && s.battery_mv;
    if (!mv || mv <= 0) return -1;
    if (mv >= BAT_CURVE[0][0]) return 100;
    for (var i = 1; i < BAT_CURVE.length; i++) {
      if (mv >= BAT_CURVE[i][0]) {
        var dv = BAT_CURVE[i - 1][0] - BAT_CURVE[i][0];
        var dp = BAT_CURVE[i - 1][1] - BAT_CURVE[i][1];
        return BAT_CURVE[i][1] + Math.floor((mv - BAT_CURVE[i][0]) * dp / dv);
      }
    }
    return 0;
  }

  /* ================= 温湿度 / 天气版式预览 =================
   *
   * 与固件 sdcard/layout/C.json、Cp.json 一一对应：坐标、字号、颜色都是抄
   * 那两份 JSON 的。改版式时两边必须一起改 —— 这一条以前吃过亏：预览好看，
   * 屏上是另一套。
   *
   * 两种形态：
   *   wx.ok  → 有预报：今天天气 / 机身温湿度两栏 / 未来三天，底部日期与数据时刻
   *   否则    → 没网：上半温度、下半湿度，各带一个相对上次刷新量的变化量
   */
  var WX_INK = '#111412';
  /* 黑夜模式的"墨"：和固件调色板里的白一致，压在 #0d0d0d 底上 */
  var NIGHT_INK = '#f7f6f2';
  /* 近 24 小时温度：从 /api/status 拿，拿不到就用示例曲线（离线预览） */
  var TEMP_HIST = null;
  var HUM_HIST = null;
  var WX_BLUE = '#3f6f8f';
  var WX_RED = '#b84b38';
  var WX_YELLOW = '#d1a938';

  /* 离线演示用的一份样例预报：没连设备时也能看出三行版长什么样 */
  var WX_DEMO = {
    ok: true, place: 'GUANGZHOU', text: 'PARTLY CLOUDY', code: 2,
    hi: 26, lo: 18,
    days: [{ code: 2, hi: 25, lo: 17 }, { code: 61, hi: 22, lo: 16 }, { code: 0, hi: 27, lo: 19 }]
  };

  /* 设备报上来的天气（/api/status 的 weather 字段）；没有就是 null */
  var WX_LIVE = null;
  /* 上一次刷新的读数，来自 /api/status；null 表示设备也没记住 */
  var PREV_T = null, PREV_H = null;

  function wxGroup(code) {
    if (code === 0) return 0;
    if (code === 1 || code === 2) return 1;
    if (code === 3) return 2;
    if (code === 45 || code === 48) return 3;
    if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 4;
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 5;
    if (code >= 95) return 6;
    return 2;
  }

  function wxTextOf(code) {
    switch (wxGroup(code)) {
    case 0: return 'CLEAR';
    case 1: return 'PARTLY CLOUDY';
    case 2: return 'CLOUDY';
    case 3: return 'FOGGY';
    case 4: return (code >= 51 && code <= 57) ? 'DRIZZLE' : (code >= 80 && code <= 82 ? 'SHOWERS' : 'RAIN');
    case 5: return 'SNOW';
    case 6: return 'THUNDER';
    default: return 'CLOUDY';
    }
  }

  var WD_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  function wxData() {
    if (WX_LIVE && WX_LIVE.ok) return WX_LIVE;
    if (!Api.isOnline()) return WX_DEMO;
    return { ok: false };
  }

  /* 与固件 wxicon.c 同一套形状：圆 + 矩形拼出来，颜色也一致 */
  function wxIcon(x, y, s, group) {
    var g = pctx;
    var cx = x + s / 2, cy = y + s / 2;
    function rad(r, col) {
      g.fillStyle = col;
      g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.fill();
    }
    function cloud(bx, by, bw, bh, col) {
      g.fillStyle = col;
      var b = by + bh * 0.60;
      g.fillRect(bx + bw * 0.18, b, bw * 0.64, bh * 0.16);
      g.beginPath();
      g.arc(bx + bw * 0.32, b, bw * 0.17, 0, 6.2832);
      g.arc(bx + bw * 0.50, b - bh * 0.10, bw * 0.23, 0, 6.2832);
      g.arc(bx + bw * 0.68, b, bw * 0.16, 0, 6.2832);
      g.fill();
    }
    function rays(r) {
      g.strokeStyle = WX_YELLOW;
      g.lineWidth = Math.max(2, Math.round(s / 14));
      g.lineCap = 'round';
      for (var i = 0; i < 8; i++) {
        var dx = [1, 1, 0, -1, -1, -1, 0, 1][i], dy = [0, 1, 1, 1, 0, -1, -1, -1][i];
        g.beginPath();
        g.moveTo(cx + dx * r * 1.35, cy + dy * r * 1.35);
        g.lineTo(cx + dx * r * 1.75, cy + dy * r * 1.75);
        g.stroke();
      }
    }
    switch (group) {
    case 0:
      rad(s * 0.26, WX_YELLOW); rays(s * 0.26);
      break;
    case 1:
      g.fillStyle = WX_YELLOW;
      g.beginPath(); g.arc(x + s * 0.34, y + s * 0.34, s * 0.20, 0, 6.2832); g.fill();
      cloud(x + s * 0.40, y + s * 0.34, s * 0.60, s * 0.56, WX_INK);
      break;
    case 2:
      cloud(x, y + s * 0.06, s * 0.72, s * 0.60, WX_INK);
      cloud(x + s * 0.26, y + s * 0.26, s * 0.74, s * 0.64, WX_BLUE);
      break;
    case 3:
      g.fillStyle = WX_INK;
      for (var i2 = 0; i2 < 3; i2++) {
        var lw = i2 === 1 ? s * 0.74 : s * 0.92;
        g.fillRect(x + (s - lw) / 2, y + s * (0.24 + 0.24 * i2), lw, Math.max(2, s / 14 + 2));
      }
      break;
    case 4:
      cloud(x, y, s, s * 0.62, WX_INK);
      g.strokeStyle = WX_BLUE; g.lineWidth = Math.max(2, Math.round(s / 12)); g.lineCap = 'round';
      for (var i3 = 0; i3 < 3; i3++) {
        var bx3 = x + s * (0.26 + 0.20 * i3);
        g.beginPath(); g.moveTo(bx3, y + s * 0.70); g.lineTo(bx3 - s * 0.06, y + s * 0.96); g.stroke();
      }
      break;
    case 5:
      cloud(x, y, s, s * 0.62, WX_INK);
      g.fillStyle = WX_BLUE;
      for (var i4 = 0; i4 < 3; i4++) {
        g.beginPath(); g.arc(x + s * (0.26 + 0.20 * i4), y + s * 0.84, Math.max(2, s / 14 + 1), 0, 6.2832); g.fill();
      }
      break;
    default:
      cloud(x, y, s, s * 0.60, WX_INK);
      g.strokeStyle = WX_RED; g.lineWidth = Math.max(3, Math.round(s / 10)); g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x + s * 0.54, y + s * 0.58);
      g.lineTo(x + s * 0.42, y + s * 0.80);
      g.lineTo(x + s * 0.58, y + s * 0.78);
      g.lineTo(x + s * 0.46, y + s * 0.99);
      g.stroke();
      break;
    }
  }

  /* 小图标：温度计 / 水滴。与固件的 glyph 图元同一套画法，
   * 尺寸跟着 box 走 —— 44 就是 44，想跟 48 号数字等高也不会模糊。 */
  function thermoIcon(x, y, s, col) {
    /* 与固件 draw_thermo_glyph() 同一套几何：细管（s/7）、圆球（2s/7）、
     * 顶部圆头 + 两条 1px 管壁 + 液柱 + 右侧三档刻度。
     * 以前是「0.22 宽实心管 + 0.34 球」，在 46px 的框里就是一根胖棒子。 */
    var bg = (WB_THEME === 'night') ? '#0d0d0d' : '#f7f6f2';
    var tubeW = Math.max(4, Math.min(8, Math.round(s / 7)));
    var r = Math.max(9, Math.round(s * 2 / 7));
    var cx = x + Math.round(s / 2) - 2;
    var top = y + 2;
    var bulbCy = y + s - r - 1;
    var headR = Math.round(tubeW / 2) + (tubeW % 2);

    pctx.fillStyle = col;
    pctx.beginPath(); pctx.arc(cx, top + headR, headR, 0, 6.2832); pctx.fill();
    pctx.fillStyle = bg;
    pctx.beginPath(); pctx.arc(cx, top + headR, Math.max(1, headR - 1), 0, 6.2832); pctx.fill();

    pctx.fillStyle = col;
    pctx.fillRect(cx - headR, top + headR, 1, bulbCy - top - headR);
    pctx.fillRect(cx + headR, top + headR, 1, bulbCy - top - headR);

    pctx.beginPath(); pctx.arc(cx, bulbCy, r, 0, 6.2832); pctx.fill();
    pctx.fillStyle = bg;
    pctx.beginPath(); pctx.arc(cx, bulbCy, Math.max(1, r - 3), 0, 6.2832); pctx.fill();

    var liq = Math.max(6, Math.round((bulbCy - top) * 0.6));
    var lw = Math.max(3, tubeW - 2);
    pctx.fillStyle = col;
    pctx.fillRect(cx - Math.floor(lw / 2), bulbCy - liq, lw, liq);
    pctx.beginPath(); pctx.arc(cx, bulbCy, Math.max(1, r - 4), 0, 6.2832); pctx.fill();

    for (var i = 1; i <= 3; i++) {
      var ty = top + 4 + Math.round(i * (bulbCy - top - 6) / 4);
      pctx.fillRect(cx + headR + 3, ty, (i === 2) ? 6 : 4, 1);
    }
  }

  function dropIcon(x, y, s, col) {
    /* 圆底 + 短锥帽。之前锥太长、球太小，看着像个气球。 */
    var r = Math.round(s * 0.34);
    var cx = x + s / 2;
    var cy = y + s - r - 1;
    var tipY = y + Math.max(2, s * 0.14);

    pctx.fillStyle = col;
    pctx.beginPath();
    pctx.moveTo(cx, tipY);
    pctx.bezierCurveTo(cx + r * 0.9, cy - r * 0.85, cx + r, cy + r * 0.2, cx, cy + r);
    pctx.bezierCurveTo(cx - r, cy + r * 0.2, cx - r * 0.9, cy - r * 0.85, cx, tipY);
    pctx.fill();
  }

  /* 时间前那个标记：水怪 / 印章 / 空电池 / 弯月。
   * 数据来自 icons.js（和固件 /icons/*.bin 同一份），逐像素落墨。
   * —— 之前预览里根本没有这个函数，调用处每帧抛 ReferenceError，
   *    于是「只有时间、没有水怪小鱼月亮」。 */
  var MARK_PAL = [[13,13,13],[247,246,242],[232,195,23],[179,58,50],[52,80,110],[62,122,62]];
  function drawMarkIcon(name, x, y, box, rgb) {
    var ic = Icons.get(name);
    if (!ic) return;
    var ox = x + Math.floor((box - ic.w) / 2);
    var oy = y + Math.floor((box - ic.h) / 2);
    var base = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
    for (var r = 0; r < ic.h; r++) {
      for (var c = 0; c < ic.w; c++) {
        var col = null;
        if (ic.bpp === 4) {
          var v = ic.idx[r * ic.w + c];
          if (v === 15) continue;
          var q = MARK_PAL[v] || rgb;
          col = 'rgb(' + q[0] + ',' + q[1] + ',' + q[2] + ')';
        } else if (ic.bits[r * ic.w + c]) {
          col = base;
        }
        if (!col) continue;
        pctx.fillStyle = col;
        pctx.fillRect(ox + c, oy + r, 1, 1);
      }
    }
  }

  /* 变化量：升画红上箭头、降画蓝下箭头，数值只打绝对值。
   * val === null 表示这一次没有上一次的读数（刚开机 / 刚换卡）。 */
  function drawDelta(x, y, box, val, isTemp) {
    var ink = (WB_THEME === 'night') ? NIGHT_INK : WX_INK;
    if (typeof val !== 'number' || !isFinite(val)) {
      txt('--', x, y + box * 0.72, 24, ink);
      return;
    }
    var up = val > 0.05, down = val < -0.05;
    var col = up ? WX_RED : down ? WX_BLUE : ink;
    var s = Math.min(box, 34), head = Math.round(s / 2), stemW = Math.max(2, Math.round(s / 4));

    pctx.fillStyle = col;
    for (var j = 0; j < head; j++) {
      var ww = 1 + Math.round((s - 1) * j / Math.max(1, head - 1));
      if (up) pctx.fillRect(x + (s - ww) / 2, y + j, ww, 1);
      else    pctx.fillRect(x + (s - ww) / 2, y + s - 1 - j, ww, 1);
    }
    if (up) pctx.fillRect(x + (s - stemW) / 2, y + head, stemW, s - head);
    else    pctx.fillRect(x + (s - stemW) / 2, y, stemW, s - head);

    var a = Math.abs(val);
    txt(isTemp ? a.toFixed(1) : String(Math.round(a)), x + s + 6, y + s * 0.72, 24, col);
  }

  function txt(str, x, y, size, col, align) {
    pctx.fillStyle = col || WX_INK;
    pctx.font = 'bold ' + size + 'px monospace';
    pctx.textAlign = align || 'left';
    pctx.fillText(str, x, y);
    pctx.textAlign = 'left';
  }

  function fmtDelta(v, dec) {
    if (typeof v !== 'number' || !isFinite(v)) return '--';
    return (v >= 0 ? '+' : '') + (dec ? v.toFixed(1) : String(Math.round(v)));
  }

  /* 月历：与固件 layout.c 的 draw_calendar() 同一套几何 —— 标题 + 一条细线 +
   * 星期表头 + 6 行日期；今天用圆角胶囊，周日红、周六蓝。
   * night=true 时黑底白字，今天改黄胶囊黑字（和固件一致）。 */
  function drawCalendar(x, y, w, h, now, size, night) {
    var MON3 = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    var WD3 = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    var ink = night ? NIGHT_INK : WX_INK;
    var titleH = size + 8, headH = size + 6, rows = 6;
    var cw = Math.floor(w / 7);
    var ch = Math.floor((h - titleH - headH) / rows);
    if (ch < 12) return;

    txt(MON3[now.getMonth()] + ' ' + now.getFullYear(), x + w / 2, y + titleH / 2, size, ink, 'center');
    pctx.fillStyle = ink;
    pctx.fillRect(x, y + titleH - 2, w, 1);

    for (var c = 0; c < 7; c++) {
      txt(WD3[c], x + c * cw + cw / 2, y + titleH + headH / 2, size,
          c === 0 ? WX_RED : (c === 6 ? WX_BLUE : ink), 'center');
    }

    var first = new Date(now.getFullYear(), now.getMonth(), 1);
    var firstWd = first.getDay();
    var dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    for (var d = 1; d <= dim; d++) {
      var slot = firstWd + d - 1;
      var r = Math.floor(slot / 7), col = slot % 7;
      if (r >= rows) break;
      var cx = x + col * cw, cy = y + titleH + headH + r * ch;
      var today = (d === now.getDate());
      if (today) {
        var bw = Math.min(String(d).length * size * 0.62 + 16, cw - 6);
        var bh = Math.min(ch - 6, size + 10);
        roundRect(cx + (cw - bw) / 2, cy + (ch - bh) / 2, bw, bh, bh / 2,
                  night ? '#e8c317' : WX_RED);
      }
      txt(String(d), cx + cw / 2, cy + ch / 2, size,
          today ? (night ? '#0d0d0d' : '#ffffff')
                : (col === 0 ? WX_RED : (col === 6 ? WX_BLUE : ink)), 'center');
    }
  }

  function roundRect(x, y, w, h, r, fill) {
    pctx.fillStyle = fill;
    pctx.beginPath();
    if (pctx.roundRect) {
      pctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
    } else {
      pctx.rect(x, y, w, h);
    }
    pctx.fill();
  }

  /* ---------- 底部花草 / 天气氛围带 ----------
   * 与固件 draw_scenery() 同构：一条地平线 + 左右两丛草 + 两朵花；
   * 取到天气时中间换成对应氛围（晴=太阳、多云=云+日、雨=云+雨滴、雪=云+雪点）。
   * 夜里所有"墨色"都换成 NIGHT_INK，否则黑底上看不见。 */
  /* 底部花草带：与固件 layout.c 的 draw_scenery() 同一套几何。
   * 草更高更密（每侧三丛、每丛五片），四朵带茎带叶的花，中间留给天气氛围。
   * 所有坐标按宽高比例给，440 宽和 760 宽都铺得满。 */
  function drawScenery(x, y, w, h, night, wx, code) {
    if (w < 60 || h < 24) return;
    var ink = night ? NIGHT_INK : WX_INK;
    var GREEN = '#3e7a3e', YELLOW = '#e8c317';
    var base = y + h - 1;

    pctx.fillStyle = ink;
    pctx.fillRect(x, base, w, 1);
    if (h >= 40) pctx.fillRect(x, base - 2, w, 1);

    function circle(cx, cy, r, col) {
      pctx.fillStyle = col;
      pctx.beginPath();
      pctx.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2);
      pctx.fill();
    }
    function cloud(cx, cy, r, col) {
      circle(cx - r, cy, r * 0.75, col);
      circle(cx + r, cy, r * 0.75, col);
      circle(cx, cy - r / 2, r, col);
      pctx.fillStyle = col;
      pctx.fillRect(cx - r, cy, r * 2, r * 0.75);
    }
    function blade(bx, by, bh, lean) {
      pctx.fillStyle = GREEN;
      var den = Math.max(1, bh * bh / 2);
      for (var t = 0; t < bh; t++) {
        pctx.fillRect(bx + Math.round(lean * t * t / den), by - t, t < bh / 3 ? 2 : 1, 1);
      }
    }

    /* 天气氛围 */
    if (wx && wx.ok) {
      var cx = x + w / 2, cy = y + h / 2 - 1;
      var r = Math.max(9, Math.min(24, Math.floor(h / 3)));
      if (code <= 1) {
        circle(cx, cy, r * 0.75, YELLOW);
        var DX = [1, -1, 0, 0, 1, -1, 1, -1], DY = [0, 0, 1, -1, 1, 1, -1, -1];
        pctx.fillStyle = YELLOW;
        for (var a = 0; a < 8; a++) pctx.fillRect(cx + DX[a] * (r + 1), cy + DY[a] * (r + 1), 3, 3);
      } else if (code <= 3) {
        cloud(cx - r / 3, cy, r * 0.75, ink);
        circle(cx + r * 0.75, cy - r / 3, r / 2, YELLOW);
      } else if (code >= 45 && code <= 48) {
        pctx.fillStyle = ink;
        for (var i2 = 0; i2 < 3; i2++) pctx.fillRect(cx - r, cy - r / 2 + i2 * (r / 2 + 1), r * 2, 1);
      } else if (code >= 51 && code <= 67) {
        cloud(cx, cy - r / 3, r * 0.75, ink);
        pctx.fillStyle = WX_BLUE;
        for (var i3 = 0; i3 < 4; i3++) pctx.fillRect(cx - r + i3 * (r * 2 / 3), cy + r / 2, 2, r / 2);
      } else if (code >= 71 && code <= 86) {
        cloud(cx, cy - r / 3, r * 0.75, ink);
        pctx.fillStyle = WX_BLUE;
        for (var i4 = 0; i4 < 5; i4++) pctx.fillRect(cx - r + i4 * (r / 2), cy + r / 2 + (i4 % 2) * 4, 3, 3);
      } else {
        cloud(cx, cy - r / 3, r * 0.75, ink);
        pctx.fillStyle = WX_RED;
        for (var t2 = 0; t2 < r / 2; t2++) pctx.fillRect(cx - t2 / 2 + (t2 > r / 4 ? 3 : 0), cy + t2, 2, 1);
      }
    }

    /* 草丛：左右各三丛、每丛五片 */
    var ghMax = Math.min(h - 6, Math.floor(h * 4 / 5));
    var FL = [2, 6, 10], FR = [98, 94, 90];
    for (var c2 = 0; c2 < 3; c2++) {
      var lx = x + w * FL[c2] / 100;
      var rx = x + w * FR[c2] / 100;
      for (var i = 0; i < 5; i++) {
        var dh = ghMax - (i % 3) * Math.floor(ghMax / 5);
        if (dh < 4) dh = 4;
        var step = Math.floor(w / 90) + 2;
        blade(lx + i * step, base - 2, dh, (i & 1) ? (Math.floor(dh / 3) + 2) : -(Math.floor(dh / 3) + 2));
        blade(rx - i * step, base - 2, dh, (i & 1) ? -(Math.floor(dh / 3) + 2) : (Math.floor(dh / 3) + 2));
      }
    }

    /* 四朵花：茎微歪 + 两片叶 + 四瓣花 */
    var FX = [18, 28, 72, 82];
    var PC = [YELLOW, WX_RED, WX_BLUE, YELLOW];
    var fr = Math.max(5, Math.min(12, Math.floor(h / 8)));
    for (var k = 0; k < 4; k++) {
      var fx = x + w * FX[k] / 100;
      var stem = base - 2 - (Math.floor(h * 3 / 5) + (k & 1) * Math.floor(h / 8));
      if (stem < y + fr * 2) stem = y + fr * 2;
      var lean2 = (k < 2) ? 1 : -1;
      var span = base - 2 - stem;
      pctx.fillStyle = GREEN;
      for (var t3 = 0; t3 <= span; t3++) {
        pctx.fillRect(fx + Math.round(lean2 * t3 * t3 / (base - stem + 1)), base - 2 - t3, 2, 1);
      }
      var ly = base - 2 - Math.floor(span / 3);
      for (var t4 = 0; t4 < fr; t4++) pctx.fillRect(fx - 1 - t4 + lean2, ly + t4, 2, 1);
      for (var t5 = 0; t5 < fr; t5++) pctx.fillRect(fx + 1 + t5 + lean2, ly + t5 + 2, 2, 1);

      var pcx = fx + lean2 * 2;
      circle(pcx, stem - fr, fr * 2 / 3, PC[k]);
      circle(pcx - fr, stem, fr * 2 / 3, PC[k]);
      circle(pcx + fr, stem, fr * 2 / 3, PC[k]);
      circle(pcx, stem + fr, fr * 2 / 3, PC[k]);
      circle(pcx, stem, Math.max(1, fr / 2 + 1), ink);
    }
  }

  /* 预览里每一段都单独 try 一次。
   * 之前有个 bug 让某一段抛异常，整幅预览只剩一个时间 —— 排查时完全看不出
   * 是哪一块挂的。分段之后最坏情况是"缺一块"，其余照画，也能一眼定位。 */
  function safeDraw(tag, fn) {
    try { fn(); } catch (e) {
      if (window.console && console.warn) console.warn('[preview] ' + tag, e);
    }
  }

  /* 24 小时折线（温度红 / 湿度蓝）：与固件 layout.c 的 draw_env_chart() 同一套算法。
   * 缺数据的格沿用上一个值，但线段画虚线（画 3 停 3）；
   * 最高/最低在对应点旁边标数值；横轴每 6 小时一个小刻度。 */
  function drawEnvChart(x, y, w, h, hist, isTemp) {
    var night = WB_THEME === 'night';
    var ink = night ? NIGHT_INK : WX_INK;
    var col = isTemp ? WX_RED : WX_BLUE;

    var vals = [], gaps = [], last = null, any = false, lo = 1e9, hi = -1e9;
    for (var i = 0; i < 24; i++) {
      var v = (hist && typeof hist[i] === 'number') ? hist[i] : null;
      if (v !== null) {
        last = v; any = true; gaps.push(false); vals.push(v);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      } else {
        gaps.push(true);
        vals.push(last === null ? 0 : last);
      }
    }
    if (!any) { txt('24H  --', x, y + h / 2, 16, ink); return; }

    var minSpan = isTemp ? 2 : 8;
    if (hi - lo < minSpan) { var mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }

    var left = x + 2, right = x + w - 4, top = y + 16, bot = y + h - 20;
    if (right - left < 24 || bot - top < 14) return;

    pctx.fillStyle = ink;
    pctx.fillRect(left, bot + 1, right - left + 1, 1);
    for (var t = 0; t < 24; t += 6) {
      var tx = left + Math.round((right - left) * t / 23);
      pctx.fillRect(tx, bot + 2, 2, 4);
    }

    function seg(x0, y0, x1, y1, dash) {
      var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      var err = dx - dy, n = 0;
      pctx.fillStyle = col;
      for (;;) {
        if (!dash || Math.floor(n / dash) % 2 === 0) pctx.fillRect(x0, y0, 2, 2);
        if (x0 === x1 && y0 === y1) break;
        var e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx)  { err += dx; y0 += sy; }
        n++;
      }
    }

    function yOf(v) {
      var yy = bot - Math.round((v - lo) * (bot - top) / (hi - lo));
      return Math.min(bot, Math.max(top, yy));
    }

    var px = 0, py = 0;
    for (var k = 0; k < 24; k++) {
      var cx = left + Math.round((right - left) * k / 23);
      var cy = yOf(vals[k]);
      if (k > 0) seg(px, py, cx, cy, gaps[k] ? 3 : 0);
      px = cx; py = cy;
    }
    pctx.fillStyle = col;
    pctx.beginPath(); pctx.arc(right, py, 2, 0, 6.2832); pctx.fill();

    /* 最高/最低：在点旁标数值 */
    var maxI = 0, minI = 0;
    for (var m = 0; m < 24; m++) {
      if (gaps[m]) continue;
      if (vals[m] >= hi) maxI = m;
      if (vals[m] <= lo) minI = m;
    }
    [maxI, minI].forEach(function (idx, k2) {
      var v = vals[idx];
      var cx2 = left + Math.round((right - left) * idx / 23);
      var cy2 = yOf(v);
      var lab = isTemp ? v.toFixed(1) : String(Math.round(v));
      var lx = Math.max(x, Math.min(x + w - 46, cx2 - 23));
      var ly = (k2 === 0) ? (y + 11) : (y + h - 7);
      txt(lab, lx + 23, ly, 16, col, 'center');
    });
  }

  /* 离线时的示例曲线：一天里缓慢起伏，故意留两段缺口演示虚线 */
  function demoHist(isTemp) {
    var out = [];
    for (var i = 0; i < 24; i++) {
      var gap = (i >= 9 && i <= 11);
      if (isTemp) {
        var t = 19.5 + 3.2 * Math.sin((i - 4) / 24 * 6.2832) + (i % 5) * 0.12;
        out.push(gap ? null : Math.round(t * 10) / 10);
      } else {
        var hh = 52 + 18 * Math.sin((i - 10) / 24 * 6.2832);
        out.push(gap ? null : Math.round(hh));
      }
    }
    return out;
  }

  /* ---------- 工作台预览（联网形态）----------
   * 坐标与 sdcard/layout/C.json / Cp.json 的 wx 图层一一对应。
   * 时间居中在顶部、标记在右上、底部一条花草带 —— 这三件事必须和固件一致，
   * 否则"预览即实物"就成了谎话。
   * 白天/黑夜只切 ink 与背景，彩色（红高低温、蓝湿度、黄太阳）都保留。 */
  function drawClimateWx(portrait, wx, now) {
    var night = WB_THEME === 'night';
    var ink = night ? NIGHT_INK : WX_INK;
    var temp = TEMP_SAMPLE.toFixed(1);
    var hum = String(Math.round(HUM_SAMPLE));
    var hh = pad2(now.getHours()) + 'H';
    var mk = InfoBar.markOf(now, BAT_PCT, false);
    var wtext = wx.text || wxTextOf(wx.code);
    var dT = (PREV_T === null) ? null : (TEMP_SAMPLE - PREV_T);
    var dH = (PREV_H === null) ? null : (HUM_SAMPLE - PREV_H);

    if (portrait) {
      /* 顶部只留时钟 */
      safeDraw('time', function () { txt(hh, 240, 46, 48, ink, 'center'); });
      /* 第二行：左天气、右标记（标记原来在时钟右边，挤在一起） */
      safeDraw('marks', function () { drawMarkIcon(mk.icon, 420, 92, 36, mk.rgb); });
      safeDraw('weather', function () {
        wxIcon(20, 94, 48, wxGroup(wx.code));
        txt(wtext, 78, 112, 24, ink);
        txt(wx.place || '', 78, 138, 16, WX_BLUE);
        txt('H ' + Math.round(wx.hi), 400, 110, 24, WX_RED, 'right');
        txt('L ' + Math.round(wx.lo), 400, 138, 24, WX_BLUE, 'right');
        pctx.fillStyle = ink; pctx.fillRect(20, 150, 440, 1);
      });
      safeDraw('sensor', function () {
        txt('INDOOR TEMP', 78, 171, 16, ink);
        thermoIcon(24, 182, 46, ink);
        txt(temp, 220, 222, 48, ink, 'right');
        txt('C', 226, 226, 24, ink);
        drawEnvChart(252, 156, 172, 94, TEMP_HIST || demoHist(true), true);
        pctx.fillStyle = ink; pctx.fillRect(20, 252, 440, 1);
        txt('REL HUMIDITY', 78, 273, 16, WX_BLUE);
        dropIcon(24, 284, 46, WX_BLUE);
        txt(hum, 160, 320, 48, WX_BLUE, 'right');
        txt('%RH', 164, 320, 24, WX_BLUE);
        drawEnvChart(246, 268, 174, 86, HUM_HIST || demoHist(false), false);
        pctx.fillStyle = ink; pctx.fillRect(20, 354, 440, 1);
      });
      safeDraw('calendar', function () { drawCalendar(20, 360, 440, 330, now, 32, night); });
      safeDraw('scenery', function () { drawScenery(20, 694, 440, 100, night, wx, wx.code); });
      return;
    }

    safeDraw('time', function () { txt(hh, 400, 56, 48, ink, 'center'); });
    safeDraw('marks', function () { drawMarkIcon(mk.icon, 742, 92, 34, mk.rgb); });
    safeDraw('weather', function () {
      wxIcon(20, 92, 48, wxGroup(wx.code));
      txt(wtext, 78, 110, 24, ink);
      txt(wx.place || '', 78, 136, 16, WX_BLUE);
      txt('H ' + Math.round(wx.hi), 686, 108, 24, WX_RED, 'right');
      txt('L ' + Math.round(wx.lo), 686, 136, 24, WX_BLUE, 'right');
      pctx.fillStyle = ink; pctx.fillRect(20, 152, 760, 1);
    });
    safeDraw('sensor', function () {
      txt('INDOOR TEMP', 78, 173, 16, ink);
      thermoIcon(24, 184, 46, ink);
      txt(temp, 230, 228, 48, ink, 'right');
      txt('C', 236, 232, 24, ink);
      drawEnvChart(268, 156, 124, 96, TEMP_HIST || demoHist(true), true);
      pctx.fillStyle = ink; pctx.fillRect(400, 158, 2, 104);
      txt('REL HUMIDITY', 414, 173, 16, WX_BLUE);
      dropIcon(414, 184, 46, WX_BLUE);
      txt(hum, 560, 228, 48, WX_BLUE, 'right');
      txt('%RH', 566, 232, 24, WX_BLUE);
      drawEnvChart(632, 158, 146, 96, HUM_HIST || demoHist(false), false);
      pctx.fillStyle = ink; pctx.fillRect(20, 266, 760, 1);
    });
    safeDraw('calendar', function () { drawCalendar(20, 272, 760, 152, now, 16, night); });
    safeDraw('scenery', function () { drawScenery(20, 428, 760, 48, night, wx, wx.code); });
  }

  /* ---------- 工作台预览（无网形态）----------
   * 与联网形态同一套骨架，只是没有天气那一行。日期与星期不再单独占位 ——
   * 下面的月历已经写清楚了今天几号、星期几。 */
  function drawClimateSensor(portrait, now) {
    var night = WB_THEME === 'night';
    var ink = night ? NIGHT_INK : WX_INK;
    var temp = TEMP_SAMPLE.toFixed(1);
    var hum = String(Math.round(HUM_SAMPLE));
    var dT = (PREV_T === null) ? null : (TEMP_SAMPLE - PREV_T);
    var dH = (PREV_H === null) ? null : (HUM_SAMPLE - PREV_H);
    if (!Api.isOnline() && dT === null) { dT = -0.6; dH = -11; }

    var mk = InfoBar.markOf(now, BAT_PCT, false);
    var hh = pad2(now.getHours()) + 'H';

    if (portrait) {
      safeDraw('time', function () { txt(hh, 240, 46, 48, ink, 'center'); });
      safeDraw('marks', function () { drawMarkIcon(mk.icon, 420, 92, 36, mk.rgb); });
      safeDraw('sensor', function () {
        txt('INDOOR TEMP', 78, 171, 16, ink);
        thermoIcon(24, 182, 46, ink);
        txt(temp, 220, 222, 48, ink, 'right');
        txt('C', 226, 226, 24, ink);
        drawEnvChart(252, 156, 172, 94, TEMP_HIST || demoHist(true), true);
        pctx.fillStyle = ink; pctx.fillRect(20, 252, 440, 1);
        txt('REL HUMIDITY', 78, 273, 16, WX_BLUE);
        dropIcon(24, 284, 46, WX_BLUE);
        txt(hum, 160, 320, 48, WX_BLUE, 'right');
        txt('%RH', 164, 320, 24, WX_BLUE);
        drawEnvChart(246, 268, 174, 86, HUM_HIST || demoHist(false), false);
        pctx.fillStyle = ink; pctx.fillRect(20, 354, 440, 1);
      });
      safeDraw('calendar', function () { drawCalendar(20, 360, 440, 330, now, 32, night); });
      safeDraw('scenery', function () { drawScenery(20, 694, 440, 100, night, null, 0); });
      return;
    }

    safeDraw('time', function () { txt(hh, 400, 56, 48, ink, 'center'); });
    safeDraw('marks', function () { drawMarkIcon(mk.icon, 742, 92, 34, mk.rgb); });
    safeDraw('sensor', function () {
      txt('INDOOR TEMP', 78, 173, 16, ink);
      thermoIcon(24, 184, 46, ink);
      txt(temp, 230, 228, 48, ink, 'right');
      txt('C', 236, 232, 24, ink);
      drawEnvChart(268, 156, 124, 96, TEMP_HIST || demoHist(true), true);
      pctx.fillStyle = ink; pctx.fillRect(400, 158, 2, 104);
      txt('REL HUMIDITY', 414, 173, 16, WX_BLUE);
      dropIcon(414, 184, 46, WX_BLUE);
      txt(hum, 560, 228, 48, WX_BLUE, 'right');
      txt('%RH', 566, 232, 24, WX_BLUE);
      drawEnvChart(632, 158, 146, 96, HUM_HIST || demoHist(false), false);
      pctx.fillStyle = ink; pctx.fillRect(20, 266, 760, 1);
    });
    safeDraw('calendar', function () { drawCalendar(20, 272, 760, 152, now, 16, night); });
    safeDraw('scenery', function () { drawScenery(20, 428, 760, 48, night, null, 0); });
  }

  function drawClimatePreview(W, H) {
    var portrait = H > W;
    var now = new Date();
    var wx = wxData();

    pctx.fillStyle = (WB_THEME === 'night') ? '#0d0d0d' : '#f7f6f2';
    pctx.fillRect(0, 0, W, H);
    pctx.textBaseline = 'middle';
    pctx.textAlign = 'left';
    pctx.fillStyle = WX_INK;

    if (wx.ok) drawClimateWx(portrait, wx, now);
    else       drawClimateSensor(portrait, now);
  }

  /* 免打扰前最后一次刷新：下一个刻度会落进免打扰时段 → 时间前换成黄色弯月。
   * 判据与固件 main.c 的 render_frame() 里那段一模一样（下一步刻度的分钟数落不落在
   * DND 区间），所以预览上看到月亮，设备上就一定也是月亮。 */
  function dndLastNow() {
    var on = $('#setDndOn');
    var sel = $('#setInterval');
    if (!on || !on.checked || !sel) return false;
    var step = (parseInt(sel.value, 10) || 0) * 60;
    if (step <= 0) return false;

    function toMin(v, def) {
      var m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
      return m ? (+m[1] * 60 + +m[2]) : def;
    }
    var s = toMin($('#setDndStart').value, 3 * 60);
    var e = toMin($('#setDndEnd').value, 8 * 60);
    if (s === e) return false;

    var now = new Date();
    var nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    var mm = Math.floor((Math.floor(nowSec / step) + 1) * step % 86400 / 60);
    return s < e ? (mm >= s && mm < e) : (mm >= s || mm < e);
  }

  function drawInfoBar() {
    var g = InfoBar.geo(barMode());
    var img = pctx.createImageData(g.w, g.barH);
    InfoBar.paint(img.data, new Date(), TEMP_SAMPLE, HUM_SAMPLE, barMode(),
                  { batPct: BAT_PCT, dark: BAR_THEME === 'black', dndLast: dndLastNow() });
    pctx.putImageData(img, 0, g.barY);
  }

  function drawBdayBanner() {
    var g = InfoBar.geo(barMode());
    if (!FORCE_BDAY && !InfoBar.isBday(new Date())) return;
    var img = pctx.createImageData(g.w, g.bday.h);
    InfoBar.paintBday(img.data, g.w, g.bday.h);
    pctx.putImageData(img, 0, g.bday.y);
  }

  ['#optAlgo', '#optStrength', '#optSat', '#optContrast'].forEach(function (sel) {
    $(sel).addEventListener('input', schedulePreview);
    $(sel).addEventListener('change', schedulePreview);
  });

  $('#btnResetTune').addEventListener('click', function () {
    $('#optAlgo').value = 'fs';
    $('#optStrength').value = '1';
    $('#optSat').value = '8';
    $('#optContrast').value = '4';
    schedulePreview();
    toast('已恢复推荐参数');
  });

  /* 「色彩与质感」默认收起：这四项是微调，平时用不到，
   * 一直展开会把「应用」「上传」按钮挤到屏幕外。 */
  var tuneHead = $('#tuneHead'), tuneFields = $('#tuneFields');
  function setTuneOpen(open) {
    tuneHead.setAttribute('aria-expanded', open ? 'true' : 'false');
    tuneFields.hidden = !open;
  }
  tuneHead.addEventListener('click', function (e) {
    /* 「恢复默认」就在标题行里，点它不该顺带折叠 */
    if (e.target.closest && e.target.closest('#btnResetTune')) return;
    setTuneOpen(tuneFields.hidden);
  });
  tuneHead.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setTuneOpen(tuneFields.hidden);
    }
  });

  /* 侧栏水怪：原来是个没有事件的死按钮，点了什么都不发生 */
  var BUDDY_LINES = [
    '今天也要开心呀。',
    '水怪在看着你。',
    '记得喝口水。',
    '照片都准备好了。',
    '别熬夜，屏都要睡了。'
  ];
  $('#monsterBuddy').addEventListener('click', function () {
    var el = this;
    var bubble = el.querySelector('.monster-bubble');
    el.classList.remove('duang');
    bubble.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('duang');
    bubble.classList.add('pop');
    toast(BUDDY_LINES[Math.floor(Math.random() * BUDDY_LINES.length)]);
  });
  $('.monster-face img').addEventListener('animationend', function () {
    $('#monsterBuddy').classList.remove('duang');
  });
  $('.monster-bubble').addEventListener('animationend', function () {
    this.classList.remove('pop');
  });

  /* ================= 横竖屏 ================= */

  function orientLabel(o) {
    /* 只剩两种：横放 / 正立。历史配置里可能还留着 portrait_l（倒立），
     * 一律按正立显示 —— 界面上已经不再提供倒立这个选项。 */
    return isPortrait(o) ? '正立' : '横放';
  }

  function syncCropModeUI() {
    $$('#cropMode button').forEach(function (b) {
      var selected = b.dataset.cropMode === S.cropMode;
      b.classList.toggle('sel', selected);
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    $$('#fillPick button').forEach(function (b) {
      var selected = b.dataset.fill === S.fill;
      b.classList.toggle('sel', selected);
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    $('#fillControl').hidden = S.cropMode !== 'free';
    var L = logiSize(S.orient);
    $('#ratioNote').textContent = S.cropMode === 'free'
      ? '自由比例 · ' + (S.fill === 'black' ? '黑底填充' : '白底填充')
      : '输出 ' + L.w + ' × ' + L.h;
  }

  function setCropMode(mode) {
    S.cropMode = mode === 'free' ? 'free' : 'fit';
    if (S.bitmap) {
      initCrop();
      drawCrop();
      schedulePreview();
    }
    syncCropModeUI();
  }

  $$('#cropMode button').forEach(function (b) {
    b.addEventListener('click', function () { setCropMode(b.dataset.cropMode); });
  });
  $$('#fillPick button').forEach(function (b) {
    b.addEventListener('click', function () {
      S.fill = b.dataset.fill === 'black' ? 'black' : 'white';
      syncCropModeUI();
      schedulePreview();
    });
  });

  /* 按照片宽高决定横竖：差值小于 5% 的接近正方形，按横图处理（横屏相册留白更少） */
  function autoOrientFor(bmp) {
    var vertical = bmp.height > bmp.width * 1.05;
    S.orient = vertical ? resolveOrient('portrait') : 'landscape';
    if ($('#orientHint')) $('#orientHint').textContent = vertical ? '竖向' : '横向';
    return S.orient;
  }

  function syncOrientUI() {
    /* 自动档要单独选中；手动档仍是"是不是竖着" */
    $$('#cropOrient button').forEach(function (b) {
      var on = (b.dataset.orient === 'auto')
        ? PICK_ORIENT === 'auto'
        : (PICK_ORIENT !== 'auto' && isPortrait(b.dataset.orient) === isPortrait(S.orient));
      b.classList.toggle('sel', on);
    });
    $$('#orientPick button').forEach(function (b) {
      b.classList.toggle('sel', b.dataset.orient === PICK_ORIENT);
    });
    syncCropModeUI();
    $('#previewFrame').classList.toggle('portrait', isPortrait(S.orient));
    if ($('#devFrame')) $('#devFrame').classList.toggle('portrait', isPortrait(S.orient));
  }

  /* 切换裁剪方向：只影响本地裁剪与预览，不动设备配置 */
  function applyOrient(o) {
    if (o === 'auto') {
      PICK_ORIENT = 'auto';
      if (S.bitmap) autoOrientFor(S.bitmap);
      if (!S.bitmap && $('#orientHint')) $('#orientHint').textContent = '选择照片后自动判断横竖';
      if (S.bitmap) initCrop();
      syncOrientUI();
      layoutCanvas();
      if (S.bitmap) schedulePreview();
      return;
    }
    PICK_ORIENT = o;
    S.orient = o;
    if ($('#orientHint')) $('#orientHint').textContent = '';
    if (S.bitmap) initCrop();
    syncOrientUI();
    layoutCanvas();
    if (S.bitmap) schedulePreview();
    /* 没有本地照片时，预览画的是设备里的当前照片。
     * 照片帧必须让**设备**按新方向重新转一次（/api/photo?orient=），
     * 本地只换解码方向会把同一份物理帧按相反方向解释，转不出正确的横/竖。
     * 设备离线才退回本地解码。 */
    else if (S.devPhys) {
      /* 横↔竖换的是相册，得重拉；正立↔倒立共用一本，字节完全一样，
       * 重拉只是白下一份 192KB。 */
      if (S.devId && Api.isOnline() && isPortrait(o) !== isPortrait(S.devOrient || o)) {
        Api.photoFrame(S.devId, o).then(function (phys) {
          if (phys) { S.devPhys = phys; S.devOrient = o; S.devIdx = null; }
          paintScreenView();
        }).catch(function () { paintScreenView(); });
      } else {
        S.devOrient = o;
        paintScreenView();
      }
    }
  }

  $$('#cropOrient button').forEach(function (b) {
    b.addEventListener('click', function () {
      var o = b.dataset.orient;
      applyOrient(o === 'auto' ? 'auto' : resolveOrient(o));
    });
  });

  $$('#orientPick button').forEach(function (b) {
    b.addEventListener('click', function () { applyOrient(b.dataset.orient); });
  });

  /* ================= 上传 ================= */

  function nextId(orient) {
    orient = orient || S.orient;
    if (!Api.isOnline()) return Promise.resolve(Api.nextId(orient));
    return Api.listPhotos(orient).then(function (res) {
      var max = 1000;
      (res.items || []).forEach(function (p) { max = Math.max(max, parseInt(p.id, 10) || 0); });
      return String(max + 1);
    });
  }

  /* 照片落在哪本相册，由裁剪方向决定，不是由设备当前方向决定：
   * 横着裁的图进 /photos/landscape，竖着裁的进 /photos/portrait。 */
  function dirOf(orient) {
    return '/photos/' + (isPortrait(orient) ? 'portrait' : 'landscape');
  }

  function doUpload(thenRefresh) {
    if (!S.packed) { toast('先选一张照片', true); return; }
    if (Api.isOnline() && S.packed.length !== 192000) {
      toast('照片数据不完整，请重试', true); return;
    }
    var btn = thenRefresh ? $('#btnUpload') : $('#btnSaveOnly');
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = '上传中…';
    if ($('#singleProg')) $('#singleProg').hidden = false;
    if ($('#singleBar')) $('#singleBar').style.width = '0%';
    if ($('#singlePhase')) $('#singlePhase').textContent = '正在写入相册';
    if ($('#singlePct')) $('#singlePct').textContent = '0%';

    nextId().then(function (id) {
      return Api.uploadPhotoProgress(id, S.packed, S.thumb, function (pct) {
        if ($('#singleBar')) $('#singleBar').style.width = pct + '%';
        if ($('#singlePct')) $('#singlePct').textContent = pct + '%';
        if (pct >= 100 && $('#singlePhase')) $('#singlePhase').textContent = '收尾';
      }, S.orient).then(function () { return id; });
    }).then(function (id) {
      if ($('#btnPick2')) $('#btnPick2').textContent = '下一张';
      if ($('#singlePhase')) $('#singlePhase').textContent = '完成';
      if (!thenRefresh) { toast('已存入相册 · 编号 ' + id); return; }
      return Api.refreshNow(null).then(function () {
        toast('已上屏，刷新约 30 秒');
      });
    }).catch(function (err) {
      toast('上传失败：' + err.message, true);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = old;
      setTimeout(function () { if ($('#singleProg')) $('#singleProg').hidden = true; }, 1200);
      refreshStatus();
    });
  }

  $('#btnUpload').addEventListener('click', function () { doUpload(true); });
  $('#btnSaveOnly').addEventListener('click', function () { doUpload(false); });

  var folderInput = $('#folderInput');
  var batchRunning = false;
  var batchCancel = false;
  var batchPaused = false;
  var batchItems = [];          /* {file, fit, state, msg, url} */
  var BATCH_FIT = 'cover';      /* 整批默认，可逐张改 */

  $$('#batchFit button').forEach(function (b) {
    b.addEventListener('click', function () {
      BATCH_FIT = b.dataset.fit || 'cover';
      $$('#batchFit button').forEach(function (x) { x.classList.toggle('sel', x === b); });
      $$('#batchList .bl-fit').forEach(function (sel) { sel.value = BATCH_FIT; });
      batchItems.forEach(function (it) { if (it.state === 'wait') it.fit = BATCH_FIT; });
    });
  });

  /* 把一张图渲染成 192 KB 物理帧。cover 铺满裁切；contain 整图缩放留白
   * （走自由比例那条通路，和网页上的「适应」是同一个语义）。 */
  function frameFromBitmap(bmp, fit) {
    var orient = bmp.width >= bmp.height ? 'landscape' : resolveOrient('portrait');
    var L = logiSize(orient);
    var src;
    if (fit === 'contain') {
      src = sampleCrop(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height },
                       L.w, L.h, 'free', 'white');
    } else {
      var crop = centeredCrop(bmp.width, bmp.height, L.w / L.h);
      src = sampleCrop(bmp, crop, L.w, L.h, 'fit', 'white');
    }
    var idx = Dither.convert(src, {
      algo: $('#optAlgo').value,
      strength: parseFloat($('#optStrength').value),
      sat: parseFloat($('#optSat').value),
      contrast: parseFloat($('#optContrast').value)
    });
    var phys = toPhysical(idx, L.w, L.h, orient);
    return { data: Dither.pack4(phys), thumb: makeThumb(phys), orient: orient };
  }

  /* ---------- 弹窗里的列表 ---------- */

  function renderBatchList() {
    var ul = $('#batchList');
    if (!ul) return;
    ul.innerHTML = batchItems.map(function (it, i) {
      return '<li data-i="' + i + '">' +
        '<img class="bl-thumb" src="' + it.url + '" alt="">' +
        '<div class="bl-main"><span class="bl-name" title="' + esc(it.file.name) + '">' +
          esc(it.file.name) + '</span><span class="bl-state">' + (it.msg || '等待') + '</span></div>' +
        '<select class="bl-fit" aria-label="这张怎么裁">' +
          '<option value="cover">铺满</option><option value="contain">适应</option></select>' +
        '</li>';
    }).join('');
    $$('#batchList .bl-fit').forEach(function (sel, i) {
      sel.value = batchItems[i] ? batchItems[i].fit : BATCH_FIT;
      sel.disabled = batchRunning;
      sel.addEventListener('change', function () {
        if (batchItems[i]) batchItems[i].fit = sel.value;
      });
    });
    if ($('#batchCount')) $('#batchCount').textContent = '共 ' + batchItems.length + ' 张';
  }

  function setRow(i, msg, cls) {
    var li = $('#batchList') && $('#batchList').querySelector('li[data-i="' + i + '"]');
    if (!li) return;
    if (batchItems[i]) { batchItems[i].msg = msg; batchItems[i].state = cls || 'wait'; }
    var st = li.querySelector('.bl-state');
    if (st) { st.textContent = msg; st.className = 'bl-state' + (cls ? ' ' + cls : ''); }
  }

  function batchStats() {
    var ok = 0, bad = 0;
    batchItems.forEach(function (it) {
      if (it.state === 'ok') ok++;
      if (it.state === 'bad') bad++;
    });
    return { ok: ok, bad: bad };
  }

  function updateBatch(done, total, name) {
    if ($('#batchProgress')) $('#batchProgress').hidden = false;
    if ($('#batchText')) $('#batchText').textContent = done + ' / ' + total + (name ? ' · ' + name : '');
    if ($('#batchBar')) $('#batchBar').style.width = (total ? done / total * 100 : 0) + '%';
  }

  /* ---------- 选文件夹 → 先出弹窗，再开始 ---------- */

  $('#btnBatchUpload').addEventListener('click', function () {
    if (batchRunning) return;
    folderInput.value = '';
    folderInput.click();
  });

  folderInput.addEventListener('change', function () {
    var files = Array.prototype.slice.call(folderInput.files || []).filter(function (f) {
      return /^image\//.test(f.type) || /\.(jpe?g|png|webp|bmp|heic|heif)$/i.test(f.name);
    }).sort(function (a, b) {
      return (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name);
    });
    if (!files.length) { toast('文件夹中没有可识别的图片', true); return; }

    batchItems.forEach(function (it) { if (it.url) URL.revokeObjectURL(it.url); });
    batchItems = files.map(function (f) {
      return { file: f, fit: BATCH_FIT, state: 'wait', msg: '等待', url: URL.createObjectURL(f) };
    });
    renderBatchList();
    if ($('#btnBatchStart')) { $('#btnBatchStart').disabled = false; $('#btnBatchStart').textContent = '开始上传'; }
    if ($('#btnBatchPause')) $('#btnBatchPause').hidden = true;
    if ($('#btnBatchRetry')) $('#btnBatchRetry').hidden = true;
    if ($('#batchProgress')) $('#batchProgress').hidden = true;
    if ($('#batchDialog') && !$('#batchDialog').open) $('#batchDialog').showModal();
  });

  function closeBatchDialog() {
    if (batchRunning) { batchCancel = true; return; }
    if ($('#batchDialog') && $('#batchDialog').open) $('#batchDialog').close();
    batchItems.forEach(function (it) { if (it.url) URL.revokeObjectURL(it.url); });
    batchItems = [];
  }

  if ($('#btnBatchClose')) $('#btnBatchClose').addEventListener('click', closeBatchDialog);
  if ($('#btnBatchCancelDlg')) $('#btnBatchCancelDlg').addEventListener('click', closeBatchDialog);
  if ($('#btnBatchCancel')) $('#btnBatchCancel').addEventListener('click', function () {
    if (batchRunning) { batchCancel = true; $('#btnBatchCancel').disabled = true; }
  });

  if ($('#btnBatchPause')) {
    $('#btnBatchPause').addEventListener('click', function () {
      batchPaused = !batchPaused;
      this.textContent = batchPaused ? '继续' : '暂停';
      if ($('#batchText')) $('#batchText').textContent = batchPaused ? '已暂停' : '继续上传…';
    });
  }

  if ($('#btnBatchRetry')) {
    $('#btnBatchRetry').addEventListener('click', function () {
      var n = 0;
      batchItems.forEach(function (it) {
        if (it.state === 'bad') { it.state = 'wait'; it.msg = '等待重试'; n++; }
      });
      renderBatchList();
      this.hidden = true;
      if (n) runBatch();
    });
  }

  if ($('#btnBatchStart')) {
    $('#btnBatchStart').addEventListener('click', function () {
      if (batchRunning || !batchItems.length) return;
      runBatch();
    });
  }

  async function runBatch() {
    batchRunning = true;
    batchCancel = false;
    batchPaused = false;
    if ($('#btnBatchStart')) $('#btnBatchStart').disabled = true;
    if ($('#btnBatchPause')) { $('#btnBatchPause').hidden = false; $('#btnBatchPause').textContent = '暂停'; }
    if ($('#btnBatchRetry')) $('#btnBatchRetry').hidden = true;
    $$('#batchList .bl-fit').forEach(function (sel) { sel.disabled = true; });
    updateBatch(0, batchItems.length, '');

    for (var i = 0; i < batchItems.length; i++) {
      var it = batchItems[i];
      if (batchCancel) break;
      if (it.state === 'ok') { updateBatch(i + 1, batchItems.length, ''); continue; }

      /* 暂停：每 200 ms 看一次，取消优先 */
      while (batchPaused && !batchCancel) {
        await new Promise(function (r) { setTimeout(r, 200); });
      }
      if (batchCancel) break;

      setRow(i, '处理中…', 'busy');
      updateBatch(i, batchItems.length, it.file.name);
      var bmp = null;
      try {
        bmp = await createImageBitmap(it.file, { imageOrientation: 'from-image' });
        var f = frameFromBitmap(bmp, it.fit || BATCH_FIT);
        var id = await nextId(f.orient);
        await Api.uploadPhoto(id, f.data, f.thumb, null, f.orient);
        setRow(i, '已上传 #' + id, 'ok');
      } catch (e) {
        setRow(i, '失败：' + (e && e.message || '未知'), 'bad');
      } finally {
        if (bmp && bmp.close) bmp.close();
      }
      updateBatch(i + 1, batchItems.length, it.file.name);
    }

    var st = batchStats();
    batchRunning = false;
    if ($('#btnBatchStart')) { $('#btnBatchStart').disabled = false; $('#btnBatchStart').textContent = '再传一次'; }
    if ($('#btnBatchPause')) $('#btnBatchPause').hidden = true;
    if ($('#btnBatchRetry')) $('#btnBatchRetry').hidden = st.bad === 0;
    $$('#batchList .bl-fit').forEach(function (sel) { sel.disabled = false; });
    if ($('#batchText')) {
      $('#batchText').textContent = (batchCancel ? '已取消 · ' : '完成 · ') +
        '成功 ' + st.ok + ' · 失败 ' + st.bad;
    }
    toast((batchCancel ? '批量上传已取消 · ' : '批量上传完成 · ') +
          '成功 ' + st.ok + '，失败 ' + st.bad, st.bad > 0);
    refreshStatus();
  }

  /* ================= 相册 ================= */

  /* 竖屏照片的缩略图是从物理帧 5:1 抽的（侧躺 160×96），显示前转回来变 96×160 */
  function uprightThumb(t, orient) {
    var out = new Uint8Array(96 * 160);
    for (var v = 0; v < 160; v++) {
      for (var u = 0; u < 96; u++) {
        var px, py;
        if (orient === 'portrait_r') { px = v; py = 95 - u; }
        else                         { px = 159 - v; py = u; }
        out[v * 96 + u] = t[py * 160 + px];
      }
    }
    return out;
  }

  /* ---------- 列表缩略图 ----------
   * 优先取卡里的 .thm（7680 字节，很快）；手工拷进卡的照片没有 .thm，
   * 就在前端把整帧按 5:1 抽样降成 160×96，避免整行只剩一个空框。
   * 串行排队，别让一页 20 张同时发请求把设备压住。 */
  var SHOT_QUEUE = Promise.resolve();

  function rowThumb(id, po) {
    return Api.thumb(id, po).then(function (t) {
      if (t) return t;
      return fetchFrame(id, po).then(function (f) {
        var idx = Dither.unpack4(f, 800, 480);
        var out = new Uint8Array(160 * 96);
        for (var y = 0; y < 96; y++) {
          for (var x = 0; x < 160; x++) out[y * 160 + x] = idx[y * 5 * 800 + x * 5];
        }
        return out;
      });
    });
  }

  /* 画进固定 5:3 的框：横图铺满，竖图居中留白；关掉插值保持像素锐利 */
  function paintShot(cv, idx, w, h) {
    var bw = 240, bh = 144;
    cv.width = bw; cv.height = bh;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#efeee8';
    ctx.fillRect(0, 0, bw, bh);
    var s = Math.min(bw / w, bh / h);
    var dw = Math.round(w * s), dh = Math.round(h * s);
    var tile = document.createElement('canvas');
    tile.width = w; tile.height = h;
    tile.getContext('2d').putImageData(Dither.toImageData(idx, w, h), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, Math.round((bw - dw) / 2), Math.round((bh - dh) / 2), dw, dh);
  }

  function queueShot(cv, id, po) {
    SHOT_QUEUE = SHOT_QUEUE.then(function () {
      if (!cv || !cv.parentNode) return null;          /* 已翻页/换册，这张不用画了 */
      return rowThumb(id, po).then(function (t) {
        if (!t || !cv.parentNode) return;
        if (isPortrait(po)) paintShot(cv, uprightThumb(t, po), 96, 160);
        else paintShot(cv, t, 160, 96);
      });
    }).catch(function () {});
  }

  /* 相册浏览方向独立于设备方向：无需为了看另一本相册而重画屏幕。 */
  var GALLERY_ORIENT = 'landscape';
  var GALLERY_READY = false;
  var GALLERY_PAGE = 1;
  var GALLERY_PAGE_SIZE = 20;
  var galleryRequest = 0;
  /* 相册选中集：id → orient。删除/下载都只认它，卡片上不再挂单张按钮 */
  var SEL = {};

  function selIds() { return Object.keys(SEL); }

  function updateSelBar() {
    var n = selIds().length;
    $('#selCount').textContent = n ? '已选 ' + n + ' 张' : '未选中';
    $('#btnDownloadSel').disabled = !n;
    $('#btnDeleteSel').disabled = !n;
    var cards = $$('#galleryGrid .ph');
    var allSel = cards.length > 0 && cards.every(function (c) { return SEL[c.dataset.id]; });
    $('#btnSelAll').textContent = allSel ? '取消全选' : '全选';
  }

  /* 点编号 = 让屏幕显示这张 */
  /* 取一张照片的完整物理帧：在线走 /api/photo（384000 字节，4bpp 打包），
   * 离线演示没有原始帧，用 160×96 缩略图按 5 倍放大还原。 */
  function fetchFrame(id, po) {
    if (Api.isOnline()) {
      return fetch(Api.getBase().replace(/\/$/, '') + '/api/photo?name=' + encodeURIComponent(id) +
                   (po ? '&orient=' + encodeURIComponent(po) : ''))
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        })
        .then(function (b) { return new Uint8Array(b); });
    }
    return Api.thumb(id, po).then(function (t) {
      if (!t) throw new Error('演示数据里没有这张的原始帧');
      var full = new Uint8Array(800 * 480);
      for (var y = 0; y < 480; y++) {
        for (var x = 0; x < 800; x++) {
          full[y * 800 + x] = t[Math.floor(y / 5) * 160 + Math.floor(x / 5)];
        }
      }
      return full;
    });
  }

  /* 卡里的竖屏照片是横着存的（物理帧恒为 800×480），显示前要转正。
   * 映射关系与 uprightThumb 一致，只是按原始分辨率算，不用缩略图凑。 */
  function frameToIdx(frame, po) {
    var idx = Dither.unpack4(frame, 800, 480);
    if (!isPortrait(po)) return { idx: idx, w: 800, h: 480 };
    var out = new Uint8Array(480 * 800);
    for (var y = 0; y < 800; y++) {
      for (var x = 0; x < 480; x++) {
        out[y * 480 + x] = (po === 'portrait_r')
          ? idx[(479 - x) * 800 + y]
          : idx[x * 800 + (799 - y)];
      }
    }
    return { idx: out, w: 480, h: 800 };
  }

  /* ================= 照片预览 ================= */

  var PHOTO_VIEW = null;

  function openPhoto(id, po, meta) {
    PHOTO_VIEW = { id: id, po: po || 'landscape' };
    var pp = isPortrait(PHOTO_VIEW.po);
    $('#photoTitle').textContent = id;
    $('#photoSub').textContent = (pp ? '480 × 800' : '800 × 480') +
      (meta && meta.size ? ' · ' + Math.round(meta.size / 1024) + ' KB' : '') +
      (meta && meta.added ? ' · ' + fmtTime(meta.added) : '');

    var cv = $('#photoCanvas');
    cv.width = pp ? 480 : 800;
    cv.height = pp ? 800 : 480;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#efeee8';
    ctx.fillRect(0, 0, cv.width, cv.height);
    $('#photoLoading').hidden = false;

    var dlg = $('#photoDialog');
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute('open', '');

    var want = id;
    fetchFrame(id, PHOTO_VIEW.po).then(function (frame) {
      if (!PHOTO_VIEW || PHOTO_VIEW.id !== want) return;   /* 期间又点了别的 */
      var img = frameToIdx(frame, PHOTO_VIEW.po);
      cv.width = img.w; cv.height = img.h;
      cv.getContext('2d').putImageData(Dither.toImageData(img.idx, img.w, img.h), 0, 0);
      $('#photoLoading').hidden = true;
    }).catch(function (e) {
      $('#photoLoading').hidden = true;
      toast('预览失败：' + e.message, true);
    });
  }

  function closePhoto() {
    var dlg = $('#photoDialog');
    PHOTO_VIEW = null;
    if (dlg.close) dlg.close();
    else dlg.removeAttribute('open');
  }

  function showPhoto(id, po) {
    Api.setCurrent(id, po).then(function () {
      return Api.refreshNow(null);
    }).then(function () {
      toast('正在刷新，约 30 秒');
      renderGallery();
    }).catch(function (e) { toast('失败：' + e.message, true); });
  }

  $('#btnClosePhoto').addEventListener('click', closePhoto);
  $('#btnPhotoClose').addEventListener('click', closePhoto);
  $('#btnPhotoShow').addEventListener('click', function () {
    if (!PHOTO_VIEW) { closePhoto(); return; }
    var t = PHOTO_VIEW;
    closePhoto();
    showPhoto(t.id, t.po);
  });
  var photoDialog = $('#photoDialog');
  photoDialog.addEventListener('click', function (e) {
    if (e.target === photoDialog) closePhoto();
  });
  /* Esc 关闭时 dialog 自己会关，这里只需清掉预览目标，免得下次按钮指向旧照片 */
  photoDialog.addEventListener('cancel', function () { PHOTO_VIEW = null; });

  $('#btnSelAll').addEventListener('click', function () {
    var cards = $$('#galleryGrid .ph');
    var allSel = cards.length > 0 && cards.every(function (c) { return SEL[c.dataset.id]; });
    SEL = {};
    if (!allSel) {
      cards.forEach(function (c) {
        var id = c.dataset.id;
        SEL[id] = (GALLERY_ORIENT === 'portrait') ? 'portrait_l' : 'landscape';
      });
    }
    cards.forEach(function (c) { c.classList.toggle('sel', !!SEL[c.dataset.id]); });
    updateSelBar();
  });

  $('#btnDownloadSel').addEventListener('click', function () {
    var ids = selIds();
    /* 浏览器会拦连续下载，间隔 400ms 一张，避免只有第一张成功 */
    ids.forEach(function (id, i) {
      setTimeout(function () { downloadPhoto(id, SEL[id]); }, i * 400);
    });
  });

  $('#btnDeleteSel').addEventListener('click', function () {
    var ids = selIds();
    if (!ids.length) return;
    if (!confirm('是否删除 ' + ids.length + ' 张照片？')) return;
    var btn = $('#btnDeleteSel');
    btn.disabled = true;
    Promise.all(ids.map(function (id) {
      return Api.deletePhoto(id, SEL[id]).then(function () {
        return { id: id, ok: true };
      }).catch(function () { return { id: id, ok: false }; });
    })).then(function (results) {
      var okIds = results.filter(function (r) { return r.ok; }).map(function (r) { return r.id; });
      var failed = results.length - okIds.length;
      okIds.forEach(function (id) { delete SEL[id]; });
      if (okIds.length && !failed) toast('已删除 ' + okIds.length + ' 张照片');
      else if (okIds.length) toast('已删除 ' + okIds.length + ' 张，' + failed + ' 张失败', true);
      else toast('删除失败：' + (Api.isOnline() ? '请重试' : '未连接设备'), true);
      renderGallery();
    }).then(function () { btn.disabled = selIds().length === 0; });
  });

  $$('#galleryOrient button').forEach(function (b) {
    b.addEventListener('click', function () {
      GALLERY_ORIENT = b.dataset.galleryOrient;
      GALLERY_READY = true;
      GALLERY_PAGE = 1;
      renderGallery();
    });
  });

  $('#btnEmptyUpload').addEventListener('click', function () {
    activateTab($('#navUpload'), false);
  });

  $('#galleryPrev').addEventListener('click', function () {
    if (GALLERY_PAGE > 1) { GALLERY_PAGE--; renderGallery(); }
  });
  $('#galleryNext').addEventListener('click', function () {
    GALLERY_PAGE++; renderGallery();
  });

  function renderGallery() {
    var grid = $('#galleryGrid');
    var requestId = ++galleryRequest;
    var queryOrient = GALLERY_ORIENT === 'portrait' ? 'portrait_l' : 'landscape';
    $$('#galleryOrient button').forEach(function (b) {
      b.classList.toggle('sel', b.dataset.galleryOrient === GALLERY_ORIENT);
    });
    Api.listPhotos(queryOrient).then(function (res) {
      if (requestId !== galleryRequest) return;
      var items = (res.items || []).slice().sort(function (a, b) {
        return String(b.added || '').localeCompare(String(a.added || ''));
      });
      var totalPages = Math.max(1, Math.ceil(items.length / GALLERY_PAGE_SIZE));
      GALLERY_PAGE = clamp(GALLERY_PAGE, 1, totalPages);
      var pageStart = (GALLERY_PAGE - 1) * GALLERY_PAGE_SIZE;
      var pageItems = items.slice(pageStart, pageStart + GALLERY_PAGE_SIZE);
      grid.innerHTML = '';
      grid.classList.toggle('portrait', GALLERY_ORIENT === 'portrait');
      $('#galleryEmpty').hidden = !!items.length;
      $('#galleryStat').textContent = items.length + ' 张';
      $('#galleryPager').hidden = totalPages <= 1;
      $('#galleryPageText').textContent = GALLERY_PAGE + ' / ' + totalPages;
      $('#galleryPrev').disabled = GALLERY_PAGE <= 1;
      $('#galleryNext').disabled = GALLERY_PAGE >= totalPages;

      var c = res.counts || {};
      $('#galleryLandCount').textContent = c.landscape == null ? (GALLERY_ORIENT === 'landscape' ? items.length : 0) : c.landscape;
      $('#galleryPortraitCount').textContent = c.portrait == null ? (GALLERY_ORIENT === 'portrait' ? items.length : 0) : c.portrait;
      /* 翻页/换册后把不在本页的选中项丢掉，免得"删掉看不见的那几张" */
      var pageIds = {};
      pageItems.forEach(function (it) { pageIds[it.id] = 1; });
      Object.keys(SEL).forEach(function (id) { if (!pageIds[id]) delete SEL[id]; });

      pageItems.forEach(function (it) {
        var po = it.orient || 'landscape';
        var pp = isPortrait(po);
        var currentOnScreen = it.id === res.current && pp === isPortrait(DEV_ORIENT);
        var card = document.createElement('div');
        card.className = 'ph' + (currentOnScreen ? ' current' : '') + (pp ? ' vertical' : '');
        card.dataset.id = it.id;
        if (SEL[it.id]) card.classList.add('sel');
        card.innerHTML =
          '<span class="ph-check" aria-hidden="true"></span>' +
          '<button class="ph-shot" type="button" aria-label="预览 ' + esc(it.id) + '"><canvas></canvas></button>' +
          '<div class="ph-body">' +
          '  <div class="ph-title">' +
          '    <span class="ph-id">' + esc(it.id) + '</span>' +
          '    <span class="ph-badges">' +
          (currentOnScreen ? '<span class="badge">在屏</span>' : '') +
          '    </span></div>' +
          '  <div class="ph-sub">' + fmtTime(it.added) + ' · ' +
          Math.round((it.size || 192000) / 1024) + ' KB</div>' +
          '</div>';
        grid.appendChild(card);

        /* 整行点一下 = 选中/取消；点缩略图 = 先在网页里预览，预览里再决定上屏。
         * 以前每行挂「显示/下载/删除」三个按钮，手机上必点错；
         * 现在下载/删除挪到上方统一按钮，只对选中的那几张生效。 */
        card.addEventListener('click', function () {
          if (SEL[it.id]) delete SEL[it.id];
          else SEL[it.id] = po;
          card.classList.toggle('sel', !!SEL[it.id]);
          updateSelBar();
        });
        card.querySelector('.ph-shot').addEventListener('click', function (e) {
          e.stopPropagation();
          openPhoto(it.id, po, { size: it.size, added: it.added });
        });
        queueShot(card.querySelector('.ph-shot canvas'), it.id, po);
      });
      updateSelBar();
    }).catch(function (e) {
      toast('读取相册失败：' + e.message, true);
    });
  }

  function downloadPhoto(id, orient) {
    if (Api.isOnline()) {
      fetch(Api.getBase().replace(/\/$/, '') + '/api/photo?name=' + encodeURIComponent(id) +
            (orient ? '&orient=' + encodeURIComponent(orient) : ''))

        .then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { saveBlob(new Uint8Array(b), id); })
        .catch(function () { toast('下载失败', true); });
    } else {
      Api.thumb(id, orient).then(function (t) {
        if (!t) { toast('演示数据无原始帧', true); return; }
        var full = new Uint8Array(800 * 480);
        for (var y = 0; y < 480; y++) {
          for (var x = 0; x < 800; x++) {
            full[y * 800 + x] = t[Math.floor(y / 5) * 160 + Math.floor(x / 5)];
          }
        }
        saveBlob(Dither.pack4(full), id);
      });
    }
  }

  function saveBlob(u8, id) {
    var blob = new Blob([u8], { type: 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'photo_' + id + '.p6';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  $('#btnReloadGallery').addEventListener('click', renderGallery);

  /* ================= 设置 ================= */

  var cfgCache = null;

  function loadSettings() {
    Api.getConfig().then(function (c) {
      cfgCache = c;
      $('#setInterval').value = String(c.refresh_interval_min);
      $('#setDndOn').checked = !!(c.dnd && c.dnd.enabled);
      if (c.dnd) {
        $('#setDndStart').value = c.dnd.start || '03:00';
        $('#setDndEnd').value = c.dnd.end || '08:00';
      }
      setLayoutPick(c.default_layout || 'B');
      /* 校准值：文件里没有就留空（= 不补），别显示成 0 让人以为设过 */
      if ($('#setTempOff')) {
        $('#setTempOff').value = (typeof c.temp_offset_c === 'number' && c.temp_offset_c !== 0)
          ? String(c.temp_offset_c) : '';
      }
      if ($('#setHumOff')) {
        $('#setHumOff').value = (typeof c.hum_offset_pct === 'number' && c.hum_offset_pct !== 0)
          ? String(c.hum_offset_pct) : '';
      }
      if ($('#setBeep')) $('#setBeep').checked = c.beep_enabled !== false;
      if ($('#setNetEvery')) $('#setNetEvery').value = String(c.net_interval_min || 1440);
      if ($('#setAiOn')) $('#setAiOn').checked = c.ai_enabled !== false;
      if ($('#setAiUrl')) $('#setAiUrl').value = c.ai_url || '';
      setPhotoModeUI(c.photo_mode || 'cycle', c.photo_fixed_id || '');
      applyBeepMask(typeof c.beep_mask === 'number' ? c.beep_mask : 31);
      if ($('#setFwUrl')) $('#setFwUrl').value = c.fw_manifest || FW_MANIFEST_DEFAULT;
      if ($('#setNtp')) { $('#setNtp').checked = c.ntp_enabled !== false; syncTimeLock(); }
      if ($('#setVolume')) {
        var vol = (typeof c.beep_volume === 'number') ? c.beep_volume : 60;
        $('#setVolume').value = String(Math.round(vol / 10) * 10);
        $('#volVal').textContent = $('#setVolume').value + '%';
        syncVolEnabled();
      }
      applyWxToUI(c);
      DEV_ORIENT = PICK_ORIENT = c.orientation || 'landscape';
      if (typeof c.wb_theme === 'string') setWbTheme(c.wb_theme, false);
      if (!S.bitmap) S.orient = DEV_ORIENT;
      syncOrientUI();
      updateDndState();
    }).catch(function () {});

    refreshStatus();
  }

  function setLayoutPick(v) {
    v = /^(A|B|C)$/.test(v) ? v : 'B';
    $$('.lp').forEach(function (el) {
      var selected = el.dataset.layout === v;
      el.classList.toggle('sel', selected);
      el.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    $('#layoutPick').dataset.value = v;
    /* 白底/黑底只对「照片 + 信息」有意义：纯照片没有信息栏，温湿度版式走自己的配色。
     * 不是置灰（置灰还会占位、让人以为点不动），直接整行隐藏。 */
    $$('#barTheme button').forEach(function (b) { b.disabled = v !== 'B'; });
    $('#barThemeField').hidden = v !== 'B';
    $('#barThemeField').classList.toggle('disabled', v !== 'B');
    /* 工作台配色只对布局 C（工作台）有意义 */
    if ($('#wbThemeField')) {
      $('#wbThemeField').hidden = v !== 'C';
      $('#wbThemeField').classList.toggle('disabled', v !== 'C');
    }
    schedulePreview();
  }

  function setBarTheme(theme, updatePreview) {
    BAR_THEME = theme === 'black' ? 'black' : 'white';
    try { localStorage.setItem('pp_bar_theme', BAR_THEME); } catch (e) {}
    $$('#barTheme button').forEach(function (b) {
      var selected = b.dataset.barTheme === BAR_THEME;
      b.classList.toggle('sel', selected);
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (updatePreview !== false) schedulePreview();
  }

  $$('#barTheme button').forEach(function (b) {
    b.addEventListener('click', function () { setBarTheme(b.dataset.barTheme); });
  });

  function setWbTheme(theme, updatePreview) {
    WB_THEME = (theme === 'night') ? 'night' : 'day';
    try { localStorage.setItem('pp_wb_theme', WB_THEME); } catch (e) {}
    $$('#wbTheme button').forEach(function (b) {
      var selected = b.dataset.wbTheme === WB_THEME;
      b.classList.toggle('sel', selected);
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (updatePreview !== false) schedulePreview();
  }

  $$('#wbTheme button').forEach(function (b) {
    b.addEventListener('click', function () { setWbTheme(b.dataset.wbTheme); });
  });

  function updateDndState() {
    var on = $('#setDndOn').checked;
    $('#setDndStart').disabled = !on;
    $('#setDndEnd').disabled = !on;
    $('.dnd-times').classList.toggle('disabled', !on);
  }

  /* 改刷新间隔/免打扰都要重画预览：月亮图标取决于"下一刻度会不会被 DND 挡掉" */
  $('#setInterval').addEventListener('change', function () { schedulePreview(); });
  $('#setDndOn').addEventListener('change', function () { updateDndState(); schedulePreview(); });
  ['#setDndStart', '#setDndEnd'].forEach(function (sel) {
    var el = $(sel);
    if (el) el.addEventListener('change', schedulePreview);
  });

  $$('.lp').forEach(function (el) {
    el.addEventListener('click', function () { setLayoutPick(el.dataset.layout); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); setLayoutPick(el.dataset.layout);
      }
    });
  });

  function persistPreviewSettings() {
    function apply(cfg) {
      cfg.default_layout = currentLayout();
      cfg.orientation = PICK_ORIENT;
      cfg.info_bar_theme = BAR_THEME;
      cfg.wb_theme = WB_THEME;
      cfgCache = cfg;
      return Api.setConfig(cfg).then(function () { return Api.setBarTheme(BAR_THEME); });
    }
    /* cfgCache 为 null 时不能拿空对象直接 POST：那会把 config.json 覆盖成只剩
     * 三个字段，刷新间隔、免打扰、时区、温湿度偏移、WiFi 密码全部丢掉。 */
    if (cfgCache) return apply(cfgCache);
    return Api.getConfig()
      .then(function (c) { return apply(c || {}); })
      .catch(function () { return apply({}); });
  }

  /* 版式/方向/信息栏：两个出口。
   * 「保存」只落配置，不动屏幕——换版式要 40 秒全刷，随手调一下就刷屏太浪费；
   * 「保存并刷新」落配置 + 立刻重画，一次到位。 */
  function saveDisplaySettings(alsoRefresh) {
    var b1 = $('#btnSaveDisplayCfg'), b2 = $('#btnApplyDisplay');
    b1.disabled = b2.disabled = true;
    persistPreviewSettings().then(function () {
      if (!alsoRefresh) {
        toast('已保存，下次刷新生效');
        return null;
      }
      DEV_ORIENT = PICK_ORIENT;
      syncOrientUI();
      return Api.refreshNow(null).then(function () { toast('已保存，正在重画'); });
    }).catch(function (e) {
      toast((alsoRefresh ? '应用' : '保存') + '失败：' + (e && e.message || '未知错误'), true);
    }).then(function () {
      b1.disabled = b2.disabled = false;
    });
  }

  $('#btnSaveDisplayCfg').addEventListener('click', function () { saveDisplaySettings(false); });
  $('#btnApplyDisplay').addEventListener('click', function () { saveDisplaySettings(true); });

  $('#btnSaveDisplay').addEventListener('click', function () {
    function apply(cfg) {
      cfg.refresh_interval_min = parseInt($('#setInterval').value, 10);
      cfg.net_interval_min = parseInt($('#setNetEvery') ? $('#setNetEvery').value : '1440', 10) || 1440;
      cfg.photo_mode = currentPhotoMode();
      cfg.photo_fixed_id = currentPhotoMode() === 'fixed'
        ? ($('#setPhotoFixed') ? $('#setPhotoFixed').value : '') : '';
      cfg.dnd = {
        enabled: $('#setDndOn').checked,
        start: $('#setDndStart').value,
        end: $('#setDndEnd').value
      };
      cfgCache = cfg;
      return Api.setConfig(cfg).then(function () {
        toast('刷新设置已保存');
      }).catch(function (e) { toast('保存失败：' + e.message, true); });
    }
    if (cfgCache) return apply(cfgCache);
    Api.getConfig()
      .then(function (c) { return apply(c || {}); })
      .catch(function () { return apply({}); });
  });

  /* ---------- 照片刷新方式 ---------- */

  function currentPhotoMode() {
    var b = $('#setPhotoMode') && $('#setPhotoMode').querySelector('button.sel');
    return b ? (b.dataset.photoMode || 'cycle') : 'cycle';
  }

  function setPhotoModeUI(mode, fixedId) {
    if (!$('#setPhotoMode')) return;
    $$('#setPhotoMode button').forEach(function (b) {
      b.classList.toggle('sel', b.dataset.photoMode === mode);
    });
    if ($('#photoFixedField')) $('#photoFixedField').hidden = mode !== 'fixed';
    if (mode === 'fixed') refreshFixedSelect(fixedId);
  }

  /* 单张模式的选择器：列当前相册里的照片。设备离线时给一句提示，
   * 不要让人对着空下拉框猜。 */
  function refreshFixedSelect(cur) {
    var sel = $('#setPhotoFixed');
    if (!sel) return;
    if (!Api.isOnline()) {
      sel.innerHTML = '<option value="">（离线，连上设备后再选）</option>';
      return;
    }
    Api.listPhotos(S.orient).then(function (res) {
      var items = (res && res.items) || [];
      if (!items.length) {
        sel.innerHTML = '<option value="">（这本相册还是空的）</option>';
        return;
      }
      sel.innerHTML = items.map(function (p) {
        var mark = (p.orient && p.orient !== 'landscape') ? '竖' : '横';
        return '<option value="' + p.id + '">#' + p.id + '　' + mark + '</option>';
      }).join('');
      if (cur) sel.value = cur;
    }).catch(function () {
      sel.innerHTML = '<option value="">（读取相册失败）</option>';
    });
  }

  $$('#setPhotoMode button').forEach(function (b) {
    b.addEventListener('click', function () {
      setPhotoModeUI(b.dataset.photoMode || 'cycle', null);
    });
  });

  /* ---------- 提示音分组 ---------- */

  function applyBeepMask(mask) {
    $$('.beep-groups input[data-bit]').forEach(function (el) {
      el.checked = (mask & parseInt(el.dataset.bit, 10)) !== 0;
    });
  }

  function currentBeepMask() {
    var m = 0;
    $$('.beep-groups input[data-bit]').forEach(function (el) {
      if (el.checked) m |= parseInt(el.dataset.bit, 10);
    });
    return m;
  }

  /* ---------- WiFi 扫描 ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function rssiLevel(rssi) {
    if (rssi >= -55) return 4;
    if (rssi >= -67) return 3;
    if (rssi >= -78) return 2;
    return 1;
  }

  function renderScan(list) {
    var box = $('#scanList');
    box.hidden = false;
    box.innerHTML = '';

    if (!list || !list.length) {
      box.innerHTML = '<div class="scan-empty">没扫到可用网络。设备可能正忙或射频未开，稍后重试。</div>';
      return;
    }

    list.forEach(function (ap) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'scan-item';
      b.innerHTML =
        '<span class="bars" data-lv="' + rssiLevel(ap.rssi) + '"><i></i><i></i><i></i><i></i></span>' +
        '<span class="nm">' + esc(ap.ssid) +
        (ap.secure ? '' : '<em>开放</em>') + '</span>' +
        '<span class="dbm">' + ap.rssi + '</span>';
      b.addEventListener('click', function () {
        $('#setSsid').value = ap.ssid;
        $('#scanHint').textContent = '已填入 ' + ap.ssid;
        $('#setPass').focus();
      });
      box.appendChild(b);
    });
  }

  var scanRetried = false;

  $('#btnScan').addEventListener('click', function () {
    var btn = $('#btnScan');
    btn.disabled = true;
    $('#scanHint').textContent = '扫描中…';
    Api.scanWifi().then(function (r) {
      var list = (r && r.networks) || [];
      renderScan(list);
      scanRetried = false;
      $('#scanHint').textContent = list.length ? list.length + ' 个网络，点一行填入' : '未发现网络';
    }).catch(function (e) {
      /* 扫描会让射频短暂重启，正在连它的手机会掉线一次，
       * 这不是扫描失败，等连接回来重试即可。 */
      var dropped = /Failed to fetch|NetworkError|abort|Load failed/i.test(e && e.message || '');
      if (dropped && !scanRetried) {
        scanRetried = true;
        $('#scanHint').textContent = '连接短暂中断，10 秒后自动重试…';
        toast('扫描时连接会短暂中断，稍等自动重试');
        setTimeout(function () { $('#btnScan').click(); }, 10000);
      } else {
        $('#scanHint').textContent = dropped ? '仍连不上设备，请重新连接后再试' : '扫描失败';
        toast('扫描失败：' + (e && e.message || '未知错误'), true);
      }
    }).then(function () {
      btn.disabled = false;
    });
  });

  $('#btnTogglePass').addEventListener('click', function () {
    var input = $('#setPass');
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    this.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
  });

  /* ---------- 演示模式的两个 WiFi 彩蛋 ---------- */
  var WIFI_EGGS = {
    'Colloidal': { pass: '19991123', text: '有一条咸鱼在你的荷塘' },
    'SaHaRa':    { pass: '20000826', text: '水怪如夜空里的星尘' }
  };

  function showEgg(text) {
    var old = document.getElementById('eggPopup');
    if (old) old.parentNode.removeChild(old);
    var box = document.createElement('div');
    box.id = 'eggPopup';
    box.className = 'egg-popup';
    box.innerHTML = '<i class="egg-mark"></i><p>' + esc(text) + '</p>';
    document.body.appendChild(box);
    requestAnimationFrame(function () { box.classList.add('on'); });
    setTimeout(function () {
      box.classList.remove('on');
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 420);
    }, 3800);
  }

  /* 把设备的 802.11 失败原因码翻成人话。密码错和「压根没扫到这个网络」
   * 对用户是两件完全不同的事：前者要改密码，后者要看是不是 5G 频段 /
   * 名字打错 / 离得太远。只回一句「连接失败」等于什么都没说。
   *
   * 2026-11-21：以前只认 201/15/202 几个码，用户输错密码拿到的是
   * 「原因码 14」（MIC failure）—— 和密码错误其实是同一件事，却要人去查表。
   * 现在按「处置方式」分成四类，表里覆盖了 ESP-IDF wifi_err_reason_t 里
   * 实际会遇到的全部常见码，落不到表里的也给出下一步该做什么。 */
  var WIFI_REASON = {
    /* 密码 / 加密协商：改密码或改路由器的加密方式 */
    pwd: [14, 15, 202, 204, 24, 18, 19, 20, 23, 16, 17, 21, 22],
    /* 没找到这个网络：名字、频段、距离 */
    noap: [201, 200, 203],
    /* 被路由器/信号打断：靠近一点、重试 */
    weak: [1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 205]
  };

  function wifiFailText(reason, ssid) {
    var r = Number(reason) || 0;
    if (WIFI_REASON.pwd.indexOf(r) >= 0) {
      /* 24/18/19 是加密方式对不上，改密码没用，要说清楚 */
      if (r === 24 || r === 18 || r === 19) {
        return ssid + ' 的加密方式不兼容，把路由器改成 WPA2-PSK（AES）再试';
      }
      if (r === 23) return ssid + ' 需要网页/企业认证，相框连不了这种网络';
      return '密码不对，请重新输入 ' + ssid + ' 的密码';
    }
    if (WIFI_REASON.noap.indexOf(r) >= 0) {
      if (r === 200) return '信号太弱，连不上 ' + ssid + '，靠近路由器再试';
      return '没找到 ' + ssid + '，确认名字没打错，且是 2.4G 网络（相框不支持 5G）';
    }
    if (r === 5) return ssid + ' 的连接数已满，先在路由器上踢掉一台设备';
    if (WIFI_REASON.weak.indexOf(r) >= 0) {
      return '和 ' + ssid + ' 的连接被中断了，靠近路由器、确认密码后再试一次';
    }
    if (r === 0) return '连不上 ' + ssid + '，检查密码、或换成 2.4G 的网络';
    return '连不上 ' + ssid + '，请确认密码正确、且这是 2.4G 网络（原因码 ' + r + '）';
  }

  /* 「更换网络」：配好网之后手动项是收起的，点这个再展开。
   * 只放在内存里，不落盘 —— 刷新页面回到"已连接、只显示信息"的样子才是对的。 */
  var wxManualOpen = false;

  $('#btnChangeWifi').addEventListener('click', function () {
    wxManualOpen = true;
    if ($('#wifiManual')) $('#wifiManual').hidden = false;
    if ($('#wifiChangeRow')) $('#wifiChangeRow').hidden = true;
    var s = $('#setSsid');
    if (s) { s.focus(); s.select(); }
  });

  $('#btnSaveWifi').addEventListener('click', function () {
    var ssid = $('#setSsid').value.trim();
    if (!ssid) { toast('请填写 WiFi 名称', true); return; }
    var pass = $('#setPass').value;
    var btn = $('#btnSaveWifi');
    var egg = WIFI_EGGS[ssid];
    if (!Api.isOnline() && egg && pass === egg.pass) showEgg(egg.text);
    btn.disabled = true; btn.textContent = '连接中…';
    Api.setWifi(ssid, pass).then(function (r) {
      /* 设备连不上路由器时返回的是 ok:false + 空 ip，不是 HTTP 错误。
       * 原来不看这个字段，一律弹「已连接」—— 密码打错也告诉用户连上了，
       * 然后用户去家里那张网里找一个根本没入网的设备。 */
      if (r && r.ok === false) {
        toast(wifiFailText(r.reason, ssid), true);
        return;
      }
      /* 这里只说局域网地址：提示栏也统一成"局域网"口径，不再混着讲热点。 */
      toast(r && r.ip
        ? '已连上 ' + ssid + '，局域网地址 ' + r.ip
        : '已连上 ' + ssid + '，但没拿到 IP，稍等几秒再看「运行状态」');
      /* 连上了就把扫描列表收起来：那一屏是给"还没配网"的人挑网络用的，
       * 配好之后留着只会把已连接信息挤到下面。 */
      if ($('#scanList')) { $('#scanList').hidden = true; $('#scanList').innerHTML = ''; }
      if ($('#scanHint')) $('#scanHint').textContent = '';
      /* 配好就收起整块手动项，只留「当前连接」+「更换网络」 */
      wxManualOpen = false;
      if ($('#wifiManual')) $('#wifiManual').hidden = true;
      if ($('#wifiChangeRow')) $('#wifiChangeRow').hidden = false;
      refreshStatus();
    }).catch(function (e) {
      toast('连接失败：' + e.message, true);
    }).then(function () {
      btn.disabled = false; btn.textContent = '保存并连接';
    });
  });

  /* ---------- 时间：年 / 月 / 日 / 时 / 分 / 秒 逐格填写 ---------- */

  var TIME_TOUCHED = false;
  var TIME_IDS = ['tYear', 'tMon', 'tDay', 'tHour', 'tMin', 'tSec'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function timeOffsetMin() {
    return (cfgCache && cfgCache.utc_offset_min != null) ? cfgCache.utc_offset_min : 480;
  }

  /* 设备本地时间 = UTC(epoch + 时区偏移)。这里一律用 getUTC* 取字段，
   * 免得浏览器自己在别的时区时把设备时间算错一格。 */
  function fillTimeByEpoch(epoch) {
    if (!epoch) return;
    var d = new Date((epoch + timeOffsetMin() * 60) * 1000);
    $('#tYear').value = d.getUTCFullYear();
    $('#tMon').value = pad2(d.getUTCMonth() + 1);
    $('#tDay').value = pad2(d.getUTCDate());
    $('#tHour').value = pad2(d.getUTCHours());
    $('#tMin').value = pad2(d.getUTCMinutes());
    $('#tSec').value = pad2(d.getUTCSeconds());
  }

  /* 读六格并校验；返回 null 表示不合法（已经 toast 过） */
  function readTimeInputs() {
    var y = parseInt($('#tYear').value, 10);
    var mo = parseInt($('#tMon').value, 10);
    var d = parseInt($('#tDay').value, 10);
    var h = parseInt($('#tHour').value, 10);
    var mi = parseInt($('#tMin').value, 10);
    var s = parseInt($('#tSec').value, 10);

    var bad = [];
    if (!(y >= 2000 && y <= 2099)) bad.push('年（2000–2099）');
    if (!(mo >= 1 && mo <= 12)) bad.push('月（1–12）');
    if (!(h >= 0 && h <= 23)) bad.push('时（0–23）');
    if (!(mi >= 0 && mi <= 59)) bad.push('分（0–59）');
    if (!(s >= 0 && s <= 59)) bad.push('秒（0–59）');

    /* Date.UTC(y, mo, 0) 就是 mo 月的最后一天，闰年自动算对 */
    var dim = (mo >= 1 && mo <= 12) ? new Date(Date.UTC(y, mo, 0)).getUTCDate() : 0;
    if (mo >= 1 && mo <= 12 && !(d >= 1 && d <= dim)) bad.push('日（本月 1–' + dim + '）');

    if (bad.length) {
      toast('请检查：' + bad.join('、'), true);
      return null;
    }
    return { y: y, mo: mo, d: d, h: h, mi: mi, s: s };
  }

  function timeEpoch() {
    var v = readTimeInputs();
    if (!v) return null;
    return Math.floor(Date.UTC(v.y, v.mo - 1, v.d, v.h, v.mi, v.s) / 1000 - timeOffsetMin() * 60);
  }

  TIME_IDS.forEach(function (id) {
    var el = $('#' + id);
    if (!el) return;
    el.addEventListener('input', function () { TIME_TOUCHED = true; });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('#btnSyncTime').click(); }
    });
  });

  /* 「相册时间」按钮已按用户要求删掉：填时间只有一个入口「本机时间」，
   * 少一个按钮，也少一次"到底该按哪个"的犹豫。 */

  $('#btnFillLocal').addEventListener('click', function () {
    fillTimeByEpoch(Math.floor(Date.now() / 1000));
    TIME_TOUCHED = false;
    toast('已填入本机时间');
  });

  $('#btnSyncTime').addEventListener('click', function () {
    var epoch = timeEpoch();
    if (epoch === null) return;
    var btn = $('#btnSyncTime');
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = '保存中…';
    Api.syncTime(epoch).then(function () {
      toast('时间已保存到相册');
      TIME_TOUCHED = false;
      refreshStatus();
    }).catch(function (e) {
      toast('写入失败：' + e.message, true);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = old;
    });
  });

  /* 开了在线对时就把手写时间这条路锁掉：六个时间输入、本机时间、保存按钮全禁用。
   * 提示语不再写一行字（用户要求删掉），只把整块置灰 —— 灰掉本身就说明不能改。 */
  function syncTimeLock() {
    var auto = $('#setNtp') && $('#setNtp').checked;
    TIME_IDS.forEach(function (id) {
      var el = $('#' + id);
      if (el) el.disabled = auto;
    });
    if ($('#btnFillLocal')) $('#btnFillLocal').disabled = auto;
    if ($('#btnSyncTime')) $('#btnSyncTime').disabled = auto;
    if ($('#timeRow')) $('#timeRow').classList.toggle('disabled', auto);
  }

  /* 在线对时开关：改一下立刻落盘（不等「保存」按钮 —— 那个按钮写的是时间）。
   * 打开时顺手让设备当场校一次，省得等到下一个整点才知道有没有生效。 */
  $('#setNtp').addEventListener('change', function () {
    var on = this.checked;
    syncTimeLock();
    if (!Api.isOnline()) { toast('未连接设备，开关会在下次连上后再保存', true); return; }

    (cfgCache ? Promise.resolve(cfgCache) : Api.getConfig())
      .then(function (c) {
        c = c || {};
        c.ntp_enabled = on;
        cfgCache = c;
        return Api.setConfig(c);
      })
      .then(function () {
        if (!on) { toast('已关闭在线对时，之后只按 RTC 走'); return null; }
        toast('已开启在线对时，正在校时…');
        return Api.syncNtp().then(function () {
          toast('对时完成');
          refreshStatus();
          return Api.status().then(function (s) { fillTimeByEpoch(s.time || s.epoch); });
        }).catch(function (e) {
          /* 设备没联网时 NTP 一定失败，这不是开关的错，说清楚就行 */
          toast('打开成功，但这次对时没成功：' + (e && e.message || '设备可能没联网'), true);
        });
      })
      .catch(function (e) { toast('保存失败：' + (e && e.message || '未知错误'), true); });
  });

  /* ================= 天气：省市两级 + 自动定位 ================= */

  var WX_PICK = { prov: -1, city: -1 };

  function fillProvinces() {
    var prov = $('#setWxProv');
    if (!prov || prov.options.length) return;
    prov.innerHTML = '<option value="-1">省份</option>' +
      CN_CITIES.map(function (p, i) {
        return '<option value="' + i + '">' + p.p + '</option>';
      }).join('');
    fillCities(-1);
  }

  function fillCities(pi) {
    var city = $('#setWxCity');
    if (!city) return;
    if (pi < 0 || !CN_CITIES[pi]) {
      city.innerHTML = '<option value="-1">城市</option>';
      city.disabled = true;
      return;
    }
    city.disabled = false;
    city.innerHTML = CN_CITIES[pi].c.map(function (c, i) {
      return '<option value="' + i + '">' + c.n + '</option>';
    }).join('');
  }

  /* 把配置里的城市回填到两个下拉框：按英文名反查，查不到就当作没选 */
  function applyWxToUI(c) {
    fillProvinces();
    var pi = -1, ci = -1;
    if (c && c.wx_city) {
      CN_CITIES.forEach(function (p, i) {
        p.c.forEach(function (cc, j) {
          if (cc.en && c.wx_city && cc.en.toLowerCase() === String(c.wx_city).toLowerCase()) {
            pi = i; ci = j;
          }
        });
      });
    }
    WX_PICK.prov = pi; WX_PICK.city = ci;
    $('#setWxProv').value = String(pi);
    fillCities(pi);
    if (pi >= 0 && ci >= 0) $('#setWxCity').value = String(ci);
    var auto = !(c && c.wx_auto === false);
    if (c && pi >= 0 && ci >= 0) auto = false;      /* 选了具体城市就不是自动 */
    $('#setWxAuto').checked = auto;
    syncWxUI();
  }

  function syncWxUI() {
    var auto = $('#setWxAuto').checked;
    var prov = $('#setWxProv');
    if (prov) prov.disabled = auto;
    /* 自动定位时整块城市选择收起来：留着两个灰掉的下拉只会让人以为还要选 */
    if ($('#wxManualField')) $('#wxManualField').hidden = auto;
    if (auto) {
      $('#setWxCity').disabled = true;
      $('#wxPickLabel').textContent = '自动（按 IP）';
    } else {
      $('#setWxCity').disabled = WX_PICK.prov < 0;
      var pi = parseInt($('#setWxProv').value, 10);
      var ci = parseInt($('#setWxCity').value, 10);
      $('#wxPickLabel').textContent =
        (pi >= 0 && ci >= 0 && CN_CITIES[pi] && CN_CITIES[pi].c[ci])
          ? CN_CITIES[pi].p + ' · ' + CN_CITIES[pi].c[ci].n
          : '未选择';
    }
  }

  $('#setWxAuto').addEventListener('change', syncWxUI);
  $('#setWxProv').addEventListener('change', function () {
    var pi = parseInt(this.value, 10);
    WX_PICK.prov = pi; WX_PICK.city = -1;
    fillCities(pi);
    syncWxUI();
  });
  $('#setWxCity').addEventListener('change', function () {
    WX_PICK.city = parseInt(this.value, 10);
    syncWxUI();
  });

  $('#btnSaveWx').addEventListener('click', function () {
    if (!Api.isOnline()) { toast('未连接设备，先在右上角「连接设备」', true); return; }
    var auto = $('#setWxAuto').checked;
    var pi = parseInt($('#setWxProv').value, 10);
    var ci = parseInt($('#setWxCity').value, 10);

    var btn = $('#btnSaveWx');
    btn.disabled = true;
    (cfgCache ? Promise.resolve(cfgCache) : Api.getConfig())
      .then(function (c) {
        c = c || {};
        c.wx_auto = auto;
        if (!auto && pi >= 0 && ci >= 0) {
          var city = CN_CITIES[pi].c[ci];
          c.wx_city = city.en;                       /* 固件用它上屏、做 geocoding 兜底 */
          c.wx_lat = city.lat;
          c.wx_lon = city.lon;
          c.wx_label = CN_CITIES[pi].p + '·' + city.n;
        } else {
          c.wx_city = '';
          c.wx_lat = 0;
          c.wx_lon = 0;
          c.wx_label = '';
        }
        cfgCache = c;
        return Api.setConfig(c);
      })
      .then(function () {
        toast(auto ? '已设为按 IP 自动定位'
                    : '天气城市已保存：' + $('#wxPickLabel').textContent);
        return Api.refreshNow(currentLayout()).catch(function () {});
      })
      .catch(function (e) { toast('保存失败：' + (e && e.message || '未知错误'), true); })
      .then(function () { btn.disabled = false; });
  });

  /* 音量：拖动时只改数字，松手才落盘并试听一声。
   * 每次变化固定 10%（range 的 step=10），所以 0~100 只有十档。 */
  /* 提示音关掉时音量条一起灰掉：留着能拖的滑块只会让人以为「调了会响」 */
  function syncVolEnabled() {
    var on = $('#setBeep').checked;
    $('#setVolume').disabled = !on;
    $('#volField').classList.toggle('disabled', !on);
  }
  $('#setBeep').addEventListener('change', syncVolEnabled);

  $('#setVolume').addEventListener('input', function () {
    $('#volVal').textContent = this.value + '%';
  });

  $('#setVolume').addEventListener('change', function () {
    var v = parseInt(this.value, 10);
    $('#volVal').textContent = v + '%';
    if (!Api.isOnline()) return;
    /* 先落盘再试听：试听是按设备侧音量播的，配置没写下去还是旧音量 */
    (cfgCache ? Promise.resolve(cfgCache) : Api.getConfig())
      .then(function (c) {
        c = c || {};
        c.beep_volume = v;
        cfgCache = c;
        return Api.setConfig(c);
      })
      .then(function () { return Api.previewBeep(); })
      .catch(function () {});          /* 试听失败不打扰，保存那步会报错 */
  });

  /* 保存机身传感器校准与按键提示音。走的是同一份 config.json（读-合并-写），
   * 所以不会把 WiFi、刷新间隔这些字段抹掉。 */
  /* 「传感器」：只保存温湿度补偿。
   * 提示音从这张卡里分出去了 —— 它和语音包是一件事，和机壳烘热没关系。 */
  $('#btnSaveBody').addEventListener('click', function () {
    if (!Api.isOnline()) { toast('未连接设备，先在右上角「连接设备」', true); return; }
    var tRaw = $('#setTempOff').value.trim();
    var hRaw = $('#setHumOff').value.trim();
    var t = tRaw === '' ? 0 : parseFloat(tRaw);
    var h = hRaw === '' ? 0 : parseInt(hRaw, 10);
    if (!isFinite(t) || Math.abs(t) > 2) { toast('温度补偿要在 ±2℃ 以内（超了多半是填错了）', true); return; }
    if (!isFinite(h) || Math.abs(h) > 15) { toast('湿度补偿要在 ±15% 以内', true); return; }

    var btn = $('#btnSaveBody');
    btn.disabled = true;
    (cfgCache ? Promise.resolve(cfgCache) : Api.getConfig())
      .then(function (c) {
        c = c || {};
        c.temp_offset_c = t;
        c.hum_offset_pct = h;
        cfgCache = c;
        return Api.setConfig(c);
      })
      .then(function () {
        toast('已保存：温度 ' + (t >= 0 ? '+' : '') + t.toFixed(1) + '℃，湿度 ' +
              (h >= 0 ? '+' : '') + h + '%');
        return Api.refreshNow(currentLayout()).catch(function () {});
      })
      .then(function () { refreshStatus(); })
      .catch(function (e) { toast('保存失败：' + (e && e.message || '未知错误'), true); })
      .then(function () { btn.disabled = false; });
  });

  /* 「提示音」：开关 + 音量 + 语音包，一起落盘。
   * 开关关掉时固件那边 sound_enabled=false，语音提示与音乐提示全都不响 ——
   * 它们共用同一个开关，不需要额外再传一个字段。 */
  function syncBeepUI() {
    var on = $('#setBeep') ? $('#setBeep').checked : true;
    if ($('#volField')) $('#volField').classList.toggle('disabled', !on);
    if ($('#setVolume')) $('#setVolume').disabled = !on;
    if ($('#setSoundPack')) $('#setSoundPack').disabled = !on;
    if ($('#btnBeepPreview')) $('#btnBeepPreview').disabled = !on;
  }

  $('#setBeep').addEventListener('change', syncBeepUI);

  $('#btnBeepPreview').addEventListener('click', function () {
    if (!Api.isOnline()) { toast('未连接设备', true); return; }
    Api.previewBeep().then(function () {
      toast('试听：' + ($('#setSoundPack') ? $('#setSoundPack').value : 'default'));
    }).catch(function (e) { toast('试听失败：' + (e && e.message || '未知错误'), true); });
  });

  $('#btnSaveBeep').addEventListener('click', function () {
    if (!Api.isOnline()) { toast('未连接设备，先在右上角「连接设备」', true); return; }
    var btn = $('#btnSaveBeep');
    btn.disabled = true;
    var on = $('#setBeep').checked;
    (cfgCache ? Promise.resolve(cfgCache) : Api.getConfig())
      .then(function (c) {
        c = c || {};
        c.beep_enabled = on;
        c.beep_mask = currentBeepMask();
        c.beep_volume = parseInt($('#setVolume').value, 10) || 0;
        if ($('#setSoundPack')) c.sound_pack = $('#setSoundPack').value || 'default';
        cfgCache = c;
        return Api.setConfig(c);
      })
      .then(function () {
        toast(on ? ('已保存：音量 ' + (parseInt($('#setVolume').value, 10) || 0) + '%，语音包 ' +
                    ($('#setSoundPack') ? $('#setSoundPack').value : 'default'))
                  : '已关闭提示音（语音与音乐提示一并关闭）');
        return refreshStatus();
      })
      .catch(function (e) { toast('保存失败：' + (e && e.message || '未知错误'), true); })
      .then(function () { btn.disabled = false; });
  });

  /* ================= AI 助手 ================= */

  function aiSay(txt, bad) {
    var el = $('#aiSay');
    if (!el) return;
    el.hidden = !txt;
    el.textContent = txt || '';
    el.classList.toggle('bad', !!bad);
  }

  if ($('#btnAiAsk')) {
    $('#btnAiAsk').addEventListener('click', function () {
      var t = ($('#aiText').value || '').trim();
      if (!t) { $('#aiText').focus(); return; }
      if (!Api.isOnline()) { aiSay('未连接设备', true); return; }
      var b = this;
      b.disabled = true;
      aiSay('正在处理…');
      Api.aiAsk(t).then(function (r) {
        aiSay((r && r.say) || '（没有回复）', !(r && r.ok));
      }).catch(function (e) {
        aiSay('失败：' + (e && e.message || '未知错误'), true);
      }).then(function () { b.disabled = false; });
    });
    $('#aiText').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('#btnAiAsk').click(); }
    });
  }

  if ($('#btnAiSave')) {
    $('#btnAiSave').addEventListener('click', function () {
      if (!Api.isOnline()) { toast('未连接设备', true); return; }
      var b = this;
      b.disabled = true;
      (cfgCache ? Promise.resolve(cfgCache) : Api.getConfig())
        .then(function (c) {
          c = c || {};
          c.ai_enabled = $('#setAiOn').checked;
          c.ai_url = ($('#setAiUrl').value || '').trim();
          cfgCache = c;
          return Api.setConfig(c);
        })
        .then(function () { toast('AI 设置已保存'); })
        .catch(function (e) { toast('保存失败：' + (e && e.message || '未知错误'), true); })
        .then(function () { b.disabled = false; });
    });
  }

  /* ================= 在线媒体资源 ================= */

  /* 设备那边是一个任务在跑（逐项下载 + 校验），网页只负责点开始和轮询进度。
   * 轮询间隔 1.5 秒：几十项资源、每项几百 KB，这个粒度足够，也不会把设备的
   * 单线程 httpd 压满。 */
  var assetsTimer = null;

  function paintAssets(a) {
    if (!a) return;
    var total = a.total || 0, done = a.done || 0;
    var pct = total ? Math.round(done / total * 100) : 0;
    if ($('#assetsProg')) $('#assetsProg').hidden = false;
    if ($('#assetsBar')) $('#assetsBar').style.width = pct + '%';
    if ($('#assetsPct')) $('#assetsPct').textContent = pct + '%';
    if ($('#assetsPhase')) {
      var txt = a.running
        ? ('第 ' + Math.min(done + 1, total) + '/' + total + ' 项' + (a.current ? ' · ' + a.current : ''))
        : (a.message || '—');
      $('#assetsPhase').textContent = txt;
    }
  }

  function pollAssets() {
    Api.assetsState().then(function (a) {
      if (!a) return;
      paintAssets(a);
      if (a.running) return;                 /* 还在跑，下一拍继续 */
      if (assetsTimer) { clearTimeout(assetsTimer); assetsTimer = null; }
      if ($('#btnAssetsGo')) $('#btnAssetsGo').disabled = false;
      toast((a.message || '资源同步结束') + (a.failed ? '（有失败项，可再点一次补）' : ''), a.failed > 0);
    }).catch(function () {});
    if (assetsTimer !== null) assetsTimer = setTimeout(pollAssets, 1500);
  }

  if ($('#btnAssetsGo')) {
    $('#btnAssetsGo').addEventListener('click', function () {
      if (!Api.isOnline()) { toast('未连接设备', true); return; }
      var btn = this;
      btn.disabled = true;
      Api.assetsSync('').then(function (a) {
        paintAssets(a);
        if (assetsTimer) clearTimeout(assetsTimer);
        assetsTimer = setTimeout(pollAssets, 800);
      }).catch(function (e) {
        btn.disabled = false;
        toast('启动失败：' + (e && e.message || '未知错误'), true);
      });
    });
    /* 打开设置页时先看一眼有没有在跑的同步（比如刷新过网页） */
    Api.assetsState().then(function (a) {
      if (a && a.running) {
        if ($('#btnAssetsGo')) $('#btnAssetsGo').disabled = true;
        if (assetsTimer) clearTimeout(assetsTimer);
        assetsTimer = setTimeout(pollAssets, 800);
      }
    }).catch(function () {});
  }

  /* ================= 在线更新 ================= */

  /* 默认地址：发布仓库里的 manifest（jsDelivr 代理 GitHub 仓库文件，免费且走 HTTPS）。
   * 输入框的 value 也是它，这里再留一份，方便配置文件里为空时回填。 */
  var FW_MANIFEST_DEFAULT = 'https://raw.githubusercontent.com/CY-flying/sweetfish-fw/main/manifest.json';

  var fwPoll = null;
  var fwWasActive = false;

  function fwMsg(html, bad) {
    var box = $('#fwRemote');
    box.hidden = false;
    box.classList.toggle('bad', !!bad);
    box.innerHTML = html;
  }

  function fwStopPoll() {
    if (fwPoll) { clearInterval(fwPoll); fwPoll = null; }
  }

  function fwProgress(pct, phase) {
    $('#otaProg').hidden = false;
    $('#otaBar').style.width = Math.max(1, Math.min(100, pct)).toFixed(1) + '%';
    $('#otaPct').textContent = Math.round(pct) + '%';
    $('#otaPhase').textContent = phase;
  }

  /* 「设置地址」只负责打开弹窗：地址是配置项，平时不占版面。
   * 弹窗里预填当前值（没设过就是默认的发布仓库地址）。 */
  function openFwUrlDialog() {
    var d = $('#fwUrlDialog');
    if ($('#setFwUrl')) {
      $('#setFwUrl').value = (cfgCache && cfgCache.fw_manifest) || FW_MANIFEST_DEFAULT;
    }
    if (d && d.showModal && !d.open) d.showModal();
    else if (d) d.setAttribute('open', '');
    setTimeout(function () { if ($('#setFwUrl')) { $('#setFwUrl').focus(); $('#setFwUrl').select(); } }, 30);
  }

  function closeFwUrlDialog() {
    var d = $('#fwUrlDialog');
    if (!d) return;
    if (d.close) d.close(); else d.removeAttribute('open');
  }

  $('#btnFwSave').addEventListener('click', function () {
    if (!Api.isOnline()) { toast('未连接设备', true); return; }
    openFwUrlDialog();
  });

  $('#btnFwUrlSave').addEventListener('click', function () {
    if (!Api.isOnline()) { toast('未连接设备', true); return; }
    var url = $('#setFwUrl').value.trim();
    if (url && url.toLowerCase().indexOf('https://') !== 0) {
      toast('必须是 https:// 开头的地址（设备只认加密连接）', true);
      return;
    }
    var btn = $('#btnFwUrlSave');
    btn.disabled = true;
    (cfgCache ? Promise.resolve(cfgCache) : Api.getConfig())
      .then(function (c) {
        c = c || {};
        c.fw_manifest = url;
        cfgCache = c;
        return Api.setConfig(c);
      })
      .then(function () {
        closeFwUrlDialog();
        toast(url ? '更新地址已保存' : '更新地址已清空');
      })
      .catch(function (e) { toast('保存失败：' + (e && e.message || '未知错误'), true); })
      .then(function () { btn.disabled = false; });
  });

  ['btnFwUrlCancel', 'btnFwUrlClose'].forEach(function (id) {
    $('#' + id).addEventListener('click', closeFwUrlDialog);
  });

  $('#btnFwCheck').addEventListener('click', function () {
    if (!Api.isOnline()) { toast('未连接设备', true); return; }
    if (!$('#setFwUrl').value.trim()) { toast('先填更新地址并保存', true); return; }

    var btn = $('#btnFwCheck');
    btn.disabled = true;
    $('#btnFwGo').hidden = true;        /* 只有查到新版本才把它露出来 */
    fwMsg('正在检查…');

    Api.fwCheck().then(function (r) {
      if (!r || !r.ok) {
        fwMsg('检查失败：' + ((r && r.err) || '未知原因'), true);
        return;
      }
      var lines = '<b>' + esc(r.ver || '—') + '</b>' +
        (r.newer ? '<span class="fw-tag">有新版本</span>' : '<span class="fw-tag">已是最新</span>') +
        '<br>当前版本 ' + esc(r.cur || '—') +
        (r.size ? ' · ' + fmtSize(r.size / 1024) : '');
      if ((r.desc || []).length) {
        lines += '<ul>' + r.desc.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      } else {
        lines += '<br><span style="color:var(--ink-3)">这个包没带更新说明</span>';
      }
      fwMsg(lines);
      /* 按钮只在「确实有新版本」时出现：平时页面上就只有
       * 「设置地址」和「检查更新」两个按钮，符合用户的预期。 */
      $('#btnFwGo').hidden = !r.newer;
      $('#btnFwGo').disabled = !r.newer;
    }).catch(function (e) {
      fwMsg('检查失败：' + (e && e.message || '未知错误'), true);
    }).then(function () { btn.disabled = false; });
  });

  $('#btnFwGo').addEventListener('click', function () {
    if (!Api.isOnline()) { toast('未连接设备', true); return; }
    if (!confirm('从网上拉取新固件并写入设备，期间请勿断电。确定继续？')) return;

    var btn = $('#btnFwGo');
    btn.hidden = false;
    btn.disabled = true;
    btn.textContent = '下载中…';
    fwWasActive = false;
    fwProgress(1, '连接服务器');

    Api.fwGo().then(function () {
      var t0 = Date.now();
      fwStopPoll();
      fwPoll = setInterval(function () {
        if (Date.now() - t0 > 240000) {
          fwStopPoll(); btn.textContent = '在线更新';
          fwMsg('超时：超过 4 分钟没有进展，请检查设备网络', true);
          return;
        }
        Api.otaInfo().then(function (o) {
          var on = (o && o.online) || {};
          if (o && o.active) {
            fwWasActive = true;
            var pct = o.total ? (o.written / o.total * 100) : 0;
            fwProgress(pct, '下载 ' + fmtSize((o.written || 0) / 1024) + ' / ' + fmtSize((o.total || 0) / 1024));
          } else if (on.err) {
            fwStopPoll(); btn.textContent = '在线更新';
            $('#otaProg').hidden = true;
            fwMsg('更新失败：' + esc(on.err), true);
          } else if (fwWasActive) {
            fwStopPoll(); btn.textContent = '在线更新';
            fwProgress(100, '写入完成，设备重启中');
            fwMsg('固件已写入并校验通过，设备正在重启。约 10 秒后重新连接。');
            setTimeout(function () { location.reload(); }, 12000);
          }
        }).catch(function () { /* 设备重启中，连接会断，属于正常 */ });
      }, 1200);
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = '在线更新';
      fwMsg('启动失败：' + (e && e.message || '未知错误'), true);
    });
  });

  /* ================= 文件管理 =================
   *
   * 一张卡管三件事：进目录、删东西、往当前目录传文件。
   * 后端只有 /api/files（GET 列一层 / DELETE 删一个）和 /api/put（上传），
   * 前端不做递归，也不做重命名 —— 用得最多的就是"把语音包拖进去、把旧图删掉"。
   */
  var FS_PATH = '/';

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function fsJoin(dir, name) {
    return (dir === '/' ? '' : dir) + '/' + name;
  }

  function renderFiles(r) {
    FS_PATH = (r && r.path) || '/';
    if ($('#fsPath')) $('#fsPath').textContent = FS_PATH;

    var list = (r && r.entries) || [];
    list.sort(function (a, b) {
      if (!!a.dir !== !!b.dir) return a.dir ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });

    var box = $('#fsList');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="fs-empty">这个目录是空的</div>';
      return;
    }
    box.innerHTML = list.map(function (e) {
      var name = esc(e.name);
      /* 系统预留的那几样（字库/图标/版式/内置网页/出厂语音包/配置）不给删除键，
       * 换成一枚「系统」标签，悬停能看到为什么不能删。设备端也会拦 ——
       * 这里只是不让人白点一下。 */
      var act = e.locked
        ? '<span class="fs-lock" title="' + esc(e.why || '系统文件，不能删除') + '">系统</span>'
        : '<button class="fs-del" type="button" data-del="' + name + '">删除</button>';
      return '<div class="fs-item" data-name="' + name + '" data-dir="' + (e.dir ? 1 : 0) + '">' +
             '<span class="fs-ico' + (e.dir ? ' dir' : '') + '">' + (e.dir ? '▸' : '·') + '</span>' +
             '<span class="fs-name">' + name + (e.dir ? '/' : '') + '</span>' +
             '<span class="fs-size">' + (e.dir ? '' : fmtBytes(e.size)) + '</span>' +
             act +
             '</div>';
    }).join('');
  }

  function loadFiles(path) {
    if (!Api.isOnline()) {
      if ($('#fsList')) $('#fsList').innerHTML = '<div class="fs-empty">未连接设备，先在右上角「连接设备」</div>';
      return;
    }
    Api.fsList(path || '/').then(renderFiles).catch(function (e) {
      if ($('#fsList')) $('#fsList').innerHTML = '<div class="fs-empty">打不开：' + esc(e.message || '未知错误') + '</div>';
    });
  }

  if ($('#fsList')) {
    $('#fsList').addEventListener('click', function (ev) {
      var del = ev.target.closest ? ev.target.closest('[data-del]') : null;
      var item = ev.target.closest ? ev.target.closest('.fs-item') : null;

      if (del && item) {
        var name = del.dataset.del;
        var full = fsJoin(FS_PATH, name);
        if (!confirm('删除 ' + full + ' ？\n这个操作不可撤销。')) return;
        Api.fsDelete(full).then(function () {
          toast('已删除 ' + name);
          loadFiles(FS_PATH);
        }).catch(function (e) { toast('删除失败：' + (e && e.message || '未知错误'), true); });
        return;
      }
      if (item && item.dataset.dir === '1') {
        loadFiles(fsJoin(FS_PATH, item.dataset.name));
      }
    });
  }

  if ($('#btnFsUp')) {
    $('#btnFsUp').addEventListener('click', function () {
      if (FS_PATH === '/' || !FS_PATH) return;
      var up = FS_PATH.replace(/\/[^\/]+$/, '');
      loadFiles(up || '/');
    });
  }
  if ($('#btnFsReload')) {
    $('#btnFsReload').addEventListener('click', function () { loadFiles(FS_PATH); });
  }

  if ($('#fsUpload')) {
    $('#fsUpload').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = '';
      if (!files.length) return;
      if (!Api.isOnline()) { toast('未连接设备', true); return; }

      var box = $('#fsProg'), bar = $('#fsBar'), ph = $('#fsPhase'), pct = $('#fsPct');
      if (box) box.hidden = false;
      var done = 0, ok = 0, fail = [];

      function step() {
        if (done >= files.length) {
          if (bar) bar.style.width = '100%';
          if (ph) ph.textContent = fail.length ? ('完成，失败 ' + fail.length + ' 个') : '上传完成';
          if (pct) pct.textContent = '100%';
          if (ok) toast('已上传 ' + ok + ' 个文件到 ' + FS_PATH);
          if (fail.length) toast('失败：' + fail.join('、'), true);
          setTimeout(function () { if (box) box.hidden = true; }, 1200);
          loadFiles(FS_PATH);
          return;
        }
        var f = files[done];
        if (ph) ph.textContent = '上传 ' + (done + 1) + '/' + files.length + '：' + f.name;
        Api.fsUpload(f, FS_PATH, function (p) {
          var overall = (done + p) / files.length;
          if (bar) bar.style.width = Math.round(overall * 100) + '%';
          if (pct) pct.textContent = Math.round(overall * 100) + '%';
        }).then(function () { ok++; })
          .catch(function (e) { fail.push(f.name + '（' + (e && e.message || '失败') + '）'); })
          .then(function () { done++; step(); });
      }
      step();
    });
  }

  /* ================= 音乐 ================= */

  var MUSIC = { mode: 0, index: 0, items: [] };   /* 0 = 列表循环，与固件缺省一致 */

  function renderMusicUI() {
    $$('#musicMode button').forEach(function (b) {
      b.classList.toggle('sel', parseInt(b.dataset.mode, 10) === MUSIC.mode);
    });
    var box = $('#musicList');
    if (!box) return;
    if (!MUSIC.items.length) {
      box.innerHTML = '<div class="music-empty">' +
        (Api.isOnline() ? 'TF 卡 music 目录里没有 .wav 文件' : '连上设备后才能读取音乐库') +
        '</div>';
    } else {
      box.innerHTML = MUSIC.items.map(function (n, i) {
        return '<button type="button" class="music-item' + (i === MUSIC.index ? ' on' : '') +
               '" data-i="' + i + '"><span class="idx">' + pad2(i + 1) + '</span><span>' +
               esc(n) + '</span></button>';
      }).join('');
    }
    if ($('#musicNow')) $('#musicNow').textContent = MUSIC.items[MUSIC.index] || '—';
  }

  function loadMusic(notify) {
    loadSoundPacks();
    if (!Api.isOnline()) {
      MUSIC.items = []; renderMusicUI();
      if (notify) toast('未连接设备，无法读取音乐库', true);
      return;
    }
    Api.musicList().then(function (r) {
      MUSIC.items = (r && r.items) || [];
      MUSIC.mode = (r && typeof r.mode === 'number') ? r.mode : 0;
      MUSIC.index = (r && typeof r.index === 'number') ? r.index : 0;
      renderMusicUI();
      if (notify) toast(MUSIC.items.length ? '读取到 ' + MUSIC.items.length + ' 首' : 'music 目录里没有 .wav');
    }).catch(function (e) {
      if (notify) toast('读取失败：' + (e && e.message || '未知错误'), true);
    });
  }

  $$('#musicMode button').forEach(function (b) {
    b.addEventListener('click', function () {
      MUSIC.mode = parseInt(b.dataset.mode, 10) || 0;
      renderMusicUI();
    });
  });

  $('#musicList').addEventListener('click', function (e) {
    var item = e.target.closest ? e.target.closest('.music-item') : null;
    if (!item) return;
    MUSIC.index = parseInt(item.dataset.i, 10) || 0;
    renderMusicUI();
  });

  $('#btnMusicReload').addEventListener('click', function () { loadMusic(true); });

  /* ---------- 语音包 ----------
   * 列表来自设备扫描 /sdcard/sounds/*，default 永远第一。
   * 选中值写进 config.json 的 sound_pack，固件按 <包>/<事件>.wav 播放，
   * 缺文件回落到 default。 */
  function loadSoundPacks() {
    var sel = $('#setSoundPack');
    if (!sel) return;
    if (!Api.isOnline()) {
      sel.innerHTML = '<option value="default">default（出厂）</option>';
      return;
    }
    Api.soundPacks().then(function (r) {
      var packs = (r && r.packs) || ['default'];
      var cur = (cfgCache && cfgCache.sound_pack) || (r && r.current) || 'default';
      if (packs.indexOf(cur) < 0) packs = [cur].concat(packs);
      sel.innerHTML = packs.map(function (p) {
        return '<option value="' + esc(p) + '"' + (p === cur ? ' selected' : '') + '>' +
               esc(p) + (p === 'default' ? '（出厂）' : '') + '</option>';
      }).join('');
    }).catch(function () {});
  }

  /* ---------- 上传音乐 ----------
   *
   * 走 /api/put（通用写文件接口，path=/music/<文件名>），边传边报进度。
   * 只收 .wav：固件现在只用 wav 解码，mp3 传上去也放不出来，与其让人传完
   * 一首都没响，不如当场说清楚。
   *
   * 串行传而不是并发：ESP32 的 httpd 只有一条任务，并发上传只会互相抢
   * socket，反而更慢、更容易超时。 */
  function musicUploadOne(file, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', Api.getBase().replace(/\/$/, '') +
               '/api/put?path=' + encodeURIComponent('/music/' + file.name));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.timeout = 180000;
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
  }

  function musicUploadQueue(list) {
    var box = $('#musicProg'), bar = $('#musicBar');
    var ph = $('#musicPhase'), pct = $('#musicPct');
    if (box) box.hidden = false;
    var done = 0, okCount = 0, fail = [];

    function step() {
      if (done >= list.length) {
        if (bar) bar.style.width = '100%';
        if (ph) ph.textContent = fail.length ? ('完成，失败 ' + fail.length + ' 首') : '上传完成';
        if (pct) pct.textContent = '100%';
        if (okCount) toast('已上传 ' + okCount + ' 首音乐');
        if (fail.length) toast('上传失败：' + fail.join('、'), true);
        setTimeout(function () { if (box) box.hidden = true; }, 1400);
        loadMusic(false);
        return;
      }
      var f = list[done];
      if (ph) ph.textContent = '上传 ' + (done + 1) + '/' + list.length + '：' + f.name;
      musicUploadOne(f, function (p) {
        var overall = (done + p) / list.length;
        if (bar) bar.style.width = Math.round(overall * 100) + '%';
        if (pct) pct.textContent = Math.round(overall * 100) + '%';
      }).then(function () { okCount++; })
        .catch(function (e) { fail.push(f.name + '（' + (e && e.message || '未知错误') + '）'); })
        .then(function () { done++; step(); });
    }
    step();
  }

  $('#musicFile').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = '';
    if (!files.length) return;
    if (!Api.isOnline()) { toast('未连接设备，先在右上角「连接设备」', true); return; }
    var wav = [], bad = [];
    files.forEach(function (f) { (/\.wav$/i.test(f.name) ? wav : bad).push(f); });
    if (bad.length) {
      toast('只支持 .wav，已跳过：' + bad.map(function (f) { return f.name; }).join('、'), true);
    }
    if (!wav.length) return;
    musicUploadQueue(wav);
  });

  $('#btnSaveMusic').addEventListener('click', function () {
    if (!Api.isOnline()) { toast('未连接设备', true); return; }
    var btn = $('#btnSaveMusic');
    btn.disabled = true;
    (cfgCache ? Promise.resolve(cfgCache) : Api.getConfig())
      .then(function (c) {
        c = c || {};
        c.music_mode = MUSIC.mode;
        c.music_index = MUSIC.index;
        if ($('#setSoundPack')) c.sound_pack = $('#setSoundPack').value || 'default';
        cfgCache = c;
        return Api.setConfig(c);
      })
      .then(function () { toast('音乐设置已保存，下次长按 KEY 生效'); })
      .catch(function (e) { toast('保存失败：' + (e && e.message || '未知错误'), true); })
      .then(function () { btn.disabled = false; });
  });

  $('#btnRefreshNow').addEventListener('click', function () {
    if (!Api.isOnline()) { toast('未连接设备，先在右上角「连接设备」', true); return; }
    var btn = $('#btnRefreshNow');
    var old = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = '刷新中…';

    var before = null;
    Api.status().then(function (s) { before = s.last_refresh; }).catch(function () {})
      /* 刷新前先把「版式 + 信息栏白/黑底 + 方向」同步给设备。
       * 以前只发 refresh，屏上用的还是上次「应用到设备」时的旧版式，
       * 用户改完白底黑底点刷新会觉得"改了没生效"。 */
      .then(function () {
        return persistPreviewSettings().catch(function () { return null; });
      })
      .then(function () { return Api.refreshNow(currentLayout()); })
      .then(function () {
        toast('已下发刷新，屏上约 25 秒完成');
        btn.textContent = '等待屏完成…';
        /* 屏刷完固件会更新 last_refresh，比对一次才能确认真的刷了，
         * 而不是只看 HTTP 200 —— 固件是先回 ok 再干活的。 */
        var waited = 0;
        var timer = setInterval(function () {
          waited += 6000;
          Api.status().then(function (s) {
            var done = before == null || s.last_refresh !== before;
            if (done || waited >= 60000) {
              clearInterval(timer);
              btn.disabled = false; btn.innerHTML = old;
              refreshStatus();
              if (done) toast('屏幕已刷新');
              else toast('设备没有回报刷新完成，请看看屏幕是否在动', true);
            }
          }).catch(function () {
            if (waited >= 60000) {
              clearInterval(timer);
              btn.disabled = false; btn.innerHTML = old;
              toast('刷新状态查询失败，设备可能已休眠', true);
            }
          });
        }, 6000);
      })
      .catch(function (e) {
        toast('刷新失败：' + e.message, true);
        btn.disabled = false; btn.innerHTML = old;
      });
  });

  $('#btnSleep').addEventListener('click', function () {
    if (!confirm('让设备立即进入休眠？\n网页服务将暂时关闭，设备会按刷新计划或按键再次唤醒。')) return;
    Api.sleep().then(function () {
      toast('设备已休眠');
    }).catch(function (e) { toast('失败：' + e.message, true); });
  });

  /* ================= 固件更新 ================= */

  var otaFile = null;
  var otaInfo = null;      /* 选中的固件解析结果：版本/日期/说明条目 */
  var otaAppLen = 0;       /* 真正的 app 长度；装了说明块时要截掉尾部再上传 */

  var FW_MAGIC = 'SFWNOTE1';

  function fwU32(b, off) {
    return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
  }
  function fwCStr(b, off, n) {
    var out = '';
    for (var i = off; i < off + n && b[i]; i++) out += String.fromCharCode(b[i]);
    return out;
  }
  function fwFind(b, str) {
    var pat = [];
    for (var i = 0; i < str.length; i++) pat.push(str.charCodeAt(i));
    outer:
    for (var k = 0; k + pat.length <= b.length; k++) {
      for (var j = 0; j < pat.length; j++) if (b[k + j] !== pat[j]) continue outer;
      return k;
    }
    return -1;
  }

  /* 读固件里的元数据。两个来源：
   *   ① ESP-IDF 的 app descriptor（bin 偏移 0x20，magic 0xABCD5432）——
   *      版本与编译时间，任何 app.bin 都有；
   *   ② tools/fw_note.py 贴在文件尾的说明块 —— 正式版本号与更新条目。
   * 说明块可能没有（自己编的 bin、老版本），那就走「暂未说明」。 */
  function readFwFile(file) {
    return new Promise(function (resolve) {
      var info = { ver: '', built: '', adVer: '', adDate: '', adTime: '',
                   size: file.size, desc: [], appLen: file.size, noted: false };

      var hr = new FileReader();
      hr.onload = function () {
        try {
          var b = new Uint8Array(hr.result);
          if (b.length >= 0x100 && fwU32(b, 0x20) === 0xABCD5432) {
            info.adVer = fwCStr(b, 0x30, 32);
            info.adTime = fwCStr(b, 0x70, 16);
            info.adDate = fwCStr(b, 0x80, 16);
          }
        } catch (e) { /* 读不出就只显示文件大小 */ }
        readTail();
      };
      hr.onerror = readTail;
      hr.readAsArrayBuffer(file.slice(0, 512));

      function readTail() {
        var tr = new FileReader();
        tr.onload = function () {
          try {
            var b = new Uint8Array(tr.result);
            var m = fwFind(b, FW_MAGIC);
            if (m >= 0) {
              var n = fwU32(b, m + 8);
              if (n > 0 && m + 12 + n <= b.length) {
                var j = JSON.parse(new TextDecoder('utf-8').decode(b.subarray(m + 12, m + 12 + n)));
                info.noted = true;
                info.ver = j.ver || '';
                info.built = j.built || '';
                info.desc = Array.isArray(j.desc) ? j.desc : [];
                if (j.app_len > 0 && j.app_len <= file.size) info.appLen = j.app_len;
              }
            }
          } catch (e) { /* 块坏了就当没有 */ }
          resolve(info);
        };
        tr.onerror = function () { resolve(info); };
        tr.readAsArrayBuffer(file.slice(Math.max(0, file.size - 65536)));
      }
    });
  }

  function showOtaDialog(info) {
    $('#otaDlgVer').textContent = info.ver || info.adVer || '未知';
    var when = info.built || [info.adDate, info.adTime].filter(Boolean).join(' ');
    $('#otaDlgDate').textContent = when || '未知';
    $('#otaDlgSize').textContent = fmtSize(info.size / 1024);

    var box = $('#otaDlgNote');
    box.classList.toggle('none', !info.desc.length);
    box.textContent = info.desc.length
      ? info.desc.map(function (x) { return '· ' + x; }).join('\n')
      : '暂未说明';
    box.scrollTop = 0;

    var dlg = $('#otaDialog');
    if (dlg && dlg.showModal && !dlg.open) dlg.showModal();
    else if (dlg) dlg.setAttribute('open', '');
  }

  function refreshOtaInfo() {
    Api.otaInfo().then(function (o) {
      $('#otaVer').textContent = o.ver || '—';
      $('#otaPart').textContent = o.partition || '—';
      $('#otaSlot').textContent = o.slot ? (o.slot / 1048576).toFixed(1) + ' MB' : '不可更新';

      var warn = $('#otaWarn');
      if (!warn) return;
      if (!Api.isOnline()) {
        warn.innerHTML = '<strong>离线模式。</strong>连上设备后才能更新固件。';
        $('#btnOta').disabled = true;
      } else if (o.rollback_pending) {
        warn.innerHTML = '<strong>新固件待确认。</strong>本次启动自检通过后会自动确认，无需操作。';
      } else if (o.battery_mv && o.battery_mv < 3500 && !o.usb_power) {
        warn.innerHTML = '<strong>电池电压偏低，设备会拒绝写入。</strong>请先接 USB 供电，再更新。';
      } else if (otaFile) {
        /* 已经选好文件：在线状态下把按钮恢复可用，别被上面的分支留下禁用态 */
        $('#btnOta').disabled = false;
      }
    }).catch(function () { /* 老固件没有这个接口，忽略 */ });
  }

  function otaPick(file) {
    if (!file) return;
    if (!/\.bin$/i.test(file.name)) { toast('请选择 .bin 固件文件', true); return; }
    if (file.size < 96 * 1024) { toast('文件过小，不是有效固件', true); return; }
    otaFile = file;
    $('#otaDrop').classList.add('has');
    $('#otaDropTitle').textContent = file.name;
    $('#otaDropSub').textContent = (file.size / 1048576).toFixed(2) + ' MB · 点此重选';
    $('#btnOta').disabled = false;
    $('#btnOta').textContent = '上传并重启';

    /* 选完文件立刻把版本/日期/说明摆出来让人确认 —— 以前是点「上传并重启」
     * 弹一个只有文件名的 confirm，更新内容全靠事先看发布说明。 */
    otaInfo = null;
    readFwFile(file).then(function (info) {
      otaInfo = info;
      otaAppLen = info.appLen;
      showOtaDialog(info);
    });
  }

  /* label 原生会把点击转发给内部 input，不需要再 JS 触发一次。
   * 之前这里是 preventDefault + $('#otaFile').click()，在 iOS Safari / 微信内置
   * 浏览器里对隐藏 input 的脚本点击会被忽略，文件框根本不弹 → "点了没反应"。
   * 现在 input 用 .sr-only 视觉隐藏（仍可聚焦、可被 label 激活）。 */
  $('#otaFile').addEventListener('change', function (e) {
    otaPick(e.target.files && e.target.files[0]);
    e.target.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (t) {
    $('#otaDrop').addEventListener(t, function (e) {
      e.preventDefault(); $('#otaDrop').classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    $('#otaDrop').addEventListener(t, function (e) {
      e.preventDefault(); $('#otaDrop').classList.remove('drag');
    });
  });
  $('#otaDrop').addEventListener('drop', function (e) {
    otaPick(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  /* 真正开始写：弹窗点「开始更新」才走这里 */
  function doFlash() {
    if (!Api.isOnline()) { toast('未连接设备，无法上传固件', true); return; }
    if (!otaFile) { toast('请先选择 .bin 固件文件', true); $('#otaFile').click(); return; }

    var btn = $('#btnOta');
    btn.disabled = true;
    btn.textContent = '更新中…';
    $('#otaProg').hidden = false;
    $('#otaBar').style.width = '1%';
    $('#otaPct').textContent = '0%';
    $('#otaPhase').textContent = '准备中';

    /* 带说明块的包要在上传前截断：说明块只有网页看得懂，写进 app 分区
     * 虽然不影响启动，但没必要让它占空间、也没必要赌 OTA 校验的实现细节。 */
    var blob = (otaAppLen > 0 && otaAppLen < otaFile.size)
      ? otaFile.slice(0, otaAppLen) : otaFile;
    Api.flashFirmware(blob, function (pct, phase) {
      $('#otaBar').style.width = Math.max(1, Math.min(100, pct)).toFixed(1) + '%';
      $('#otaPct').textContent = Math.round(pct) + '%';
      $('#otaPhase').textContent = phase;
    }).then(function () {
      $('#otaPhase').textContent = '写入完成，设备重启中';
      $('#otaPct').textContent = '100%';
      toast('固件已更新，设备正在重启，约 10 秒后重新连接');
      setTimeout(function () { location.reload(); }, 12000);
    }).catch(function (e) {
      $('#otaPhase').textContent = '失败';
      $('#otaBar').style.width = '0%';
      $('#otaProg').hidden = true;
      btn.disabled = false;
      btn.textContent = '重新上传';
      toast('更新失败：' + e.message, true);
    });
  }

  $('#btnOta').addEventListener('click', function () {
    if (!otaFile) { toast('请先选择 .bin 固件文件', true); $('#otaFile').click(); return; }
    if (!Api.isOnline()) { toast('未连接设备，无法上传固件', true); return; }
    /* 已经有解析结果就直接复用；没有（刚打开页面）再读一次 */
    if (otaInfo) showOtaDialog(otaInfo);
    else readFwFile(otaFile).then(function (info) { otaInfo = info; otaAppLen = info.appLen; showOtaDialog(info); });
  });

  /* dialog.close() 在个别老 WebView 上没有，退化成去掉 open 属性 */
  function closeOtaDialog() {
    var d = $('#otaDialog');
    if (!d) return;
    if (d.close) d.close(); else d.removeAttribute('open');
  }

  $('#btnOtaConfirm').addEventListener('click', function () {
    closeOtaDialog();
    doFlash();
  });
  ['btnOtaCancel', 'btnOtaDlgClose'].forEach(function (id) {
    $('#' + id).addEventListener('click', closeOtaDialog);
  });

  /* ================= 启动 ================= */

  function openHashTab() {
    var name = location.hash.slice(1);
    if (PAGE_META[name]) activateTab($('.tab[data-tab="' + name + '"]'), false);
  }
  window.addEventListener('hashchange', openHashTab);
  openHashTab();
  if (typeof renderMusicUI === 'function') renderMusicUI();
  /* 天气卡片先按缺省（自动定位）画一遍：城市选择栏默认收起，
   * 等设备连上后再用 config 里的真实设置覆盖，避免先闪一下两个下拉框。 */
  if ($('#setWxAuto')) { fillProvinces(); syncWxUI(); }

  window.addEventListener('resize', function () {
    layoutCanvas();
  });

  if (window.ResizeObserver) {
    new ResizeObserver(function () { layoutCanvas(); }).observe($('#cropWrap'));
  }

  layoutCanvas();
  syncOrientUI();

  /* 打开页面就自动找设备：同源 → 设备热点 192.168.4.1 → mDNS 名。
   * 必须先确定连接再拉配置，否则 getConfig 会走离线演示数据，把屏幕方向读错。 */
  Api.autoConnect().then(function (url) {
    var ok = !!url;
    setConn(ok, ok ? '已连接' : '离线模式');

    return Api.getConfig().then(function (c) {
      /* 开局先问一次方向：相册页读哪本相册、预览按哪个比例排版都靠它。 */
      if (!c) return;
      cfgCache = c;
      /* 版式也照设备实际的来 —— 否则设备在放温湿度版式、这里却高亮着
       * 「照片 + 信息」，预览和真机对不上。 */
      if (c.default_layout) setLayoutPick(c.default_layout);
      if (!c.orientation) return;
      DEV_ORIENT = PICK_ORIENT = c.orientation;
      if (!GALLERY_READY) GALLERY_ORIENT = isPortrait(DEV_ORIENT) ? 'portrait' : 'landscape';
      if (!S.bitmap) S.orient = DEV_ORIENT;
      syncOrientUI();
      layoutCanvas();
    }).catch(function () {});
  }).then(function () {
    refreshStatus();
    refreshOtaInfo();
    /* 登录即见当前画面：拉一次设备里那张正在显示的照片 */
    loadDeviceScreen();
    setInterval(refreshStatus, 15000);
    setInterval(refreshOtaInfo, 60000);
  });

})();
