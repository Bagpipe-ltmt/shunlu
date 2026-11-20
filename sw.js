/* 顺路 · Service Worker
 * 外壳用「网络优先、离线回缓存」，这样改了代码刷新一次就生效；
 * 接口请求全部直连（实时数据不能缓存）；图标这类静态资源走缓存优先。
 */
'use strict';

const VERSION = 'v7';
const CACHE = 'shunlu-shell-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg'
];
const OFFLINE_PAGE = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => { /* 某个文件缺失也不阻塞安装 */ })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cachePut(req, res) {
  if (!res || res.status !== 200 || res.type === 'opaque') return;
  const copy = res.clone();
  caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => { });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  // 跨域（车来了 / 高德）一律不拦，实时数据不走缓存
  if (url.origin !== self.location.origin) return;
  // sw.js 自己不要被拦截，否则浏览器更新不了 Service Worker
  if (url.pathname.endsWith('/sw.js')) return;

  const isIcon = /\.(png|svg|ico|webp)$/i.test(url.pathname);

  if (isIcon) {
    // 图标：缓存优先
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        cachePut(req, res);
        return res;
      }))
    );
    return;
  }

  // 页面与脚本样式：网络优先，失败回缓存，再失败回离线首页
  // cache:'no-store' 是为了绕开浏览器 HTTP 缓存，改完代码刷新就能看到
  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        cachePut(req, res);
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE_PAGE)))
  );
});
