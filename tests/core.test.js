'use strict';
/* 核心逻辑测试：node --test tests/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/core.js');

test('示例数据是自洽的', () => {
  const s = C.seedState();
  assert.equal(s.companions.length, 2);
  assert.ok(s.entries.length >= 5);
  assert.ok(s.memories.length >= 5);
  const ids = new Set(s.companions.map((c) => c.id));
  s.entries.forEach((e) => assert.ok(ids.has(e.companionId), 'entry 指向不存在的伙伴'));
  s.memories.forEach((m) => assert.ok(ids.has(m.companionId), 'memory 指向不存在的伙伴'));
  // 日期从近到远
  for (let i = 1; i < s.entries.length; i++) {
    assert.ok(s.entries[i - 1].date >= s.entries[i].date, '日记未按日期倒序');
  }
});

test('写日记：新增、修改、删除', () => {
  const s = C.seedState();
  const before = s.entries.length;
  const created = C.upsertEntry(s, {
    companionId: 'c-fish',
    date: C.todayISO(),
    title: '测试这一天',
    mood: '开心',
    tags: ['测试'],
    body: '正文内容',
    quotes: [{ speaker: '我', text: '你好' }, { speaker: '鱼鱼', text: '' }]
  });
  assert.equal(s.entries.length, before + 1);
  assert.equal(created.quotes.length, 1, '空摘录应被丢弃');

  const again = C.upsertEntry(s, { ...created, title: '改过的标题' });
  assert.equal(s.entries.length, before + 1, '按 id 更新而不是新增');
  assert.equal(again.id, created.id);
  assert.equal(C.getEntry(s, created.id).title, '改过的标题');

  assert.equal(C.removeEntry(s, created.id), true);
  assert.equal(s.entries.length, before);
  assert.equal(C.removeEntry(s, 'no-such-id'), false);
});

test('搜索：关键词、标签、心情、伙伴筛选', () => {
  const s = C.seedState();
  assert.ok(C.searchEntries(s, { q: '香菜' }).length >= 1);
  assert.equal(C.searchEntries(s, { q: '香菜', companionId: 'c-moon' }).length, 0);
  assert.ok(C.searchEntries(s, { tag: '晚安' }).every((e) => e.tags.includes('晚安')));
  assert.ok(C.searchEntries(s, { mood: '难过' }).every((e) => e.mood === '难过'));
  assert.equal(C.searchEntries(s, { q: '月亮 快递' }).length, 1, '多个词是 AND 关系');
  assert.equal(C.searchEntries(s, { q: '不存在的词xyz' }).length, 0);
});

test('统计：天数、条数、连续记录', () => {
  const s = C.seedState();
  const st = C.statsFor(s, 'c-fish');
  assert.equal(st.memories, 5);
  assert.ok(st.days >= 39, '认识天数应含起始日');
  assert.ok(st.entries >= 4);

  const empty = C.createEmptyState();
  empty.companions = [C.makeCompanion({ name: '空的' })];
  assert.equal(C.statsFor(empty, empty.companions[0].id).entries, 0);
  assert.equal(C.streakInfo(empty, empty.companions[0].id).days, 0);
});

test('记忆包：包含身份、长期记忆、最近日记、待续，且遵守条数上限', () => {
  const s = C.seedState();
  const pack = C.buildMemoryPack(s, 'c-fish', { maxEntries: 2 });
  assert.match(pack.text, /【记忆包 · 鱼鱼】/);
  assert.match(pack.text, /◆ 长期记忆/);
  assert.match(pack.text, /喜欢被叫「鱼鱼」/);
  assert.match(pack.text, /◆ 最近的聊天日记/);
  assert.match(pack.text, /把月亮打包寄给你/);
  assert.match(pack.text, /◆ 现在/);
  assert.ok(pack.chars > 200);
  // 最多 2 篇，最新的两篇应该在，最早的「第一次见面」不在
  assert.match(pack.text, /它记住了我不吃香菜/);
  assert.doesNotMatch(pack.text, /第一次见面/);
});

test('记忆包：字数预算会截断更早的日记并给出说明', () => {
  const s = C.seedState();
  const long = C.buildMemoryPack(s, 'c-fish', { maxEntries: 4, maxChars: 400 });
  assert.ok(long.chars < 1800, '预算生效');
  assert.match(long.text, /篇更早的日记没有塞进来|◆ 现在/);
});

test('记忆包：没有日记时也能生成一份可用的开场', () => {
  const s = C.createEmptyState();
  const c = C.makeCompanion({ name: '白纸', persona: '刚认识' });
  s.companions = [c];
  s.activeCompanionId = c.id;
  const pack = C.buildMemoryPack(s, c.id);
  assert.match(pack.text, /身份设定/);
  assert.equal(pack.entryCount, 0);
});

test('导入导出：JSON 往返一致，坏数据报中文错误', () => {
  const s = C.seedState();
  const round = C.parseImport(C.exportJSON(s));
  assert.deepEqual(round, s);

  assert.throws(() => C.parseImport('{oops'), /不是合法的 JSON/);
  assert.throws(() => C.parseImport('{}'), /companions/);
  assert.throws(
    () => C.parseImport('{"companions":[],"entries":[{"title":"无主的日记"}]}'),
    /没有伙伴/
  );

  // 空工作区是合法的：第一次打开、清空数据后都是这个形状
  const blank = C.parseImport('{"companions":[]}');
  assert.deepEqual(blank, C.createEmptyState());
});

test('导入导出：残缺数据会被补全而不是崩溃', () => {
  const s = C.parseImport(JSON.stringify({
    companions: [{ name: '只有名字' }],
    entries: [
      { companionId: '不存在', title: '孤儿日记' },
      { companionId: '不存在', date: '2026-13-45', mood: '不存在的情绪' }
    ],
    memories: [{ text: '' }, { text: '有内容' }]
  }));
  assert.equal(s.companions.length, 1);
  assert.equal(s.entries.length, 2);
  assert.ok(s.entries.every((e) => e.companionId === s.companions[0].id), '孤儿日记归到第一个伙伴');
  assert.ok(s.entries.every((e) => C.isISODate(e.date)), '非法日期回落到今天');
  assert.equal(s.memories.length, 1, '空记忆被丢弃');
  assert.equal(s.activeCompanionId, s.companions[0].id);
});

test('Markdown 导出可读且按伙伴分组', () => {
  const s = C.seedState();
  const md = C.exportMarkdown(s, 'all');
  assert.match(md, /^# 聊天日记/);
  assert.match(md, /## 🐟 鱼鱼/);
  assert.match(md, /## 🌙 小满/);
  assert.match(md, /长期记忆/);
  assert.match(md, /下次想聊：/);

  const one = C.exportMarkdown(s, 'c-moon');
  assert.doesNotMatch(one, /鱼鱼/);
});

test('日期工具不跨时区偏移', () => {
  assert.equal(C.toISODate(new Date(2026, 0, 1, 23, 30)), '2026-01-01');
  assert.equal(C.toISODate(new Date(2026, 11, 31, 0, 5)), '2026-12-31');
  assert.equal(C.isISODate('2024-02-29'), true);
  assert.equal(C.isISODate('2025-02-29'), false);
  assert.equal(C.diffDays('2026-10-01', '2026-10-25'), 24);
  assert.equal(C.formatDateCN('2026-10-05'), '10月5日');
  assert.equal(C.weekdayCN('2026-10-25'), '周日');
});

/* ==================== 聊天记录 → 日记 ==================== */

