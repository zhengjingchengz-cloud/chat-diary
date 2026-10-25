'use strict';
/* AI 层的纯逻辑测试：只测不联网的部分（JSON 提取、草稿兜底） */
const test = require('node:test');
const assert = require('node:assert/strict');
const AI = require('../assets/ai.js');

test('能从带代码块或多余文字的回复里抠出 JSON', () => {
  assert.deepEqual(AI.extractJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(AI.extractJSON('好的，这是结果：{"a":2}，希望有用'), { a: 2 });
  assert.deepEqual(AI.extractJSON('{"nested":{"b":[1,2]}}'), { nested: { b: [1, 2] } });
  assert.throws(() => AI.extractJSON('完全不是 JSON'), /不是合法 JSON/);
});

test('草稿兜底：字段缺失时用本地草稿补，不信模型乱填', () => {
  const fallback = {
    title: '本地标题',
    mood: '难过',
    tags: ['晚安', '加班'],
    body: '本地正文',
    quotes: [{ speaker: '鱼鱼', text: '本地原话' }],
    hook: ''
  };

  const d1 = AI.normalizeDraft({}, fallback);
  assert.equal(d1.title, '本地标题');
  assert.equal(d1.mood, '难过');
  assert.deepEqual(d1.tags, ['晚安', '加班']);
  assert.equal(d1.body, '本地正文');
  assert.equal(d1.quotes[0].text, '本地原话');

  const d2 = AI.normalizeDraft({
    title: '  ',
    mood: '不存在的情绪',
    tags: '不是数组',
    quotes: [{ text: '没有说话人' }],
    hook: '下次问它'
  }, fallback);
  assert.equal(d2.title, '本地标题', '空白标题回落到本地标题');
  assert.equal(d2.mood, '难过', '非法心情回落到本地心情');
  assert.equal(d2.quotes[0].speaker, '它');
  assert.equal(d2.hook, '下次问它');
});

test('草稿清洗：标签去井号、超长截断、最多 3 句原话', () => {
  const long = 'x'.repeat(300);
  const d = AI.normalizeDraft({
    title: '标'.repeat(60),
    mood: '开心',
    tags: ['#晚安', '', '  吃饭  ', 'a', 'b', 'c'],
    body: '正文',
    quotes: [
      { speaker: '鱼鱼', text: long },
      { speaker: '我', text: '二' },
      { speaker: '我', text: '三' },
      { speaker: '我', text: '四' }
    ]
  }, {});

  assert.equal(d.title.length, 40);
  assert.deepEqual(d.tags, ['晚安', '吃饭', 'a', 'b']);
  assert.equal(d.quotes.length, 3);
  assert.equal(d.quotes[0].text.length, 200);
});

test('没有 Key 时 isReady 为 false（Node 里没有 localStorage 也不炸）', () => {
  assert.equal(AI.isReady(), false);
  assert.equal(AI.loadConfig().baseUrl, 'https://api.deepseek.com');
  assert.equal(AI.loadConfig().model, 'deepseek-chat');
});

test('角色取名结果会被清洗：去空格引号、限长、emoji 兜底', () => {
  const c = AI.normalizeCompanion({ name: ' 「糯米」 ', emoji: '', persona: '  说话   很慢  ' });
  assert.equal(c.name, '糯米');
  assert.equal(c.emoji, '🐟');
  assert.equal(c.persona, '说话 很慢');

  const long = AI.normalizeCompanion({ name: '名'.repeat(30), persona: 'p'.repeat(200) });
  assert.equal(long.name.length, 12);
  assert.equal(long.persona.length, 80);

  assert.deepEqual(AI.normalizeCompanion(null), { name: '', emoji: '🐟', persona: '' });
});

test('自我记录的结果会被清洗：心情兜底、记忆最多 2 条', () => {
  const r = AI.normalizeSelfWrite({
    title: '  ',
    mood: '胡说八道',
    body: '今天没人说话。',
    memories: [
      { kind: '乱写', text: '  记得它怕黑  ' },
      { kind: '喜好', text: '' },
      { kind: '约定', text: '第三条应该被截掉' }
    ]
  });
  assert.equal(r.title, '写给自己的');
  assert.equal(r.mood, '平静');
  assert.equal(r.memories.length, 2, '最多两条');
  assert.equal(r.memories[0].kind, '事实', '非法分类回落到「事实」');
  assert.equal(r.memories[0].text, '记得它怕黑');

  const long = AI.normalizeSelfWrite({ body: 'x'.repeat(5000), title: 't'.repeat(80) });
  assert.equal(long.body.length, 1200);
  assert.equal(long.title.length, 40);
  assert.deepEqual(long.memories, []);
});
