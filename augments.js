// ===== 증강 정의 (서버·클라이언트 공용) =====
// 새 증강은 POOL 에 한 줄만 추가하면 돼요.
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
//   (아래 목록은 틀이 잘 도는지 확인하려고 넣은 샘플이에요. 마음대로 바꾸고 늘리세요)
(function (root) {
  const POOL = [
    // ----- 공통 -----
    { id: 'armor',    tank: null, icon: '🛡️', name: '강철 장갑',  desc: '최대 체력 +30',               mods: { hp: 30 } },
    { id: 'fuel',     tank: null, icon: '⛽',  name: '보조 연료',  desc: '이동력 ×1.5',                  mods: { fuel: 1.5 } },
    { id: 'powder',   tank: null, icon: '💥',  name: '강화 화약',  desc: '주는 피해 ×1.15',              mods: { dmg: 1.15 } },
    { id: 'reactive', tank: null, icon: '🧱',  name: '반응 장갑',  desc: '받는 피해 ×0.85',              mods: { taken: .85 } },
    { id: 'plate',    tank: null, icon: '🏗️', name: '중장갑',     desc: '최대 체력 +50 · 이동력 ×0.8',  mods: { hp: 50, fuel: .8 } },
    { id: 'medkit',   tank: null, icon: '🩹', name: '응급 수리',  desc: '체력 즉시 +40 회복 (최대 체력까지)',   mods: { heal: 40 } },
    { id: 'glass',    tank: null, icon: '🗡️', name: '유리 대포',  desc: '주는 피해 ×1.3 · 받는 피해 ×1.25',   mods: { dmg: 1.3, taken: 1.25 } },
    { id: 'bulwark',  tank: null, icon: '🏰', name: '방벽',       desc: '받는 피해 ×0.75 · 이동력 ×0.85',     mods: { taken: .75, fuel: .85 } },
    { id: 'runner',   tank: null, icon: '👟', name: '질주',       desc: '이동력 ×2 · 받는 피해 ×1.1',          mods: { fuel: 2, taken: 1.1 } },
    { id: 'blast',    tank: null, icon: '💣', name: '확장 폭약',  desc: '모든 폭발 범위 ×1.2',                 mods: { rad: 1.2 } },
    { id: 'overdrive', tank: null, icon: '⚡', name: '과부하 회로', desc: '주는 피해 ×1.1 · 이동력 ×1.2',      mods: { dmg: 1.1, fuel: 1.2 } },
    { id: 'balance',  tank: null, icon: '⚖️', name: '균형 장비',  desc: '체력 +15 · 주는 피해 ×1.05 · 받는 피해 ×0.95', mods: { hp: 15, dmg: 1.05, taken: .95 } },
    { id: 'ceramic',  tank: null, icon: '🧿', name: '세라믹 장갑', desc: '체력 +20 · 받는 피해 ×0.9',          mods: { hp: 20, taken: .9 } },
    // ----- 탱크 전용 -----
    { id: 'precision', tank: 'basic', icon: '🎯', name: '정밀 조준',  desc: '기본탄 피해 ×1.3',   mods: { kindDmg: { basic: 1.3 } } },
    { id: 'overcharge', tank: 'heavy', icon: '☄️', name: '과충전 장약', desc: '광폭탄 피해 ×1.25', mods: { kindDmg: { heavy: 1.25 } } },
    { id: 'scatter',  tank: 'cluster',    icon: '🎆', name: '산탄',          desc: '소탄 수 ×2 (8발 → 16발)',                       mods: { shells: 2 } },
    { id: 'reflect',  tank: 'laser',      icon: '🪞', name: '입사각 반사각', desc: '레이저 반사 횟수 +2',                          mods: { bounce: 2 } },
    { id: 'amplify',  tank: 'laser',      icon: '🔆', name: '증폭',          desc: '레이저 굵기·판정 범위 ×1.5',                    mods: { beam: 1.5 } },
    { id: 'blaze',    tank: 'incendiary', icon: '🔥', name: '불타는 영역',   desc: '화염 범위 ×1.5',                               mods: { area: 1.5 } },
    { id: 'signal',    tank: 'carpet', icon: '📡', name: '신호탄',    desc: '미사일 +2발 (3발 → 5발) · 피해 중앙 20 / 양옆 15 / 끝 10',                         mods: { missiles: 2 } },
    { id: 'emergency', tank: 'carpet', icon: '🚨', name: '비상 신호', desc: '미사일 피해 ×1.5',                               mods: { kindDmg: { carpet: 1.5 } } },
    { id: 'multidrill', tank: 'pierce', icon: '⚙️', name: '다중 드릴', desc: '기존 드릴 + 작은 드릴 2발 · 작은 드릴은 각 피해 50%', mods: { drills: true } },
    { id: 'fission',  tank: 'bumper', icon: '🧬', name: '분열',      desc: '튈 때 나오는 탄 2개 → 4개',                      mods: { split: 4 } },
    { id: 'jumbo',    tank: 'bumper', icon: '🏀', name: '점보',      desc: '가장 큰 탄 하나가 3번 튕겨요 · 분열 없음',        mods: { jumbo: true } },
    { id: 'dual',     tank: 'homing',     icon: '✌️', name: '듀얼',          desc: '유도탄 2발 발사 · 각 피해 70% · 3인 이상이면 서로 다른 적을 노려요', mods: { dual: true } },
    { id: 'crater',    tank: 'basic', icon: '🕳️', name: '대구경 탄두', desc: '기본탄 폭발 범위 ×1.25',           mods: { rad: 1.25 } },
    { id: 'tungsten',  tank: 'basic', icon: '🔩', name: '텅스텐 탄심', desc: '기본탄 피해 ×1.15 · 폭발 범위 ×1.1', mods: { kindDmg: { basic: 1.15 }, rad: 1.1 } },
    { id: 'shockwave', tank: 'heavy', icon: '🌋', name: '충격파',      desc: '광폭탄 폭발 범위 ×1.25',           mods: { rad: 1.25 } },
    { id: 'demolish',  tank: 'heavy', icon: '🧨', name: '파쇄 장약',   desc: '광폭탄 피해 ×1.15 · 폭발 범위 ×1.1', mods: { kindDmg: { heavy: 1.15 }, rad: 1.1 } },
    { id: 'warhead',   tank: 'cluster', icon: '💢', name: '확산 탄두',  desc: '소탄 피해 ×1.5',                  mods: { kindDmg: { cluster: 1.5 } } },
    { id: 'bomblet',   tank: 'cluster', icon: '🎇', name: '대형 소탄',  desc: '소탄 폭발 범위 ×1.4',             mods: { rad: 1.4 } },
    { id: 'seeker',    tank: 'homing', icon: '📡', name: '정밀 탐색기', desc: '유도탄 불발 없음',                 mods: { dud: 0 } },
    { id: 'hwarhead',  tank: 'homing', icon: '🎯', name: '강화 탄두',   desc: '유도탄 피해 ×1.4',                 mods: { kindDmg: { homing: 1.4 } } },
    { id: 'drillpower', tank: 'pierce', icon: '🪛', name: '고출력 드릴', desc: '관통탄 피해 ×1.3 (드릴 포함)',     mods: { kindDmg: { pierce: 1.3 } } },
    { id: 'widebore',  tank: 'pierce', icon: '⭕', name: '광폭 천공',   desc: '관통탄 폭발 범위 ×1.4',            mods: { rad: 1.4 } },
    { id: 'overload',  tank: 'laser', icon: '⚡', name: '과부하',       desc: '레이저 피해 ×1.3',                 mods: { kindDmg: { laser: 1.3 } } },
    { id: 'prism',     tank: 'laser', icon: '🔷', name: '프리즘',       desc: '반사 +1 · 굵기·판정 ×1.25',        mods: { bounce: 1, beam: 1.25 } },
    { id: 'napalm',    tank: 'incendiary', icon: '🛢️', name: '네이팜', desc: '소이탄 피해(화상 포함) ×1.5',      mods: { kindDmg: { incendiary: 1.5 } } },
    { id: 'longburn',  tank: 'incendiary', icon: '♨️', name: '지속 연소', desc: '불길 지속 시간 ×1.7',            mods: { fireMs: 1.7 } },
    { id: 'wide',      tank: 'carpet', icon: '↔️', name: '광역 폭격',   desc: '미사일 간격 ×1.4',                 mods: { spread: 1.4 } },
    { id: 'bigbomb',   tank: 'carpet', icon: '💥', name: '대형 미사일', desc: '미사일 폭발 범위 ×1.3',            mods: { rad: 1.3 } },
    { id: 'lightslug', tank: 'sniper', icon: '🪶', name: '경량 탄두',   desc: '저격탄이 받는 중력 ×0.6 · 더 곧게 날아가요', mods: { grav: .6 } },
    { id: 'hollow',    tank: 'sniper', icon: '🔻', name: '고관통 탄심', desc: '저격탄 피해 ×1.2 (50 → 60)',          mods: { kindDmg: { sniper: 1.2 } } },
    { id: 'zeroing',   tank: 'sniper', icon: '🎯', name: '영점 조절',   desc: '저격탄 피격 범위 ×1.5',                mods: { hitr: 1.5 } },
    { id: 'scope',     tank: 'sniper', icon: '🔭', name: '고배율 조준경', desc: '조준 점선이 2배 길어져요',             mods: { scope: 2 } },
    { id: 'highvolt', tank: 'electro', icon: '⚡', name: '고전압',        desc: '전기장 피해 ×1.5 (3 → 5)',                    mods: { kindDmg: { electro: 1.5 } } },
    { id: 'longarc',  tank: 'electro', icon: '🔌', name: '장시간 방전',   desc: '전기장이 나아가는 시간 ×1.5 (3초 → 4.5초)',     mods: { fireMs: 1.5 } },
    { id: 'carbide',  tank: 'grinder', icon: '🔩', name: '초경 톱날',     desc: '톱니바퀴 피해 ×1.4 (10 → 14)',                 mods: { kindDmg: { grinder: 1.4 } } },
    { id: 'longroll', tank: 'grinder', icon: '🛞', name: '장거리 구동',   desc: '톱니바퀴가 굴러가는 시간 ×1.5 (3초 → 4.5초)',   mods: { fireMs: 1.5 } },
    { id: 'rubber',    tank: 'bumper', icon: '🟢', name: '고무 탄성',   desc: '범퍼탄 피해 ×1.3',                 mods: { kindDmg: { bumper: 1.3 } } },
    { id: 'heavyball', tank: 'bumper', icon: '🎱', name: '묵직한 공',   desc: '범퍼탄 폭발 범위 ×1.25',           mods: { rad: 1.25 } },
  ];
  const byId = Object.fromEntries(POOL.map(a => [a.id, a]));
  const SPECIFIC_SLOTS = 1;   // 선택지 3개 중 탱크 전용을 최소 몇 개 넣을지 (전용 증강이 있는 탱크만)
  const PICK_MS = 20000;      // 선택 제한 시간 (넘기면 랜덤으로 골라져요)

  function calc(ids) {   // 가진 증강들을 합쳐서 최종 능력치 계산
    const m = { hp: 0, dmg: 1, taken: 1, fuel: 1, kindDmg: {}, shells: 1, bounce: 0, beam: 1, area: 1, dual: false, missiles: 0, drills: false, split: 2, jumbo: false, rad: 1, dud: 1, fireMs: 1, spread: 1, grav: 1, hitr: 1, scope: 1 };
    ids.forEach(id => {
      const a = byId[id]; if (!a) return;
      const x = a.mods || {};
      m.hp += x.hp || 0; m.dmg *= x.dmg || 1; m.taken *= x.taken || 1; m.fuel *= x.fuel || 1;
      m.shells *= x.shells || 1; m.bounce += x.bounce || 0; m.beam *= x.beam || 1; m.area *= x.area || 1; m.dual = m.dual || !!x.dual;
      m.missiles += x.missiles || 0; m.drills = m.drills || !!x.drills; m.split = Math.max(m.split, x.split || 2); m.jumbo = m.jumbo || !!x.jumbo;
      m.rad *= x.rad || 1; m.grav *= x.grav || 1; m.hitr *= x.hitr || 1; m.scope *= x.scope || 1; m.fireMs *= x.fireMs || 1; m.spread *= x.spread || 1; m.dud *= x.dud === undefined ? 1 : x.dud;
      Object.entries(x.kindDmg || {}).forEach(([k, v]) => { m.kindDmg[k] = (m.kindDmg[k] || 1) * v; });
    });
    return m;
  }

  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function offer(tank, have = [], n = 3) {   // 이 탱크에게 보여줄 선택지 n개 (이미 가진 증강은 제외)
    const ok = POOL.filter(a => !have.includes(a.id) && (a.tank === null || a.tank === tank));
    const spec = shuffle(ok.filter(a => a.tank === tank)), rest = ok.filter(a => a.tank === null);
    const first = spec.slice(0, Math.min(SPECIFIC_SLOTS, n));
    const left = shuffle([...rest, ...spec.slice(first.length)]);
    return shuffle([...first, ...left.slice(0, n - first.length)]).map(a => a.id);
  }

  const api = { POOL, byId, calc, offer, SPECIFIC_SLOTS, PICK_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FAUG = api;
})(this);
