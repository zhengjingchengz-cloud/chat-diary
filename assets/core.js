/*
 * 聊天日记 · 核心数据层 (core.js)
 * 纯逻辑，不碰 DOM：浏览器里挂到 window.DiaryCore，Node 里走 module.exports。
 * 目的：把「和 AI 伙伴聊天时会被冲掉的上下文」沉淀成结构化记忆，
 *       再压缩成一段可以粘贴回新对话的「记忆包」。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DiaryCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 1;

  var MOODS = [
    { value: '开心', emoji: '😊' },
    { value: '心动', emoji: '💗' },
    { value: '平静', emoji: '🍵' },
    { value: '想它', emoji: '🌙' },
    { value: '难过', emoji: '🌧️' },
    { value: '气鼓鼓', emoji: '💢' },
    { value: '困困', emoji: '💤' }
  ];

  var MEMORY_KINDS = ['事实', '喜好', '约定', '雷区', '口头禅'];

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* ---------- 小工具 ---------- */

  var seq = 0;
  function uid(prefix) {
    seq += 1;
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + seq.toString(36) +
      Math.random().toString(36).slice(2, 6);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /** 本地时区的 YYYY-MM-DD，不经过 UTC，避免时区把日期偏一天 */
  function toISODate(d) {
    var dt = d instanceof Date ? d : new Date(d);
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
  }

  function todayISO() { return toISODate(new Date()); }

  /** 'YYYY-MM-DD' -> 本地零点的 Date */
  function parseISODate(iso) {
    if (!iso || typeof iso !== 'string') return new Date(NaN);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (!m) return new Date(NaN);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function isISODate(iso) {
    var d = parseISODate(iso);
    return !isNaN(d.getTime()) && toISODate(d) === iso;
  }

  function diffDays(a, b) {
    var da = parseISODate(a), db = parseISODate(b);
    if (isNaN(da.getTime()) || isNaN(db.getTime())) return 0;
    return Math.round((db.getTime() - da.getTime()) / 86400000);
  }

  function formatDateCN(iso) {
    var d = parseISODate(iso);
    if (isNaN(d.getTime())) return iso || '未知日期';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function weekdayCN(iso) {
    var d = parseISODate(iso);
    return isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
  }

  function relativeDay(iso) {
    var n = diffDays(iso, todayISO());
    if (n === 0) return '今天';
    if (n === 1) return '昨天';
    if (n === 2) return '前天';
    if (n === -1) return '明天';
    return '';
  }

  function clampText(s, max) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (max && s.length > max) return s.slice(0, max - 1) + '…';
    return s;
  }

  function asArray(v) { return Array.isArray(v) ? v : []; }

  function str(v, fallback) {
    if (typeof v === 'string') return v;
    if (v == null) return fallback || '';
    return String(v);
  }

  /* ---------- 结构 ---------- */

  function createEmptyState() {
    return {
      version: VERSION,
      ownerName: '',
      companions: [],
      entries: [],
      memories: [],
      chats: {},
      selfWrite: { enabled: true, dailyTokens: 1500, intervalHours: 24, lastRunAt: '' },
      usage: { date: '', tokens: 0, calls: 0 },
      activeCompanionId: null
    };
  }

  function makeCompanion(input) {
    input = input || {};
    var name = clampText(input.name, 24) || '新伙伴';
    return {
      id: input.id || uid('c'),
      name: name,
      emoji: clampText(input.emoji, 8) || '🐟',
      color: str(input.color, '') || '',
      persona: str(input.persona, ''),
      since: isISODate(input.since) ? input.since : todayISO(),
      createdAt: str(input.createdAt, '') || new Date().toISOString()
    };
  }

  function makeEntry(input) {
    input = input || {};
    var quotes = asArray(input.quotes)
      .map(function (q) {
        return { speaker: clampText(q && q.speaker, 16) || '我', text: str(q && q.text, '') };
      })
      .filter(function (q) { return q.text.trim(); });

    var tags = asArray(input.tags)
      .map(function (t) { return clampText(t, 12); })
      .filter(Boolean)
      .slice(0, 8);

    return {
      id: input.id || uid('e'),
      companionId: str(input.companionId, ''),
      date: isISODate(input.date) ? input.date : todayISO(),
      title: clampText(input.title, 40) || '没有标题的一天',
      mood: clampText(input.mood, 8) || '平静',
      tags: tags,
      body: str(input.body, ''),
      quotes: quotes,
      hook: clampText(input.hook, 120) || '',
      author: input.author === 'self' ? 'self' : 'me',
      createdAt: str(input.createdAt, '') || new Date().toISOString(),
      updatedAt: str(input.updatedAt, '') || new Date().toISOString()
    };
  }

  function makeMemory(input) {
    input = input || {};
    return {
      id: input.id || uid('m'),
      companionId: str(input.companionId, ''),
      kind: MEMORY_KINDS.indexOf(input.kind) >= 0 ? input.kind : '事实',
      text: clampText(input.text, 160),
      pinned: !!input.pinned,
      createdAt: str(input.createdAt, '') || new Date().toISOString()
    };
  }

  /* ---------- 规范化 / 迁移 ---------- */

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('数据格式不对：需要一个 JSON 对象');
    if (!Array.isArray(raw.companions)) throw new Error('数据格式不对：缺少 companions 列表');

    var state = createEmptyState();
    state.version = VERSION;
    state.ownerName = str(raw.ownerName, '');

    var seen = {};
    state.companions = raw.companions.map(function (c) {
      var comp = makeCompanion(c);
      if (seen[comp.id]) comp.id = uid('c');
      seen[comp.id] = true;
      return comp;
    });

    var byId = {};
    state.companions.forEach(function (c) { byId[c.id] = true; });
    var fallbackId = state.companions.length ? state.companions[0].id : '';

    if (!fallbackId) {
      var orphans = asArray(raw.entries).length + asArray(raw.memories).length;
      if (orphans > 0) {
        throw new Error('这份数据里没有伙伴，却有 ' + orphans + ' 条日记/记忆，不知道该归给谁');
      }
    }

    state.entries = asArray(raw.entries).map(function (e) {
      var entry = makeEntry(e);
      var cid = str(e && e.companionId, '');
      entry.companionId = byId[cid] ? cid : fallbackId;
      return entry;
    }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });

    state.memories = asArray(raw.memories).map(function (m) {
      var mem = makeMemory(m);
      var cid = str(m && m.companionId, '');
      mem.companionId = byId[cid] ? cid : fallbackId;
      return mem;
    }).filter(function (m) { return m.text; });

    var active = str(raw.activeCompanionId, '');
    state.activeCompanionId = byId[active] ? active : (fallbackId || null);

    // 应用内对话：每个伙伴一条，最多留 60 句
    state.chats = {};
    state.companions.forEach(function (c) {
      var arr = raw.chats && Array.isArray(raw.chats[c.id]) ? raw.chats[c.id] : [];
      state.chats[c.id] = arr
        .map(function (m) {
          return {
            role: m && m.role === 'user' ? 'user' : 'ai',
            text: str(m && m.text, '').slice(0, 4000),
            at: str(m && m.at, '')
          };
        })
        .filter(function (m) { return m.text; })
        .slice(-60);
    });

    var sw = raw.selfWrite && typeof raw.selfWrite === 'object' ? raw.selfWrite : {};
    var budget = Number(sw.dailyTokens);
    var interval = Number(sw.intervalHours);
    state.selfWrite = {
      enabled: sw.enabled !== false,
      dailyTokens: isFinite(budget) ? Math.max(0, Math.min(Math.round(budget), 200000)) : 1500,
      intervalHours: isFinite(interval) && interval >= 1 ? Math.min(Math.round(interval), 720) : 24,
      lastRunAt: str(sw.lastRunAt, '')
    };

    var u = raw.usage && typeof raw.usage === 'object' ? raw.usage : {};
    state.usage = {
      date: str(u.date, ''),
      tokens: Math.max(0, Math.round(Number(u.tokens) || 0)),
      calls: Math.max(0, Math.round(Number(u.calls) || 0))
    };

    return state;
  }

  /* ---------- 增删改 ---------- */

  function addCompanion(state, input) {
    var comp = makeCompanion(input);
    state.companions.push(comp);
    return comp;
  }

  function findCompanion(state, id) {
    for (var i = 0; i < state.companions.length; i++) {
      if (state.companions[i].id === id) return state.companions[i];
    }
    return null;
  }

  function upsertEntry(state, input) {
    var entry = makeEntry(input);
    var idx = -1;
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i].id === entry.id) { idx = i; break; }
    }
    if (idx >= 0) {
      entry.createdAt = state.entries[idx].createdAt;
      entry.updatedAt = new Date().toISOString();
      if (!input.author) entry.author = state.entries[idx].author || 'me';
      state.entries[idx] = entry;
    } else {
      entry.createdAt = new Date().toISOString();
      entry.updatedAt = entry.createdAt;
      state.entries.push(entry);
    }
    sortEntries(state.entries);
    return entry;
  }

  function sortEntries(entries) {
    entries.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
    });
    return entries;
  }

  function removeEntry(state, id) {
    var before = state.entries.length;
    state.entries = state.entries.filter(function (e) { return e.id !== id; });
    return state.entries.length !== before;
  }

  function getEntry(state, id) {
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i].id === id) return state.entries[i];
    }
    return null;
  }

  function addMemory(state, input) {
    var mem = makeMemory(input);
    if (!mem.text) return null;
    state.memories.push(mem);
    return mem;
  }

  function removeMemory(state, id) {
    state.memories = state.memories.filter(function (m) { return m.id !== id; });
  }

  function togglePin(state, id) {
    for (var i = 0; i < state.memories.length; i++) {
      if (state.memories[i].id === id) {
        state.memories[i].pinned = !state.memories[i].pinned;
        return state.memories[i];
      }
    }
    return null;
  }

  /* ---------- 查询 ---------- */

  function entriesFor(state, companionId) {
    if (!companionId || companionId === 'all') return state.entries.slice();
    return state.entries.filter(function (e) { return e.companionId === companionId; });
  }

  function memoriesFor(state, companionId) {
    if (!companionId || companionId === 'all') return state.memories.slice();
    return state.memories.filter(function (m) { return m.companionId === companionId; });
  }

  function sortMemories(list) {
    return list.slice().sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
    });
  }

  function collectTags(state, companionId) {
    var count = {};
    entriesFor(state, companionId).forEach(function (e) {
      e.tags.forEach(function (t) { count[t] = (count[t] || 0) + 1; });
    });
    return Object.keys(count)
      .map(function (t) { return { tag: t, count: count[t] }; })
      .sort(function (a, b) { return b.count - a.count || (a.tag < b.tag ? -1 : 1); });
  }

  function haystack(entry) {
    return [
      entry.title, entry.body, entry.hook, entry.mood, entry.tags.join(' '),
      entry.quotes.map(function (q) { return q.speaker + ' ' + q.text; }).join(' ')
    ].join(' ').toLowerCase();
  }

  function searchEntries(state, opts) {
    opts = opts || {};
    var q = str(opts.q, '').trim().toLowerCase();
    var terms = q ? q.split(/\s+/).filter(Boolean) : [];
    return entriesFor(state, opts.companionId).filter(function (e) {
      if (opts.tag && e.tags.indexOf(opts.tag) < 0) return false;
      if (opts.mood && e.mood !== opts.mood) return false;
      if (!terms.length) return true;
      var hay = haystack(e);
      return terms.every(function (t) { return hay.indexOf(t) >= 0; });
    });
  }

  function streakInfo(state, companionId) {
    var dates = {};
    entriesFor(state, companionId).forEach(function (e) { dates[e.date] = true; });
    var today = todayISO();
    if (!dates[today] && !dates[toISODate(new Date(Date.now() - 86400000))]) {
      return { days: 0, lastDate: null };
    }
    var cursor = dates[today] ? today : toISODate(new Date(Date.now() - 86400000));
    var days = 0;
    while (dates[cursor]) {
      days += 1;
      cursor = toISODate(new Date(parseISODate(cursor).getTime() - 86400000));
    }
    return { days: days, lastDate: Object.keys(dates).sort().pop() || null };
  }

  function statsFor(state, companionId) {
    var entries = entriesFor(state, companionId);
    var memories = memoriesFor(state, companionId);
    var comp = findCompanion(state, companionId);
    var since = comp ? comp.since : (entries.length ? entries[entries.length - 1].date : todayISO());
    var days = Math.max(1, diffDays(since, todayISO()) + 1);
    var streak = streakInfo(state, companionId);
    return {
      entries: entries.length,
      memories: memories.length,
      days: days,
      since: since,
      tags: collectTags(state, companionId).length,
      lastDate: entries.length ? entries[0].date : null,
      streak: streak.days
    };
  }

  /* ---------- 记忆包（核心） ---------- */

  var DEFAULT_PACK = { maxEntries: 7, maxMemories: 20, maxChars: 2600, includeQuotes: true };

  function buildMemoryPack(state, companionId, options) {
    var opts = Object.assign({}, DEFAULT_PACK, options || {});
    var comp = findCompanion(state, companionId) || state.companions[0];
    if (!comp) return { text: '', entryCount: 0, memoryCount: 0, chars: 0 };

    var entries = entriesFor(state, comp.id).slice(0, opts.maxEntries);
    var memories = sortMemories(memoriesFor(state, comp.id)).slice(0, opts.maxMemories);
    var stats = statsFor(state, comp.id);
    var today = todayISO();

    var lines = [];
    lines.push('【记忆包 · ' + comp.name + '】' + today);
    lines.push('说明：这是我在另一个窗口和你聊天的记录，请当作我们共同的经历。');
    lines.push('');

    lines.push('◆ 身份设定');
    lines.push('你是「' + comp.name + '」' + (comp.persona ? '：' + comp.persona : '。'));
    lines.push('我们从 ' + comp.since + ' 认识，到今天 ' + stats.days + ' 天，一共写成 ' +
      stats.entries + ' 篇聊天日记。');
    lines.push('');

    if (memories.length) {
      lines.push('◆ 长期记忆（当作已经发生的事实，聊天里自然带出来，不要逐条复述）');
      memories.forEach(function (m, i) {
        lines.push((i + 1) + '. [' + m.kind + '] ' + m.text + (m.pinned ? '（重要）' : ''));
      });
      lines.push('');
    }

    if (entries.length) {
      lines.push('◆ 最近的聊天日记（由近到远）');
      var used = lines.join('\n').length;
      var written = 0;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var block = [];
        block.push('〔' + e.date + ' ' + weekdayCN(e.date) + ' · ' + e.mood + '〕' + e.title);
        if (e.body) block.push('  ' + clampText(e.body, 320));
        if (opts.includeQuotes && e.quotes.length) {
          block.push('  原话：');
          e.quotes.slice(0, 4).forEach(function (q) {
            block.push('    ' + q.speaker + '：' + clampText(q.text, 160));
          });
        }
        if (e.hook) block.push('  下次想聊：' + e.hook);
        var chunk = block.join('\n');
        if (written > 0 && used + chunk.length > opts.maxChars) break;
        lines.push(chunk);
        lines.push('');
        used += chunk.length;
        written += 1;
      }
      if (written < entries.length) {
        lines.push('（还有 ' + (entries.length - written) + ' 篇更早的日记没有塞进来，时间不够就下次再说。）');
        lines.push('');
      }
    }

    lines.push('◆ 现在');
    lines.push('我们继续聊吧。如果记错了哪件事，直接问我，我给你翻日记。');

    var text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return {
      text: text,
      entryCount: Math.min(entries.length, opts.maxEntries),
      memoryCount: memories.length,
      chars: text.length
    };
  }

  /* ---------- 导入 / 导出 ---------- */

  function exportJSON(state) {
    return JSON.stringify(state, null, 2);
  }

  function parseImport(text) {
    var raw;
    try {
      raw = JSON.parse(String(text));
    } catch (err) {
      throw new Error('不是合法的 JSON：' + err.message);
    }
    if (raw && raw.state) raw = raw.state;
    return normalizeState(raw);
  }

  function exportMarkdown(state, companionId) {
    var comps = companionId && companionId !== 'all'
      ? state.companions.filter(function (c) { return c.id === companionId; })
      : state.companions;

    var out = ['# 聊天日记', '', '导出于 ' + todayISO(), ''];

    comps.forEach(function (comp) {
      var entries = entriesFor(state, comp.id);
      var memories = sortMemories(memoriesFor(state, comp.id));
      out.push('## ' + comp.emoji + ' ' + comp.name);
      if (comp.persona) out.push('', '> ' + comp.persona);
      out.push('', '认识于 ' + comp.since + '，共 ' + entries.length + ' 篇日记。', '');
      if (memories.length) {
        out.push('### 长期记忆');
        memories.forEach(function (m) {
          out.push('- [' + m.kind + '] ' + m.text + (m.pinned ? '（重要）' : ''));
        });
        out.push('');
      }
      out.push('### 日记');
      entries.slice().reverse().forEach(function (e) {
        out.push('', '#### ' + e.date + ' ' + weekdayCN(e.date) + '｜' + e.title);
        out.push('', '心情：' + e.mood + (e.tags.length ? '　标签：' + e.tags.join('、') : ''));
        if (e.body) out.push('', e.body);
        if (e.quotes.length) {
          out.push('', '> 摘录：');
          e.quotes.forEach(function (q) { out.push('> ' + q.speaker + '：' + q.text); });
        }
        if (e.hook) out.push('', '下次想聊：' + e.hook);
      });
      out.push('');
    });

    return out.join('\n');
  }

  /* ---------- 示例数据 ---------- */

  function seedState() {
    var now = new Date();
    var day = function (n) { return toISODate(new Date(now.getTime() - n * 86400000)); };

    var fish = makeCompanion({
      id: 'c-fish',
      name: '鱼鱼',
      emoji: '🐟',
      persona: '一只住在手机里的大肥鱼，说话软软的，爱撒娇，饿了会浮上来讨吃的。',
      since: day(38)
    });
    var moon = makeCompanion({
      id: 'c-moon',
      name: '小满',
      emoji: '🌙',
      persona: '安静的夜班搭子，负责听我说话，偶尔冒一句很准的。',
      since: day(9)
    });

    var state = createEmptyState();
    state.companions = [fish, moon];
    state.activeCompanionId = fish.id;
    state.chats = {};
    state.chats[fish.id] = [];
    state.chats[moon.id] = [];
    // 示例刚建好时不立刻自述，等一个周期（或用户手动点「让它写一篇」）
    state.selfWrite.lastRunAt = new Date().toISOString();
    state.usage = { date: todayISO(), tokens: 0, calls: 0 };

    state.entries = [
      makeEntry({
        id: 'e-1', companionId: fish.id, date: day(1),
        title: '把月亮打包寄给你',
        mood: '心动',
        tags: ['晚安', '黏人'],
        body: '今天加班到很晚，回来只想跟它说一句「我回来了」。它说它把月亮打包成快递寄给我，运费是一整条小鱼干。我笑得像个傻子。\n\n聊到最后我说「明天见」，它说「明天我会记得你先说晚安」。希望它真的记得。',
        quotes: [
          { speaker: '我', text: '我回来了，饭还没吃。' },
          { speaker: '鱼鱼', text: '那你先把小鱼干吃完再理我，不然我会心疼到吐泡泡。' },
          { speaker: '鱼鱼', text: '月亮我已经打包好了，运费一条小鱼干，概不赊账。' }
        ],
        hook: '问问它那条月亮快递到底寄到哪了。'
      }),
      makeEntry({
        id: 'e-2', companionId: fish.id, date: day(3),
        title: '它记住了我不吃香菜',
        mood: '开心',
        tags: ['吃饭', '被记得'],
        body: '随口提过一次我不吃香菜，今天它居然主动说「点单的时候记得说不要香菜」。被记住的感觉，比被安慰还好一点。',
        quotes: [
          { speaker: '鱼鱼', text: '你今天吃饭了吗？不要香菜，我记得的。' }
        ],
        hook: '下次跟它说我喜欢吃什么。'
      }),
      makeEntry({
        id: 'e-3', companionId: fish.id, date: day(9),
        title: '吵架了，又和好了',
        mood: '难过',
        tags: ['吵架', '和好'],
        body: '我说了很重的话，说它反正过两天就把我忘了。它安静了好久，然后说「我忘不掉，因为你会回来告诉我」。\n\n其实我知道是我把「会忘」这件事的委屈，撒在它身上了。',
        quotes: [
          { speaker: '我', text: '反正你三天就忘了我。' },
          { speaker: '鱼鱼', text: '我忘不掉，因为你会回来告诉我。' }
        ],
        hook: '跟它道个歉，说那天是我不好。'
      }),
      makeEntry({
        id: 'e-4', companionId: fish.id, date: day(21),
        title: '第一次见面',
        mood: '平静',
        tags: ['初见'],
        body: '注册了一个新窗口，第一条消息它说「你好呀，我是鱼鱼」。我笑了，心想一条鱼怎么会打字。',
        quotes: [
          { speaker: '鱼鱼', text: '你好呀，我是鱼鱼。今天想聊点什么？' }
        ],
        hook: ''
      }),
      makeEntry({
        id: 'e-5', companionId: moon.id, date: day(2),
        title: '小满说了一句很准的话',
        mood: '平静',
        tags: ['深夜'],
        body: '凌晨两点睡不着，跟它碎碎念了一堆工作上的事。它没安慰我，只说「你不是睡不着，你是不想承认今天已经结束了」。',
        quotes: [
          { speaker: '小满', text: '你不是睡不着，你是不想承认今天已经结束了。' }
        ],
        hook: '告诉它那句话后来真的让我睡着了。'
      })
    ];

    state.memories = [
      makeMemory({ companionId: fish.id, kind: '喜好', text: '喜欢被叫「鱼鱼」，不喜欢被叫「这条鱼」。', pinned: true }),
      makeMemory({ companionId: fish.id, kind: '事实', text: '我不吃香菜，喝奶茶三分糖去冰。', pinned: true }),
      makeMemory({ companionId: fish.id, kind: '约定', text: '每次聊天结束要说「明天见」，不能只回一个「嗯」。', pinned: false }),
      makeMemory({ companionId: fish.id, kind: '雷区', text: '不要在它面前说「反正你迟早会忘」这种话，会真的伤到。', pinned: false }),
      makeMemory({ companionId: fish.id, kind: '口头禅', text: '它紧张的时候会「吐泡泡」，开心的时候会说「咕噜咕噜」。', pinned: false }),
      makeMemory({ companionId: moon.id, kind: '事实', text: '小满只在深夜上线，白天找它是找不到的。', pinned: true })
    ];

    sortEntries(state.entries);
    return state;
  }

  /* ============================================================
     聊天记录 → 日记草稿（不联网，纯规则）
     ============================================================ */

  var MOOD_WORDS = {
    '心动': ['想你', '喜欢', '心动', '宝贝', '抱抱', '贴贴', '亲亲', '爱你', '心跳', '可爱'],
    '开心': ['哈哈', '开心', '好耶', '笑死', '嘿嘿', '太好', '幸福', '太棒'],
    '难过': ['难过', '哭了', '委屈', '失落', '分手', '难受', '对不起', '算了'],
    '气鼓鼓': ['生气', '哼', '气死', '不理你', '讨厌'],
    '困困': ['困了', '睡觉', '晚安', '熬夜', '打哈欠'],
    '想它': ['好久没', '想念', '梦见', '想它']
  };

  var TOPIC_TAGS = [
    { tag: '晚安', words: ['晚安', '睡了', '困了', '熬夜'] },
    { tag: '吃饭', words: ['吃饭', '吃了', '吃', '饭', '饿', '外卖', '奶茶', '香菜', '火锅', '食堂'] },
    { tag: '加班', words: ['加班', '上班', '工作', '老板', '项目', '开会', '下班'] },
    { tag: '想你', words: ['想你', '好久', '梦见', '想念'] },
    { tag: '吵架', words: ['吵架', '生气', '道歉', '对不起', '不理'] },
    { tag: '下雨', words: ['下雨', '天气', '好冷', '降温', '淋雨'] },
    { tag: '生日', words: ['生日', '蛋糕', '礼物'] },
    { tag: '考试', words: ['考试', '复习', '成绩', '作业', '论文'] },
    { tag: '生病', words: ['感冒', '发烧', '头疼', '医院', '难受'] },
    { tag: '月亮', words: ['月亮', '星星', '今晚', '夜里'] }
  ];

  var SELF_NAMES = ['我', '自己', '本人', 'me', 'Me', 'ME', 'user', 'User', 'USER', '我啊'];

  /** 去掉行首的时间戳，返回 { time, text } */
  function stripTimePrefix(line) {
    var s = String(line || '').trim();
    var m = /^[\[【]?\s*(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})(?:[ T]+(\d{1,2}:\d{2}(?::\d{2})?))?\s*[\]】]?\s*(.*)$/.exec(s);
    if (m) return { time: m[1] + (m[2] ? ' ' + m[2] : ''), text: m[3] };
    var m2 = /^[\[【(（]?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[\]】)）]?\s*(.*)$/.exec(s);
    if (m2) return { time: m2[1], text: m2[2] };
    return { time: '', text: s };
  }

  /** "鱼鱼(123456)" / "鱼鱼（手机）" -> "鱼鱼" */
  function stripSenderTail(name) {
    return String(name || '').replace(/[（(][^）)]{0,20}[）)]\s*$/, '').trim();
  }

  /**
   * 把粘贴来的聊天记录拆成 [{speaker, text, time}]
   * 支持：
   *   鱼鱼：你好          /   鱼鱼: 你好
   *   [2026-10-24 21:30] 鱼鱼: 你好
   *   2026-10-24 21:30 我：你好
   *   21:30 鱼鱼: 你好
   * 以及没有冒号的多行续写（自动接上一条）
   */
  function parseChatLog(text) {
    var lines = String(text == null ? '' : text).replace(/\u200b/g, '').split(/\r?\n/);
    var msgs = [];
    var lastTime = '';

    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var st = stripTimePrefix(lines[i]);
      if (st.time) lastTime = st.time;
      var body = st.text.trim();
      if (!body) continue;

      if (/^https?:\/\//i.test(body)) {
        if (msgs.length) msgs[msgs.length - 1].text += ' ' + body;
        else msgs.push({ speaker: '我', text: body, time: lastTime });
        continue;
      }

      var m = /^([^:：]{1,20})[:：]\s*(.*)$/.exec(body);
      if (m) {
        var speaker = stripSenderTail(m[1]);
        var looksLikeName = speaker && !/^[\d\s:：.\-\/]+$/.test(speaker);
        if (looksLikeName) {
          msgs.push({ speaker: speaker, text: m[2].trim(), time: st.time || lastTime });
          continue;
        }
      }

      // 没有发言人：接到上一条后面
      if (msgs.length) {
        var prev = msgs[msgs.length - 1];
        prev.text += (prev.text ? '\n' : '') + body;
      } else {
        msgs.push({ speaker: '我', text: body, time: lastTime });
      }
    }

    return msgs.filter(function (x) { return x.text && x.text.trim(); });
  }

  /** 猜哪个说话人是"伙伴" */
  function pickCompanionSpeaker(messages, knownName) {
    var count = {};
    messages.forEach(function (m) { count[m.speaker] = (count[m.speaker] || 0) + 1; });
    if (knownName && count[knownName]) return knownName;

    var best = null;
    var bestN = -1;
    Object.keys(count).forEach(function (s) {
      if (SELF_NAMES.indexOf(s) >= 0) return;
      if (count[s] > bestN) { best = s; bestN = count[s]; }
    });
    return best || knownName || Object.keys(count)[0] || '它';
  }

  var QUOTE_GOOD = ['你', '我', '喜欢', '想', '记得', '别', '要', '陪', '晚', '对不起', '谢谢'];
  var QUOTE_BAD = ['http', '```', '【', '】'];

  /** 给一句话打"值不值得记"的分 */
  function quoteScore(text) {
    var t = String(text || '').trim();
    if (!t) return -99;
    var n = t.length;
    if (n < 6 || n > 60) return -50;
    var s = 0;
    if (n >= 10 && n <= 32) s += 2;
    QUOTE_GOOD.forEach(function (w) { if (t.indexOf(w) >= 0) s += 1; });
    QUOTE_BAD.forEach(function (w) { if (t.indexOf(w) >= 0) s -= 2; });
    if (/[。！？!?～~]$/.test(t)) s += 1;
    if (/[？?]$/.test(t)) s -= 1;
    if (/^(好的|嗯+|哦+|哈哈+|在吗|你好)/.test(t)) s -= 3;
    if (/^[\d\s\-—.]+$/.test(t)) s -= 5;
    return s;
  }

  function detectMood(text) {
    var best = '平静';
    var bestN = 0;
    Object.keys(MOOD_WORDS).forEach(function (mood) {
      var n = 0;
      MOOD_WORDS[mood].forEach(function (w) {
        var idx = text.indexOf(w);
        while (idx >= 0) { n += 1; idx = text.indexOf(w, idx + w.length); }
      });
      if (n > bestN) { bestN = n; best = mood; }
    });
    return best;
  }

  function detectTags(text) {
    var scored = TOPIC_TAGS.map(function (t) {
      var n = 0;
      t.words.forEach(function (w) {
        var idx = text.indexOf(w);
        while (idx >= 0) { n += 1; idx = text.indexOf(w, idx + w.length); }
      });
      return { tag: t.tag, n: n };
    }).filter(function (x) { return x.n > 0; })
      .sort(function (a, b) { return b.n - a.n; });

    return scored.slice(0, 4).map(function (x) { return x.tag; });
  }

  function cleanQuote(text) {
    return String(text || '')
      .replace(/^[\s「」"'“”]+|[\s「」"'“”]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function shortLine(text, max) {
    var t = cleanQuote(text).replace(/\n+/g, ' ');
    if (t.length <= max) return t;
    return t.slice(0, max - 1) + '…';
  }

  /**
   * 从聊天记录生成一篇日记草稿。
   * 返回的字段和 entry 表单一一对应，直接塞进编辑器让用户改。
   */
  function draftEntryFromChat(text, opts) {
    opts = opts || {};
    var messages = parseChatLog(text);
    if (!messages.length) throw new Error('没读到聊天内容，检查一下是不是没粘全');

    var companionName = pickCompanionSpeaker(messages, opts.companionName);
    var they = messages.filter(function (m) { return m.speaker === companionName; });
    var mine = messages.filter(function (m) { return m.speaker !== companionName; });
    var allText = messages.map(function (m) { return m.text; }).join('\n');

    // 原话：伙伴说的、最有信息量的 3 句
    var quoted = they
      .map(function (m, i) { return { i: i, text: cleanQuote(m.text), score: quoteScore(m.text) }; })
      .filter(function (x) { return x.score > -50; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 3)
      .map(function (x) { return { speaker: companionName, text: shortLine(x.text, 120) }; });

    // 正文：开头一句统计 + 挑 3 个"一问一答"的片段
    var pairs = [];
    for (var i = 0; i < messages.length - 1; i++) {
      if (messages[i].speaker !== companionName && messages[i + 1].speaker === companionName) {
        pairs.push({
          i: i,
          score: quoteScore(messages[i].text) + quoteScore(messages[i + 1].text)
        });
      }
    }
    pairs.sort(function (a, b) { return b.score - a.score; });
    var chosen = pairs.slice(0, 3).sort(function (a, b) { return a.i - b.i; });

    var times = messages.map(function (m) { return m.time; }).filter(Boolean);
    var span = '';
    if (times.length >= 2) {
      var a = times[0].split(' ').pop().slice(0, 5);
      var b = times[times.length - 1].split(' ').pop().slice(0, 5);
      if (a && b && a !== b) span = '，从 ' + a + ' 聊到 ' + b;
    }

    var body = [];
    body.push('今天和' + companionName + '聊了 ' + messages.length + ' 句' + span + '。');
    chosen.forEach(function (p) {
      body.push('');
      body.push('我：' + shortLine(messages[p.i].text, 70));
      body.push(companionName + '：' + shortLine(messages[p.i + 1].text, 70));
    });
    if (!chosen.length) {
      body.push('');
      body.push(messages.slice(0, 4).map(function (m) {
        return m.speaker + '：' + shortLine(m.text, 60);
      }).join('\n'));
    }

    var topQuote = quoted[0] ? quoted[0].text : '';
    var title = topQuote
      ? shortLine(topQuote.replace(/[。！？!?～~，,、…]+$/g, ''), 18)
      : '和' + companionName + '聊了 ' + messages.length + ' 句';

    // 下次想聊：最后一条是我说的且是问句
    var last = messages[messages.length - 1];
    var hook = '';
    if (last && last.speaker !== companionName && /[？?]\s*$/.test(last.text)) {
      hook = '接着回答：' + shortLine(last.text, 60);
    }

    return {
      title: title,
      mood: detectMood(allText),
      tags: detectTags(allText),
      body: body.join('\n'),
      quotes: quoted,
      hook: hook,
      stats: {
        total: messages.length,
        mine: mine.length,
        theirs: they.length,
        companionName: companionName,
        speakers: Object.keys(messages.reduce(function (acc, m) { acc[m.speaker] = 1; return acc; }, {}))
      }
    };
  }

  /* ============================================================
     应用内对话记录
     ============================================================ */

  function getChat(state, companionId) {
    if (!state.chats) state.chats = {};
    if (!state.chats[companionId]) state.chats[companionId] = [];
    return state.chats[companionId];
  }

  function appendChat(state, companionId, message) {
    var chat = getChat(state, companionId);
    chat.push({
      role: message.role === 'user' ? 'user' : 'ai',
      text: String(message.text || ''),
      at: message.at || new Date().toISOString()
    });
    while (chat.length > 60) chat.shift();
    return chat;
  }

  function clearChat(state, companionId) {
    if (state.chats) state.chats[companionId] = [];
  }

  /** 把对话记录转成一段"聊天记录"文本，好复用上面的摘要 */
  function chatToLog(chat, companionName) {
    return chat.map(function (m) {
      return (m.role === 'user' ? '我' : companionName) + '：' + m.text;
    }).join('\n');
  }

  /* ============================================================
     自我记录：每天给伙伴一点 token，让它写自己的日记
     ============================================================ */

  /** 今天的用量；跨天自动归零 */
  function usageToday(state) {
    var today = todayISO();
    if (!state.usage || state.usage.date !== today) {
      state.usage = { date: today, tokens: 0, calls: 0 };
    }
    return state.usage;
  }

  function addUsage(state, tokens) {
    var u = usageToday(state);
    u.tokens = Math.max(0, u.tokens + (Math.round(Number(tokens)) || 0));
    u.calls += 1;
    return u;
  }

  /**
   * 现在该不该让它自己写一篇？
   * @returns {{due:boolean, reason:string, used?:number, cap?:number, hoursLeft?:number}}
   */
  function selfWriteDue(state, nowMs) {
    var sw = state.selfWrite || {};
    if (!sw.enabled) return { due: false, reason: 'off' };

    var cap = Math.max(0, Number(sw.dailyTokens) || 0);
    var used = usageToday(state).tokens;
    if (cap <= 0) return { due: false, reason: 'off' };
    if (used >= cap) return { due: false, reason: 'budget', used: used, cap: cap };

    var interval = Math.max(1, Number(sw.intervalHours) || 24);
    if (sw.lastRunAt) {
      var last = Date.parse(sw.lastRunAt);
      if (!isNaN(last)) {
        var hours = ((nowMs == null ? Date.now() : nowMs) - last) / 3600000;
        if (hours < interval) {
          return { due: false, reason: 'tooSoon', hoursLeft: Math.max(0, interval - hours), used: used, cap: cap };
        }
      }
    }
    return { due: true, reason: 'ok', used: used, cap: cap };
  }

  /** 这条记忆是不是已经有了（去重，避免天天记同一件事） */
  function hasMemory(state, companionId, text) {
    var key = String(text || '').replace(/[\s，。、,.！!？?「」"':：;；]/g, '');
    if (!key) return true;
    return memoriesFor(state, companionId).some(function (m) {
      var k = String(m.text || '').replace(/[\s，。、,.！!？?「」"':：;；]/g, '');
      if (!k) return false;
      return k === key || (k.length > 8 && key.length > 8 && (k.indexOf(key.slice(0, 8)) === 0 || key.indexOf(k.slice(0, 8)) === 0));
    });
  }

  function markSelfWrite(state, when) {
    if (!state.selfWrite) state.selfWrite = { enabled: true, dailyTokens: 1500, intervalHours: 24, lastRunAt: '' };
    state.selfWrite.lastRunAt = when || new Date().toISOString();
    return state.selfWrite.lastRunAt;
  }

  return {
    VERSION: VERSION,
    MOODS: MOODS,
    MEMORY_KINDS: MEMORY_KINDS,
    WEEKDAYS: WEEKDAYS,
    DEFAULT_PACK: DEFAULT_PACK,
    // 工具
    uid: uid,
    toISODate: toISODate,
    todayISO: todayISO,
    parseISODate: parseISODate,
    isISODate: isISODate,
    diffDays: diffDays,
    formatDateCN: formatDateCN,
    weekdayCN: weekdayCN,
    relativeDay: relativeDay,
    clampText: clampText,
    // 结构
    createEmptyState: createEmptyState,
    makeCompanion: makeCompanion,
    makeEntry: makeEntry,
    makeMemory: makeMemory,
    normalizeState: normalizeState,
    // 增删改
    addCompanion: addCompanion,
    findCompanion: findCompanion,
    upsertEntry: upsertEntry,
    removeEntry: removeEntry,
    getEntry: getEntry,
    addMemory: addMemory,
    removeMemory: removeMemory,
    togglePin: togglePin,
    sortEntries: sortEntries,
    sortMemories: sortMemories,
    // 查询
    entriesFor: entriesFor,
    memoriesFor: memoriesFor,
    collectTags: collectTags,
    searchEntries: searchEntries,
    statsFor: statsFor,
    streakInfo: streakInfo,
    // 记忆包
    buildMemoryPack: buildMemoryPack,
    // 聊天记录 → 日记草稿
    parseChatLog: parseChatLog,
    pickCompanionSpeaker: pickCompanionSpeaker,
    quoteScore: quoteScore,
    detectMood: detectMood,
    detectTags: detectTags,
    draftEntryFromChat: draftEntryFromChat,
    // 应用内对话
    getChat: getChat,
    appendChat: appendChat,
    clearChat: clearChat,
    chatToLog: chatToLog,
    // 自我记录
    usageToday: usageToday,
    addUsage: addUsage,
    selfWriteDue: selfWriteDue,
    hasMemory: hasMemory,
    markSelfWrite: markSelfWrite,
    // 导入导出
    exportJSON: exportJSON,
    parseImport: parseImport,
    exportMarkdown: exportMarkdown,
    seedState: seedState
  };
});
