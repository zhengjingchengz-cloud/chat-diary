/*
 * 聊天日记 · 游戏引擎 (game.js)
 *
 * 「谁是卧底」的纯规则逻辑：发牌、发言顺序、投票、出局、胜负、局后总结。
 * 不碰 DOM、不调 API——法官的事全在这里做，AI 只负责演。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DiaryGame = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var WORD_PAIRS = [
    { civilian: '可乐', undercover: '雪碧' },
    { civilian: '苹果', undercover: '梨' },
    { civilian: '猫', undercover: '狗' },
    { civilian: '火锅', undercover: '麻辣烫' },
    { civilian: '微信', undercover: 'QQ' },
    { civilian: '地铁', undercover: '公交' },
    { civilian: '咖啡', undercover: '奶茶' },
    { civilian: '蛋糕', undercover: '面包' },
    { civilian: '医院', undercover: '药店' },
    { civilian: '老师', undercover: '教练' },
    { civilian: '夏天', undercover: '秋天' },
    { civilian: '老虎', undercover: '狮子' },
    { civilian: '手机', undercover: '平板' },
    { civilian: '电影', undercover: '电视剧' },
    { civilian: '薯条', undercover: '薯片' },
    { civilian: '篮球', undercover: '排球' },
    { civilian: '键盘', undercover: '鼠标' },
    { civilian: '眼镜', undercover: '墨镜' }
  ];

  var NPC_POOL = [
    { name: '阿灯', emoji: '🕯️' },
    { name: '糯米', emoji: '🍚' },
    { name: '团子', emoji: '🍡' },
    { name: '豆豆', emoji: '🫘' },
    { name: '阿眠', emoji: '🌙' },
    { name: '七七', emoji: '🎐' }
  ];

  var MIN_PLAYERS = 4;
  var MAX_PLAYERS = 6;

  function uid(prefix) {
    return (prefix || 'g') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  function shuffle(list, rng) {
    var a = list.slice();
    var r = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function byId(g, id) {
    for (var i = 0; i < g.players.length; i++) if (g.players[i].id === id) return g.players[i];
    return null;
  }

  function alivePlayers(g) {
    return g.players.filter(function (p) { return p.alive; });
  }

  function pushLog(g, entry) {
    g.log.push(Object.assign({ at: new Date().toISOString(), round: g.round }, entry));
    return g.log[g.log.length - 1];
  }

  /**
   * 开一局。
   * @param {Array<{id,name,emoji,isMe,companionId}>} players 4–6 人
   */
  function createGame(players, rng) {
    if (!Array.isArray(players) || players.length < MIN_PLAYERS) {
      throw new Error('至少要 ' + MIN_PLAYERS + ' 个人才能玩');
    }
    if (players.length > MAX_PLAYERS) throw new Error('最多 ' + MAX_PLAYERS + ' 个人');

    var r = rng || Math.random;
    var pair = WORD_PAIRS[Math.floor(r() * WORD_PAIRS.length)];
    var underIdx = Math.floor(r() * players.length);

    var list = players.map(function (p, i) {
      var role = i === underIdx ? 'undercover' : 'civilian';
      return {
        id: p.id,
        name: p.name,
        emoji: p.emoji || '🙂',
        isMe: !!p.isMe,
        companionId: p.companionId || null,
        alive: true,
        role: role,
        word: role === 'undercover' ? pair.undercover : pair.civilian
      };
    });

    var g = {
      id: uid('g'),
      type: 'undercover',
      createdAt: new Date().toISOString(),
      players: list,
      round: 1,
      phase: 'describe',
      order: shuffle(list.map(function (p) { return p.id; }), r),
      speakerIndex: 0,
      speeches: [],
      votes: [],
      log: [],
      pair: pair,
      winner: null,
      summarized: false
    };

    pushLog(g, { kind: 'system', text: '发牌完毕，' + list.length + ' 个人，第 1 轮开始发言。' });
    return g;
  }

  function me(g) {
    return g.players.filter(function (p) { return p.isMe; })[0] || null;
  }

  function currentSpeaker(g) {
    if (!g || g.phase !== 'describe') return null;
    var id = g.order[g.speakerIndex];
    return id ? byId(g, id) : null;
  }

  /** 发言：只允许当前该说话的人说 */
  function speak(g, playerId, text) {
    if (!g || g.phase !== 'describe') return false;
    var p = byId(g, playerId);
    var cur = currentSpeaker(g);
    if (!p || !p.alive || !cur || cur.id !== playerId) return false;
    var t = String(text || '').trim();
    if (!t) return false;

    g.speeches.push({ round: g.round, playerId: playerId, text: t });
    pushLog(g, { kind: 'speech', playerId: playerId, text: t });
    g.speakerIndex += 1;

    if (g.speakerIndex >= g.order.length) {
      g.phase = 'vote';
      g.votes = [];
      pushLog(g, { kind: 'system', text: '发言结束，开始投票。' });
    }
    return true;
  }

  function vote(g, fromId, toId) {
    if (!g || g.phase !== 'vote') return false;
    var f = byId(g, fromId);
    var t = byId(g, toId);
    if (!f || !f.alive || !t || !t.alive || f.id === t.id) return false;
    if (g.votes.some(function (v) { return v.from === fromId; })) return false;

    g.votes.push({ from: fromId, to: toId, round: g.round });
    pushLog(g, { kind: 'vote', playerId: fromId, targetId: toId });
    return true;
  }

  function voters(g) {
    return alivePlayers(g);
  }

  function pendingVoters(g) {
    var voted = {};
    g.votes.forEach(function (v) { voted[v.from] = 1; });
    return voters(g).filter(function (p) { return !voted[p.id]; });
  }

  function tally(g) {
    var counts = {};
    alivePlayers(g).forEach(function (p) { counts[p.id] = 0; });
    g.votes.forEach(function (v) {
      if (counts[v.to] !== undefined) counts[v.to] += 1;
    });

    var max = -1;
    var top = [];
    Object.keys(counts).forEach(function (id) {
      if (counts[id] > max) { max = counts[id]; top = [id]; }
      else if (counts[id] === max) top.push(id);
    });

    return { counts: counts, top: top, max: max, tie: top.length > 1 || max <= 0 };
  }

  function checkWin(g) {
    var under = g.players.filter(function (p) { return p.role === 'undercover' && p.alive; });
    var civ = g.players.filter(function (p) { return p.role === 'civilian' && p.alive; });
    if (!under.length) return 'civilian';
    if (civ.length <= 1) return 'undercover';
    return null;
  }

  /**
   * 结算投票：平票则本轮无人出局；否则出局并判定胜负。
   * @returns {{outId:string|null, tie:boolean, winner:string|null}}
   */
  function resolveVote(g) {
    if (!g || g.phase !== 'vote') return { outId: null, tie: false, winner: g ? g.winner : null };

    var t = tally(g);
    if (t.tie) {
      pushLog(g, { kind: 'system', text: '平票，本轮没人出局。' });
      var w0 = checkWin(g);
      if (w0) { g.winner = w0; g.phase = 'over'; }
      else g.phase = 'result';
      return { outId: null, tie: true, winner: w0 };
    }

    var outId = t.top[0];
    var p = byId(g, outId);
    p.alive = false;
    pushLog(g, {
      kind: 'reveal',
      playerId: outId,
      text: p.name + ' 被投出，身份是' + (p.role === 'undercover' ? '卧底' : '平民') + '。'
    });

    var w = checkWin(g);
    if (w) {
      g.winner = w;
      g.phase = 'over';
      pushLog(g, {
        kind: 'system',
        text: w === 'civilian' ? '卧底出局，平民赢了。' : '场上只剩一个平民，卧底赢了。'
      });
    } else {
      g.phase = 'result';
    }
    return { outId: outId, tie: false, winner: w };
  }

  function nextRound(g) {
    if (!g || g.winner) return false;
    g.round += 1;
    g.speakerIndex = 0;
    g.votes = [];
    g.order = shuffle(alivePlayers(g).map(function (p) { return p.id; }));
    g.phase = 'describe';
    pushLog(g, { kind: 'system', text: '第 ' + g.round + ' 轮开始，剩下的 ' + g.order.length + ' 个人继续。' });
    return true;
  }

  /** 局后：一篇日记 + 每个 AI 玩家一条记忆 */
  function buildSummary(g) {
    var m = me(g);
    var others = g.players.filter(function (p) { return !p.isMe; });
    var names = others.map(function (p) { return p.name; }).join('、');
    var winnerText = g.winner === 'civilian' ? '平民赢了'
      : g.winner === 'undercover' ? '卧底赢了' : '没分出胜负';

    var myRole = m ? (m.role === 'undercover' ? '卧底' : '平民') : '局外人';
    var lines = [];

    lines.push('今天和' + names + '玩了一局「谁是卧底」，' + g.players.length + ' 个人，最后' + winnerText + '。');
    if (m) {
      lines.push('');
      lines.push('我是' + myRole + '，拿到的词是「' + m.word + '」。' +
        (m.alive ? '我活到了最后。' : '我没撑住，中途就被投出去了。'));
    }

    var mine = g.speeches.filter(function (s) { return m && s.playerId === m.id; });
    if (mine.length) {
      lines.push('');
      lines.push('我说的：' + mine.map(function (s) { return '「' + s.text + '」'; }).join('；'));
    }

    var funny = g.speeches.filter(function (s) {
      return (!m || s.playerId !== m.id) && s.text.length >= 8;
    }).slice(0, 2);
    if (funny.length) {
      lines.push('');
      funny.forEach(function (s) {
        var p = byId(g, s.playerId);
        lines.push((p ? p.name : '有人') + '说：「' + s.text + '」');
      });
    }

    var dead = g.players.filter(function (p) { return !p.alive; });
    if (dead.length) {
      lines.push('');
      lines.push('被投出去的是：' + dead.map(function (p) {
        return p.name + '（' + (p.role === 'undercover' ? '卧底' : '平民') + '）';
      }).join('、') + '。');
    }

    var memories = others.filter(function (p) { return p.companionId; }).map(function (p) {
      var outcome = p.alive ? '活到了最后' : '被投出去了';
      return {
        companionId: p.companionId,
        kind: '事实',
        text: '玩过一局谁是卧底：我是' + (p.role === 'undercover' ? '卧底' : '平民') +
          '，' + outcome + '，最后' + winnerText + '。'
      };
    });

    return {
      title: '和他们玩了一局谁是卧底',
      body: lines.join('\n'),
      winner: g.winner,
      memories: memories
    };
  }

  return {
    WORD_PAIRS: WORD_PAIRS,
    NPC_POOL: NPC_POOL,
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    uid: uid,
    shuffle: shuffle,
    createGame: createGame,
    byId: byId,
    me: me,
    alivePlayers: alivePlayers,
    currentSpeaker: currentSpeaker,
    speak: speak,
    vote: vote,
    voters: voters,
    pendingVoters: pendingVoters,
    tally: tally,
    resolveVote: resolveVote,
    checkWin: checkWin,
    nextRound: nextRound,
    buildSummary: buildSummary
  };
});
