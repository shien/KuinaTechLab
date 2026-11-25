(function (global) {
  'use strict';

  /**
   * 生活の行動マスター（18種類＋自由カード用）
   * periods: どの時間帯（morning / afternoon / evening）でおすすめ候補として上位表示するか
   * defaultTimes: 時間帯ごとの初期入力時刻（あとから時間入力欄で自由に変更可能）
   */
  const ACTIVITIES = [
    {
      id: 'wakeup',
      label: 'おきる',
      image: 'images/wakeup.png',
      periods: ['morning'],
      defaultTimes: { morning: '07:00', afternoon: '13:00', evening: '17:00' }
    },
    {
      id: 'toilet',
      label: 'トイレ',
      image: 'images/toilet.png',
      periods: ['morning', 'afternoon', 'evening'],
      defaultTimes: { morning: '07:05', afternoon: '13:00', evening: '20:45' }
    },
    {
      id: 'wash',
      label: 'てあらい',
      image: 'images/wash.png',
      periods: ['morning', 'afternoon', 'evening'],
      defaultTimes: { morning: '07:10', afternoon: '15:00', evening: '17:30' }
    },
    {
      id: 'dress',
      label: 'きがえ',
      image: 'images/dress.png',
      periods: ['morning', 'evening'],
      defaultTimes: { morning: '07:15', afternoon: '13:00', evening: '18:50' }
    },
    {
      id: 'meal',
      label: 'ごはん',
      image: 'images/meal.png',
      periods: ['morning', 'afternoon', 'evening'],
      defaultTimes: { morning: '07:30', afternoon: '12:00', evening: '19:00' }
    },
    {
      id: 'brush',
      label: 'はみがき',
      image: 'images/brush.png',
      periods: ['morning', 'evening'],
      defaultTimes: { morning: '07:50', afternoon: '12:40', evening: '20:30' }
    },
    {
      id: 'ready',
      label: 'したく',
      image: 'images/ready.png',
      periods: ['morning', 'evening'],
      defaultTimes: { morning: '08:00', afternoon: '13:30', evening: '20:15' }
    },
    {
      id: 'school',
      label: 'がっこう',
      image: 'images/school.png',
      periods: ['morning', 'afternoon'],
      defaultTimes: { morning: '08:15', afternoon: '13:00', evening: '16:00' }
    },
    {
      id: 'dayservice',
      label: 'デイサービス',
      image: 'images/dayservice.png',
      periods: ['afternoon', 'evening', 'morning'],
      defaultTimes: { morning: '09:30', afternoon: '14:30', evening: '16:00' }
    },
    {
      id: 'outing',
      label: 'おでかけ',
      image: 'images/outing.png',
      periods: ['morning', 'afternoon'],
      defaultTimes: { morning: '10:00', afternoon: '14:00', evening: '17:00' }
    },
    {
      id: 'snack',
      label: 'おやつ',
      image: 'images/snack.png',
      periods: ['afternoon'],
      defaultTimes: { morning: '10:30', afternoon: '15:00', evening: '16:30' }
    },
    {
      id: 'homework',
      label: 'しゅくだい',
      image: 'images/homework.png',
      periods: ['afternoon', 'evening'],
      defaultTimes: { morning: '09:30', afternoon: '15:30', evening: '17:30' }
    },
    {
      id: 'ipad',
      label: 'iPad',
      image: 'images/ipad.png',
      periods: ['afternoon', 'evening'],
      defaultTimes: { morning: '09:00', afternoon: '16:00', evening: '19:45' }
    },
    {
      id: 'play',
      label: 'あそぶ',
      image: 'images/play.png',
      periods: ['afternoon', 'morning'],
      defaultTimes: { morning: '10:00', afternoon: '16:00', evening: '17:30' }
    },
    {
      id: 'tidy',
      label: 'おかたづけ',
      image: 'images/tidy.png',
      periods: ['evening', 'afternoon'],
      defaultTimes: { morning: '11:30', afternoon: '16:45', evening: '20:10' }
    },
    {
      id: 'bath',
      label: 'おふろ',
      image: 'images/bath.png',
      periods: ['evening'],
      defaultTimes: { morning: '08:00', afternoon: '16:00', evening: '18:15' }
    },
    {
      id: 'book',
      label: 'ほんをよむ',
      image: 'images/book.png',
      periods: ['evening', 'afternoon'],
      defaultTimes: { morning: '10:30', afternoon: '14:30', evening: '20:40' }
    },
    {
      id: 'sleep',
      label: 'ねむる',
      image: 'images/sleep.png',
      periods: ['evening'],
      defaultTimes: { morning: '10:00', afternoon: '14:00', evening: '21:00' }
    }
  ];

  // 時間帯ごとの「選びやすいおすすめ順」定義
  const PERIODS = [
    {
      id: 'morning',
      label: 'あさ',
      sub: 'Morning',
      icon: '🌅',
      recommended: ['wakeup', 'toilet', 'wash', 'dress', 'meal', 'brush', 'ready', 'school', 'outing']
    },
    {
      id: 'afternoon',
      label: 'ひる',
      sub: 'Daytime',
      icon: '☀️',
      recommended: ['meal', 'school', 'dayservice', 'outing', 'wash', 'snack', 'homework', 'ipad', 'play', 'tidy']
    },
    {
      id: 'evening',
      label: 'ゆうがた・よる',
      sub: 'Evening',
      icon: '🌙',
      recommended: ['dayservice', 'wash', 'bath', 'meal', 'ipad', 'homework', 'tidy', 'brush', 'book', 'toilet', 'sleep']
    }
  ];

  // すぐに使い始められる定番プリセット
  const PRESETS = {
    weekday: [
      { period: 'morning', activityId: 'wakeup', time: '07:00', label: 'おきる', note: '' },
      { period: 'morning', activityId: 'toilet', time: '07:05', label: 'トイレ', note: '' },
      { period: 'morning', activityId: 'dress', time: '07:15', label: 'きがえ', note: '' },
      { period: 'morning', activityId: 'meal', time: '07:25', label: 'あさごはん', note: '' },
      { period: 'morning', activityId: 'brush', time: '07:50', label: 'はみがき', note: '' },
      { period: 'morning', activityId: 'school', time: '08:10', label: 'がっこう', note: '' },
      { period: 'afternoon', activityId: 'dayservice', time: '14:30', label: 'デイサービス', note: '' },
      { period: 'evening', activityId: 'wash', time: '17:30', label: 'てあらい', note: 'かえったら すぐ' },
      { period: 'evening', activityId: 'bath', time: '18:00', label: 'おふろ', note: '' },
      { period: 'evening', activityId: 'meal', time: '18:45', label: 'よるごはん', note: '' },
      { period: 'evening', activityId: 'ipad', time: '19:30', label: 'iPad', note: '30ぷん' },
      { period: 'evening', activityId: 'brush', time: '20:15', label: 'はみがき', note: '' },
      { period: 'evening', activityId: 'sleep', time: '20:45', label: 'ねむる', note: 'おやすみ' }
    ],
    holiday: [
      { period: 'morning', activityId: 'wakeup', time: '07:30', label: 'おきる', note: '' },
      { period: 'morning', activityId: 'dress', time: '07:45', label: 'きがえ', note: '' },
      { period: 'morning', activityId: 'meal', time: '08:00', label: 'あさごはん', note: '' },
      { period: 'morning', activityId: 'brush', time: '08:30', label: 'はみがき', note: '' },
      { period: 'morning', activityId: 'outing', time: '10:00', label: 'おでかけ', note: '' },
      { period: 'afternoon', activityId: 'meal', time: '12:00', label: 'ひるごはん', note: '' },
      { period: 'afternoon', activityId: 'play', time: '13:30', label: 'あそぶ', note: '' },
      { period: 'afternoon', activityId: 'snack', time: '15:00', label: 'おやつ', note: '' },
      { period: 'afternoon', activityId: 'ipad', time: '15:30', label: 'iPad', note: '' },
      { period: 'evening', activityId: 'tidy', time: '17:30', label: 'おかたづけ', note: '' },
      { period: 'evening', activityId: 'bath', time: '18:00', label: 'おふろ', note: '' },
      { period: 'evening', activityId: 'meal', time: '18:45', label: 'よるごはん', note: '' },
      { period: 'evening', activityId: 'brush', time: '20:00', label: 'はみがき', note: '' },
      { period: 'evening', activityId: 'book', time: '20:20', label: 'ほんをよむ', note: '' },
      { period: 'evening', activityId: 'sleep', time: '21:00', label: 'ねむる', note: '' }
    ]
  };

  function getActivityById(id) {
    return ACTIVITIES.find(function (a) { return a.id === id; }) || ACTIVITIES[0];
  }

  global.DailyScheduleData = {
    ACTIVITIES: ACTIVITIES,
    PERIODS: PERIODS,
    PRESETS: PRESETS,
    getActivityById: getActivityById
  };
})(window);