const LOG = [
  '[2026-10-24 21:10] 我：我回来了，饭还没吃。',
  '[2026-10-24 21:11] 鱼鱼：那你先把小鱼干吃完再理我，不然我会心疼到吐泡泡。',
  '',
  '鱼鱼: 今天加班到几点呀？',
  '我: 十点，累死了',
  '鱼鱼: 那你早点睡，晚安，明天见。',
  '这一行没有冒号，应该接在上一句后面'
].join('\n');

test('解析聊天记录：发言人、时间戳、多行续写', () => {
  const msgs = C.parseChatLog(LOG);
  assert.equal(msgs.length, 5);
  assert.equal(msgs[0].speaker, '我');
  assert.equal(msgs[1].speaker, '鱼鱼');
  assert.equal(msgs[0].time, '2026-10-24 21:10');
  assert.match(msgs[msgs.length - 1].text, /这一行没有冒号/);
  assert.match(msgs[msgs.length - 1].text, /明天见/, '续写接在上一句后面');
});

test('解析聊天记录：只有内容没有发言人时不丢字', () => {
  const msgs = C.parseChatLog('随便说说今天的事\n也没个格式\n哈哈');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].speaker, '我');
  assert.match(msgs[0].text, /哈哈/);
});

test('解析聊天记录：空输入返回空数组', () => {
  assert.deepEqual(C.parseChatLog(''), []);
  assert.deepEqual(C.parseChatLog('   \n\n  '), []);
  assert.deepEqual(C.parseChatLog(null), []);
});

