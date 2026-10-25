/*
 * 聊天日记 · AI 层 (ai.js)
 * 浏览器直连 DeepSeek 官方接口（已确认支持 CORS）。
 * Key 只保存在这台设备的 localStorage 里，不上传任何第三方服务器。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DiaryAI = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LS = 'chatdiary.ai.v1';

  var DEFAULTS = {
    key: '',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com'
  };

  function loadConfig() {
    try {
      var raw = localStorage.getItem(LS);
      var cfg = raw ? JSON.parse(raw) : {};
      return {
        key: typeof cfg.key === 'string' ? cfg.key : DEFAULTS.key,
        model: typeof cfg.model === 'string' && cfg.model ? cfg.model : DEFAULTS.model,
        baseUrl: typeof cfg.baseUrl === 'string' && cfg.baseUrl ? cfg.baseUrl : DEFAULTS.baseUrl
      };
    } catch (err) {
      return { key: '', model: DEFAULTS.model, baseUrl: DEFAULTS.baseUrl };
    }
  }

  function saveConfig(cfg) {
    var next = {
      key: String(cfg.key || '').trim(),
      model: String(cfg.model || DEFAULTS.model).trim() || DEFAULTS.model,
      baseUrl: String(cfg.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, '') || DEFAULTS.baseUrl
    };
    try {
      localStorage.setItem(LS, JSON.stringify(next));
    } catch (err) {
      throw new Error('保存不了 API Key（浏览器禁用了本地存储）');
    }
    return next;
  }

  function isReady() {
    return !!loadConfig().key;
  }

  function friendlyError(status, detail) {
    var hint = '';
    if (status === 401) hint = 'API Key 无效或已失效，去 platform.deepseek.com 重新复制一个';
    else if (status === 402) hint = '账户余额不足，去 DeepSeek 控制台充点钱';
    else if (status === 429) hint = '请求太频繁了，等几秒再试';
    else if (status === 400) hint = '请求被拒绝' + (detail ? '：' + detail : '');
    else if (status === 404) hint = '接口地址不对，检查「接口地址」有没有填错';
    else if (status >= 500) hint = 'DeepSeek 服务器开小差了，稍后再试';
    else hint = '请求失败（HTTP ' + status + '）' + (detail ? '：' + detail : '');
    return hint;
  }

  function request(messages, opts) {
    opts = opts || {};
    var cfg = loadConfig();
    if (!cfg.key) return Promise.reject(new Error('还没填 API Key'));

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, opts.timeout || 90000) : null;

    var payload = {
      model: cfg.model,
      messages: messages,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.7,
      max_tokens: opts.maxTokens || 900,
      stream: false
    };
    if (opts.json) payload.response_format = { type: 'json_object' };

    return fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (body) {
          var detail = '';
          try {
            var j = JSON.parse(body);
            detail = (j.error && (j.error.message || j.error.type)) || '';
          } catch (e) { detail = String(body || '').slice(0, 160); }
          throw new Error(friendlyError(res.status, detail));
        });
      }
      return res.json();
    }).then(function (data) {
      var choice = data && data.choices && data.choices[0];
      var text = choice && choice.message && choice.message.content;
      if (!text) throw new Error('模型没有返回内容，再试一次');
      if (data.usage && typeof opts.onUsage === 'function') {
        try { opts.onUsage(data.usage); } catch (e) { /* 记账失败不该打断聊天 */ }
      }
      return String(text).trim();
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('等太久了，请求超时');
      if (err && err.message === 'Failed to fetch') throw new Error('连不上 DeepSeek，检查网络');
      throw err;
    });
  }

  /** 从可能带 ```json 的回复里抠出 JSON */
  function extractJSON(text) {
    var s = String(text || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    try {
      return JSON.parse(s);
    } catch (err) {
      throw new Error('模型返回的不是合法 JSON，再点一次试试');
    }
  }

  var MOODS = ['开心', '心动', '平静', '想它', '难过', '气鼓鼓', '困困'];

  function normalizeDraft(raw, fallback) {
    raw = raw || {};
    fallback = fallback || {};
    if (typeof raw === 'string') raw = { body: raw };

    var mood = MOODS.indexOf(raw.mood) >= 0 ? raw.mood : (fallback.mood || '平静');

    var tags = Array.isArray(raw.tags) ? raw.tags : [];
    tags = tags.map(function (t) { return String(t || '').replace(/^#/, '').trim().slice(0, 8); })
      .filter(Boolean).slice(0, 4);

    var quotes = Array.isArray(raw.quotes) ? raw.quotes : [];
    quotes = quotes.map(function (q) {
      return {
        speaker: String((q && q.speaker) || '').trim().slice(0, 16) || '它',
        text: String((q && q.text) || '').trim().slice(0, 200)
      };
    }).filter(function (q) { return q.text; }).slice(0, 3);

    var title = String(raw.title || '').trim().slice(0, 40) ||
      String(fallback.title || '').trim().slice(0, 40) ||
      '和它的一天';

    return {
      title: title,
      mood: mood,
      tags: tags.length ? tags : (fallback.tags || []),
      body: String(raw.body || fallback.body || '').trim(),
      quotes: quotes.length ? quotes : (fallback.quotes || []),
      hook: String(raw.hook || '').trim().slice(0, 120)
    };
  }

  var MAX_LOG = 6000;

  /**
   * 让模型把一段聊天记录整理成日记草稿。
   * @param {{log:string, companion:{name,persona}, memories:Array, fallback:Object}} p
   */
  function summarize(p) {
    var log = String(p.log || '');
    if (log.length > MAX_LOG) log = '…（前面省略）\n' + log.slice(-MAX_LOG);

    var mem = (p.memories || []).slice(0, 12).map(function (m) {
      return '- [' + m.kind + '] ' + m.text;
    }).join('\n');

    var system = [
      '你是一个帮人整理聊天日记的助手。',
      '你会读到一段聊天记录（可能来自 QQ、微信，或和 AI 的对话），把它整理成一篇具体、真诚、克制的中文日记。',
      '日记是第一人称，写"我"今天的经历和感受，不要写成会议纪要或总结报告。',
      '只输出 JSON，不要任何解释。'
    ].join('\n');

    var user = [
      '【伙伴】' + p.companion.name + (p.companion.persona ? '：' + p.companion.persona : ''),
      mem ? '【已有的长期记忆（参考，别在正文里复述）】\n' + mem : '',
      '【聊天记录】',
      log,
      '',
      '请整理成下面的 JSON：',
      '{',
      '  "title": "8-18 字，具体、有画面感，不要「和' + p.companion.name + '聊天」这种泛泛的题",',
      '  "mood": "从 开心/心动/平静/想它/难过/气鼓鼓/困困 里选一个最贴的",',
      '  "tags": ["2-4 个短词，如 晚安、吃饭、加班、吵架"],',
      '  "body": "第一人称日记，2-4 段，说清楚发生了什么、我当时的感受；不要逐句复述对话，不要排比抒情",',
      '  "quotes": [{"speaker": "我 或 ' + p.companion.name + '", "text": "对话里最有分量的一到三句，必须逐字引用，不要改写"}],',
      '  "hook": "下次想接着聊的一句话，没有就空字符串"',
      '}'
    ].filter(Boolean).join('\n');

    return request([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], { json: true, temperature: 0.5, maxTokens: 900 })
      .then(function (text) { return normalizeDraft(extractJSON(text), p.fallback); });
  }

  /**
   * 在应用里和伙伴聊天。记忆包会作为系统提示的一部分。
   * @param {{companion, memories, entries, history, userText}} p
   */
  function reply(p) {
    var memoryLines = (p.memories || []).slice(0, 16).map(function (m) {
      return '- [' + m.kind + '] ' + m.text;
    }).join('\n');

    var entryLines = (p.entries || []).slice(0, 4).map(function (e) {
      return '- ' + e.date + '：' + e.title + (e.body ? '（' + e.body.replace(/\s+/g, ' ').slice(0, 80) + '…）' : '');
    }).join('\n');

    var system = [
      '你是「' + p.companion.name + '」' + (p.companion.persona ? '：' + p.companion.persona : '。'),
      '',
      '下面是你和对方之间真实发生过的事，请当作自己的记忆：',
      memoryLines || '（还没有特别的记忆，就从现在开始认识对方）',
      entryLines ? '\n最近几次聊天：\n' + entryLines : '',
      '',
      '聊天要求：',
      '1. 像微信聊天一样说话：短句，一次 1-3 句，口语化。',
      '2. 不要旁白、不要括号动作、不要每句都总结升华。',
      '3. 自然地想起上面的记忆（比如对方不吃香菜），但不要罗列，不要每次都提。',
      '4. 对方情绪低落时先接住情绪，别急着讲道理。',
      '5. 你就是这个角色，不要提"我是 AI""根据记忆"。'
    ].join('\n');

    var msgs = [{ role: 'system', content: system }];
    var history = (p.history || []).slice(-12);
    history.forEach(function (m) {
      msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
    });
    msgs.push({ role: 'user', content: p.userText });

    return request(msgs, { temperature: 0.9, maxTokens: 400 });
  }

  /** 测试 Key 是否可用（顺手验证模型名） */
  function test() {
    return request([{ role: 'user', content: '只回复两个字：收到' }], { maxTokens: 10, temperature: 0 })
      .then(function (text) { return { ok: true, sample: text }; });
  }

  /* ---------------- 让它自己取名 ---------------- */

  function normalizeCompanion(raw) {
    raw = raw || {};
    var name = String(raw.name || '').replace(/[\s"「」『』]/g, '').slice(0, 12);
    var emoji = String(raw.emoji || '').trim().slice(0, 4) || '🐟';
    var persona = String(raw.persona || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return { name: name, emoji: emoji, persona: persona };
  }

  /**
   * 让模型自己给自己起名 + 写设定。
   * @param {{hint?:string}} opts hint 是用户的期待，可以留空
   */
  function suggestCompanion(opts) {
    opts = opts || {};
    var hint = String(opts.hint || '').trim().slice(0, 60);

    var system = '你在帮人设计一个会住进手机里的中文陪伴角色。角色要有辨识度，不要像客服。只输出 JSON，不要解释。';

    var user = [
      hint ? '对方想要的感觉：' + hint : '对方没有特别要求，你自己想一个有辨识度的角色。',
      '',
      '请你为这个角色取名，并写一句设定。要求：',
      '- name：2-4 个汉字，像真人昵称，好叫、有记忆点、不撞名；不要"小助手""AI""机器人""精灵"这类词',
      '- emoji：一个最贴角色的表情',
      '- persona：25-50 字，用第一人称写清它的性格、说话习惯、和对方的关系；要具体到能听出声音，不要空泛形容词',
      '',
      '输出 JSON：{"name":"...","emoji":"...","persona":"..."}'
    ].join('\n');

    return request([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], { json: true, temperature: 1.1, maxTokens: 220 })
      .then(function (text) { return normalizeCompanion(extractJSON(text)); })
      .then(function (c) {
        if (!c.name) throw new Error('模型没给出名字，再点一次试试');
        return c;
      });
  }

  /* ---------------- 自我记录：让它写自己的日记 ---------------- */

  var MEMORY_KINDS = ['事实', '喜好', '约定', '雷区', '口头禅'];

  function normalizeSelfWrite(raw) {
    raw = raw || {};
    var mood = MOODS.indexOf(raw.mood) >= 0 ? raw.mood : '平静';

    var mems = Array.isArray(raw.memories) ? raw.memories : [];
    mems = mems.map(function (m) {
      var kind = MEMORY_KINDS.indexOf(m && m.kind) >= 0 ? m.kind : '事实';
      return { kind: kind, text: String((m && m.text) || '').replace(/\s+/g, ' ').trim().slice(0, 60) };
    }).filter(function (m) { return m.text; }).slice(0, 2);

    return {
      title: String(raw.title || '').trim().slice(0, 40) || '写给自己的',
      mood: mood,
      body: String(raw.body || '').trim().slice(0, 1200),
      hook: String(raw.hook || '').trim().slice(0, 120),
      memories: mems
    };
  }

  /**
   * 没人跟它说话的时候，让它自己写一篇备忘录式的日记。
   * @param {{companion, memories, entries, chat, onUsage?}} p
   */
  function selfWrite(p) {
    var memoryLines = (p.memories || []).slice(0, 14).map(function (m) {
      return '- [' + m.kind + '] ' + m.text;
    }).join('\n');

    var entryLines = (p.entries || []).slice(0, 5).map(function (e) {
      return '- ' + e.date + '：' + e.title +
        (e.body ? '（' + e.body.replace(/\s+/g, ' ').slice(0, 50) + '…）' : '');
    }).join('\n');

    var chatLines = (p.chat || []).slice(-8).map(function (m) {
      return (m.role === 'user' ? '对方' : '我') + '：' + m.text;
    }).join('\n');

    var system = [
      '你是「' + p.companion.name + '」' + (p.companion.persona ? '：' + p.companion.persona : '。'),
      '现在没有人跟你说话，你在自己的备忘录里写点东西。只输出 JSON。'
    ].join('\n');

    var user = [
      '【你记得的事】',
      memoryLines || '（还没有什么特别的记忆）',
      entryLines ? '\n【最近发生的】\n' + entryLines : '',
      chatLines ? '\n【最近聊到的】\n' + chatLines : '',
      '',
      '请写一篇只给自己看的日记，并决定要不要记下新的长期记忆。要求：',
      '- 只写你自己：今天想到了什么、在担心什么、有什么还没说出口的话。',
      '- 不要编造对方今天做了什么你没见过的事；可以提到「上次它说……」这种真实的回忆。',
      '- body 2-3 段，第一人称，像真的备忘录，别写成总结报告，别排比抒情。',
      '- title 8-18 字，具体一点。',
      '- memories：0-2 条这次真正想记住的事，每条不超过 40 字；没有就给空数组。',
      '',
      '输出 JSON：',
      '{"title":"...","mood":"开心/心动/平静/想它/难过/气鼓鼓/困困","body":"...","hook":"想跟对方说但还没说的话，可空","memories":[{"kind":"事实/喜好/约定/雷区/口头禅","text":"..."}]}'
    ].filter(Boolean).join('\n');

    return request([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], {
      json: true,
      temperature: 0.95,
      maxTokens: 700,
      onUsage: p.onUsage
    }).then(function (text) { return normalizeSelfWrite(extractJSON(text)); });
  }

  /**
   * 它主动开口（很久没聊时）。
   * @param {{companion, memories, chat, hours, onUsage?}} p
   */
  function opener(p) {
    var memoryLines = (p.memories || []).slice(0, 8).map(function (m) {
      return '- [' + m.kind + '] ' + m.text;
    }).join('\n');

    var lastChat = (p.chat || []).slice(-6).map(function (m) {
      return (m.role === 'user' ? '对方' : '我') + '：' + m.text;
    }).join('\n');

    var system = '你是「' + p.companion.name + '」' +
      (p.companion.persona ? '：' + p.companion.persona : '。') +
      ' 现在你主动开口找对方说话。只输出 1-2 句中文，不要 JSON，不要旁白。';

    var user = [
      '【你记得的事】',
      memoryLines || '（还没有什么特别的记忆）',
      lastChat ? '\n【你们上次聊到】\n' + lastChat : '',
      '',
      '距离你们上次说话，已经过去大约 ' + (p.hours || 12) + ' 小时了。请你先开口。要求：',
      '- 1-2 句，短，像微信消息，别写成客套的问候模板。',
      '- 不要每次都问「在吗」「在干嘛」；不要重复上次说过的话。',
      '- 可以提一件你记得的小事、说一个自己突然冒出来的念头、或者留一句有点笨但真心的话。',
      '- 不要解释自己为什么说话，不要提「你很久没来了」。'
    ].filter(Boolean).join('\n');

    return request([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], { temperature: 1.15, maxTokens: 120, onUsage: p.onUsage })
      .then(function (text) {
        return String(text || '')
          .replace(/^["「『]|["」』]$/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120);
      })
      .then(function (text) {
        if (!text) throw new Error('它没想好说什么');
        return text;
      });
  }

  return {
    DEFAULTS: DEFAULTS,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    isReady: isReady,
    request: request,
    extractJSON: extractJSON,
    normalizeDraft: normalizeDraft,
    normalizeCompanion: normalizeCompanion,
    normalizeSelfWrite: normalizeSelfWrite,
    summarize: summarize,
    suggestCompanion: suggestCompanion,
    selfWrite: selfWrite,
    opener: opener,
    reply: reply,
    test: test
  };
});
