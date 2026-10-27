export const PARTS = {
  dispatch: { label: '배차', fullLabel: '배차엔진 파트', className: 'dispatch', color: '#e9b740' },
  data: { label: '데이터', fullLabel: '데이터플랫폼 파트', className: 'data', color: '#5388dc' },
  map: { label: '맵', fullLabel: '맵 파트', className: 'map', color: '#db7776' },
};

export const ZONES = {
  A: { name: '전동 데스크 · 파티션', description: '높이는 자유롭게, 집중은 편안하게.', electric: true, partition: true, monitor: '싱글 모니터', photo: 'assets/zone-a.jpg', count: 9 },
  B: { name: '전동 데스크 · 오픈형', description: '탁 트인 자리에서 가볍게 소통해요.', electric: true, partition: false, monitor: '싱글 모니터', photo: 'assets/zone-b.jpg', count: 6 },
  C: { name: '고정 데스크 · 파티션', description: '아늑한 독립 공간에서 몰입해요.', electric: false, partition: true, monitor: '싱글 모니터', photo: 'assets/zone-c.jpg', count: 6 },
};

// Coordinates reproduce the relative layout in the supplied diagram, not meters.
export const SEATS = [
  ...[['207', '206', '205'], ['68', '69', '70'], ['73', '72', '71']].flatMap((row, y) => row.map((id, x) => ({ id, zone: 'A', x, y }))),
  ...[['79', '78', '77'], ['80', '81', '82']].flatMap((row, y) => row.map((id, x) => ({ id, zone: 'B', x, y: y + 4 }))),
  ...[['85', '90'], ['86', '89'], ['87', '88']].flatMap((row, y) => row.map((id, x) => ({ id, zone: 'C', x, y: y + 7 }))),
];

const names = {
  data: ['노현구', '소민걸', '하회원', '왕정갑', '김장우', '남선우', '황시정', '김태석'],
  dispatch: ['유건우', '김병훈', '전윤혁', '임홍규', '부정준', '허자윤', '이영호', '이태양'],
  map: ['김병조', '예윤지', '천정명', '신희수'],
};

export const INITIAL_PARTICIPANTS = Object.entries(names).flatMap(([part, members]) => members.map((name, index) => ({ id: `${part}-${index + 1}`, name, part })));

export function createInitialState() {
  return { version: 1, participants: structuredClone(INITIAL_PARTICIPANTS), preferences: {}, result: null, updatedAt: null };
}

export function stateFingerprint(state) {
  return JSON.stringify({ participants: state.participants.map(p => ({ id: p.id, name: p.name, part: p.part })).sort((a, b) => a.id.localeCompare(b.id)), preferences: Object.fromEntries(Object.entries(state.preferences).sort(([a], [b]) => a.localeCompare(b))) });
}

export function createDemoPreferences(participants = INITIAL_PARTICIPANTS) {
  const preferredZone = { data: 'A', dispatch: 'B', map: 'C' };
  return Object.fromEntries(participants.map((person, index) => {
    const ordered = SEATS.toSorted((a, b) => {
      const score = s => (s.zone === preferredZone[person.part] ? 0 : 12) + ((Number(s.id) * 7 + index * 11) % 23) / 4;
      return score(a) - score(b) || a.id.localeCompare(b.id);
    });
    return [person.id, ordered.map(s => s.id)];
  }));
}
