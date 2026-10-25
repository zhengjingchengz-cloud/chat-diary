#!/usr/bin/env node
/*
 * 给 index.html 里的资源加内容指纹：assets/app.js?v=1a2b3c4d
 *
 * 为什么：浏览器会缓存 JS/CSS，改了代码普通刷新可能还是旧的。
 * 用文件内容的 sha1 前 8 位当版本号——
 *   · 文件没变 → 版本号不变 → 继续用缓存，快
 *   · 文件变了 → 版本号变了 → 浏览器必须重新下载，立刻生效
 *
 * 每次部署前跑一次：node tools/stamp.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');

let html = fs.readFileSync(indexPath, 'utf8');
const stamped = [];
const missing = [];

const re = /(assets\/[\w.-]+\.(?:js|css))(?:\?v=[a-f0-9]+)?/g;

html = html.replace(re, function (match, file) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) {
    missing.push(file);
    return match;
  }
  const hash = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 8);
  stamped.push(file + '?v=' + hash);
  return file + '?v=' + hash;
});

fs.writeFileSync(indexPath, html, 'utf8');

(stamped.length ? stamped : ['（没有找到需要加版本号的资源）']).forEach(function (s) {
  console.log('  ' + s);
});
if (missing.length) {
  console.error('找不到文件：' + missing.join(', '));
  process.exitCode = 1;
}
console.log('已写入 index.html');
