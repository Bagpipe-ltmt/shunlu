/* 顺路 —— 车来了实时公交 + 高德路线 + 支付宝乘车码
 * 纯前端，无构建步骤。所有配置存在 localStorage。
 */
(function () {
  'use strict';

  /* =================================================================
   * 0. 小工具
   * ================================================================= */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  function lsGet(key, def) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : def;
    } catch (e) { return def; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 隐私模式忽略 */ }
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2400);
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function clock(ts) {
    var d = new Date(ts || Date.now());
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function fmtDist(m) {
    if (m === null || m === undefined || isNaN(m)) return '';
    m = Number(m);
    if (m < 1000) return Math.round(m) + ' 米';
    return (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' 公里';
  }
  function fmtDur(sec) {
    if (sec === null || sec === undefined || isNaN(sec) || sec < 0) return '—';
    var s = Math.round(Number(sec));
    if (s < 60) return s + ' 秒';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' 分钟';
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return h + ' 小时' + (mm ? ' ' + mm + ' 分' : '');
  }

  function haversine(lat1, lng1, lat2, lng2) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* ---------------- 坐标：浏览器给 WGS84，高德/换乘规划要 GCJ02 ---------------- */

  var AA = 6378245.0;
  var EE = 0.00669342162296594323;

  function outOfChina(lat, lng) {
    return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
  }
  function tLat(x, y) {
    var r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    r += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return r;
  }
  function tLng(x, y) {
    var r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    r += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return r;
  }
  function wgs2gcj(lat, lng) {
    if (outOfChina(lat, lng)) return { lat: lat, lng: lng };
    var dLat = tLat(lng - 105.0, lat - 35.0);
    var dLng = tLng(lng - 105.0, lat - 35.0);
    var radLat = lat / 180.0 * Math.PI;
    var magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((AA * (1 - EE)) / (magic * sqrtMagic) * Math.PI);
    dLng = (dLng * 180.0) / (AA / sqrtMagic * Math.cos(radLat) * Math.PI);
    return { lat: lat + dLat, lng: lng + dLng };
  }

  /* =================================================================
   * 1. 配置
   * ================================================================= */

  var DEFAULT_CFG = {
    cityId: '034',
    cityName: '上海',
    busBase: 'https://ts-api.tundrey.com',
    amapKey: '',
    proxy: '',
    codeScheme: 'alipays://platformapi/startapp?appId=200011235'
  };

  var cfg = Object.assign({}, DEFAULT_CFG, lsGet('shunlu.cfg.v1', {}));

  function saveCfg() {
    lsSet('shunlu.cfg.v1', cfg);
    $('#city-label').textContent = cfg.cityName || '城市';
  }

  /* =================================================================
   * 2. 网络
   * ================================================================= */

  function getJSON(url, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 13000);
    var opts = { cache: 'no-store', headers: { Accept: 'application/json' } };
    if (ctrl) opts.signal = ctrl.signal;

    return fetch(url, opts).then(function (r) {
      return r.text().then(function (text) {
        var json = null;
        try { json = JSON.parse(text); } catch (e) { /* 可能不是 JSON */ }
        if (!json) {
          throw new Error('接口返回异常（HTTP ' + r.status + '）');
        }
        return { status: r.status, json: json };
      });
    }).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      if (err && (err.name === 'AbortError')) throw new Error('请求超时，检查一下网络');
      var m = err && err.message ? err.message : String(err);
      if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
        throw new Error('请求被拦截或没网（也可能是接口地址填错）');
      }
      throw new Error('网络不通：' + m);
    });
  }

  function qs(params) {
    var sp = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      sp.append(k, v);
    });
    return sp.toString();
  }

  function buildUrl(base, path, params) {
    var url = String(base).replace(/\/+$/, '') + path + '?' + qs(params);
    if (cfg.proxy) {
      url = String(cfg.proxy).replace(/\/+$/, '') + '?url=' + encodeURIComponent(url);
    }
    return url;
  }

  /* ---------------- 车来了（chelaile-api-server 协议） ---------------- */

  function busApi(path, params) {
    return getJSON(buildUrl(cfg.busBase || DEFAULT_CFG.busBase, path, params)).then(function (res) {
      var j = res.json || {};
      if (j.error) {
        var e = new Error(j.error.message || j.error.code || '公交接口返回错误');
        e.code = j.error.code;
        throw e;
      }
      return j;
    });
  }

  /* ---------------- 高德 ---------------- */

  function needKey() {
    var e = new Error('这个功能需要高德 Key，在「我的」里填一下（免费申请）');
    e.needKey = true;
    return e;
  }

  function amapApi(path, params) {
    if (!cfg.amapKey) return Promise.reject(needKey());
    var p = Object.assign({ key: cfg.amapKey }, params);
    return getJSON(buildUrl('https://restapi.amap.com', path, p)).then(function (res) {
      var j = res.json || {};
      var ok = String(j.status) === '1' || j.errcode === 0;
      if (!ok) {
        var info = j.info || j.errmsg || ('HTTP ' + res.status);
        var e = new Error('高德：' + info);
        if (String(j.infocode) === '10001' || String(j.infocode) === '10009') e.needKey = true;
        throw e;
      }
      return j;
    });
  }

  /* ---------------- 定位 ---------------- */

  // 当前是不是「http 打开的局域网/本地地址」——这类页面手机不给定位
  function isHttpPage() {
    if (location.protocol !== 'http:') return false;
    return !/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(location.hostname);
  }

  var ONLINE_URL = 'https://shunlu.pages.dev';

  function geolocate() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error('这台设备的浏览器不给定位，手填地址更快'));
      // 不要只凭 isSecureContext 提前拒绝：有些内置浏览器/WebView 这个标记不准，
      // 而 https 页面里的定位其实是好的。先真去要一次，失败了再解释原因。
      navigator.geolocation.getCurrentPosition(function (pos) {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
      }, function (err) {
        var bad = isHttpPage();
        var denied = !!(err && err.code === 1);
        var msg;
        if (bad) msg = '这是 http 打开的，手机不给定位；换成线上 https 地址就行';
        else if (denied) msg = '定位被拒：这个浏览器没给位置权限（Via 这类精简浏览器常见），直接手填地址更快';
        else if (err && err.code === 3) msg = '定位超时了，靠近窗边再试，或手填地址';
        else msg = '定位没成功，手填地址更快';
        var e = new Error(msg);
        e.insecure = bad;
        e.denied = denied;
        reject(e);
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }

  // 顶部提示条：http 页面时告诉用户去哪儿用定位
  function checkInsecureBar() {
    var bar = $('#insecure-bar');
    if (!bar) return;
    if (!isHttpPage()) { bar.hidden = true; return; }
    bar.hidden = false;
    var link = $('#insecure-link');
    if (link) link.setAttribute('href', ONLINE_URL + (location.hash || ''));
  }

  /* =================================================================
   * 3. 状态
   * ================================================================= */

  var state = {
    tab: 'bus',
    loc: null,        // WGS84
    watch: lsGet('shunlu.watch.v1', []),
    places: lsGet('shunlu.places.v1', []),
    searchLines: [],
    searchStops: [],
    nearby: null,
    nearbyErr: null,
    route: { from: null, to: null, mode: 'transit', plans: [], loading: false },
    tipTimer: null,
    refreshTimer: null,
    installEvent: null
  };

  function persistWatch() { lsSet('shunlu.watch.v1', state.watch); }
  function persistPlaces() { lsSet('shunlu.places.v1', state.places); }

  function rememberPlace(p) {
    if (!p || !p.lat) return;
    state.places = state.places.filter(function (x) {
      return !(x.name === p.name && Math.abs(x.lat - p.lat) < 0.0002);
    });
    state.places.unshift({ name: p.name, lat: p.lat, lng: p.lng });
    state.places = state.places.slice(0, 8);
    persistPlaces();
  }

  /* =================================================================
   * 4. 弹层 / 对话框
   * ================================================================= */

  function openSheet(title, html) {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = html;
    $('#mask').classList.add('show');
    $('#sheet').classList.add('show');
  }
  function closeSheet() {
    $('#mask').classList.remove('show');
    $('#sheet').classList.remove('show');
  }

  /* 先尝试 App scheme，超时后回落到网页 */
  function tryScheme(scheme, onFail, waitMs) {
    var wait = waitMs || 1700;
    try { window.location.href = scheme; } catch (e) { /* 忽略 */ }
    setTimeout(function () {
      if (document.hidden) return;      // 切到别处了，说明 App 起来了
      if (typeof onFail === 'function') onFail();
    }, wait);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { toast('已复制'); },
        function () { toast('复制失败，长按文字手动复制'); });
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  /* =================================================================
   * 5. 高德 / 支付宝 跳转
   * ================================================================= */

  var MODE_T = { drive: 0, transit: 1, walk: 2, ride: 3 };

  function amapScheme(from, to, mode) {
    var t = MODE_T[mode] === undefined ? 1 : MODE_T[mode];
    var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    var p = 'sourceApplication=shunlu' +
      '&slat=' + from.lat + '&slon=' + from.lng + '&sname=' + encodeURIComponent(from.name || '起点') +
      '&dlat=' + to.lat + '&dlon=' + to.lng + '&dname=' + encodeURIComponent(to.name || '终点') +
      '&dev=0&t=' + t;
    return isIOS ? 'iosamap://path?' + p : 'amapuri://route/plan/?' + p;
  }

  function amapWebUrl(from, to, mode) {
    var m = { transit: 'bus', drive: 'car', walk: 'walk', ride: 'ride' }[mode] || 'bus';
    return 'https://uri.amap.com/navigation?from=' + from.lng + ',' + from.lat + ',' +
      encodeURIComponent(from.name || '起点') + '&to=' + to.lng + ',' + to.lat + ',' +
      encodeURIComponent(to.name || '终点') + '&mode=' + m + '&policy=1&src=shunlu&coordinate=gaode&callnative=1';
  }

  function openNavigation(from, to, mode) {
    if (!from || !to) { toast('起点和终点都要有坐标'); return; }
    tryScheme(amapScheme(from, to, mode), function () {
      window.location.href = amapWebUrl(from, to, mode);
    }, 1600);
  }

  function openAlipay(kind) {
    var scheme = kind === 'scan'
      ? 'alipays://platformapi/startapp?saId=10000007'
      : (cfg.codeScheme || DEFAULT_CFG.codeScheme);
    var fired = false;
    tryScheme(scheme, function () {
      if (fired) return;
      fired = true;
      openSheet('没跳过去？', [
        '<div class="hint"><span>🛈</span><span>浏览器可能拦截了 App 跳转。手动路径一样快：',
        kind === 'scan' ? '支付宝首页 → 顶部「扫一扫」' : '支付宝首页 → 出行 → 乘车码',
        '</span></div>',
        '<button class="btn block primary" style="margin-top:12px" data-act="copy" data-text="' + esc(scheme) + '">复制跳转链接</button>',
        '<button class="btn block ghost" style="margin-top:8px" data-act="alipay-retry" data-kind="' + esc(kind) + '">再试一次</button>',
        '<div class="tiny muted" style="margin-top:12px">链接：' + esc(scheme) + '</div>'
      ].join(''));
    }, 1900);
  }

  /* =================================================================
   * 6. 视图切换
   * ================================================================= */

  var TABS = ['bus', 'route', 'code', 'me'];

  function setTab(name) {
    if (TABS.indexOf(name) < 0) return;
    state.tab = name;
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    var view = $('#view-' + name);
    if (view) view.classList.add('active');
    $$('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    window.scrollTo(0, 0);
    if (name === 'me') { fillSettings(); checkHealth(); }
    if (name === 'code') renderPlaces();
    if (name === 'route' && !state.route.plans.length) renderPlans();
  }

  /* =================================================================
   * 7. 公交：搜索
   * ================================================================= */

  function doSearch() {
    var q = ($('#q').value || '').trim();
    if (!q) { toast('输入线路号或站点名'); return; }
    $('#search-results').innerHTML = '<div class="card"><div class="skel" style="width:60%"></div><div class="skel" style="width:80%;margin-top:10px"></div></div>';
    busApi('/v1/search', { city_id: cfg.cityId, keyword: q }).then(function (j) {
      state.searchLines = (j.lines || []).slice(0, 8);
      state.searchStops = (j.stations || []).slice(0, 8);
      renderSearch();
    }).catch(function (e) {
      $('#search-results').innerHTML = '<div class="card"><div class="hint warn"><span>⚠</span><span>' + esc(e.message) + '</span></div></div>';
    });
  }

  function renderSearch() {
    var box = $('#search-results');
    var lines = state.searchLines, stops = state.searchStops;
    if (!lines.length && !stops.length) {
      box.innerHTML = '<div class="card"><div class="empty">没找到，换成线路号（如 71）或站名试试</div></div>';
      return;
    }
    var html = '';

    if (lines.length) {
      html += '<div class="card"><div class="h2">线路 <span class="tag">点一条选方向</span></div><div class="list">';
      lines.forEach(function (l, i) {
        var dirs = l.directions && l.directions.length ? l.directions : [{ direction: l.direction, lineId: l.lineId, startSn: l.startSn, endSn: l.endSn }];
        var d0 = dirs[0] || {};
        html += '<button class="item" data-act="line-open" data-i="' + i + '">' +
          '<span class="lineno' + (l.isSubway ? ' metro' : '') + '">' + esc(l.name) + '</span>' +
          '<span class="grow" style="min-width:0">' +
          '<span class="ellipsis" style="display:block">' + esc(d0.startSn || '') + ' → ' + esc(d0.endSn || '') + '</span>' +
          '<span class="sub ellipsis" style="display:block">' + (l.isSubway ? '地铁' : '公交') + ' · ' + dirs.length + ' 个方向</span>' +
          '</span><span class="muted">›</span></button>';
      });
      html += '</div></div>';
    }

    if (stops.length) {
      html += '<div class="card"><div class="h2">站点 <span class="tag">点一查看经过的线路</span></div><div class="list">';
      stops.forEach(function (s, i) {
        var dist = state.loc && s.lat ? haversine(state.loc.lat, state.loc.lng, s.lat, s.lng) : null;
        html += '<button class="item" data-act="stop-open" data-i="' + i + '">' +
          '<span class="badge gray" style="flex:none">站点</span>' +
          '<span class="grow" style="min-width:0"><span class="ellipsis" style="display:block">' + esc(s.sn) + '</span>' +
          '<span class="sub">' + (dist ? fmtDist(dist) + ' · ' : '') + (s.isSubway ? '地铁站' : '公交站') + '</span></span>' +
          '<span class="muted">›</span></button>';
      });
      html += '</div></div>';
    }

    box.innerHTML = html;
  }

  /* 线路 → 选方向 */
  function openDirections(line) {
    var dirs = line.directions && line.directions.length
      ? line.directions
      : [{ direction: line.direction, lineId: line.lineId, startSn: line.startSn, endSn: line.endSn }];

    var html = '<div class="list">' + dirs.map(function (d) {
      return '<button class="item" data-act="dir-pick" data-lineid="' + esc(d.lineId) + '" data-name="' + esc(line.name) + '" data-end="' + esc(d.endSn || '') + '">' +
        '<span class="badge">开往 ' + esc(d.endSn || '') + '</span>' +
        '<span class="grow tiny muted ellipsis">' + esc(d.startSn || '') + ' → ' + esc(d.endSn || '') + '</span>' +
        '<span class="muted">›</span></button>';
    }).join('') + '</div>';
    openSheet(line.name + (line.isSubway ? ' 号线' : ' 路'), html);
  }

  /* 选方向 → 选上车站 */
  function openLineStations(lineId, name, endSn) {
    openSheet(name + ' 路 · ' + (endSn || ''), '<div class="empty"><div class="skel" style="width:70%;margin:0 auto"></div></div>');
    busApi('/v1/lines/detail', { city_id: cfg.cityId, line_id: lineId }).then(function (j) {
      if (j.empty || !j.stations || !j.stations.length) {
        openSheet(name + ' 路', '<div class="empty">' + esc(j.hint || '这条线暂时没有站点数据（地铁线路请用「附近站点」查看）') + '</div>');
        return;
      }
      var line = j.line || {};
      var head = '<div class="row" style="gap:8px;margin-bottom:6px">' +
        '<span class="badge gray">' + esc(line.firstTime || '') + ' – ' + esc(line.lastTime || '') + '</span>' +
        '<span class="badge gray">' + esc(line.price || '票价未提供') + '</span>' +
        '<span class="badge gray">' + (line.stationsNum || j.stations.length) + ' 站</span></div>';
      var html = head + '<div class="tiny muted" style="margin-bottom:6px">选你的上车站：</div><div class="list">';
      j.stations.forEach(function (s) {
        html += '<button class="item" data-act="station-pick" ' +
          'data-lineid="' + esc(lineId) + '" data-name="' + esc(name) + '" data-end="' + esc(endSn || line.endSn || '') + '" ' +
          'data-dir="' + esc(line.direction) + '" data-order="' + esc(s.order) + '" ' +
          'data-sid="' + esc(s.sId) + '" data-sname="' + esc(s.sn) + '" ' +
          'data-lat="' + esc(s.wgsLat || '') + '" data-lng="' + esc(s.wgsLng || '') + '">' +
          '<span class="badge gray" style="flex:none">' + esc(s.order) + '</span>' +
          '<span class="grow" style="min-width:0"><span class="ellipsis" style="display:block">' + esc(s.sn) + '</span>' +
          (s.metros && s.metros.length ? '<span class="sub ellipsis" style="display:block">可换 ' + esc(s.metros.map(function (m) { return m.name; }).join(' / ')) + '</span>' : '') +
          '</span><span class="muted">＋</span></button>';
      });
      html += '</div>';
      openSheet(name + ' 路 · 选站', html);
    }).catch(function (e) {
      openSheet(name + ' 路', '<div class="hint warn"><span>⚠</span><span>' + esc(e.message) + '</span></div>');
    });
  }

  /* 搜索里的站点 → 经过的线路 */
  function openStop(s) {
    if (!s.physicalStId) { toast('这个站点缺少详细信息'); return; }
    openSheet(s.sn, '<div class="empty"><div class="skel" style="width:70%;margin:0 auto"></div></div>');
    busApi('/v1/stops/detail', {
      city_id: cfg.cityId, physical_st_id: s.physicalStId,
      namesake_st_id: s.namesakeStId || '',
      lat: state.loc ? state.loc.lat : '', lng: state.loc ? state.loc.lng : ''
    }).then(function (j) {
      var stations = j.stations || [];
      if (!stations.length) { openSheet(s.sn, '<div class="empty">这个站暂时没有到站数据</div>'); return; }
      var html = '';
      stations.forEach(function (st) {
        html += '<div class="h2" style="margin-top:2px">' + esc(st.sn) + '</div><div class="list">';
        (st.lines || []).forEach(function (l) {
          var eta = lineEta(l);
          html += '<button class="item" data-act="stop-add" ' +
            'data-lineid="' + esc(l.lineId) + '" data-name="' + esc(l.name) + '" data-dir="' + esc(l.direction) + '" ' +
            'data-end="' + esc(l.endSn || '') + '" data-order="' + esc(l.targetOrder) + '" ' +
            'data-sid="' + esc(st.sId) + '" data-sname="' + esc(st.sn) + '" ' +
            'data-lat="' + esc(st.lat || '') + '" data-lng="' + esc(st.lng || '') + '">' +
            '<span class="lineno' + (l.isSubway ? ' metro' : '') + '" style="min-width:44px;height:26px;font-size:13px">' + esc(l.name) + '</span>' +
            '<span class="grow" style="min-width:0"><span class="ellipsis" style="display:block">开往 ' + esc(l.endSn || '') + '</span>' +
            '<span class="sub">' + esc(l.firstTime || '') + '–' + esc(l.lastTime || '') + (l.price ? ' · ' + esc(l.price) : '') + '</span></span>' +
            '<span class="tiny" style="color:var(--green)">' + (eta ? Math.max(1, Math.round(eta.sec / 60)) + ' 分' : '＋') + '</span></button>';
        });
        html += '</div>';
      });
      openSheet(s.sn + ' · 经过线路', html);
    }).catch(function (e) {
      openSheet(s.sn, '<div class="hint warn"><span>⚠</span><span>' + esc(e.message) + '</span></div>');
    });
  }

  /* =================================================================
   * 8. 公交：附近站点
   * ================================================================= */

  /* 到站时间：lines/realtime 给 eta.travelTime，stops/nearby 直接给 travelTime */
  function lineEta(line) {
    var buses = (line && line.buses) || [];
    for (var i = 0; i < buses.length; i++) {
      var b = buses[i];
      if (b.eta && b.eta.travelTime >= 0) return { sec: b.eta.travelTime, bus: b };
      if (typeof b.travelTime === 'number' && b.travelTime >= 0) return { sec: b.travelTime, bus: b };
    }
    return null;
  }

  function etaText(line, short) {
    var e = lineEta(line);
    if (e) {
      if (e.sec < 60) return '即将到站';
      var m = Math.round(e.sec / 60);
      return short ? m + ' 分' : m + ' 分钟';
    }
    if (line && line.buses && line.buses.length) return '在途';
    if (line && line.preArrivalTime) return line.preArrivalTime + ' 发车';
    return '';
  }

  function loadNearby() {
    var box = $('#nearby-box');
    box.innerHTML = '<div class="card"><div class="skel" style="width:50%"></div><div class="skel" style="width:75%;margin-top:10px"></div></div>';

    var ready = state.loc ? Promise.resolve(state.loc) : geolocate().then(function (loc) {
      state.loc = loc;
      return loc;
    });

    ready.then(function (loc) {
      return busApi('/v1/stops/nearby', {
        city_id: cfg.cityId, lat: loc.lat, lng: loc.lng, limit: 6
      });
    }).then(function (j) {
      state.nearby = j.stops || [];
      state.nearbyErr = null;
      renderNearby();
    }).catch(function (e) {
      state.nearbyErr = e.message;
      var httpPage = isHttpPage();
      box.innerHTML = '<div class="card">' +
        '<div class="hint warn" style="margin-bottom:12px"><span>⚠</span><span>' + esc(e.message) + '</span></div>' +
        '<div class="tiny muted" style="line-height:1.7;margin-bottom:14px">' +
        (httpPage
          ? '你现在是用局域网 http 地址打开的，手机在这类页面上禁用定位。换成 https 的线上版就能用；其他功能（搜线路、看站牌、查换乘、跳高德）不受影响。'
          : '手机只在 https 页面（或 localhost）给定位。如果刚才点了「不允许」，点地址栏左边的锁/信息图标把位置改成允许；如果点了允许还是这样，多半是这个浏览器没有位置权限（Via 这类精简浏览器常见）——换 Chrome 最省事，或者直接搜站名。') +
        '</div>' +
        '<div class="row" style="gap:8px">' +
        (httpPage
          ? '<a class="btn primary grow" style="text-decoration:none" href="' + ONLINE_URL + '">打开线上版</a>'
          : '<button class="btn primary grow" data-act="focus-search">改用手动搜索</button>') +
        '<button class="btn ghost" data-act="nearby">重试定位</button>' +
        '</div></div>';
    });
  }

  function renderNearby() {
    var box = $('#nearby-box');
    if (!state.nearby || !state.nearby.length) {
      box.innerHTML = '<div class="card"><div class="empty">附近 1 公里内没有查到站点，换个城市试试？</div></div>';
      return;
    }
    var html = '<div class="card flush"><div style="padding:14px 14px 6px"><div class="h2" style="margin:0">附近站点 <span class="tag">按距离排序</span></div></div><div style="padding:0 14px 12px">';
    state.nearby.forEach(function (st) {
      html += '<div style="padding:10px 0;border-top:1px solid var(--line)">' +
        '<div class="row"><b style="font-size:14px">' + esc(st.sn) + '</b>' +
        '<span class="tiny muted">' + fmtDist(st.distance) + '</span>' +
        (st.isSubway ? '<span class="badge" style="height:18px">地铁</span>' : '') + '</div>';
      var lines = (st.lines || []).slice(0, 6);
      if (!lines.length) html += '<div class="tiny muted" style="margin-top:4px">暂无线路信息</div>';
      lines.forEach(function (l) {
        var when = etaText(l);
        var hasEta = !!lineEta(l) || !!(l.buses && l.buses.length);
        html += '<button class="bus-row" style="width:100%;border:0;text-align:left;margin-top:6px" data-act="nearby-add" ' +
          'data-lineid="' + esc(l.lineId) + '" data-name="' + esc(l.name) + '" data-dir="' + esc(l.direction) + '" ' +
          'data-end="' + esc(l.endSn || '') + '" data-order="' + esc(l.targetOrder) + '" ' +
          'data-sid="' + esc(l.targetStationId || st.sId) + '" data-sname="' + esc(st.sn) + '">' +
          '<span class="lineno' + (l.isSubway ? ' metro' : '') + '">' + esc(l.name) + '</span>' +
          '<span class="grow ellipsis">开往 ' + esc(l.endSn || '') + (l.status && !l.preArrivalTime ? ' · ' + esc(l.status) : '') + '</span>' +
          '<span style="color:' + (hasEta ? 'var(--green)' : 'var(--sub)') + ';font-weight:600">' + esc(when || '＋') + '</span>' +
          '</button>';
      });
      html += '</div>';
    });
    html += '</div><div class="hint" style="margin:0 14px 14px"><span>🛈</span><span>点任意线路即可加入「我的站牌」，之后自动刷新到站时间。</span></div></div>';
    box.innerHTML = html;
  }

  /* =================================================================
   * 9. 公交：我的站牌
   * ================================================================= */

  function addWatch(w) {
    if (!w.lineId || !w.stationId) { toast('缺少线路信息'); return; }
    var key = w.lineId + '|' + w.stationId + '|' + w.targetOrder;
    if (state.watch.some(function (x) { return x.key === key; })) {
      toast('已经在我的站牌里了');
      closeSheet();
      return;
    }
    if (state.watch.length >= 12) { toast('最多 12 个站牌，先删掉几个'); return; }
    w.key = key;
    w.cityId = w.cityId || cfg.cityId;
    w.addedAt = Date.now();
    state.watch.unshift(w);
    persistWatch();
    closeSheet();
    toast('已加入我的站牌');
    renderWatch();
    refreshWatch(true);
  }

  function removeWatch(key) {
    state.watch = state.watch.filter(function (w) { return w.key !== key; });
    persistWatch();
    renderWatch();
  }

  function refreshWatch(manual) {
    if (!state.watch.length) { renderWatch(); return; }
    $('#btn-refresh').classList.add('busy');

    var jobs = state.watch.map(function (w) {
      return busApi('/v1/lines/realtime', {
        city_id: w.cityId || cfg.cityId,
        line_id: w.lineId,
        target_order: w.targetOrder,
        station_id: w.stationId,
        lat: w.stopLat || (state.loc ? state.loc.lat : ''),
        lng: w.stopLng || (state.loc ? state.loc.lng : '')
      }).then(function (j) { return { ok: true, j: j }; })
        .catch(function (e) { return { ok: false, e: e.message }; });
    });

    Promise.all(jobs).then(function (results) {
      results.forEach(function (r, i) {
        if (state.watch[i]) {
          state.watch[i].rt = r;
          state.watch[i].ts = Date.now();
        }
      });
      renderWatch();
      $('#btn-refresh').classList.remove('busy');
      $('#bus-updated').textContent = '更新于 ' + clock();
      if (manual) toast('已刷新');
    });
  }

  function capacityBadge(cap) {
    if (cap === 2) return '<span class="badge red">拥挤</span>';
    if (cap === 1) return '<span class="badge orange">适中</span>';
    if (cap === 0) return '<span class="badge green">空</span>';
    return '';
  }

  function watchCard(w) {
    var rt = w.rt;
    var buses = [];
    var real = null;
    if (rt && rt.ok && rt.j) {
      buses = rt.j.buses || [];
      real = rt.j.realData !== false;
    }

    var first = null;
    for (var i = 0; i < buses.length; i++) {
      if (buses[i].eta && buses[i].eta.travelTime >= 0) { first = buses[i]; break; }
    }
    if (!first && buses.length) first = buses[0];

    var etaHtml = '';
    if (!rt) {
      etaHtml = '<b class="none">···</b><span>加载中</span>';
    } else if (!rt.ok) {
      etaHtml = '<b class="none">读取失败</b><span>' + esc(rt.e || '') + '</span>';
    } else if (!buses.length) {
      etaHtml = '<b class="none">暂无车</b><span>' + (real === false ? '未发车 / 非实时' : '等下一班') + '</span>';
    } else if (first.eta && first.eta.travelTime >= 0) {
      var sec = first.eta.travelTime;
      var soon = sec <= 120;
      etaHtml = '<b class="' + (soon ? 'soon' : '') + (sec < 60 ? ' word' : '') + '">' +
        (sec < 60 ? '即将到站' : Math.round(sec / 60) + '<small style="font-size:13px;font-weight:600">分钟</small>') +
        '</b><span>' + (first.eta.displayTime ? esc(first.eta.displayTime) + ' 到站' : '预计到站时间') + '</span>';
    } else {
      var away = null;
      if (first.order !== undefined && w.targetOrder) {
        away = Math.max(0, Number(w.targetOrder) - Number(first.order));
      }
      var big, small;
      if (away !== null && away > 0) { big = '还有 ' + away + ' 站'; small = first.distanceToWaitStn ? fmtDist(first.distanceToWaitStn) : '估算位置'; }
      else if (away === 0) { big = '已进站'; small = '正在上下客'; }
      else { big = '在途'; small = first.distanceToWaitStn ? fmtDist(first.distanceToWaitStn) : '等待实时数据'; }
      etaHtml = '<b class="none">' + big + '</b><span>' + small + '</span>';
    }

    var rows = '';
    buses.slice(0, 3).forEach(function (b, idx) {
      var when = b.eta && b.eta.travelTime >= 0
        ? (b.eta.travelTime < 60 ? '即将到站' : Math.round(b.eta.travelTime / 60) + ' 分钟')
        : (b.distanceToWaitStn ? '距站 ' + fmtDist(b.distanceToWaitStn) : '在途');
      rows += '<div class="bus-row">' +
        '<span style="flex:none" class="tiny">' + (idx === 0 ? '下一辆' : '第' + (idx + 1) + '辆') + '</span>' +
        '<b>' + esc(when) + '</b>' +
        (b.licence ? '<span class="tiny" style="opacity:.7">' + esc(b.licence) + '</span>' : '') +
        '<span style="margin-left:auto">' + capacityBadge(b.capacity) + '</span>' +
        '</div>';
    });
    if (!rows && rt && rt.ok) {
      rows = '<div class="bus-row"><span>暂时没有车辆数据，稍后再刷新</span></div>';
    }

    var navBtn = (w.stopLat && w.stopLng)
      ? '<button class="btn sm ghost" data-act="walk-to-stop" data-i="' + esc(w.key) + '">步行到站</button>'
      : '';

    return '<div class="board">' +
      '<div class="board-head">' +
      '<span class="lineno">' + esc(w.name) + '</span>' +
      '<div class="grow" style="min-width:0">' +
      '<div class="ellipsis" style="font-weight:600;font-size:14px">' + esc(w.stationName) + '</div>' +
      '<div class="dir ellipsis">开往 ' + esc(w.endSn || '') + ' · 第 ' + esc(w.targetOrder) + ' 站</div>' +
      '</div>' +
      '<div class="eta">' + etaHtml + '</div>' +
      '</div>' +
      '<div class="buses">' + rows + '</div>' +
      '<div class="row" style="margin-top:10px;gap:8px">' +
      navBtn +
      '<span class="tiny muted grow" style="text-align:right">' + (w.ts ? clock(w.ts) + ' 更新' : '') + '</span>' +
      '<button class="btn sm ghost" data-act="watch-del" data-key="' + esc(w.key) + '">移除</button>' +
      '</div>' +
      '</div>';
  }

  function renderWatch() {
    var box = $('#watch-box');
    $('#watch-count').textContent = String(state.watch.length);
    $('#btn-clear-watch').hidden = state.watch.length === 0;
    $('#bus-empty').hidden = state.watch.length > 0;

    if (!state.watch.length) { box.innerHTML = ''; return; }
    box.innerHTML = state.watch.map(watchCard).join('') +
      '<button class="addhint" data-act="focus-search">＋ 再搜一条线路或站点，加入站牌</button>';
  }

  /* =================================================================
   * 10. 路线
   * ================================================================= */

  function pointLabel(p, placeholder) {
    return p ? p.name : placeholder;
  }

  function setPoint(which, p) {
    state.route[which] = p;
    var input = which === 'from' ? $('#from-input') : $('#to-input');
    if (input) input.value = p ? p.name : '';
    $('#tips-box').innerHTML = '';
    if (p) rememberPlace(p);
  }

  /* 深链：?from=31.23,121.47,人民广场&to=31.24,121.50,陆家嘴&mode=transit&go=1 */
  function parsePoint(s) {
    if (!s) return null;
    var parts = String(s).split(',');
    if (parts.length < 2) return null;
    var lat = Number(parts[0]);
    var lng = Number(parts[1]);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { name: parts.slice(2).join(',') || '地图选点', lat: lat, lng: lng };
  }

  function applyDeepLink() {
    var p;
    try { p = new URLSearchParams(location.search); } catch (e) { return; }

    var mode = p.get('mode');
    if (mode && MODE_T[mode] !== undefined) {
      state.route.mode = mode;
      $$('#mode-chips .chip').forEach(function (c) {
        c.classList.toggle('active', c.getAttribute('data-mode') === mode);
      });
    }

    var from = parsePoint(p.get('from'));
    var to = parsePoint(p.get('to'));
    if (from) setPoint('from', from);
    if (to) setPoint('to', to);

    if (p.get('go') === '1' && from && to) {
      setTab('route');
      planRoute();
    }
  }

  function promptForKey() {
    openSheet('需要高德 Key', [
      '<div class="hint"><span>🛈</span><span>搜地址、算驾车/骑行/步行路线要用高德 Web 服务 Key。申请免费，1 分钟搞定。</span></div>',
      '<div class="steps" style="margin-top:12px">',
      '<div class="step">打开 <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noopener">高德开放平台控制台</a>，注册并实名。</div>',
      '<div class="step">「应用管理 → 创建新应用」，服务平台选 <b>Web服务</b>。</div>',
      '<div class="step">把生成的 Key 复制到「我的 → 高德 Key」。公交到站和一键跳高德导航不需要 Key。</div>',
      '</div>',
      '<button class="btn block primary" style="margin-top:14px" data-act="tab" data-tab="me">去填 Key</button>'
    ].join(''));
  }

  /* 没有高德 Key 时的兜底：用车来了的关键字搜索拿坐标
   * pois 本身就是 GCJ-02，站点是 WGS-84，统一换成 GCJ-02 */
  function chelaileTips(keyword) {
    var box = $('#tips-box');
    box.innerHTML = '<div class="hint"><span>⏳</span><span>没填高德 Key，先用公交关键字找地点…</span></div>';
    busApi('/v1/search', { city_id: cfg.cityId, keyword: keyword }).then(function (j) {
      var list = [];
      (j.pois || []).forEach(function (p) {
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
        list.push({ name: p.name, district: p.address || p.district || '', location: p.lng + ',' + p.lat });
      });
      (j.stations || []).forEach(function (s) {
        if (typeof s.lat !== 'number' || typeof s.lng !== 'number') return;
        var g = wgs2gcj(s.lat, s.lng);
        list.push({ name: s.sn, district: s.isSubway ? '地铁站' : '公交站', location: g.lng + ',' + g.lat });
      });
      list = list.slice(0, 6);
      if (!list.length) { box.innerHTML = '<div class="hint">没搜到，换个说法试试</div>'; return; }
      box.innerHTML = list.map(function (t, i) {
        return '<button class="tip-row" data-act="tip-pick" data-i="' + i + '">' +
          '<span class="grow" style="min-width:0"><span class="ellipsis" style="display:block">' + esc(t.name) + '</span>' +
          '<span class="sub">' + esc(t.district || '') + '</span></span>' +
          '<span class="muted tiny">选</span></button>';
      }).join('');
      state._tips = list;
    }).catch(function (e) {
      box.innerHTML = '<div class="hint warn"><span>⚠</span><span>' + esc(e.message) + '</span></div>';
    });
  }

  function fetchTips(keyword) {
    var box = $('#tips-box');
    if (!keyword) { box.innerHTML = ''; return; }
    if (!cfg.amapKey) {
      chelaileTips(keyword);
      return;
    }

    amapApi('/v3/assistant/inputtips', { keywords: keyword, city: cfg.cityName, datatype: 'all', citylimit: 'false' })
      .then(function (j) {
        var tips = (j.tips || []).filter(function (t) {
          return t.location && typeof t.location === 'string' && t.location.indexOf(',') > 0;
        }).slice(0, 6);

        // 高德有时候只给 POI 不给坐标，再用 POI 搜索兜底
        if (!tips.length) {
          return amapApi('/v3/place/text', { keywords: keyword, city: cfg.cityName, offset: 6, page: 1, extensions: 'base' })
            .then(function (k) {
              var pois = (k.pois || []).filter(function (p) { return p.location; }).slice(0, 6);
              return pois.map(function (p) {
                return { name: p.name, district: p.cityname || p.adname || '', location: p.location };
              });
            });
        }
        return tips.map(function (t) {
          return { name: t.name, district: t.district || '', location: t.location };
        });
      })
      .then(function (list) {
        if (!list.length) { box.innerHTML = '<div class="hint">没搜到，换个说法试试</div>'; return; }
        box.innerHTML = list.map(function (t, i) {
          return '<button class="tip-row" data-act="tip-pick" data-i="' + i + '">' +
            '<span class="grow" style="min-width:0"><span class="ellipsis" style="display:block">' + esc(t.name) + '</span>' +
            '<span class="sub">' + esc(t.district || '') + '</span></span>' +
            '<span class="muted tiny">选</span></button>';
        }).join('');
        state._tips = list;
      })
      .catch(function (e) {
        if (e.needKey) promptForKey();
        else box.innerHTML = '<div class="hint warn"><span>⚠</span><span>' + esc(e.message) + '</span></div>';
      });
  }

  function pickTip(i) {
    var t = (state._tips || [])[i];
    if (!t) return;
    var parts = String(t.location).split(',');
    var p = { name: t.name, lng: Number(parts[0]), lat: Number(parts[1]) };
    // 高德返回的是 GCJ02，直接可用
    var target = state._tipTarget || 'to';
    setPoint(target, p);
  }

  function ensureLocationPoint(which) {
    return geolocate().then(function (loc) {
      state.loc = loc;
      var gcj = wgs2gcj(loc.lat, loc.lng);
      return amapApi('/v3/geocode/regeo', { location: gcj.lng + ',' + gcj.lat, radius: 200 })
        .then(function (j) {
          var name = (j.regeocode && j.regeocode.formatted_address) || '我的位置';
          setPoint(which, { name: name, lat: gcj.lat, lng: gcj.lng, geo: true });
          toast('已定位：' + name);
        }, function () {
          setPoint(which, { name: '我的位置', lat: gcj.lat, lng: gcj.lng, geo: true });
        });
    }).catch(function (e) {
      toast(e.message);
      // 定位用不了时，直接把光标送到对应的输入框，让用户立刻能打字
      if (e.denied || e.insecure) {
        var el = $('#' + which + '-input');
        if (el) setTimeout(function () { el.focus(); }, 300);
      }
    });
  }

  function planRoute() {
    var r = state.route;
    if (!r.from || !r.to) {
      toast('起点和终点都要有坐标：点「定位」或从搜索提示里选一个地址');
      return;
    }
    r.loading = true;
    $('#plan-box').innerHTML = '<div class="card"><div class="skel" style="width:45%"></div><div class="skel" style="width:70%;margin-top:10px"></div><div class="skel" style="width:55%;margin-top:10px"></div></div>';
    $('#plan-empty').hidden = true;

    // 公交方案来自车来了换乘规划（不需要 Key）
    if (r.mode === 'transit') {
      busApi('/v1/transit/plan', {
        city_id: cfg.cityId,
        origin_name: r.from.name, origin_lat: r.from.lat, origin_lng: r.from.lng,
        dest_name: r.to.name, dest_lat: r.to.lat, dest_lng: r.to.lng,
        strategy: 0
      }).then(function (j) {
        r.plans = (j.plans || []).slice(0, 4).map(function (p) {
          return {
            mode: 'transit',
            duration: p.duration,
            distance: p.distance,
            walking: p.walkingDistance,
            tag: p.tag || (p.transitCount ? p.transitCount + ' 次换乘' : ''),
            segments: (p.segments || []).map(function (s) {
              return {
                type: s.type,
                name: s.name,
                lineType: s.lineType,
                from: s.departureStop,
                to: s.arrivalStop,
                via: s.viaStops,
                duration: s.duration,
                distance: s.distance
              };
            })
          };
        });
        r.loading = false;
        renderPlans();
      }).catch(function (e) {
        r.loading = false;
        $('#plan-box').innerHTML = '<div class="card"><div class="hint warn"><span>⚠</span><span>' + esc(e.message) + '</span></div></div>';
      });
      return;
    }

    // 驾车 / 步行 / 骑行来自高德
    var amapPath = r.mode === 'drive' ? '/v3/direction/driving'
      : r.mode === 'walk' ? '/v3/direction/walking'
        : '/v4/direction/bicycling';
    var origin = r.from.lng + ',' + r.from.lat;
    var dest = r.to.lng + ',' + r.to.lat;

    amapApi(amapPath, { origin: origin, destination: dest, extensions: 'base', strategy: 0, nightflag: 0 })
      .then(function (j) {
        var paths = [];
        if (r.mode === 'ride') {
          paths = (j.data && j.data.paths) || [];
        } else {
          paths = (j.route && j.route.paths) || [];
        }
        r.plans = paths.slice(0, 3).map(function (p, idx) {
          var steps = (p.steps || []).map(function (s) { return s.instruction; }).filter(Boolean);
          return {
            mode: r.mode,
            duration: p.duration,
            distance: p.distance,
            tolls: p.tolls,
            traffic: p.traffic_lights,
            title: idx === 0 ? '推荐' : '方案 ' + (idx + 1),
            segments: steps.slice(0, 3).map(function (txt) {
              return { type: 'step', text: txt };
            })
          };
        });
        r.loading = false;
        renderPlans();
      })
      .catch(function (e) {
        r.loading = false;
        if (e.needKey) {
          $('#plan-box').innerHTML = '<div class="card"><div class="hint warn"><span>⚠</span><span>' + esc(e.message) + '</span></div>' +
            '<button class="btn block primary" style="margin-top:10px" data-act="tab" data-tab="me">去填 Key</button></div>';
        } else {
          $('#plan-box').innerHTML = '<div class="card"><div class="hint warn"><span>⚠</span><span>' + esc(e.message) + '</span></div></div>';
        }
      });
  }

  function modeName(m) {
    return { transit: '公交', drive: '驾车', ride: '骑行', walk: '步行' }[m] || m;
  }

  function renderPlans() {
    var box = $('#plan-box');
    var r = state.route;
    if (!r.plans.length) { $('#plan-empty').hidden = false; box.innerHTML = ''; return; }
    $('#plan-empty').hidden = true;

    box.innerHTML = r.plans.map(function (p, i) {
      var segs = (p.segments || []).map(function (s) {
        if (s.type === 'walking' || s.type === 'walk') {
          return '<div class="seg walk"><span class="dot"></span><span class="txt">步行 ' + fmtDist(s.distance) +
            (s.duration ? ' · ' + fmtDur(s.duration) : '') + '</span></div>';
        }
        if (s.type === 'bus') {
          var isMetro = s.lineType === 1;
          return '<div class="seg"><span class="dot" style="background:' + (isMetro ? '#7b3fe4' : 'var(--brand)') + '"></span>' +
            '<span class="txt"><b>' + esc(s.name) + '</b>' +
            (isMetro ? ' <span class="badge" style="height:18px">地铁</span>' : '') +
            '<br>' + esc(s.from || '') + ' → ' + esc(s.to || '') +
            (s.via ? ' <span class="tiny muted">' + esc(s.via) + ' 站</span>' : '') +
            '</span></div>';
        }
        if (s.type === 'step') {
          return '<div class="seg"><span class="dot"></span><span class="txt">' + esc(s.text) + '</span></div>';
        }
        return '';
      }).join('');

      var meta = [];
      if (p.distance) meta.push(fmtDist(p.distance));
      if (p.walking) meta.push('步行 ' + fmtDist(p.walking));
      if (p.tolls && Number(p.tolls) > 0) meta.push('过路费 ' + p.tolls + ' 元');

      return '<div class="plan">' +
        '<div class="plan-head">' +
        '<span class="d">' + fmtDur(p.duration).replace(' ', '') + '</span>' +
        '<span class="m">' + esc(p.tag || p.title || modeName(p.mode)) + ' · ' + esc(meta.join(' · ')) + '</span>' +
        '</div>' +
        '<div class="plan-body">' + (segs || '<div class="seg"><span class="txt muted">没有分段信息</span></div>') + '</div>' +
        '<div class="plan-foot">' +
        '<button class="btn go" data-act="nav" data-i="' + i + '">高德导航</button>' +
        '<button class="btn ghost" data-act="replan" data-i="' + i + '">' + esc(modeName(p.mode)) + '详情</button>' +
        '</div></div>';
    }).join('');
  }

  function renderPlaces() {
    var box = $('#places-box');
    if (!state.places.length) {
      box.innerHTML = '<div class="empty small">在「路线」里查过的目的地会出现在这里</div>';
      return;
    }
    box.innerHTML = state.places.map(function (p, i) {
      return '<button class="item" data-act="place-go" data-i="' + i + '">' +
        '<span class="badge gray" style="flex:none">常去</span>' +
        '<span class="grow ellipsis">' + esc(p.name) + '</span>' +
        '<span class="muted tiny">导航 ›</span></button>';
    }).join('');
  }

  /* =================================================================
   * 11. 设置 / 自检 / 城市
   * ================================================================= */

  function fillSettings() {
    $('#key-input').value = cfg.amapKey || '';
    $('#base-input').value = cfg.busBase || '';
    $('#city-label').textContent = cfg.cityName || '城市';
    $('#code-scheme-label').textContent = cfg.codeScheme === DEFAULT_CFG.codeScheme ? '默认（乘车码）' : '自定义';
    try {
      var bytes = (localStorage.length || 0);
      var size = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('shunlu.') === 0) size += (localStorage.getItem(k) || '').length;
      }
      $('#store-size').textContent = bytes + ' 项 / ' + (size / 1024).toFixed(1) + ' KB';
    } catch (e) { $('#store-size').textContent = '不可用'; }
  }

  function checkHealth(force) {
    var box = $('#health-box');
    box.innerHTML =
      '<div class="kv"><span class="k">车来了实时公交</span><span class="small">检测中…</span></div>' +
      '<div class="kv"><span class="k">高德开放平台</span><span class="small">检测中…</span></div>';

    var busP = busApi('/v1/health', {}).then(function (j) {
      return { ok: true, text: (j.name || 'chelaile') + ' v' + (j.version || '?') };
    }).catch(function (e) {
      return { ok: false, text: e.message };
    });

    var amapP = !cfg.amapKey
      ? Promise.resolve({ ok: null, text: '未配置 Key（公交功能不受影响）' })
      : amapApi('/v3/ip', {}).then(function (j) {
        return { ok: true, text: '已连通 · 识别城市 ' + (j.city || j.province || '未知') };
      }).catch(function (e) {
        return { ok: false, text: e.message };
      });

    Promise.all([busP, amapP]).then(function (res) {
      box.innerHTML = res.map(function (r, i) {
        var cls = r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'wait';
        return '<div class="kv"><span class="k">' + (i === 0 ? '车来了实时公交' : '高德开放平台') + '</span>' +
          '<span class="small" style="max-width:60%;text-align:right"><i class="dot ' + cls + '"></i> ' + esc(r.text) + '</span></div>';
      }).join('');
    });
  }

  function openCityPicker() {
    openSheet('选择城市', '<div class="empty">城市列表加载中…</div>');
    var cached = lsGet('shunlu.cities.v1', null);
    var p = cached && cached.length ? Promise.resolve(cached)
      : busApi('/v1/cities', { hot_only: 'false' }).then(function (j) {
        var list = (j.cities || []).map(function (c) {
          return { id: c.cityId, name: c.cityName, pinyin: c.pinyin || '' };
        });
        if (list.length) lsSet('shunlu.cities.v1', list);
        return list;
      });

    p.then(function (list) {
      state._cities = list;
      var hot = list.slice(0, 0);
      var html = '<input class="field" id="city-search" placeholder="搜城市名或拼音" autocomplete="off" style="width:100%;margin-bottom:8px">';
      html += '<div class="list" id="city-list"></div>';
      openSheet('选择城市（共 ' + list.length + ' 个）', html);
      drawCityList(list);
      var inp = $('#city-search');
      if (inp) {
        inp.addEventListener('input', function () {
          var kw = this.value.trim().toLowerCase();
          if (!kw) return drawCityList(state._cities);
          drawCityList(state._cities.filter(function (c) {
            return c.name.toLowerCase().indexOf(kw) >= 0 || c.pinyin.toLowerCase().indexOf(kw) >= 0;
          }));
        });
      }
    }).catch(function (e) {
      openSheet('选择城市', '<div class="hint warn"><span>⚠</span><span>' + esc(e.message) + '</span></div>');
    });
  }

  function drawCityList(list) {
    var box = $('#city-list');
    if (!box) return;
    if (!list.length) { box.innerHTML = '<div class="empty">没有匹配的城市</div>'; return; }
    box.innerHTML = list.slice(0, 400).map(function (c) {
      var active = c.id === cfg.cityId;
      return '<button class="item" data-act="city-pick" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">' +
        '<span class="grow">' + esc(c.name) + '</span>' +
        (active ? '<span class="badge">当前</span>' : '<span class="muted tiny">' + esc(c.pinyin || '') + '</span>') +
        '</button>';
    }).join('');
  }

  /* =================================================================
   * 12. 事件
   * ================================================================= */

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');

    // ---- 全局 ----
    if (act === 'tab') { setTab(t.getAttribute('data-tab')); return; }
    if (act === 'close-sheet') { closeSheet(); return; }
    if (act === 'refresh') {
      if (state.tab === 'bus') refreshWatch(true);
      else if (state.tab === 'route' && state.route.plans.length) planRoute();
      else checkHealth();
      return;
    }
    if (act === 'copy') { copyText(t.getAttribute('data-text') || ''); return; }

    // ---- 公交 ----
    if (act === 'search') { doSearch(); return; }
    if (act === 'focus-search') {
      var q = $('#q');
      if (q) { q.scrollIntoView({ block: 'center' }); q.focus(); }
      return;
    }
    if (act === 'nearby') { loadNearby(); return; }
    if (act === 'demo') {
      addWatch({
        lineId: '21283603183', name: '71', dir: 0, endSn: '申昆路枢纽站',
        stationId: '021-15232', stationName: '西藏中路', targetOrder: 2,
        stopLat: 31.231006, stopLng: 121.474316, cityId: '034'
      });
      if (cfg.cityId !== '034') toast('示例是上海 71 路，可到「我的」把城市切回上海');
      return;
    }
    if (act === 'line-open') { openDirections(state.searchLines[Number(t.getAttribute('data-i'))]); return; }
    if (act === 'dir-pick') {
      openLineStations(t.getAttribute('data-lineid'), t.getAttribute('data-name'), t.getAttribute('data-end'));
      return;
    }
    if (act === 'stop-open') { openStop(state.searchStops[Number(t.getAttribute('data-i'))]); return; }

    if (act === 'station-pick' || act === 'stop-add' || act === 'nearby-add') {
      addWatch({
        lineId: t.getAttribute('data-lineid'),
        name: t.getAttribute('data-name'),
        dir: t.getAttribute('data-dir'),
        endSn: t.getAttribute('data-end'),
        stationId: t.getAttribute('data-sid'),
        stationName: t.getAttribute('data-sname'),
        targetOrder: t.getAttribute('data-order'),
        stopLat: t.getAttribute('data-lat') ? Number(t.getAttribute('data-lat')) : null,
        stopLng: t.getAttribute('data-lng') ? Number(t.getAttribute('data-lng')) : null
      });
      return;
    }
    if (act === 'watch-del') { removeWatch(t.getAttribute('data-key')); return; }
    if (act === 'clear-watch') {
      if (!confirm('清空全部站牌？')) return;
      state.watch = [];
      persistWatch();
      renderWatch();
      return;
    }
    if (act === 'walk-to-stop') {
      var w = state.watch.filter(function (x) { return x.key === t.getAttribute('data-i'); })[0];
      if (!w) return;
      var gcj = wgs2gcj(w.stopLat, w.stopLng);
      var from = state.loc ? wgs2gcj(state.loc.lat, state.loc.lng) : gcj;
      openNavigation(
        { name: '我的位置', lat: from.lat, lng: from.lng },
        { name: w.stationName, lat: gcj.lat, lng: gcj.lng },
        'walk'
      );
      return;
    }

    // ---- 路线 ----
    if (act === 'geo-from') { ensureLocationPoint('from'); return; }
    if (act === 'geo-to') { ensureLocationPoint('to'); return; }
    if (act === 'swap') {
      var f = state.route.from, tt = state.route.to;
      state.route.from = tt; state.route.to = f;
      $('#from-input').value = tt ? tt.name : '';
      $('#to-input').value = f ? f.name : '';
      toast('已交换');
      return;
    }
    if (act === 'mode') {
      state.route.mode = t.getAttribute('data-mode');
      $$('#mode-chips .chip').forEach(function (c) { c.classList.toggle('active', c === t); });
      if (state.route.from && state.route.to) planRoute();
      return;
    }
    if (act === 'plan') { planRoute(); return; }
    if (act === 'tip-pick') { pickTip(Number(t.getAttribute('data-i'))); return; }
    if (act === 'nav') {
      var plan = state.route.plans[Number(t.getAttribute('data-i'))];
      openNavigation(state.route.from, state.route.to, plan ? plan.mode : state.route.mode);
      return;
    }
    if (act === 'replan') {
      openSheet('方案详情', '<div class="hint">' + esc(modeName(state.route.mode)) + ' · 数据来自' +
        (state.route.mode === 'transit' ? '车来了' : '高德') + '，点「高德导航」可看完整路况与转向。</div>');
      return;
    }
    if (act === 'route-tab') { setTab('route'); return; }
    if (act === 'place-go') {
      var pl = state.places[Number(t.getAttribute('data-i'))];
      if (!pl) return;
      setTab('route');
      ensureLocationPoint('from');
      setTimeout(function () {
        setPoint('to', { name: pl.name, lat: pl.lat, lng: pl.lng });
        planRoute();
      }, 900);
      return;
    }

    // ---- 乘车码 ----
    if (act === 'alipay-code') { openAlipay('code'); return; }
    if (act === 'alipay-scan') { openAlipay('scan'); return; }
    if (act === 'alipay-retry') { openAlipay(t.getAttribute('data-kind') || 'code'); return; }
    if (act === 'code-custom') {
      openSheet('自定义乘车码链接', [
        '<div class="hint"><span>🛈</span><span>默认是支付宝乘车码 appId。如果你习惯用别的码（比如某个城市的交通 APP 的 scheme），把链接贴在这里。</span></div>',
        '<div class="field" style="margin-top:12px"><input id="scheme-input" value="' + esc(cfg.codeScheme) + '" placeholder="alipays://..." autocomplete="off"></div>',
        '<button class="btn block primary" style="margin-top:12px" data-act="save-scheme">保存</button>',
        '<button class="btn block ghost" style="margin-top:8px" data-act="reset-scheme">恢复默认</button>'
      ].join(''));
      return;
    }
    if (act === 'save-scheme') {
      var v = ($('#scheme-input') || {}).value || '';
      cfg.codeScheme = v.trim() || DEFAULT_CFG.codeScheme;
      saveCfg(); fillSettings(); closeSheet(); toast('已保存');
      return;
    }
    if (act === 'reset-scheme') {
      cfg.codeScheme = DEFAULT_CFG.codeScheme;
      saveCfg(); fillSettings(); closeSheet(); toast('已恢复默认');
      return;
    }
    if (act === 'install') {
      if (state.installEvent) {
        state.installEvent.prompt();
        state.installEvent = null;
        return;
      }
      openSheet('添加到主屏幕', [
        '<div class="steps">',
        '<div class="step"><b>iPhone / Safari</b>：点底部「分享」→「添加到主屏幕」。</div>',
        '<div class="step"><b>Android / Chrome</b>：右上角「⋮」→「添加到主屏幕 / 安装应用」。</div>',
        '<div class="step">装好后从桌面图标打开，长按图标可以直达「乘车码」。</div>',
        '</div>'
      ].join(''));
      return;
    }

    // ---- 我的 / 设置 ----
    if (act === 'city') { openCityPicker(); return; }
    if (act === 'city-pick') {
      cfg.cityId = t.getAttribute('data-id');
      cfg.cityName = t.getAttribute('data-name');
      saveCfg();
      closeSheet();
      toast('城市已切换到 ' + cfg.cityName);
      state.nearby = null;
      $('#nearby-box').innerHTML = '';
      return;
    }
    if (act === 'health') { checkHealth(true); return; }
    if (act === 'save-settings') {
      var key = ($('#key-input').value || '').trim();
      var base = ($('#base-input').value || '').trim();
      cfg.amapKey = key;
      cfg.busBase = base || DEFAULT_CFG.busBase;
      saveCfg();
      toast('已保存');
      checkHealth();
      return;
    }
    if (act === 'reset') {
      if (!confirm('清除本机保存的站牌、常去地址和设置？')) return;
      ['shunlu.cfg.v1', 'shunlu.watch.v1', 'shunlu.places.v1', 'shunlu.cities.v1'].forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) { }
      });
      cfg = Object.assign({}, DEFAULT_CFG);
      state.watch = [];
      state.places = [];
      saveCfg();
      renderWatch();
      fillSettings();
      toast('已清除');
      return;
    }
  });

  /* 输入框：搜索回车、地址联想 */
  function bindInputs() {
    var q = $('#q');
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    });

    ['from', 'to'].forEach(function (which) {
      var input = which === 'from' ? $('#from-input') : $('#to-input');
      input.addEventListener('input', function () {
        state._tipTarget = which;
        clearTimeout(state.tipTimer);
        var v = this.value.trim();
        // 手动改了输入框，就认为之前的坐标作废
        if (state.route[which] && state.route[which].name !== v) state.route[which] = null;
        state.tipTimer = setTimeout(function () {
          if (!v) { $('#tips-box').innerHTML = ''; return; }
          fetchTips(v);
        }, 400);
      });
      input.addEventListener('focus', function () { state._tipTarget = which; });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheet();
    });
  }

  /* =================================================================
   * 13. 启动
   * ================================================================= */

  function init() {
    saveCfg();
    renderWatch();
    bindInputs();
    setTab('bus');
    checkInsecureBar();

    // 桌面图标快捷方式（manifest.shortcuts）走 hash，如 #code
    var hash = (location.hash || '').replace(/^#/, '');
    if (TABS.indexOf(hash) >= 0) setTab(hash);
    window.addEventListener('hashchange', function () {
      var h = (location.hash || '').replace(/^#/, '');
      if (TABS.indexOf(h) >= 0) setTab(h);
    });

    applyDeepLink();

    if (state.watch.length) setTimeout(function () { refreshWatch(false); }, 300);

    // 自动刷新（只在公交页且页面可见时）
    state.refreshTimer = setInterval(function () {
      if (state.tab === 'bus' && !document.hidden && state.watch.length) refreshWatch(false);
    }, 25000);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.tab === 'bus' && state.watch.length) refreshWatch(false);
    });

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      state.installEvent = e;
    });

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 离线缓存失败不影响主流程 */ });
    }

    // 首次访问：提示先选城市
    if (!lsGet('shunlu.seen.v1', false)) {
      lsSet('shunlu.seen.v1', true);
      setTimeout(function () {
        if (!state.watch.length) {
          toast('先点右上角选城市，再搜线路或看附近站点', 3600);
        }
      }, 600);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
