(function (global) {
  'use strict';

  const RANKS = [
    {
      id: 'snail',
      minScore: 0,
      name: 'カタツムリ',
      en: 'SNAIL',
      emoji: '🐌',
      color: '#94A3B8',
      glow: 'rgba(148, 163, 184, 0.4)',
      comment: 'まずは一歩から。のんびりマイペースな探検家'
    },
    {
      id: 'beetle',
      minScore: 160,
      name: 'カブトムシ',
      en: 'BEETLE',
      emoji: '🪲',
      color: '#A78BFA',
      glow: 'rgba(167, 139, 250, 0.45)',
      comment: '力強く前進！迷路の壁に立ち向かう森の戦士'
    },
    {
      id: 'mouse',
      minScore: 380,
      name: 'マウス',
      en: 'MOUSE',
      emoji: '🐁',
      color: '#38BDF8',
      glow: 'rgba(56, 189, 248, 0.45)',
      comment: '迷路の常連！鋭い勘とすばしっこい反射神経'
    },
    {
      id: 'rabbit',
      minScore: 700,
      name: 'ウサギ',
      en: 'RABBIT',
      emoji: '🐇',
      color: '#34D399',
      glow: 'rgba(52, 211, 153, 0.45)',
      comment: '軽快なフットワークで分岐をぴょんと突破'
    },
    {
      id: 'cheetah',
      minScore: 1150,
      name: 'チーター',
      en: 'CHEETAH',
      emoji: '🐆',
      color: '#FBBF24',
      glow: 'rgba(251, 191, 36, 0.5)',
      comment: '地上最速のダッシュ！迷いのないシャープな軌跡'
    },
    {
      id: 'falcon',
      minScore: 1700,
      name: 'ハヤブサ',
      en: 'FALCON',
      emoji: '🦅',
      color: '#FB923C',
      glow: 'rgba(251, 146, 60, 0.5)',
      comment: '上空からゴールを見抜く急降下スピード'
    },
    {
      id: 'ninja',
      minScore: 2400,
      name: 'ニンジャ',
      en: 'NINJA',
      emoji: '🥷',
      color: '#F472B6',
      glow: 'rgba(244, 114, 182, 0.5)',
      comment: '電光石火の筆致。壁のすき間を風のように抜ける'
    },
    {
      id: 'supercomputer',
      minScore: 3250,
      name: 'スーパーコンピュータ',
      en: 'SUPERCOMPUTER',
      emoji: '🖥️',
      color: '#60A5FA',
      glow: 'rgba(96, 165, 250, 0.55)',
      comment: '全ルートを一瞬で並列演算する圧倒的な処理速度'
    },
    {
      id: 'ai',
      minScore: 4200,
      name: 'AI',
      en: 'ARTIFICIAL INTELLIGENCE',
      emoji: '🤖',
      color: '#2DD4BF',
      glow: 'rgba(45, 212, 191, 0.6)',
      comment: '最適解を先読みし続ける超知性アルゴリズム'
    },
    {
      id: 'quantum',
      minScore: 5400,
      name: '量子コンピュータ',
      en: 'QUANTUM',
      emoji: '⚛️',
      color: '#C084FC',
      glow: 'rgba(192, 132, 252, 0.65)',
      comment: '全経路を同時に駆け抜ける重ね合わせの境地'
    },
    {
      id: 'tachyon',
      minScore: 6900,
      name: 'タキオン',
      en: 'TACHYON',
      emoji: '⚡',
      color: '#FDE047',
      glow: 'rgba(253, 224, 71, 0.65)',
      comment: '因果律すら追い越す超光速の軌跡'
    },
    {
      id: 'light',
      minScore: 8800,
      name: '光',
      en: 'SPEED OF LIGHT',
      emoji: '✨',
      color: '#FFFFFF',
      glow: 'rgba(255, 255, 255, 0.85)',
      comment: '宇宙最速の到達点。迷路はすでに解かれている'
    }
  ];

  function getRankForScore(score) {
    let matchedIndex = 0;
    for (let i = 0; i < RANKS.length; i++) {
      if (score >= RANKS[i].minScore) {
        matchedIndex = i;
      } else {
        break;
      }
    }
    const current = RANKS[matchedIndex];
    const next = matchedIndex < RANKS.length - 1 ? RANKS[matchedIndex + 1] : null;
    return {
      index: matchedIndex,
      rank: current,
      next: next,
      pointsToNext: next ? Math.max(0, next.minScore - score) : 0
    };
  }

  global.Meiro5 = global.Meiro5 || {};
  global.Meiro5.RANKS = RANKS;
  global.Meiro5.getRankForScore = getRankForScore;
})(window);
