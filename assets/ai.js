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

  return {
    DEFAULTS: DEFAULTS,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    isReady: isReady,
    request: request,
    extractJSON: extractJSON,
    normalizeDraft: normalizeDraft,
    summarize: summarize,
    reply: reply,
    test: test
  };
});
