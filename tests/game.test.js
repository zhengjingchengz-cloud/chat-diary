'use strict';
/* 谁是卧底 · 规则引擎测试：法官必须永远算对 */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../assets/game.js');

function players(n) {
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push({ id: 'p' + i, name: '玩家' + i, emoji: '🙂', isMe: i === 0 });
  }
  return list;
}

function makeGame(n = 5) {
  const g = G.createGame(players(n));
  const under = g.players.filter((p) => p.role === 'undercover');
  assert.equal(under.length, 1, '有且只有一个卧底');
  return g;
}

/** 让当前该说话的人都说一句（不区分人） */
function speakAll(g, text) {
  let guard = 0;
  while (g.phase === 'describe' && guard++ < 20) {
    const cur = G.currentSpeaker(g);
    if (!cur) break;
    G.speak(g, cur.id, text || ('我是' + cur.name));
  }
}

function aliveIds(g) {
  return G.alivePlayers(g).map((p) => p.id);
}

test('发牌：人数、身份、词都正确', () => {
  for (const n of [4, 5, 6]) {
    const g = makeGame(n);
    assert.equal(g.players.length, n);
    assert.equal(g.players.filter((p) => p.role === 'undercover').length, 1);
    assert.equal(g.players.filter((p) => p.role === 'civilian').length, n - 1);

    const words = new Set(g.players.map((p) => p.word));
    assert.equal(words.size, 2, '两种词');
    const under = g.players.find((p) => p.role === 'undercover');
    const civ = g.players.find((p) => p.role === 'civilian');
    assert.notEqual(under.word, civ.word);
    assert.equal(under.word, g.pair.undercover);
    assert.equal(civ.word, g.pair.civilian);
  }
});

test('人数不够或太多会拒绝开局', () => {
  assert.throws(() => G.createGame(players(3)), /至少/);
  assert.throws(() => G.createGame(players(7)), /最多/);
});

test('发言：只有轮到的人能说，说完自动进入投票', () => {
  const g = makeGame(5);
  const cur = G.currentSpeaker(g);
  const other = g.players.find((p) => p.id !== cur.id);

  assert.equal(G.speak(g, other.id, '抢话'), false, '没轮到的人不能说');
  assert.equal(G.speak(g, cur.id, '   '), false, '空话不算');
  assert.equal(G.speak(g, cur.id, '这个东西夏天很常见'), true);
  assert.equal(g.speeches.length, 1);

  speakAll(g);
  assert.equal(g.phase, 'vote');
  assert.equal(g.speeches.length, 5);
  assert.equal(G.currentSpeaker(g), null, '投票阶段没有发言人');
});

test('投票：不能投自己、不能投死人、一人一票', () => {
  const g = makeGame(5);
  speakAll(g);

  const a = g.players[0], b = g.players[1];
  assert.equal(G.vote(g, a.id, a.id), false, '不能投自己');
  assert.equal(G.vote(g, a.id, b.id), true);
  assert.equal(G.vote(g, a.id, g.players[2].id), false, '一人只能投一次');

  b.alive = false;
  assert.equal(G.vote(g, g.players[2].id, b.id), false, '不能投死人');
});

test('计票与平票：平票本轮无人出局', () => {
  const g = makeGame(4);
  speakAll(g);
  const ids = g.players.map((p) => p.id);
  // 2 票投 p1，2 票投 p2 → 平票
  G.vote(g, ids[0], ids[1]);
  G.vote(g, ids[1], ids[2]);
  G.vote(g, ids[2], ids[1]);
  G.vote(g, ids[3], ids[2]);

  const t = G.tally(g);
  assert.equal(t.tie, true);
  assert.equal(t.counts[ids[1]], 2);

  const r = G.resolveVote(g);
  assert.equal(r.tie, true);
  assert.equal(r.outId, null);
  assert.equal(g.players.every((p) => p.alive), true, '平票谁都不出局');
});

test('平民赢：把卧底投出去', () => {
  const g = makeGame(5);
  speakAll(g);
  const under = g.players.find((p) => p.role === 'undercover');

  G.alivePlayers(g).forEach((p) => {
    if (p.id !== under.id) G.vote(g, p.id, under.id);
  });
  const r = G.resolveVote(g);

  assert.equal(r.outId, under.id);
  assert.equal(r.winner, 'civilian');
  assert.equal(g.phase, 'over');
  assert.equal(under.alive, false);
  assert.ok(g.log.some((l) => l.kind === 'reveal' && l.text.includes('卧底')));
});

test('卧底赢：平民一个个被投出去', () => {
  const g = makeGame(4);
  // 4 人：1 卧底 3 平民。投掉两个平民后，场上 1 平民 + 1 卧底 → 卧底胜
  const under = g.players.find((p) => p.role === 'undercover');
  const civs = g.players.filter((p) => p.role === 'civilian');

  speakAll(g);
  G.alivePlayers(g).forEach((p) => {
    if (p.id !== civs[0].id) G.vote(g, p.id, civs[0].id);
  });
  G.resolveVote(g);
  assert.equal(g.winner, null, '还剩 2 平民，没结束');

  G.nextRound(g);
  assert.equal(g.round, 2);
  assert.equal(g.speakerIndex, 0);
  assert.equal(g.votes.length, 0);
  assert.ok(!g.order.includes(civs[0].id), '死人不再发言');

  speakAll(g);
  G.alivePlayers(g).forEach((p) => {
    if (p.id !== civs[1].id) G.vote(g, p.id, civs[1].id);
  });
  const r = G.resolveVote(g);
  assert.equal(r.winner, 'undercover');
  assert.equal(under.alive, true, '卧底活到了最后');
});

test('局后总结：日记 + 每个 AI 玩家一条记忆', () => {
  const list = players(4);
  list[1].companionId = 'c-fish';
  list[2].companionId = 'c-moon';
  const g = G.createGame(list);
  speakAll(g, '这个东西我天天用');

  const under = g.players.find((p) => p.role === 'undercover');
  G.alivePlayers(g).forEach((p) => {
    if (p.id !== under.id) G.vote(g, p.id, under.id);
  });
  G.resolveVote(g);

  const s = G.buildSummary(g);
  assert.ok(s.title.includes('谁是卧底'));
  assert.ok(s.body.includes('玩家1') && s.body.includes('玩家3'), '正文里有其他人的名字');
  assert.ok(s.body.includes('平民赢了') || s.body.includes('卧底赢了'));
  assert.equal(s.memories.length, 2, '只给有 companionId 的人写记忆');
  assert.ok(s.memories.every((m) => m.text.includes('谁是卧底')));
  assert.deepEqual(s.memories.map((m) => m.companionId).sort(), ['c-fish', 'c-moon']);
});

test('我的词只有我自己能拿到（UI 只显示 me 的）', () => {
  const g = makeGame(5);
  const m = G.me(g);
  assert.ok(m && m.isMe);
  assert.ok(m.word);
});