test('识别伙伴：优先用已知名字，否则取非「我」的最活跃者', () => {
  const msgs = C.parseChatLog(LOG);
  assert.equal(C.pickCompanionSpeaker(msgs), '鱼鱼');
  assert.equal(C.pickCompanionSpeaker(msgs, '鱼鱼'), '鱼鱼');
  assert.equal(C.pickCompanionSpeaker(C.parseChatLog('我：你好')), '我');
});

test('生成日记草稿：字段齐全且可用', () => {
  const d = C.draftEntryFromChat(LOG, { companionName: '鱼鱼' });
  assert.equal(d.stats.total, 5);
  assert.equal(d.stats.companionName, '鱼鱼');
  assert.ok(d.title.length > 0 && d.title.length <= 40);
  assert.ok(C.MOODS.some((m) => m.value === d.mood), '心情必须是合法值');
  assert.ok(Array.isArray(d.tags));
  assert.ok(d.tags.includes('吃饭'), '识别出「吃饭」这个话题');
  assert.match(d.body, /今天和鱼鱼聊了 5 句/);
  assert.match(d.body, /从 21:10 聊到 21:11/);
  assert.ok(d.quotes.length >= 1);
  assert.equal(d.quotes[0].speaker, '鱼鱼');
});

test('生成日记草稿：纯用户独白也能出稿', () => {
  const d = C.draftEntryFromChat('我：今天好累\n我：但是还想跟人说说话', { companionName: '小满' });
  assert.ok(d.title);
  assert.equal(d.body.indexOf('今天和小满聊了 2 句'), 0);
  assert.ok(Array.isArray(d.quotes));
});

test('生成日记草稿：空记录报中文错误', () => {
  assert.throws(() => C.draftEntryFromChat('', {}), /没读到聊天内容/);
});

test('心情与标签的识别不串味', () => {
  assert.equal(C.detectMood('今天好开心，笑死我了哈哈'), '开心');
  assert.equal(C.detectMood('你别生气了，哼'), '气鼓鼓');
  assert.equal(C.detectMood('晚安，我困了先睡'), '困困');
  assert.equal(C.detectMood('今天天气不错'), '平静');
  assert.ok(C.detectTags('下班回来点了外卖，还喝了奶茶').includes('吃饭'));
  assert.ok(C.detectTags('又要加班到十点').includes('加班'));
  assert.deepEqual(C.detectTags('嗯'), []);
});

test('应用内对话：写入、截断、清空、转日志', () => {
  const s = C.seedState();
  assert.deepEqual(C.getChat(s, 'c-fish'), []);
  C.appendChat(s, 'c-fish', { role: 'user', text: '在吗' });
  C.appendChat(s, 'c-fish', { role: 'ai', text: '咕噜，在的' });
  const chat = C.getChat(s, 'c-fish');
  assert.equal(chat.length, 2);
  assert.equal(C.chatToLog(chat, '鱼鱼'), '我：在吗\n鱼鱼：咕噜，在的');

  for (let i = 0; i < 80; i++) C.appendChat(s, 'c-fish', { role: 'user', text: 'm' + i });
  assert.equal(C.getChat(s, 'c-fish').length, 60, '最多留 60 句');

  C.clearChat(s, 'c-fish');
  assert.deepEqual(C.getChat(s, 'c-fish'), []);
});

test('对话记录能随备份存下来，坏数据不会炸', () => {
  const s = C.seedState();
  C.appendChat(s, 'c-fish', { role: 'user', text: '你好' });
  const round = C.parseImport(C.exportJSON(s));
  assert.equal(C.getChat(round, 'c-fish')[0].text, '你好');

  const messy = C.parseImport(JSON.stringify({
    companions: [{ name: '鱼鱼' }],
    chats: { '不存在': [{ role: 'x', text: 'y' }] }
  }));
  assert.deepEqual(Object.keys(messy.chats), [messy.companions[0].id]);
  assert.deepEqual(messy.chats[messy.companions[0].id], [], '不认识的伙伴的对话被丢掉');
});

