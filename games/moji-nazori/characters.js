(function (global) {
  'use strict';

  /**
   * 6作品のキャラクターデータ
   * nameHira はすべて純粋なひらがな（＋長音「ー」のみ）で統一。
   * カタカナ表示時は toKatakana() で全文字を確実にカタカナへ変換する。
   */
  const SERIES = [
    {
      id: 'pokemon',
      label: 'ポケモン',
      fromText: 'ポケモン より',
      badgeColor: '#f59e0b',
      characters: [
        'ぴかちゅう',
        'いーぶい',
        'にゃおは',
        'ほげーた',
        'くわっす',
        'ぽっちゃま',
        'かびごん',
        'めたもん',
        'りざーどん',
        'げんがー',
        'ぷりん',
        'ぴちゅー',
        'るかりお',
        'にんふぃあ',
        'みみっきゅ',
        'ででんね',
        'ぱも',
        'みゅう',
        'こだっく',
        'ふしぎだね',
        'ひとかげ',
        'ぜにがめ',
        'やどん',
        'とげぴー'
      ]
    },
    {
      id: 'sanrio',
      label: 'サンリオ',
      fromText: 'サンリオ より',
      badgeColor: '#fb7185',
      characters: [
        'はろーきてぃ',
        'まいめろでぃ',
        'くろみ',
        'しなもろーる',
        'ぽむぽむぷりん',
        'ぽちゃっこ',
        'けろけろけろっぴ',
        'ばつまる',
        'はんぎょどん',
        'たきしーどさむ',
        'ぐでたま',
        'こぎみゅん',
        'きき',
        'らら',
        'うぃっしゅみーめる',
        'あひるのぺっくる',
        'ぼんぼんりぼん',
        'まるもふびより'
      ]
    },
    {
      id: 'sanx',
      label: 'サンエックスユニバース',
      fromText: 'サンエックスユニバース より',
      badgeColor: '#f97316',
      characters: [
        'りらっくま',
        'こりらっくま',
        'きいろいとり',
        'ちゃいろいこぐま',
        'しろくま',
        'ぺんぎん',
        'とんかつ',
        'ねこ',
        'とかげ',
        'えびふらいのしっぽ',
        'たれぱんだ',
        'こげぱん',
        'まめごま',
        'じんべえさん',
        'ころころころにゃん',
        'ぽかんとたん',
        'しゅがーここむー',
        'いしよわちゃん'
      ]
    },
    {
      id: 'zorori',
      label: 'かいけつゾロリ',
      fromText: 'かいけつゾロリ より',
      badgeColor: '#ea580c',
      characters: [
        'ぞろり',
        'いしし',
        'のしし',
        'ぶるる',
        'こぶる',
        'あーさー',
        'えるぜ',
        'ねりー',
        'びーと',
        'みゃん',
        'ぞろりーぬ',
        'いぬたく'
      ]
    },
    {
      id: 'precure',
      label: '名探偵プリキュア！',
      fromText: '名探偵プリキュア！ より',
      badgeColor: '#ec4899',
      characters: [
        'きゅああんさー',
        'きゅあみすてぃっく',
        'きゅあえくれーる',
        'きゅああるかな',
        'あけちあんな',
        'こばやしみくる',
        'ほわくれあ',
        'もりあるるか',
        'ぽちたん',
        'しゅしゅたん',
        'ましゅたん',
        'まふるしょちょう',
        'じぇっとせんぱい'
      ]
    },
    {
      id: 'sunsun',
      label: 'サンサンキッズTV',
      fromText: 'サンサンキッズTV より',
      badgeColor: '#eab308',
      characters: [
        'さんさん',
        'くもりん',
        'ぷりる',
        'のいず',
        'つくも',
        'びーびー',
        'ききりん',
        'そーだおじさん'
      ]
    }
  ];

  // ひらがな → カタカナ（すべてのひらがなを確実にカタカナへ変換）
  function toKatakana(str) {
    return String(str).replace(/[\u3041-\u3096]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) + 0x60);
    });
  }

  // カタカナ → ひらがな（すべてのカタカナを確実にひらがなへ変換）
  function toHiragana(str) {
    return String(str).replace(/[\u30A1-\u30F6]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0x60);
    });
  }

  // 小書き文字・長音記号（なぞり対象の優先度判定に使用）
  const SMALL_OR_MARK = /^[ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ\s・]$/;
  const NON_TRACEABLE = /^[ー\s・]$/;

  /**
   * 練習対象の1文字のインデックスをランダムに選ぶ。
   * 伸ばし棒「ー」などは避け、通常の大きな文字を優先して選ぶ。
   */
  function pickTargetIndex(displayName) {
    const chars = Array.from(displayName);
    const preferred = [];
    const fallback = [];

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (NON_TRACEABLE.test(ch)) continue;
      if (!SMALL_OR_MARK.test(ch)) {
        preferred.push(i);
      } else {
        fallback.push(i);
      }
    }

    const pool = preferred.length > 0 ? preferred : fallback;
    if (pool.length === 0) return 0;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * ランダムな出題を1件生成する
   * @param {Object} opts
   * @param {string} opts.scriptMode 'random' | 'hiragana' | 'katakana'
   * @param {string} opts.seriesFilter 'all' | series.id
   * @param {string} [opts.lastKey] 直前と同じ出題を避けるためのキー
   */
  function pickQuestion(opts) {
    const scriptMode = (opts && opts.scriptMode) || 'random';
    const seriesFilter = (opts && opts.seriesFilter) || 'all';
    const lastKey = (opts && opts.lastKey) || '';

    const activeSeries =
      seriesFilter === 'all'
        ? SERIES
        : SERIES.filter(function (s) {
            return s.id === seriesFilter;
          });

    const poolSeries = activeSeries.length > 0 ? activeSeries : SERIES;

    // 各作品のキャラクター数に比例した出現比率になるよう、全対象キャラをフラットに展開して抽選
    const weightedPool = [];
    for (let s = 0; s < poolSeries.length; s++) {
      const series = poolSeries[s];
      for (let c = 0; c < series.characters.length; c++) {
        weightedPool.push({ series: series, rawHira: series.characters[c] });
      }
    }

    let chosenSeries = weightedPool[0].series;
    let rawHira = weightedPool[0].rawHira;
    let script = 'hiragana';
    let displayName = rawHira;
    let targetIndex = 0;

    for (let attempt = 0; attempt < 8; attempt++) {
      const picked = weightedPool[Math.floor(Math.random() * weightedPool.length)];
      chosenSeries = picked.series;
      rawHira = picked.rawHira;

      if (scriptMode === 'hiragana') {
        script = 'hiragana';
      } else if (scriptMode === 'katakana') {
        script = 'katakana';
      } else {
        script = Math.random() < 0.5 ? 'hiragana' : 'katakana';
      }

      displayName =
        script === 'hiragana' ? toHiragana(rawHira) : toKatakana(rawHira);
      targetIndex = pickTargetIndex(displayName);

      const candidateKey = chosenSeries.id + ':' + displayName + ':' + targetIndex;
      if (candidateKey !== lastKey) {
        break;
      }
    }

    const chars = Array.from(displayName);
    return {
      seriesId: chosenSeries.id,
      seriesLabel: chosenSeries.label,
      fromText: chosenSeries.fromText,
      badgeColor: chosenSeries.badgeColor,
      script: script, // 'hiragana' | 'katakana'
      scriptLabel: script === 'hiragana' ? 'ひらがな' : 'カタカナ',
      displayName: displayName,
      chars: chars,
      targetIndex: targetIndex,
      targetChar: chars[targetIndex],
      key: chosenSeries.id + ':' + displayName + ':' + targetIndex
    };
  }

  global.MojiNazori = global.MojiNazori || {};
  global.MojiNazori.SERIES = SERIES;
  global.MojiNazori.toHiragana = toHiragana;
  global.MojiNazori.toKatakana = toKatakana;
  global.MojiNazori.pickQuestion = pickQuestion;
})(window);
