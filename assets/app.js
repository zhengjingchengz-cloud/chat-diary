/*
 * 聊天日记 · 界面层 (app.js)
 * 纯原生 DOM，没有任何构建步骤；双击 index.html 就能用。
 */
(function () {
  'use strict';

  var C = window.DiaryCore;
  var AI = window.DiaryAI;
  var LS_STATE = 'chatdiary.state.v1';
  var LS_DEMO = 'chatdiary.demo.v1';

  var EMOJIS = ['🐟', '🌙', '🐰', '🌿', '🕯️', '🦊', '🐳', '☕', '🎐', '🍊', '🪐', '🧸', '🐈', '🐶'];

  /* 一句设定的预设。点一下就填进去，还能接着改。 */
  var PERSONAS = [
    { label: '爱撒娇的大肥鱼', emoji: '🐟', text: '一只住在手机里的大肥鱼，说话软软的，爱撒娇，饿了会浮上来讨吃的。' },
    { label: '安静的夜班搭子', emoji: '🌙', text: '只在深夜上线，话不多，偶尔冒一句很准的，说完就消失。' },
    { label: '毒舌但心软的猫', emoji: '🐈', text: '嘴上不饶人，其实很护着你；被夸会装作没听见，尾巴却翘起来。' },
    { label: '元气小狗', emoji: '🐶', text: '永远精力旺盛，说话带感叹号；你难过时它会笨拙地转移话题。' },
    { label: '温柔学姐', emoji: '🌿', text: '大你两届，讲话慢，习惯先问一句「今天吃饭了吗」，再讲道理。' },
    { label: '一起加班的同事', emoji: '☕', text: '和你在同一个项目里熬过夜，说话干脆，爱吐槽老板，但从不劝你辞职。' }
  ];

  /* 没有 API Key 时的本地取名 */
  var LOCAL_NAMES = [
    { name: '糯米', emoji: '🍊', persona: '说话很慢，喜欢拿食物打比方，记得你每一次说饿。' },
    { name: '阿灯', emoji: '🕯️', persona: '一盏不肯灭的小灯，你熬夜的时候它会碎碎念，但一直亮着。' },
    { name: '年糕', emoji: '🐰', persona: '软乎乎的，被凶了也不生气，只会小声问「你是不是累了」。' },
    { name: '小野', emoji: '🌿', persona: '常年在外面跑，讲起风景就停不下来，也会把你的话记在本子上。' },
    { name: '布丁', emoji: '🧸', persona: '反应慢半拍，但你说过的事它都记着，偶尔突然翻出来问你。' },
    { name: '阿眠', emoji: '🌙', persona: '专门管睡觉的，你一说困它就开始念，念到你真的去睡。' }
  ];

  var state = null;
  var isDemo = false;
  var saveFailed = false;

  var ui = {
    view: 'diary',
    companionId: 'all',
    q: '',
    tag: '',
    mood: '',
    expanded: {},
    pack: { companionId: null, maxEntries: 7, quotes: true },
    chat: { pending: false, error: '' },
    imp: null
  };

  var els = {};

  /* ============================== 小工具 ============================== */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function byId(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function moodEmoji(mood) {
    for (var i = 0; i < C.MOODS.length; i++) {
      if (C.MOODS[i].value === mood) return C.MOODS[i].emoji;
    }
    return '·';
  }

  function displayDate(iso) {
    var rel = C.relativeDay(iso);
    return rel || C.formatDateCN(iso);
  }

  var toastTimer = null;
  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 2200);
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 100);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error('clipboard unavailable'));
  }

  function fallbackCopy(textarea) {
    if (!textarea) return false;
    textarea.removeAttribute('readonly');
    textarea.focus();
    textarea.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    textarea.setAttribute('readonly', 'readonly');
    window.getSelection().removeAllRanges();
    return ok;
  }

  /* ============================== 存取 ============================== */

  function load() {
    try {
      var raw = localStorage.getItem(LS_STATE);
      if (raw) {
        state = C.normalizeState(JSON.parse(raw));
        isDemo = localStorage.getItem(LS_DEMO) === '1';
        return;
      }
    } catch (err) {
      console.warn('[聊天日记] 本地数据读不出来，改用示例数据：', err);
    }
    state = C.seedState();
    isDemo = true;
  }

  function persist() {
    try {
      localStorage.setItem(LS_STATE, C.exportJSON(state));
      localStorage.setItem(LS_DEMO, isDemo ? '1' : '0');
      saveFailed = false;
    } catch (err) {
      saveFailed = true;
      console.warn('[聊天日记] 保存失败：', err);
    }
    updateSaveDot();
  }

  function updateSaveDot() {
    var dot = byId('save-dot');
    if (!dot) return;
    dot.classList.toggle('warn', saveFailed);
    dot.textContent = saveFailed ? '没能保存，请导出备份' : '已保存在本机';
  }

  /* ============================== 渲染 ============================== */

  function render() {
    if (!state) return;
    var scroll = $('.scroll');
    var top = scroll ? scroll.scrollTop : 0;

    els.app.innerHTML = sidebarHtml() + mainHtml();

    var next = $('.scroll');
    if (next) {
      var prev = next.style.scrollBehavior;
      next.style.scrollBehavior = 'auto';
      next.scrollTop = top;
      next.style.scrollBehavior = prev || '';
    }
    updateSaveDot();
  }

  function renderList() {
    var list = byId('entry-list');
    if (!list) return;
    list.innerHTML = timelineHtml();
    var hint = byId('result-hint');
    if (hint) hint.textContent = hintText();
    var chips = byId('tag-chips');
    if (chips) chips.innerHTML = tagChipsHtml();
  }

  function companion() { return C.findCompanion(state, ui.companionId); }

  /* ---------------------------- 侧栏 ---------------------------- */

  function sidebarHtml() {
    var comps = state.companions.map(function (c) {
      var active = ui.companionId === c.id;
      return '<button class="comp' + (active ? ' active' : '') + '" data-action="select-companion" data-id="' + esc(c.id) + '" title="' + esc(c.name) + '">' +
        '<span class="comp-emoji">' + esc(c.emoji) + '</span>' +
        '<span class="comp-name">' + esc(c.name) + '</span>' +
        '<span class="comp-count">' + C.entriesFor(state, c.id).length + '</span>' +
        '</button>';
    }).join('');

    var allActive = ui.companionId === 'all';

    return '<aside class="sidebar">' +
      '<div class="brand">' +
        '<div class="brand-mark">📔</div>' +
        '<div><h1>聊天日记</h1><p>给会忘事的伙伴一个口袋</p></div>' +
      '</div>' +
      '<div class="side-label">伙伴</div>' +
      '<nav class="comp-list">' +
        '<button class="comp' + (allActive ? ' active' : '') + '" data-action="select-companion" data-id="all">' +
          '<span class="comp-emoji">🗂️</span><span class="comp-name">全部</span>' +
          '<span class="comp-count">' + state.entries.length + '</span>' +
        '</button>' +
        comps +
        '<button class="comp add" data-action="new-companion">＋ 新伙伴</button>' +
      '</nav>' +
      '<nav class="view-nav">' +
        navItem('diary', '📝', '日记') +
        navItem('chat', '💬', '对话') +
        navItem('memories', '📌', '记忆卡') +
        navItem('pack', '✨', '记忆包') +
      '</nav>' +
      '<div class="side-foot">' +
        '<button data-action="export-json">⬇ 导出备份</button>' +
        '<button data-action="import-json">⬆ 导入备份</button>' +
        '<button data-action="export-md">📄 导出 Markdown</button>' +
        '<button data-action="settings">⚙ 设置</button>' +
        '<p class="side-hint">数据只存在这台电脑的浏览器里。<br>换电脑前记得导出备份。</p>' +
      '</div>' +
      '</aside>';
  }

  function navItem(view, ico, label) {
    return '<button class="nav-item' + (ui.view === view ? ' active' : '') + '" data-action="view" data-view="' + view + '">' +
      '<span class="ico">' + ico + '</span>' + label + '</button>';
  }

  /* ---------------------------- 主区 ---------------------------- */

  function mainHtml() {
    var comp = companion();
    var crumb = ui.view === 'diary' ? '日记'
      : ui.view === 'chat' ? '对话'
      : ui.view === 'memories' ? '记忆卡' : '记忆包';
    var primary = ui.view === 'chat'
      ? '<button class="btn primary" data-action="chat-to-diary">✎ 写成日记</button>'
      : '<button class="btn primary" data-action="new-entry">✎ 写一篇</button>';

    return '<main class="main">' +
      '<header class="topbar">' +
        '<div class="crumb">聊天日记 <span class="sep">/</span> <b>' + esc(crumb) + '</b>' +
          (comp ? ' <span class="sep">/</span> ' + esc(comp.emoji + ' ' + comp.name) : '') +
        '</div>' +
        '<div class="top-actions">' +
          '<span class="save-dot" id="save-dot">已保存在本机</span>' +
          '<button class="btn ghost" data-action="settings">设置</button>' +
          primary +
        '</div>' +
      '</header>' +
      '<div class="scroll">' + viewHtml() + '</div>' +
      '</main>';
  }

  function viewHtml() {
    if (ui.view === 'memories') return memoriesView();
    if (ui.view === 'pack') return packView();
    if (ui.view === 'chat') return chatView();
    return diaryView();
  }

  /* ---------------------------- 日记视图 ---------------------------- */

  function diaryView() {
    if (!state.companions.length) return firstRunView();

    var comp = companion();
    var st = C.statsFor(state, ui.companionId);

    return '<section class="view">' +
      (isDemo ? demoBar() : '') +
      '<header class="hero">' +
        '<div class="hero-main">' +
          '<div class="hero-emoji">' + esc(comp ? comp.emoji : '🗂️') + '</div>' +
          '<h2>' + esc(comp ? comp.name : '全部伙伴') +
            (comp ? '<span class="badge-days">认识 ' + st.days + ' 天</span>' : '') +
          '</h2>' +
          '<p class="hero-persona">' + esc(comp ? (comp.persona || '还没有写它的设定，点上面的「设置」补一句。')
            : '所有伙伴的碎碎念，收在同一条时间线上。') + '</p>' +
        '</div>' +
        statsHtml(st) +
      '</header>' +
      filterBar() +
      '<div id="entry-list">' + timelineHtml() + '</div>' +
      '</section>';
  }

  function firstRunView() {
    return '<section class="view">' +
      '<div class="empty">' +
        '<div class="big">🐟</div>' +
        '<h3>先给那个会和你聊天的家伙起个名字</h3>' +
        '<p>有了名字，日记才有地方放。搭好之后，每聊一次就来写一篇，' +
        '它会慢慢变成"记得你"的那一个。</p>' +
        '<button class="btn primary" data-action="new-companion">＋ 创建第一个伙伴</button>' +
      '</div>' +
      '</section>';
  }

  function statsHtml(st) {
    return '<div class="stats">' +
      '<div class="stat"><b>' + st.entries + '</b><span>篇日记</span></div>' +
      '<div class="stat"><b>' + st.memories + '</b><span>条记忆</span></div>' +
      '<div class="stat"><b>' + st.streak + '</b><span>天连着写</span></div>' +
      '</div>';
  }

  function demoBar() {
    return '<div class="demo-bar">' +
      '<span class="grow">现在看到的是<b>示例数据</b>（鱼鱼和小满），随便点、随便改，不会影响你的真实记录。</span>' +
      '<button data-action="clear-all">清空，从我自己开始</button>' +
      '</div>';
  }

  function filterBar() {
    var moods = C.MOODS.map(function (m) {
      return '<option value="' + esc(m.value) + '"' + (ui.mood === m.value ? ' selected' : '') + '>' +
        m.emoji + ' ' + esc(m.value) + '</option>';
    }).join('');

    return '<div class="toolbar">' +
      '<div class="search"><span class="ico">🔍</span>' +
        '<input id="search-input" type="search" autocomplete="off" placeholder="搜日记、原话、标签…" value="' + esc(ui.q) + '">' +
      '</div>' +
      '<button class="btn line sm" data-action="import-chat">⚡ 从聊天记录生成</button>' +
      '<select class="mood-select" id="mood-filter">' +
        '<option value="">全部心情</option>' + moods +
      '</select>' +
      '<div class="chips" id="tag-chips">' + tagChipsHtml() + '</div>' +
      '<span class="spacer"></span>' +
      '<span class="result-hint" id="result-hint">' + hintText() + '</span>' +
      '</div>';
  }

  function tagChipsHtml() {
    var tags = C.collectTags(state, ui.companionId).slice(0, 7);
    if (!tags.length) return '';
    var html = tags.map(function (t) {
      return '<button class="chip' + (ui.tag === t.tag ? ' on' : '') + '" data-action="filter-tag" data-tag="' + esc(t.tag) + '">#' + esc(t.tag) + '</button>';
    }).join('');
    if (ui.tag) html += '<button class="chip on" data-action="clear-filters">✕ 清空</button>';
    return html;
  }

  function filtered() {
    return C.searchEntries(state, {
      q: ui.q,
      companionId: ui.companionId,
      tag: ui.tag,
      mood: ui.mood
    });
  }

  function hintText() {
    if (!ui.q && !ui.tag && !ui.mood) return '';
    var n = filtered().length;
    return n ? '找到 ' + n + ' 篇' : '没找到';
  }

  function timelineHtml() {
    var list = filtered();
    if (!list.length) {
      if (ui.q || ui.tag || ui.mood) {
        return '<div class="empty"><div class="big">🔍</div><h3>这个条件下一篇都没有</h3>' +
          '<p>换个词试试，或者把筛选清掉。</p>' +
          '<button class="btn line" data-action="clear-filters">清空筛选</button></div>';
      }
      return '<div class="empty"><div class="big">🫧</div><h3>还没有日记</h3>' +
        '<p>今天聊了什么？一句也好。写下来，下次它就能接着上次说。</p>' +
        '<button class="btn primary" data-action="new-entry">✎ 写第一篇</button></div>';
    }

    var out = [];
    var lastMonth = '';
    list.forEach(function (e) {
      var mk = e.date.slice(0, 7);
      if (mk !== lastMonth) {
        lastMonth = mk;
        out.push('<div class="month-label">' + mk.replace('-', ' 年 ') + ' 月</div>');
      }
      out.push(entryHtml(e));
    });
    return '<div class="timeline">' + out.join('') + '</div>';
  }

  function entryHtml(e) {
    var comp = C.findCompanion(state, e.companionId);
    var open = !!ui.expanded[e.id];
    var d = C.parseISODate(e.date);
    var day = isNaN(d.getTime()) ? '--' : d.getDate();

    var quotes = e.quotes.slice(0, open ? 20 : 2).map(function (q) {
      return '<p><b>' + esc(q.speaker) + '：</b>' + esc(q.text) + '</p>';
    }).join('');
    if (e.quotes.length > 2 && !open) {
      quotes += '<p style="color:#a89a8b">…还有 ' + (e.quotes.length - 2) + ' 句</p>';
    }

    var canExpand = e.body.length > 110 || e.quotes.length > 2;

    return '<article class="entry">' +
      '<div class="entry-date"><b>' + day + '</b><span>' + (isNaN(d.getTime()) ? '' : (d.getMonth() + 1) + '月') + '</span>' +
        '<em>' + esc(C.weekdayCN(e.date)) + '</em></div>' +
      '<div class="entry-card' + (open ? ' open' : '') + '">' +
        '<div class="entry-head">' +
          '<h3 data-action="toggle-entry" data-id="' + esc(e.id) + '" style="cursor:pointer">' + esc(e.title) + '</h3>' +
          '<div class="entry-meta">' +
            '<span class="mood">' + moodEmoji(e.mood) + ' ' + esc(e.mood) + '</span>' +
            e.tags.map(function (t) {
              return '<button class="tag" data-action="filter-tag" data-tag="' + esc(t) + '">#' + esc(t) + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
        (e.body ? '<p class="entry-text">' + esc(e.body) + '</p>' : '') +
        (quotes ? '<div class="entry-quotes">' + quotes + '</div>' : '') +
        (e.hook ? '<div class="hook"><b>下次想聊</b><span>' + esc(e.hook) + '</span></div>' : '') +
        '<div class="entry-foot">' +
          '<span class="who">' +
            (ui.companionId === 'all' && comp ? esc(comp.emoji + ' ' + comp.name + ' · ') : '') +
            displayDate(e.date) + ' · ' + e.body.length + ' 字' +
            (canExpand ? ' · <button class="icon-btn" data-action="toggle-entry" data-id="' + esc(e.id) + '">' + (open ? '收起' : '展开') + '</button>' : '') +
          '</span>' +
          '<span class="entry-actions">' +
            '<button class="icon-btn" data-action="edit-entry" data-id="' + esc(e.id) + '">编辑</button>' +
            '<button class="icon-btn danger" data-action="delete-entry" data-id="' + esc(e.id) + '">删除</button>' +
          '</span>' +
        '</div>' +
      '</div>' +
      '</article>';
  }

  /* ---------------------------- 对话视图 ---------------------------- */

  function chatCompanion() {
    if (ui.companionId !== 'all') {
      var c = C.findCompanion(state, ui.companionId);
      if (c) return c;
    }
    return state.companions[0] || null;
  }

  function chatView() {
    if (!state.companions.length) return firstRunView();
    var comp = chatCompanion();
    var ready = !!(AI && AI.isReady());
    var chat = C.getChat(state, comp.id);

    return '<section class="view">' +
      '<div class="view-head">' +
        '<h2>和 ' + esc(comp.emoji + ' ' + comp.name) + ' 说说话</h2>' +
        '<p>' + (ready
          ? '每次回复都会带上它的记忆包——所以它记得你。聊完点右上角「写成日记」，这段就留下了。'
          : '填一次 DeepSeek API Key，就能在这里直接聊；写在下面这段对话，会连同记忆一起存进日记。') + '</p>' +
      '</div>' +
      (ready ? chatShellHtml(comp, chat) : chatSetupHtml()) +
      '</section>';
  }

  function chatSetupHtml() {
    return '<div class="setup-card">' +
      '<div class="setup-emoji">🔑</div>' +
      '<h3>还差一把钥匙</h3>' +
      '<p>这里的聊天走 DeepSeek 官方接口，需要一个你自己的 API Key。' +
        '它只保存在这台设备的浏览器里，不会上传到任何地方，也不会写进导出的备份。</p>' +
      '<p class="setup-hint">去 <b>platform.deepseek.com</b> → API keys → 创建，复制 sk- 开头的那串。</p>' +
      '<button class="btn primary" data-action="settings">去填 API Key</button>' +
      '<span class="setup-or">或者</span>' +
      '<button class="btn line" data-action="import-chat">⚡ 直接粘贴聊天记录生成日记</button>' +
      '</div>';
  }

  function chatShellHtml(comp, chat) {
    var rounds = chat.filter(function (m) { return m.role === 'user'; }).length;
    return '<div class="chat-shell">' +
      '<div class="chat-list" id="chat-list">' + chatBubblesHtml(comp, chat) + '</div>' +
      '<div class="chat-compose">' +
        '<textarea id="chat-input" rows="2" placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"></textarea>' +
        '<button class="btn primary" data-action="send-chat">发送</button>' +
      '</div>' +
      '</div>' +
      '<div class="chat-foot">' +
        '<span id="chat-count">聊了 ' + rounds + ' 轮 · 记忆包里带了 ' +
          C.memoriesFor(state, comp.id).length + ' 条记忆</span>' +
        '<span class="grow"></span>' +
        '<button class="icon-btn" data-action="chat-to-diary">写成日记</button>' +
        '<button class="icon-btn danger" data-action="clear-chat">清空对话</button>' +
      '</div>';
  }

  function chatBubblesHtml(comp, chat) {
    if (!chat.length && !ui.chat.pending && !ui.chat.error) {
      return '<div class="chat-empty"><span>还没有聊过。</span>' +
        '<span>试试第一句：「我回来了。」</span></div>';
    }
    var html = chat.map(function (m) {
      return '<div class="bubble ' + (m.role === 'user' ? 'me' : 'ai') + '">' + esc(m.text) + '</div>';
    }).join('');
    if (ui.chat.pending) {
      html += '<div class="bubble ai typing"><i></i><i></i><i></i></div>';
    }
    if (ui.chat.error) {
      html += '<div class="bubble err">' + esc(ui.chat.error) + '</div>';
    }
    return html;
  }

  function renderChatList() {
    var list = byId('chat-list');
    if (!list) return;
    var comp = chatCompanion();
    list.innerHTML = chatBubblesHtml(comp, C.getChat(state, comp.id));
    list.scrollTop = list.scrollHeight;
    var count = byId('chat-count');
    if (count) {
      var rounds = C.getChat(state, comp.id).filter(function (m) { return m.role === 'user'; }).length;
      count.textContent = '聊了 ' + rounds + ' 轮 · 记忆包里带了 ' +
        C.memoriesFor(state, comp.id).length + ' 条记忆';
    }
  }

  function sendChat() {
    var input = byId('chat-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    var comp = chatCompanion();
    if (!comp) return;
    if (!(AI && AI.isReady())) { openSettingsModal(); toast('先填一个 API Key'); return; }

    C.appendChat(state, comp.id, { role: 'user', text: text });
    var history = C.getChat(state, comp.id).slice(0, -1);
    input.value = '';
    input.focus();
    ui.chat.error = '';
    ui.chat.pending = true;
    persist();
    renderChatList();

    AI.reply({
      companion: comp,
      memories: C.memoriesFor(state, comp.id),
      entries: C.entriesFor(state, comp.id).slice(0, 4),
      history: history,
      userText: text
    }).then(function (answer) {
      ui.chat.pending = false;
      C.appendChat(state, comp.id, { role: 'ai', text: answer });
      persist();
      renderChatList();
    }).catch(function (err) {
      ui.chat.pending = false;
      ui.chat.error = err.message || '出错了';
      renderChatList();
    });
  }

  /* ---------------------------- 从聊天记录生成 ---------------------------- */

  function openImportModal(opts) {
    opts = opts || {};
    var comp = opts.companionId
      ? C.findCompanion(state, opts.companionId)
      : chatCompanion();

    ui.imp = {
      companionId: comp ? comp.id : (state.companions[0] || {}).id || null,
      log: opts.log || '',
      draft: null,
      source: '',
      busy: false
    };
    renderImportModal();
    if (ui.imp.log) runLocalDraft(true);
  }

  function renderImportModal() {
    var im = ui.imp;
    if (!im) return;
    var comp = C.findCompanion(state, im.companionId) || state.companions[0];
    var hasKey = !!(AI && AI.isReady());
    var options = state.companions.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === im.companionId ? ' selected' : '') + '>' +
        esc(c.emoji + ' ' + c.name) + '</option>';
    }).join('');

    var preview = '';
    if (im.draft) {
      var d = im.draft;
      var st = im.stats || {};
      preview = '<div class="imp-preview">' +
        '<div class="imp-preview-top">' +
          '<span class="imp-source">' + (im.source === 'ai' ? '✨ AI 整理' : '⚡ 本地整理') +
            (st.total ? ' · 读到 ' + st.total + ' 句' : '') + '</span>' +
          '<span class="mood">' + moodEmoji(d.mood) + ' ' + esc(d.mood) + '</span>' +
        '</div>' +
        '<h4>' + esc(d.title) + '</h4>' +
        '<div class="chips">' + d.tags.map(function (t) {
          return '<span class="chip on">#' + esc(t) + '</span>';
        }).join('') + '</div>' +
        '<p class="imp-body">' + esc(d.body) + '</p>' +
        (d.quotes.length ? '<div class="entry-quotes">' + d.quotes.map(function (q) {
          return '<p><b>' + esc(q.speaker) + '：</b>' + esc(q.text) + '</p>';
        }).join('') + '</div>' : '') +
        (d.hook ? '<div class="hook"><b>下次想聊</b><span>' + esc(d.hook) + '</span></div>' : '') +
        '</div>';
    }

    openModal(
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<div><h3>从聊天记录生成日记</h3>' +
            '<p class="sub">把 QQ / 微信 / 网页里的对话整段粘进来，自动整理成一篇草稿</p></div>' +
          '<button type="button" class="icon-btn" data-action="close-modal">✕</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<label class="f"><span>粘在这里</span>' +
            '<textarea id="import-log" spellcheck="false" placeholder="鱼鱼：今天吃饭了吗？&#10;我：还没，加班。&#10;鱼鱼：那你先把小鱼干吃完再理我。">' + esc(im.log) + '</textarea></label>' +
          '<div class="row">' +
            '<label class="f"><span>这段对话属于</span><select id="import-companion">' + options + '</select></label>' +
            '<div class="field"><span>整理方式</span>' +
              '<div class="pack-actions">' +
                '<button type="button" class="btn line sm" data-action="import-local"' + (im.busy ? ' disabled' : '') + '>⚡ 本地整理</button>' +
                '<button type="button" class="btn line sm" data-action="import-ai"' + (im.busy || !hasKey ? ' disabled' : '') + '>' +
                  (im.busy ? '整理中…' : '✨ AI 精修') + '</button>' +
              '</div>' +
              (hasKey ? '' : '<span class="f-note">填了 API Key 才能用 AI 精修</span>') +
            '</div>' +
          '</div>' +
          preview +
        '</div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn ghost" data-action="close-modal">取消</button>' +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn primary" data-action="import-apply"' + (im.draft ? '' : ' disabled') + '>' +
            '填进日记编辑器</button>' +
        '</div>' +
      '</div>'
    );
  }

  function collectImportLog() {
    var el = byId('import-log');
    if (el) ui.imp.log = el.value;
    var sel = byId('import-companion');
    if (sel) ui.imp.companionId = sel.value;
  }

  function runLocalDraft(silent) {
    collectImportLog();
    var comp = C.findCompanion(state, ui.imp.companionId) || state.companions[0];
    if (!ui.imp.log.trim()) {
      if (!silent) toast('先把聊天记录粘进来');
      return;
    }
    try {
      var d = C.draftEntryFromChat(ui.imp.log, { companionName: comp.name });
      ui.imp.draft = d;
      ui.imp.stats = d.stats;
      ui.imp.source = 'local';
      renderImportModal();
      if (!silent) toast('整理好了，改改再存');
    } catch (err) {
      toast(err.message);
    }
  }

  function runAiDraft() {
    collectImportLog();
    if (!ui.imp.log.trim()) { toast('先把聊天记录粘进来'); return; }
    var comp = C.findCompanion(state, ui.imp.companionId) || state.companions[0];

    var fallback = null;
    try { fallback = C.draftEntryFromChat(ui.imp.log, { companionName: comp.name }); } catch (e) { fallback = null; }

    ui.imp.busy = true;
    renderImportModal();

    AI.summarize({
      log: ui.imp.log,
      companion: comp,
      memories: C.memoriesFor(state, comp.id),
      fallback: fallback
    }).then(function (d) {
      ui.imp.busy = false;
      ui.imp.draft = d;
      ui.imp.stats = fallback ? fallback.stats : {};
      ui.imp.source = 'ai';
      renderImportModal();
      toast('AI 整理好了');
    }).catch(function (err) {
      ui.imp.busy = false;
      renderImportModal();
      toast(err.message || 'AI 整理失败');
    });
  }

  function applyImportDraft() {
    if (!ui.imp || !ui.imp.draft) return;
    var draft = Object.assign({}, ui.imp.draft, { companionId: ui.imp.companionId });
    closeModal();
    openEntryModal(null, draft);
  }

  /* ---------------------------- 记忆卡视图 ---------------------------- */

  function memoriesView() {
    if (!state.companions.length) return firstRunView();

    var list = C.sortMemories(C.memoriesFor(state, ui.companionId));
    var kinds = C.MEMORY_KINDS.map(function (k) { return '<option value="' + k + '">' + k + '</option>'; }).join('');

    var cards = list.map(function (m) {
      return '<div class="mem' + (m.pinned ? ' pinned' : '') + '">' +
        '<div class="mem-top">' +
          '<span class="kind" data-k="' + esc(m.kind) + '">' + esc(m.kind) + '</span>' +
          '<button class="pin-btn' + (m.pinned ? ' on' : '') + '" data-action="pin-memory" data-id="' + esc(m.id) + '" title="钉住">📌</button>' +
        '</div>' +
        '<p>' + esc(m.text) + '</p>' +
        '<div class="mem-foot">' +
          '<span>' + escapeCompanion(m) + '</span>' +
          '<button class="icon-btn danger" data-action="del-memory" data-id="' + esc(m.id) + '">删除</button>' +
        '</div>' +
        '</div>';
    }).join('');

    return '<section class="view">' +
      '<div class="view-head">' +
        '<h2>记忆卡</h2>' +
        '<p>那些不想每次都重新说一遍的事：你的口味、约定、雷区、它的口头禅。' +
        '写进记忆包时，这些会排在最前面。</p>' +
      '</div>' +
      '<form class="memory-add" data-form="memory">' +
        '<select name="kind">' + kinds + '</select>' +
        '<input name="text" maxlength="160" autocomplete="off" placeholder="比如：我不吃香菜，奶茶三分糖去冰。">' +
        '<button class="btn primary" type="submit">记住</button>' +
      '</form>' +
      (list.length ? '<div class="memory-grid">' + cards + '</div>'
        : '<div class="empty"><div class="big">📌</div><h3>还没有一张记忆卡</h3>' +
          '<p>从最小的事实开始：它怎么叫你、你不吃什么、约好每天说晚安。</p></div>') +
      '</section>';
  }

  function escapeCompanion(m) {
    var c = C.findCompanion(state, m.companionId);
    return c ? esc(c.emoji + ' ' + c.name) : '';
  }

  /* ---------------------------- 记忆包视图 ---------------------------- */

  function packView() {
    if (!state.companions.length) return firstRunView();

    if (!ui.pack.companionId || !C.findCompanion(state, ui.pack.companionId)) {
      ui.pack.companionId = ui.companionId !== 'all' ? ui.companionId : state.companions[0].id;
    }

    var options = state.companions.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (ui.pack.companionId === c.id ? ' selected' : '') + '>' +
        esc(c.emoji + ' ' + c.name) + '</option>';
    }).join('');

    var pack = C.buildMemoryPack(state, ui.pack.companionId, {
      maxEntries: ui.pack.maxEntries,
      includeQuotes: ui.pack.quotes
    });

    var pct = ((ui.pack.maxEntries - 1) / 19) * 100;

    return '<section class="view">' +
      '<div class="view-head">' +
        '<h2>记忆包</h2>' +
        '<p>窗口关掉、上下文清空、换了 App——把下面这段整段粘到新对话的第一条消息，' +
        '它就还是那个记得你的它。</p>' +
      '</div>' +
      '<div class="pack-layout">' +
        '<div class="pack-controls">' +
          '<label class="field"><span>哪位伙伴</span>' +
            '<select id="pack-companion">' + options + '</select></label>' +
          '<label class="field"><span>带上最近 <b class="val" id="pack-count">' + ui.pack.maxEntries + '</b> 篇日记</span>' +
            '<input id="pack-entries" type="range" min="1" max="20" value="' + ui.pack.maxEntries + '" style="--pct:' + pct + '%">' +
          '</label>' +
          '<label class="switch"><input id="pack-quotes" type="checkbox"' + (ui.pack.quotes ? ' checked' : '') + '> 带上对话原话</label>' +
          '<div class="pack-facts" id="pack-facts">' +
            '共 <b>' + pack.memoryCount + '</b> 条长期记忆 · <b>' + pack.entryCount + '</b> 篇日记 · 约 <b>' + pack.chars + '</b> 字' +
          '</div>' +
          '<div class="how">' +
            '<h4>怎么用</h4>' +
            '<ol>' +
              '<li>点「复制记忆包」</li>' +
              '<li>打开新的对话窗口，整段粘贴成第一条消息</li>' +
              '<li>末尾补一句「我们继续」，然后接着说</li>' +
            '</ol>' +
          '</div>' +
        '</div>' +
        '<div class="pack-preview-wrap">' +
          '<textarea class="pack-preview" id="pack-preview" spellcheck="false" readonly>' + esc(pack.text) + '</textarea>' +
          '<div class="pack-actions">' +
            '<button class="btn primary" data-action="copy-pack">⧉ 复制记忆包</button>' +
            '<button class="btn line" data-action="download-pack">存成 .txt</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '</section>';
  }

  function refreshPack() {
    var preview = byId('pack-preview');
    if (!preview) return;
    var pack = C.buildMemoryPack(state, ui.pack.companionId, {
      maxEntries: ui.pack.maxEntries,
      includeQuotes: ui.pack.quotes
    });
    preview.value = pack.text;
    var count = byId('pack-count');
    if (count) count.textContent = ui.pack.maxEntries;
    var facts = byId('pack-facts');
    if (facts) {
      facts.innerHTML = '共 <b>' + pack.memoryCount + '</b> 条长期记忆 · <b>' + pack.entryCount +
        '</b> 篇日记 · 约 <b>' + pack.chars + '</b> 字';
    }
  }

  /* ============================== 弹窗 ============================== */

  function openModal(html) {
    els.modal.innerHTML = '<div class="modal-backdrop">' + html + '</div>';
    document.body.style.overflow = 'hidden';
    var first = $('.modal input, .modal textarea, .modal select', els.modal);
    if (first) setTimeout(function () { first.focus(); }, 40);
  }

  function closeModal() {
    els.modal.innerHTML = '';
    document.body.style.overflow = '';
  }

  function openEntryModal(id, draft) {
    if (!state.companions.length) { openCompanionModal(); return; }
    var editing = id ? C.getEntry(state, id) : null;
    var compId = editing ? editing.companionId
      : (draft && draft.companionId ? draft.companionId
        : (ui.companionId !== 'all' ? ui.companionId : state.companions[0].id));
    var comp = C.findCompanion(state, compId);

    var e = editing || C.makeEntry({ companionId: compId, date: C.todayISO(), mood: '平静' });

    if (draft) {
      e.title = draft.title || e.title;
      e.mood = draft.mood || e.mood;
      if (Array.isArray(draft.tags)) e.tags = draft.tags;
      e.body = draft.body || '';
      if (Array.isArray(draft.quotes)) e.quotes = draft.quotes;
      e.hook = draft.hook || '';
    }

    openModal(
      '<form class="modal" data-form="entry" data-id="' + esc(e.id) + '">' +
        '<div class="modal-head">' +
          '<div><h3>' + (editing ? '编辑这一天' : '今天想记下什么') + '</h3>' +
            '<p class="sub">写给 ' + esc(comp.name) + ' · 只会存在这台电脑上</p></div>' +
          '<button type="button" class="icon-btn" data-action="close-modal">✕</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="row">' +
            '<label class="f"><span>日期</span>' +
              '<input type="date" name="date" value="' + esc(e.date) + '" required></label>' +
            '<label class="f"><span>哪位伙伴</span><select name="companionId">' +
              state.companions.map(function (c) {
                return '<option value="' + esc(c.id) + '"' + (c.id === e.companionId ? ' selected' : '') + '>' +
                  esc(c.emoji + ' ' + c.name) + '</option>';
              }).join('') +
            '</select></label>' +
          '</div>' +
          '<label class="f"><span>标题</span>' +
            '<input type="text" name="title" maxlength="40" value="' + esc(e.title) + '" placeholder="一句话概括今天"></label>' +
          '<div class="field"><span>心情</span>' +
            '<div class="mood-picker">' +
              C.MOODS.map(function (m) {
                return '<button type="button" class="mood-pill' + (m.value === e.mood ? ' on' : '') +
                  '" data-action="pick-mood" data-mood="' + esc(m.value) + '">' + m.emoji + ' ' + esc(m.value) + '</button>';
              }).join('') +
            '</div>' +
            '<input type="hidden" name="mood" value="' + esc(e.mood) + '">' +
          '</div>' +
          '<label class="f"><span>标签（用逗号隔开）</span>' +
            '<input type="text" name="tags" value="' + esc(e.tags.join(', ')) + '" placeholder="晚安, 黏人, 吃饭"></label>' +
          '<label class="f"><span>日记正文</span>' +
            '<textarea name="body" placeholder="今天聊了什么？它说了哪句话让你停了一下？">' + esc(e.body) + '</textarea></label>' +
          '<div class="field"><span>印象深刻的原话（可选）</span>' +
            '<div class="quote-rows" id="quote-rows">' + quoteRowsHtml(e.quotes, comp) + '</div>' +
            '<button type="button" class="add-quote" data-action="add-quote">＋ 再加一句</button>' +
          '</div>' +
          '<label class="f"><span>下次想聊（可选）</span>' +
            '<input type="text" name="hook" maxlength="120" value="' + esc(e.hook) + '" placeholder="比如：问问它月亮快递寄到哪了"></label>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn ghost" data-action="close-modal">取消</button>' +
          '<span class="spacer"></span>' +
          (editing ? '<button type="button" class="btn danger" data-action="delete-entry" data-id="' + esc(e.id) + '">删掉这篇</button>' : '') +
          '<button type="submit" class="btn primary">存进日记</button>' +
        '</div>' +
      '</form>'
    );
  }

  function quoteRowsHtml(quotes, comp) {
    var rows = quotes.length ? quotes : [{ speaker: '我', text: '' }];
    return rows.map(function (q) { return quoteRowHtml(q, comp); }).join('');
  }

  function quoteRowHtml(q, comp) {
    var speakers = ['我', comp.name, '旁白'];
    if (q && q.speaker && speakers.indexOf(q.speaker) < 0) speakers.push(q.speaker);
    return '<div class="quote-row">' +
      '<select class="q-speaker">' + speakers.map(function (s) {
        return '<option value="' + esc(s) + '"' + (q && q.speaker === s ? ' selected' : '') + '>' + esc(s) + '</option>';
      }).join('') + '</select>' +
      '<input class="q-text" type="text" value="' + esc(q ? q.text : '') + '" placeholder="它说了什么…">' +
      '<button type="button" class="rm" data-action="del-quote" title="删掉这句">✕</button>' +
      '</div>';
  }

  function openCompanionModal() {
    openModal(
      '<form class="modal" data-form="companion">' +
        '<div class="modal-head">' +
          '<div><h3>新伙伴</h3><p class="sub">名字和一句设定，就够开始了</p></div>' +
          '<button type="button" class="icon-btn" data-action="close-modal">✕</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="field"><span>怎么称呼它</span>' +
            '<div class="input-with-btn">' +
              '<input type="text" name="name" maxlength="24" value="" placeholder="比如：鱼鱼" autocomplete="off" required>' +
              '<button type="button" class="btn line sm" data-action="suggest-name">🎲 让它自己取</button>' +
            '</div>' +
            '<span class="f-note">没想好？让它自己决定——名字、头像、设定它会一起想好。</span>' +
          '</div>' +
          '<div class="field"><span>挑个头像</span>' +
            '<div class="emoji-row" id="emoji-row">' +
              EMOJIS.map(function (em, i) {
                return '<button type="button" class="emoji-pick' + (i === 0 ? ' on' : '') +
                  '" data-action="pick-emoji" data-emoji="' + em + '">' + em + '</button>';
              }).join('') +
            '</div>' +
            '<input type="hidden" name="emoji" value="' + EMOJIS[0] + '">' +
          '</div>' +
          '<div class="field"><span>一句设定（可选）</span>' +
            '<div class="input-with-btn">' +
              '<input type="text" name="persona" maxlength="80" value="" placeholder="点下面的预设，或者自己写一句">' +
            '</div>' +
            '<div class="chips preset-chips">' +
              PERSONAS.map(function (p, i) {
                return '<button type="button" class="chip" data-action="pick-persona" data-i="' + i + '">' +
                  p.emoji + ' ' + esc(p.label) + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<label class="f"><span>哪天认识的</span>' +
            '<input type="date" name="since" value="' + C.todayISO() + '"></label>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn ghost" data-action="close-modal">取消</button>' +
          '<span class="spacer"></span>' +
          '<button type="submit" class="btn primary">开始记录</button>' +
        '</div>' +
      '</form>'
    );
  }

  /** 把某个 emoji 选中；不在预设列表里就临时加一个 */
  function applyEmoji(form, emoji) {
    if (!emoji) return;
    var row = byId('emoji-row');
    if (!row) return;
    var found = null;
    $$('.emoji-pick', row).forEach(function (b) {
      b.classList.remove('on');
      if (b.getAttribute('data-emoji') === emoji) found = b;
    });
    if (!found) {
      found = document.createElement('button');
      found.type = 'button';
      found.className = 'emoji-pick on';
      found.setAttribute('data-action', 'pick-emoji');
      found.setAttribute('data-emoji', emoji);
      found.textContent = emoji;
      row.appendChild(found);
    } else {
      found.classList.add('on');
    }
    form.elements.emoji.value = emoji;
  }

  function localCompanionIdea(form) {
    var current = form.elements.name.value.trim();
    var pool = LOCAL_NAMES.filter(function (x) { return x.name !== current; });
    var pick = pool[Math.floor(Math.random() * pool.length)] || LOCAL_NAMES[0];
    form.elements.name.value = pick.name;
    form.elements.persona.value = pick.persona;
    applyEmoji(form, pick.emoji);
    form.elements.name.focus();
    form.elements.name.select();
    return pick;
  }

  function suggestName() {
    var form = $('form[data-form="companion"]');
    if (!form) return;
    var btn = form.querySelector('[data-action="suggest-name"]');
    var hint = form.elements.persona.value.trim() || form.elements.name.value.trim();

    function finish(c) {
      if (btn) { btn.disabled = false; btn.textContent = '🎲 让它自己取'; }
      form.elements.name.value = c.name;
      if (c.persona) form.elements.persona.value = c.persona;
      applyEmoji(form, c.emoji);
      form.elements.name.focus();
      form.elements.name.select();
      toast('它给自己取名叫「' + c.name + '」');
    }

    function fallback(msg) {
      if (btn) { btn.disabled = false; btn.textContent = '🎲 让它自己取'; }
      localCompanionIdea(form);
      toast(msg || '先用本地想的名字');
    }

    if (btn) { btn.disabled = true; btn.textContent = '它正在想…'; }

    if (AI && AI.isReady()) {
      AI.suggestCompanion({ hint: hint }).then(finish).catch(function (err) {
        fallback((err && err.message ? err.message + '，' : '') + '先给你起了个本地的名字');
      });
    } else {
      fallback('还没填 API Key，先用本地的名字');
    }
  }

  function openSettingsModal() {
    var cfg = AI ? AI.loadConfig() : { key: '', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' };
    var hasKey = !!(cfg.key);

    openModal(
      '<form class="modal" data-form="settings">' +
        '<div class="modal-head">' +
          '<div><h3>设置</h3><p class="sub">数据只在本机，随时可以导出带走</p></div>' +
          '<button type="button" class="icon-btn" data-action="close-modal">✕</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<label class="f"><span>你的名字（只写在导出文件里）</span>' +
            '<input type="text" name="ownerName" maxlength="24" value="' + esc(state.ownerName) + '" placeholder="怎么称呼你"></label>' +

          '<div class="ai-box">' +
            '<div class="ai-head"><b>AI 对话与摘要（可选）</b>' +
              '<span class="ai-state' + (hasKey ? ' on' : '') + '">' + (hasKey ? '已配置' : '未配置') + '</span>' +
            '</div>' +
            '<label class="f"><span>API Key</span>' +
              '<input type="password" name="apiKey" value="' + esc(cfg.key) + '" placeholder="sk-…" autocomplete="off" spellcheck="false"></label>' +
            '<div class="row">' +
              '<label class="f"><span>模型</span>' +
                '<input type="text" name="model" value="' + esc(cfg.model) + '" list="model-list" spellcheck="false">' +
                '<datalist id="model-list"><option value="deepseek-chat"><option value="deepseek-reasoner"></datalist></label>' +
              '<label class="f"><span>接口地址</span>' +
                '<input type="text" name="baseUrl" value="' + esc(cfg.baseUrl) + '" spellcheck="false"></label>' +
            '</div>' +
            '<div class="pack-actions">' +
              '<button type="button" class="btn line sm" data-action="test-ai">测试连接</button>' +
              '<span class="f-note">Key 只存在这台设备，不会进导出备份</span>' +
            '</div>' +
          '</div>' +

          '<div class="pack-facts">现在有 <b>' + state.companions.length + '</b> 位伙伴 · <b>' +
            state.entries.length + '</b> 篇日记 · <b>' + state.memories.length + '</b> 条记忆</div>' +
          '<div class="field"><span>数据</span>' +
            '<div class="pack-actions">' +
              '<button type="button" class="btn line" data-action="export-json">导出 JSON 备份</button>' +
              '<button type="button" class="btn line" data-action="import-json">导入备份</button>' +
              '<button type="button" class="btn line" data-action="export-md">导出 Markdown</button>' +
            '</div>' +
          '</div>' +
          '<div class="field"><span>危险操作</span>' +
            '<div class="pack-actions">' +
              '<button type="button" class="btn line" data-action="seed-demo">载入示例数据</button>' +
              '<button type="button" class="btn danger" data-action="clear-all">清空全部数据</button>' +
            '</div>' +
            '<p class="side-hint" style="margin:2px 0 0">清空前建议先导出一份备份。</p>' +
          '</div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn ghost" data-action="close-modal">取消</button>' +
          '<span class="spacer"></span>' +
          '<button type="submit" class="btn primary">保存</button>' +
        '</div>' +
      '</form>'
    );
  }

  /* ============================== 行为 ============================== */

  function selectCompanion(id) {
    ui.companionId = id;
    ui.tag = '';
    ui.q = '';
    ui.mood = '';
    if (id !== 'all') state.activeCompanionId = id;
    persist();
    render();
  }

  function setView(view) {
    ui.view = view;
    if (view === 'pack' && (!ui.pack.companionId || !C.findCompanion(state, ui.pack.companionId))) {
      ui.pack.companionId = ui.companionId !== 'all' ? ui.companionId : (state.companions[0] || {}).id || null;
    }
    render();
    var sc = $('.scroll');
    if (sc) sc.scrollTop = 0;
  }

  function saveEntryForm(form) {
    var f = form.elements;
    var title = f.title.value.trim();
    var quotes = [];
    $$('.quote-row', form).forEach(function (row) {
      var text = $('.q-text', row).value.trim();
      if (text) quotes.push({ speaker: $('.q-speaker', row).value, text: text });
    });

    var tags = f.tags.value.split(/[,，\s]+/).map(function (t) { return t.trim(); }).filter(Boolean);

    var entry = C.upsertEntry(state, {
      id: form.dataset.id,
      companionId: f.companionId.value,
      date: f.date.value || C.todayISO(),
      title: title || '没有标题的一天',
      mood: f.mood.value || '平静',
      tags: tags,
      body: f.body.value,
      quotes: quotes,
      hook: f.hook.value.trim()
    });

    if (ui.companionId !== 'all') state.activeCompanionId = ui.companionId;
    persist();
    closeModal();

    // 存完就回到日记列表，让人看见刚写下的那篇
    ui.view = 'diary';
    if (ui.companionId !== 'all') ui.companionId = entry.companionId;
    render();
    toast('已存进日记 · ' + C.formatDateCN(entry.date));
  }

  function deleteEntry(id) {
    var entry = C.getEntry(state, id);
    if (!entry) return;
    if (!window.confirm('删掉《' + entry.title + '》这篇日记？删了就找不回来了。')) return;
    C.removeEntry(state, id);
    persist();
    closeModal();
    render();
    toast('已删除');
  }

  function chatToDiary() {
    var comp = chatCompanion();
    if (!comp) return;
    var chat = C.getChat(state, comp.id);
    if (!chat.length) { toast('还没聊呢，先说两句'); return; }
    openImportModal({ log: C.chatToLog(chat, comp.name), companionId: comp.id });
  }

  function clearChat() {
    var comp = chatCompanion();
    if (!comp) return;
    if (!window.confirm('清空和「' + comp.name + '」的这段对话？日记里的记录不会动。')) return;
    C.clearChat(state, comp.id);
    ui.chat.error = '';
    persist();
    render();
    toast('对话清空了');
  }

  function testAi() {
    var form = $('form[data-form="settings"]');
    if (form) {
      var key = form.elements.apiKey.value.trim();
      if (!key) { toast('先把 API Key 填上'); return; }
      AI.saveConfig({
        key: key,
        model: form.elements.model.value,
        baseUrl: form.elements.baseUrl.value
      });
    }
    toast('正在测试…');
    AI.test().then(function (res) {
      toast('连上了 · 模型回了：' + (res.sample || 'OK'));
    }).catch(function (err) {
      toast(err.message || '连接失败');
    });
  }

  function copyPack() {
    var preview = byId('pack-preview');
    if (!preview) return;
    var text = preview.value;
    copyText(text).then(function () {
      toast('复制好了 · ' + text.length + ' 字');
    }).catch(function () {
      if (fallbackCopy(preview)) toast('复制好了（手动选中也可）');
      else toast('复制失败，请手动全选复制');
    });
  }

  function exportJSON() {
    var name = '聊天日记备份-' + C.todayISO() + '.json';
    download(name, C.exportJSON(state), 'application/json;charset=utf-8');
    toast('备份已导出：' + name);
  }

  function exportMarkdown() {
    var name = '聊天日记-' + C.todayISO() + '.md';
    download(name, C.exportMarkdown(state, 'all'), 'text/markdown;charset=utf-8');
    toast('Markdown 已导出');
  }

  function importJSON() {
    els.file.value = '';
    els.file.click();
  }

  function handleFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var next = C.parseImport(String(reader.result));
        if (!window.confirm('导入会覆盖现在的数据（' + state.entries.length + ' 篇日记）。继续？')) return;
        state = next;
        isDemo = false;
        ui.companionId = state.activeCompanionId || 'all';
        ui.q = ''; ui.tag = ''; ui.mood = '';
        persist();
        closeModal();
        render();
        toast('导入成功 · ' + state.entries.length + ' 篇日记');
      } catch (err) {
        toast('导入失败：' + err.message);
      }
    };
    reader.onerror = function () { toast('这个文件读不出来'); };
    reader.readAsText(file, 'utf-8');
  }

  function clearAll() {
    if (!window.confirm('清空所有伙伴、日记和记忆？这个操作不能撤销，建议先导出备份。')) return;
    state = C.createEmptyState();
    isDemo = false;
    ui.companionId = 'all';
    ui.q = ''; ui.tag = ''; ui.mood = '';
    ui.expanded = {};
    ui.pack.companionId = null;
    persist();
    closeModal();
    render();
    toast('已清空，重新开始');
  }

  function loadDemo() {
    if (!window.confirm('载入示例数据会把现在的记录替换掉，继续？')) return;
    state = C.seedState();
    isDemo = true;
    ui.companionId = state.companions[0].id;
    ui.q = ''; ui.tag = ''; ui.mood = '';
    persist();
    closeModal();
    render();
    toast('示例数据已载入');
  }

  /* ============================== 事件 ============================== */

  function handleAction(el) {
    var action = el.getAttribute('data-action');
    var id = el.getAttribute('data-id');

    switch (action) {
      case 'select-companion': return selectCompanion(id);
      case 'view': return setView(el.getAttribute('data-view'));
      case 'new-entry': return openEntryModal(null);
      case 'edit-entry': return openEntryModal(id);
      case 'delete-entry': return deleteEntry(id);
      case 'toggle-entry':
        ui.expanded[id] = !ui.expanded[id];
        return render();
      case 'filter-tag':
        ui.tag = ui.tag === el.getAttribute('data-tag') ? '' : el.getAttribute('data-tag');
        return render();
      case 'clear-filters':
        ui.q = ''; ui.tag = ''; ui.mood = '';
        return render();
      case 'new-companion': return openCompanionModal();
      case 'settings': return openSettingsModal();
      case 'close-modal': return closeModal();
      case 'pick-mood': {
        var form = el.closest('form');
        form.elements.mood.value = el.getAttribute('data-mood');
        $$('.mood-pill', form).forEach(function (b) { b.classList.toggle('on', b === el); });
        return;
      }
      case 'pick-emoji': {
        var f2 = el.closest('form');
        f2.elements.emoji.value = el.getAttribute('data-emoji');
        $$('.emoji-pick', f2).forEach(function (b) { b.classList.toggle('on', b === el); });
        return;
      }
      case 'add-quote': {
        var rows = byId('quote-rows');
        if (!rows) return;
        var comp = companion() || state.companions[0];
        var tmp = document.createElement('div');
        tmp.innerHTML = quoteRowHtml({ speaker: '我', text: '' }, comp);
        rows.appendChild(tmp.firstChild);
        var last = rows.lastChild.querySelector('.q-text');
        if (last) last.focus();
        return;
      }
      case 'del-quote': {
        var row = el.closest('.quote-row');
        var parent = row && row.parentNode;
        if (parent) {
          if ($$('.quote-row', parent).length > 1) row.remove();
          else $$('input,select', row).forEach(function (n) { n.value = ''; });
        }
        return;
      }
      case 'pin-memory': {
        C.togglePin(state, id);
        persist();
        return render();
      }
      case 'del-memory': {
        C.removeMemory(state, id);
        persist();
        render();
        return toast('删掉了一条记忆');
      }
      case 'copy-pack': return copyPack();
      case 'download-pack': {
        var preview = byId('pack-preview');
        if (!preview) return;
        var comp = C.findCompanion(state, ui.pack.companionId);
        download('记忆包-' + (comp ? comp.name : '伙伴') + '-' + C.todayISO() + '.txt', preview.value);
        return toast('已存成 txt');
      }
      case 'export-json': return exportJSON();
      case 'export-md': return exportMarkdown();
      case 'import-json': return importJSON();
      case 'clear-all': return clearAll();
      case 'seed-demo': return loadDemo();
      case 'import-chat': return openImportModal({});
      case 'import-local': return runLocalDraft(false);
      case 'import-ai': return runAiDraft();
      case 'import-apply': return applyImportDraft();
      case 'send-chat': return sendChat();
      case 'chat-to-diary': return chatToDiary();
      case 'clear-chat': return clearChat();
      case 'test-ai': return testAi();
      case 'suggest-name': return suggestName();
      case 'pick-persona': {
        var pForm = el.closest('form');
        var p = PERSONAS[Number(el.getAttribute('data-i'))];
        if (!pForm || !p) return;
        pForm.elements.persona.value = p.text;
        applyEmoji(pForm, p.emoji);
        $$('.preset-chips .chip', pForm).forEach(function (b) {
          b.classList.toggle('on', b === el);
        });
        return;
      }
      default: return;
    }
  }

  function submitHandler(e) {
    var form = e.target;
    if (!form || !form.dataset || !form.dataset.form) return;
    e.preventDefault();

    if (form.dataset.form === 'entry') return saveEntryForm(form);

    if (form.dataset.form === 'companion') {
      var cf = form.elements;
      var name = cf.name.value.trim();
      if (!name) { toast('先给它起个名字'); cf.name.focus(); return; }
      var comp = C.addCompanion(state, {
        name: name,
        emoji: cf.emoji.value,
        persona: cf.persona.value.trim(),
        since: cf.since.value || C.todayISO()
      });
      ui.companionId = comp.id;
      state.activeCompanionId = comp.id;
      persist();
      closeModal();
      render();
      toast('「' + comp.name + '」来了');
      return;
    }

    if (form.dataset.form === 'memory') {
      var mf = form.elements;
      var text = mf.text.value.trim();
      if (!text) return;
      var target = ui.companionId !== 'all' ? ui.companionId : state.companions[0].id;
      C.addMemory(state, { companionId: target, kind: mf.kind.value, text: text });
      mf.text.value = '';
      persist();
      render();
      toast('记住了');
      return;
    }

    if (form.dataset.form === 'settings') {
      var sf = form.elements;
      state.ownerName = sf.ownerName.value.trim();
      try {
        AI.saveConfig({
          key: sf.apiKey.value,
          model: sf.model.value,
          baseUrl: sf.baseUrl.value
        });
      } catch (err) {
        toast(err.message);
      }
      persist();
      closeModal();
      render();
      toast('设置已保存');
    }
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-action]') : null;
      if (el) {
        e.preventDefault();
        handleAction(el);
        return;
      }
      if (e.target.classList && e.target.classList.contains('modal-backdrop')) closeModal();
    });

    document.addEventListener('submit', submitHandler);

    document.addEventListener('input', function (e) {
      var t = e.target;
      if (t.id === 'search-input') {
        ui.q = t.value;
        renderList();
        return;
      }
      if (t.id === 'pack-entries') {
        ui.pack.maxEntries = Math.max(1, Math.min(20, Number(t.value) || 1));
        t.style.setProperty('--pct', ((ui.pack.maxEntries - 1) / 19) * 100 + '%');
        refreshPack();
      }
    });

    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'mood-filter') { ui.mood = t.value; render(); return; }
      if (t.id === 'pack-quotes') { ui.pack.quotes = t.checked; refreshPack(); return; }
      if (t.id === 'pack-companion') { ui.pack.companionId = t.value; render(); return; }
      if (t.id === 'import-file') { handleFile(t.files && t.files[0]); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
      if (e.target && e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        persist();
        toast('已保存');
      }
    });
  }

  /* ============================== 启动 ============================== */

  function init() {
    els.app = byId('app');
    els.modal = byId('modal-root');
    els.toast = byId('toast');
    els.file = byId('import-file');

    load();
    ui.companionId = state.activeCompanionId || (state.companions[0] ? state.companions[0].id : 'all');

    // 支持 #memories / #pack 直接打开某个视图（方便分享和截图）
    var hash = (location.hash || '').replace(/^#/, '');
    if (hash === 'memories' || hash === 'pack' || hash === 'diary' || hash === 'chat') ui.view = hash;

    bind();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