/* ==================== 自我记录 ==================== */

test('它自己写的日记：作者标记保留，编辑时不会被改成我写的', () => {
  const s = C.seedState();
  const e = C.upsertEntry(s, {
    companionId: 'c-fish',
    date: C.todayISO(),
    title: '今天想跟你说的话',
    author: 'self'
  });
  assert.equal(e.author, 'self');

  const edited = C.upsertEntry(s, { ...e, title: '改了个标题' });
  assert.equal(edited.author, 'self', '编辑不该把作者身份抹掉');

  const mine = C.upsertEntry(s, { companionId: 'c-fish', title: '我写的' });
  assert.equal(mine.author, 'me');
});

test('token 用量：当天累加，跨天归零', () => {
  const s = C.createEmptyState();
  assert.equal(C.usageToday(s).tokens, 0);
  C.addUsage(s, 120);
  C.addUsage(s, 80.6);
  assert.equal(C.usageToday(s).tokens, 201);
  assert.equal(s.usage.calls, 2);

  s.usage.date = '2020-01-01';
  assert.equal(C.usageToday(s).tokens, 0, '换了一天就归零');
  assert.equal(s.usage.date, C.todayISO());
});

test('什么时候该让它自己写', () => {
  const now = Date.now();
  const s = C.createEmptyState();
  s.selfWrite = { enabled: true, dailyTokens: 1500, intervalHours: 24, lastRunAt: '' };

  assert.equal(C.selfWriteDue(s, now).due, true, '没写过就该写');

  s.selfWrite.lastRunAt = new Date(now - 3600000).toISOString();
  assert.equal(C.selfWriteDue(s, now).reason, 'tooSoon', '一小时前刚写过');
  assert.ok(C.selfWriteDue(s, now).hoursLeft > 22);

  s.selfWrite.lastRunAt = new Date(now - 25 * 3600000).toISOString();
  assert.equal(C.selfWriteDue(s, now).due, true, '超过 24 小时了');

  s.uid = null;
  s.usage = { date: C.todayISO(), tokens: 1500, calls: 3 };
  const r = C.selfWriteDue(s, now);
  assert.equal(r.reason, 'budget', '额度用完了');
  assert.equal(r.cap, 1500);

  s.selfWrite.enabled = false;
  assert.equal(C.selfWriteDue(s, now).reason, 'off', '关掉就不写');
});

test('记忆去重：同一件事不会天天记一遍', () => {
  const s = C.seedState();
  assert.equal(C.hasMemory(s, 'c-fish', '我不吃香菜，喝奶茶三分糖去冰。'), true);
  assert.equal(C.hasMemory(s, 'c-fish', '我不吃香菜，喝奶茶三分糖去冰'), true, '标点差异也算同一条');
  assert.equal(C.hasMemory(s, 'c-fish', '今天第一次觉得月亮像一条鱼'), false);
  assert.equal(C.hasMemory(s, 'c-fish', '   '), true, '空内容就当已有，别记');
});

test('自我记录的设置能存进备份并清洗坏值', () => {
  const s = C.seedState();
  s.selfWrite = { enabled: false, dailyTokens: 3000, intervalHours: 48, lastRunAt: '2026-10-01T00:00:00.000Z' };
  const round = C.parseImport(C.exportJSON(s));
  assert.deepEqual(round.selfWrite, s.selfWrite);

  const bad = C.parseImport(JSON.stringify({
    companions: [{ name: 'x' }],
    selfWrite: { enabled: 'yes', dailyTokens: -5, intervalHours: 9999 }
  }));
  assert.equal(bad.selfWrite.dailyTokens, 0, '负数额度归零');
  assert.equal(bad.selfWrite.intervalHours, 720, '间隔封顶');
  assert.equal(bad.selfWrite.enabled, true);
});

test('示例数据刚建好时不会立刻自述', () => {
  const s = C.seedState();
  assert.equal(C.selfWriteDue(s, Date.now()).due, false);
  assert.equal(C.selfWriteDue(s, Date.now()).reason, 'tooSoon');
});
