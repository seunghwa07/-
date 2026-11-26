// ===== 증강 정의 (서버·클라이언트 공용) =====
// 새 증강은 POOL 에 한 줄만 추가하면 돼요.
//   rarity : 'common'(일반) · 'rare'(레어) · 'epic'(에픽) · 'legendary'(전설) — 생략하면 일반. 등급이 높을수록 선택지에 덜 나와요 (RARITY_W)
//   tank : null = 모든 탱크 공통 / 'basic' · 'heavy' · 'laser' … = 해당 탱크 전용 (탱크 종류 = 포탄 종류 이름)
//   mods : 효과 (여러 개를 같이 써도 돼요)
//          hp      최대 체력 +N
//          dmg     주는 피해 ×N (모든 포탄)
//          taken   받는 피해 ×N
//          fuel    이동력 ×N
//          kindDmg { 포탄종류: ×N }  해당 탱크 포탄의 피해만
//          shells  집속탄 소탄 수 ×N   bounce  레이저 반사 횟수 +N   beam  레이저 굵기·판정 ×N
//          area    소이탄 화염 반경 ×N   dual    유도탄 듀얼(2발, 각 피해 70%)
//          missiles 융단폭격 미사일 +N발   drills  관통탄 작은 드릴 2발 추가(각 50%)
//          split   범퍼탄이 튈 때 나오는 탄 수(기본 2)   jumbo  범퍼탄 점보(큰 탄 하나가 3번 튕김, 분열 없음)
//          grav    스나이퍼탄이 받는 중력 ×N   hitr  스나이퍼탄 피격 범위 ×N   scope  조준 점선(스나이퍼) 길이 ×N
//          heal    고르는 즉시 체력 +N 회복   rad  폭발 범위 ×N   dud  유도탄 불발 확률 ×N   fireMs  소이탄 불길·일렉트로 전기장·그라인더 톱니바퀴 지속 시간 ×N   spread  융단폭격 미사일 간격 ×N
//          turns   냉각탄 얼음·물폭탄 물 범위가 남는 차례 +N   drain  흡혈탄 회복 비율 +N(0.3 = +30%p)   charge0  레일건 발사 뒤 충전 시작 단계(기본 0)
//          icptR   요격탄 요격 범위 ×N   icptP  요격 성공 확률 +N(0.2 = +20%p)   tickets  요격 티켓 최대 보유 수 +N (한 번에 더 많은 탄 요격)
//   (아래 목록은 틀이 잘 도는지 확인하려고 넣은 샘플이에요. 마음대로 바꾸고 늘리세요)
(function (root) {
  const POOL = [
    // ----- 공통 -----
    { id: 'armor',    tank: null, rarity: 'common', icon: '🛡️', name: '강철 장갑',  desc: '최대 체력 +30',               mods: { hp: 30 } },
    { id: 'fuel',     tank: null, rarity: 'common', icon: '⛽',  name: '보조 연료',  desc: '이동력 ×1.5',                  mods: { fuel: 1.5 } },
    { id: 'powder',   tank: null, rarity: 'common', icon: '💥',  name: '강화 화약',  desc: '주는 피해 ×1.15',              mods: { dmg: 1.15 } },
    { id: 'reactive', tank: null, rarity: 'common', icon: '🧱',  name: '반응 장갑',  desc: '받는 피해 ×0.85',              mods: { taken: .85 } },
    { id: 'plate',    tank: null, rarity: 'rare', icon: '🏗️', name: '중장갑',     desc: '최대 체력 +50 · 이동력 ×0.8',  mods: { hp: 50, fuel: .8 } },
    { id: 'medkit',   tank: null, rarity: 'common', icon: '🩹', name: '응급 수리',  desc: '체력 즉시 +40 회복 (최대 체력까지)',   mods: { heal: 40 } },
    { id: 'glass',    tank: null, rarity: 'epic', icon: '🗡️', name: '유리 대포',  desc: '주는 피해 ×1.3 · 받는 피해 ×1.25',   mods: { dmg: 1.3, taken: 1.25 } },
    { id: 'bulwark',  tank: null, rarity: 'rare', icon: '🏰', name: '방벽',       desc: '받는 피해 ×0.75 · 이동력 ×0.85',     mods: { taken: .75, fuel: .85 } },
    { id: 'runner',   tank: null, rarity: 'rare', icon: '👟', name: '질주',       desc: '이동력 ×2 · 받는 피해 ×1.1',          mods: { fuel: 2, taken: 1.1 } },
    { id: 'blast',    tank: null, rarity: 'common', icon: '💣', name: '확장 폭약',  desc: '모든 폭발 범위 ×1.2',                 mods: { rad: 1.2 } },
    { id: 'overdrive', tank: null, rarity: 'common', icon: '⚡', name: '과부하 회로', desc: '주는 피해 ×1.1 · 이동력 ×1.2',      mods: { dmg: 1.1, fuel: 1.2 } },
    { id: 'balance',  tank: null, rarity: 'common', icon: '⚖️', name: '균형 장비',  desc: '체력 +15 · 주는 피해 ×1.05 · 받는 피해 ×0.95', mods: { hp: 15, dmg: 1.05, taken: .95 } },
    { id: 'ceramic',  tank: null, rarity: 'common', icon: '🧿', name: '세라믹 장갑', desc: '체력 +20 · 받는 피해 ×0.9',          mods: { hp: 20, taken: .9 } },
    // ----- 탱크 전용 -----
    { id: 'precision', tank: 'basic', rarity: 'rare', icon: '🎯', name: '정밀 조준',  desc: '기본탄 피해 ×1.3',   mods: { kindDmg: { basic: 1.3 } } },
    { id: 'overcharge', tank: 'heavy', rarity: 'rare', icon: '☄️', name: '과충전 장약', desc: '광폭탄 피해 ×1.25', mods: { kindDmg: { heavy: 1.25 } } },
    { id: 'scatter',  tank: 'cluster', rarity: 'epic',    icon: '🎆', name: '산탄',          desc: '소탄 수 ×2 (8발 → 16발)',                       mods: { shells: 2 } },
    { id: 'reflect',  tank: 'laser', rarity: 'rare',      icon: '🪞', name: '입사각 반사각', desc: '레이저 반사 횟수 +2',                          mods: { bounce: 2 } },
    { id: 'amplify',  tank: 'laser', rarity: 'rare',      icon: '🔆', name: '증폭',          desc: '레이저 굵기·판정 범위 ×1.5',                    mods: { beam: 1.5 } },
    { id: 'blaze',    tank: 'incendiary', rarity: 'rare', icon: '🔥', name: '불타는 영역',   desc: '화염 범위 ×1.5',                               mods: { area: 1.5 } },
    { id: 'signal',    tank: 'carpet', rarity: 'epic', icon: '📡', name: '신호탄',    desc: '미사일 +2발 (3발 → 5발) · 피해 중앙 20 / 양옆 15 / 끝 10',                         mods: { missiles: 2 } },
    { id: 'emergency', tank: 'carpet', rarity: 'rare', icon: '🚨', name: '비상 신호', desc: '미사일 피해 ×1.5',                               mods: { kindDmg: { carpet: 1.5 } } },
    { id: 'multidrill', tank: 'pierce', rarity: 'epic', icon: '⚙️', name: '다중 드릴', desc: '기존 드릴 + 작은 드릴 2발 · 작은 드릴은 각 피해 50%', mods: { drills: true } },
    { id: 'fission',  tank: 'bumper', rarity: 'epic', icon: '🧬', name: '분열',      desc: '튈 때 나오는 탄 2개 → 4개',                      mods: { split: 4 } },
    { id: 'jumbo',    tank: 'bumper', rarity: 'epic', icon: '🏀', name: '점보',      desc: '가장 큰 탄 하나가 3번 튕겨요 · 분열 없음',        mods: { jumbo: true } },
    { id: 'dual',     tank: 'homing', rarity: 'epic',     icon: '✌️', name: '듀얼',          desc: '유도탄 2발 발사 · 각 피해 70% · 3인 이상이면 서로 다른 적을 노려요', mods: { dual: true } },
    { id: 'crater',    tank: 'basic', rarity: 'common', icon: '🕳️', name: '대구경 탄두', desc: '기본탄 폭발 범위 ×1.25',           mods: { rad: 1.25 } },
    { id: 'tungsten',  tank: 'basic', rarity: 'common', icon: '🔩', name: '텅스텐 탄심', desc: '기본탄 피해 ×1.15 · 폭발 범위 ×1.1', mods: { kindDmg: { basic: 1.15 }, rad: 1.1 } },
    { id: 'shockwave', tank: 'heavy', rarity: 'common', icon: '🌋', name: '충격파',      desc: '광폭탄 폭발 범위 ×1.25',           mods: { rad: 1.25 } },
    { id: 'demolish',  tank: 'heavy', rarity: 'common', icon: '🧨', name: '파쇄 장약',   desc: '광폭탄 피해 ×1.15 · 폭발 범위 ×1.1', mods: { kindDmg: { heavy: 1.15 }, rad: 1.1 } },
    { id: 'warhead',   tank: 'cluster', rarity: 'rare', icon: '💢', name: '확산 탄두',  desc: '소탄 피해 ×1.5',                  mods: { kindDmg: { cluster: 1.5 } } },
    { id: 'bomblet',   tank: 'cluster', rarity: 'common', icon: '🎇', name: '대형 소탄',  desc: '소탄 폭발 범위 ×1.4',             mods: { rad: 1.4 } },
    { id: 'seeker',    tank: 'homing', rarity: 'rare', icon: '📡', name: '정밀 탐색기', desc: '유도탄 불발 없음',                 mods: { dud: 0 } },
    { id: 'hwarhead',  tank: 'homing', rarity: 'rare', icon: '🎯', name: '강화 탄두',   desc: '유도탄 피해 ×1.4',                 mods: { kindDmg: { homing: 1.4 } } },
    { id: 'drillpower', tank: 'pierce', rarity: 'rare', icon: '🪛', name: '고출력 드릴', desc: '관통탄 피해 ×1.3 (드릴 포함)',     mods: { kindDmg: { pierce: 1.3 } } },
    { id: 'widebore',  tank: 'pierce', rarity: 'common', icon: '⭕', name: '광폭 천공',   desc: '관통탄 폭발 범위 ×1.4',            mods: { rad: 1.4 } },
    { id: 'overload',  tank: 'laser', rarity: 'rare', icon: '⚡', name: '과부하',       desc: '레이저 피해 ×1.3',                 mods: { kindDmg: { laser: 1.3 } } },
    { id: 'prism',     tank: 'laser', rarity: 'rare', icon: '🔷', name: '프리즘',       desc: '반사 +1 · 굵기·판정 ×1.25',        mods: { bounce: 1, beam: 1.25 } },
    { id: 'napalm',    tank: 'incendiary', rarity: 'rare', icon: '🛢️', name: '네이팜', desc: '소이탄 피해(화상 포함) ×1.5',      mods: { kindDmg: { incendiary: 1.5 } } },
    { id: 'longburn',  tank: 'incendiary', rarity: 'common', icon: '♨️', name: '지속 연소', desc: '불길 지속 시간 ×1.7',            mods: { fireMs: 1.7 } },
    { id: 'wide',      tank: 'carpet', rarity: 'common', icon: '↔️', name: '광역 폭격',   desc: '미사일 간격 ×1.4',                 mods: { spread: 1.4 } },
    { id: 'bigbomb',   tank: 'carpet', rarity: 'common', icon: '💥', name: '대형 미사일', desc: '미사일 폭발 범위 ×1.3',            mods: { rad: 1.3 } },
    { id: 'lightslug', tank: 'sniper', rarity: 'common', icon: '🪶', name: '경량 탄두',   desc: '저격탄이 받는 중력 ×0.6 · 더 곧게 날아가요', mods: { grav: .6 } },
    { id: 'hollow',    tank: 'sniper', rarity: 'rare', icon: '🔻', name: '고관통 탄심', desc: '저격탄 피해 ×1.2 (50 → 60)',          mods: { kindDmg: { sniper: 1.2 } } },
    { id: 'zeroing',   tank: 'sniper', rarity: 'common', icon: '🎯', name: '영점 조절',   desc: '저격탄 피격 범위 ×1.5',                mods: { hitr: 1.5 } },
    { id: 'scope',     tank: 'sniper', rarity: 'common', icon: '🔭', name: '고배율 조준경', desc: '조준 점선이 2배 길어져요',             mods: { scope: 2 } },
    { id: 'highvolt', tank: 'electro', rarity: 'rare', icon: '⚡', name: '고전압',        desc: '전기장 피해 ×1.5 (3 → 5)',                    mods: { kindDmg: { electro: 1.5 } } },
    { id: 'longarc',  tank: 'electro', rarity: 'common', icon: '🔌', name: '장시간 방전',   desc: '전기장이 나아가는 시간 ×1.5 (3초 → 4.5초)',     mods: { fireMs: 1.5 } },
    { id: 'carbide',  tank: 'grinder', rarity: 'rare', icon: '🔩', name: '초경 톱날',     desc: '톱니바퀴 피해 ×1.4 (10 → 14)',                 mods: { kindDmg: { grinder: 1.4 } } },
    { id: 'longroll', tank: 'grinder', rarity: 'common', icon: '🛞', name: '장거리 구동',   desc: '톱니바퀴가 굴러가는 시간 ×1.5 (3초 → 4.5초)',   mods: { fireMs: 1.5 } },
    { id: 'rubber',    tank: 'bumper', rarity: 'rare', icon: '🟢', name: '고무 탄성',   desc: '범퍼탄 피해 ×1.3',                 mods: { kindDmg: { bumper: 1.3 } } },
    { id: 'heavyball', tank: 'bumper', rarity: 'common', icon: '🎱', name: '묵직한 공',   desc: '범퍼탄 폭발 범위 ×1.25',           mods: { rad: 1.25 } },
    // ----- 중력탄 -----
    { id: 'eventh',   tank: 'gravity', rarity: 'common', icon: '🌀', name: '사건의 지평선', desc: '블랙홀 끌어당김 범위·붕괴 크레이터 ×1.15', mods: { rad: 1.15 } },
    { id: 'collapse', tank: 'gravity', rarity: 'rare', icon: '💫', name: '붕괴 촉매',     desc: '중력탄 붕괴 피해 ×1.25 (24 → 30)',         mods: { kindDmg: { gravity: 1.25 } } },
    // ----- 냉각탄 -----
    { id: 'coldfront',  tank: 'frost', rarity: 'common', icon: '🥶', name: '한파',         desc: '얼음 바닥 범위 ×1.5',                      mods: { area: 1.5 } },
    { id: 'shard',      tank: 'frost', rarity: 'rare', icon: '🧊', name: '얼음 파편',     desc: '냉각탄 피해 ×1.5 (14 → 21)',               mods: { kindDmg: { frost: 1.5 } } },
    { id: 'permafrost', tank: 'frost', rarity: 'common', icon: '❄️', name: '영구 동토',     desc: '얼음 바닥이 남는 시간 +2차례 (3 → 5)',      mods: { turns: 2 } },
    // ----- 흡혈탄 -----
    { id: 'fang',      tank: 'vampire', rarity: 'rare', icon: '🦷', name: '날카로운 송곳니', desc: '흡혈탄 피해 ×1.3 (17 → 22)',            mods: { kindDmg: { vampire: 1.3 } } },
    { id: 'bloodlust', tank: 'vampire', rarity: 'epic', icon: '🩸', name: '피의 갈증',       desc: '회복 비율 +30%p (피해의 50% → 80%)',    mods: { drain: .3 } },
    { id: 'crimson',   tank: 'vampire', rarity: 'common', icon: '🍷', name: '핏빛 폭발',       desc: '흡혈탄 폭발 범위 ×1.25',                mods: { rad: 1.25 } },
    // ----- 물폭탄 -----
    { id: 'flood',     tank: 'water', rarity: 'common', icon: '🌊', name: '대홍수',     desc: '물 범위 ×1.4',                         mods: { area: 1.4 } },
    { id: 'highpress', tank: 'water', rarity: 'rare', icon: '🚿', name: '고압 분사',  desc: '물폭탄 피해 ×1.4 (26 → 36)',           mods: { kindDmg: { water: 1.4 } } },
    { id: 'tide',      tank: 'water', rarity: 'common', icon: '⏳', name: '만조',       desc: '물 범위가 남는 시간 +2차례 (3 → 5)',   mods: { turns: 2 } },
    // ----- 고폭탄 -----
    { id: 'overpressure', tank: 'explosive', rarity: 'rare', icon: '💥', name: '과압 장약',   desc: '고폭탄 피해 ×1.25 (34 → 42)',      mods: { kindDmg: { explosive: 1.25 } } },
    { id: 'bigcalibre',   tank: 'explosive', rarity: 'common', icon: '🕳️', name: '초대구경 포신', desc: '고폭탄 폭발 범위 ×1.3',            mods: { rad: 1.3 } },
    { id: 'bunker',       tank: 'explosive', rarity: 'rare', icon: '🏚️', name: '벙커 보강',    desc: '받는 피해 ×0.8 · 최대 체력 +20 (움직이지 못하니까)', mods: { taken: .8, hp: 20 } },
    // ----- 레일건 -----
    { id: 'capacitor', tank: 'rail', rarity: 'rare', icon: '🔋', name: '고용량 축전기', desc: '레일건 피해 ×1.25',                          mods: { kindDmg: { rail: 1.25 } } },
    { id: 'magnet',    tank: 'rail', rarity: 'rare', icon: '🧲', name: '자기 집속',     desc: '레일 빔 굵기·판정 범위 ×1.4',                mods: { beam: 1.4 } },
    { id: 'preheat',   tank: 'rail', rarity: 'common', icon: '♨️', name: '예열 코일',     desc: '쏜 뒤 충전이 0이 아닌 1단계에서 시작 (바로 다시 쏠 수 있어요)', mods: { charge0: 1 } },
    // ----- 요격탄 -----
    { id: 'scanner', tank: 'intercept', rarity: 'common', icon: '📡', name: '광역 레이더',   desc: '요격 범위 ×1.4',                           mods: { icptR: 1.4 } },
    { id: 'lock',    tank: 'intercept', rarity: 'rare', icon: '🎯', name: '정밀 추적',     desc: '요격 성공 확률 +20%p (50% → 70%)',         mods: { icptP: .2 } },
    { id: 'twin',    tank: 'intercept', rarity: 'epic', icon: '🛡️', name: '이중 티켓',     desc: '요격 티켓 최대 2장 · 한 번에 탄 2발까지 요격 시도', mods: { tickets: 1 } },
    // ----- 에픽 · 전설 (잘 안 나오는 대신 강해요) -----
    { id: 'bastion',   tank: null, rarity: 'epic',      icon: '🏯', name: '철옹성',       desc: '최대 체력 +80 · 받는 피해 ×0.9',                   mods: { hp: 80, taken: .9 } },
    { id: 'warlord',   tank: null, rarity: 'epic',      icon: '🦾', name: '전쟁 군주',     desc: '주는 피해 ×1.25 · 최대 체력 +20',                  mods: { dmg: 1.25, hp: 20 } },
    { id: 'doomsday',  tank: 'heavy',  rarity: 'epic',   icon: '☠️', name: '종말의 포격',   desc: '광폭탄 피해 ×1.4 · 폭발 범위 ×1.2',                mods: { kindDmg: { heavy: 1.4 }, rad: 1.2 } },
    { id: 'lightspeed', tank: 'laser', rarity: 'epic',   icon: '🌈', name: '광속 반사',     desc: '레이저 피해 ×1.3 · 반사 +2 · 굵기·판정 ×1.25',     mods: { kindDmg: { laser: 1.3 }, bounce: 2, beam: 1.25 } },
    { id: 'titan',     tank: null, rarity: 'legendary', icon: '🗿', name: '불멸의 거신',   desc: '최대 체력 +100 · 받는 피해 ×0.85',                 mods: { hp: 100, taken: .85 } },
    { id: 'kingstrike', tank: null, rarity: 'legendary', icon: '👑', name: '왕의 일격',    desc: '주는 피해 ×1.5 · 모든 폭발 범위 ×1.2',             mods: { dmg: 1.5, rad: 1.2 } },
    { id: 'phoenix',   tank: null, rarity: 'legendary', icon: '🔥', name: '불사조의 축복', desc: '체력 즉시 완전 회복 · 최대 체력 +30',              mods: { hp: 30, heal: 999 } },
    { id: 'perfect',   tank: null, rarity: 'legendary', icon: '🌟', name: '완전체',       desc: '체력 +40 · 주는 피해 ×1.2 · 받는 피해 ×0.85 · 이동력 ×1.2', mods: { hp: 40, dmg: 1.2, taken: .85, fuel: 1.2 } },
    { id: 'deadeye',   tank: 'basic',  rarity: 'legendary', icon: '👁️', name: '신의 눈',     desc: '기본탄 피해 ×1.6 · 폭발 범위 ×1.2',                mods: { kindDmg: { basic: 1.6 }, rad: 1.2 } },
    { id: 'headshot',  tank: 'sniper', rarity: 'legendary', icon: '💀', name: '헤드샷',       desc: '저격탄 피해 ×1.5 (50 → 75) · 피격 범위 ×1.3',      mods: { kindDmg: { sniper: 1.5 }, hitr: 1.3 } },
    { id: 'zeropoint', tank: 'rail',   rarity: 'legendary', icon: '⚛️', name: '영점 에너지',  desc: '레일건 피해 ×1.5 · 쏜 뒤 충전 1단계에서 시작',     mods: { kindDmg: { rail: 1.5 }, charge0: 1 } },
    { id: 'bloodking', tank: 'vampire', rarity: 'legendary', icon: '🧛', name: '혈족의 왕',   desc: '흡혈탄 피해 ×1.2 · 회복 비율 +50%p (50% → 100%)',  mods: { kindDmg: { vampire: 1.2 }, drain: .5 } },
  ];
  const byId = Object.fromEntries(POOL.map(a => [a.id, a]));
  const SPECIFIC_SLOTS = 1;   // 선택지 3개 중 탱크 전용을 최소 몇 개 넣을지 (전용 증강이 있는 탱크만)
  const PICK_MS = 20000;      // 선택 제한 시간 (넘기면 랜덤으로 골라져요)

  function calc(ids) {   // 가진 증강들을 합쳐서 최종 능력치 계산
    const m = { hp: 0, dmg: 1, taken: 1, fuel: 1, kindDmg: {}, shells: 1, bounce: 0, beam: 1, area: 1, dual: false, missiles: 0, drills: false, split: 2, jumbo: false, rad: 1, dud: 1, fireMs: 1, spread: 1, grav: 1, hitr: 1, scope: 1, turns: 0, drain: 0, charge0: 0, icptR: 1, icptP: 0, tickets: 0 };
    ids.forEach(id => {
      const a = byId[id]; if (!a) return;
      const x = a.mods || {};
      m.hp += x.hp || 0; m.dmg *= x.dmg || 1; m.taken *= x.taken || 1; m.fuel *= x.fuel || 1;
      m.shells *= x.shells || 1; m.bounce += x.bounce || 0; m.beam *= x.beam || 1; m.area *= x.area || 1; m.dual = m.dual || !!x.dual;
      m.missiles += x.missiles || 0; m.drills = m.drills || !!x.drills; m.split = Math.max(m.split, x.split || 2); m.jumbo = m.jumbo || !!x.jumbo;
      m.rad *= x.rad || 1; m.grav *= x.grav || 1; m.hitr *= x.hitr || 1; m.scope *= x.scope || 1; m.fireMs *= x.fireMs || 1; m.spread *= x.spread || 1; m.dud *= x.dud === undefined ? 1 : x.dud;
      m.turns += x.turns || 0; m.drain += x.drain || 0; m.charge0 = Math.max(m.charge0, x.charge0 || 0); m.icptR *= x.icptR || 1; m.icptP += x.icptP || 0; m.tickets += x.tickets || 0;
      Object.entries(x.kindDmg || {}).forEach(([k, v]) => { m.kindDmg[k] = (m.kindDmg[k] || 1) * v; });
    });
    return m;
  }

  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // 등급: 이름 · 색 · 등장 가중치 (선택지 한 칸마다 이 확률로 등급이 먼저 정해져요)
  const RARITY = [
    { id: 'common',    name: '일반',  color: '#c9d3f2', w: 60 },
    { id: 'rare',      name: '레어',  color: '#4dd2ff', w: 28 },
    { id: 'epic',      name: '에픽',  color: '#c06bff', w: 10 },
    { id: 'legendary', name: '전설',  color: '#ffb62e', w: 2 },
  ];
  const rarOf = a => a.rarity || 'common';
  // 후보(cands) 중 하나를 등급 가중치로 뽑아요 (후보에 없는 등급은 건너뛰고 나머지끼리 다시 계산)
  function draw(cands) {
    const have = RARITY.filter(r => cands.some(a => rarOf(a) === r.id));
    let roll = Math.random() * have.reduce((s, r) => s + r.w, 0), pick = have[have.length - 1];
    for (const r of have) { if ((roll -= r.w) < 0) { pick = r; break; } }
    const list = cands.filter(a => rarOf(a) === pick.id);
    return list[Math.floor(Math.random() * list.length)];
  }
  function offer(tank, have = [], n = 3) {   // 이 탱크에게 보여줄 선택지 n개 (이미 가진 증강은 제외, 등급이 높을수록 드물게)
    let ok = POOL.filter(a => !have.includes(a.id) && (a.tank === null || a.tank === tank));
    const out = [], takeOne = cands => { const a = draw(cands); if (a) { out.push(a); ok = ok.filter(o => o !== a); } };
    for (let k = 0; k < Math.min(SPECIFIC_SLOTS, n); k++) { const sp = ok.filter(a => a.tank === tank); if (sp.length) takeOne(sp); }
    while (out.length < n && ok.length) takeOne(ok);
    return shuffle(out).map(a => a.id);
  }

  const api = { POOL, byId, calc, offer, RARITY, SPECIFIC_SLOTS, PICK_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FAUG = api;
})(this);
