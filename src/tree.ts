import type { FamilyTreeState, Person } from './types';

export function getGenerationRows(state: FamilyTreeState) {
  const people = Object.values(state.people);
  if (!people.length) return [];

  const parentsByChild = getParentsByChild(state);
  const generationById = getGenerationDepths(state);
  const maxGeneration = Math.max(...[...generationById.values()]);
  const rows: string[][] = [];

  people.forEach((person) => {
    const generation = generationById.get(person.id) ?? maxGeneration;
    const displayDepth = maxGeneration - generation;
    if (!rows[displayDepth]) rows[displayDepth] = [];
    rows[displayDepth].push(person.id);
  });

  return rows.filter(Boolean).map((row) => sortGeneration(row, state, parentsByChild));
}

function getGenerationDepths(state: FamilyTreeState) {
  const depthById = new Map<string, number>();
  const roots = state.roots.filter((id) => state.people[id]);
  const queue: Array<[string, number]> = [];

  roots.forEach((rootId) => {
    queue.push([rootId, 0]);
    state.people[rootId].partners.forEach((partnerId) => {
      if (state.people[partnerId]) queue.push([partnerId, 0]);
    });
  });

  if (!queue.length) {
    Object.keys(state.people).forEach((personId) => queue.push([personId, 0]));
  }

  while (queue.length) {
    const next = queue.shift();
    if (!next) break;
    const [personId, depth] = next;
    const previousDepth = depthById.get(personId);
    if (previousDepth !== undefined && previousDepth >= depth) continue;

    depthById.set(personId, depth);
    const person = state.people[personId];
    if (!person) continue;

    person.partners.forEach((partnerId) => {
      if (state.people[partnerId]) queue.push([partnerId, depth]);
    });
    person.children.forEach((childId) => {
      if (state.people[childId]) queue.push([childId, depth + 1]);
    });
  }

  Object.keys(state.people).forEach((personId) => {
    if (!depthById.has(personId)) depthById.set(personId, 0);
  });

  return depthById;
}

export function getParentsByChild(state: FamilyTreeState) {
  const parentsByChild = new Map<string, string[]>();
  Object.values(state.people).forEach((person) => {
    person.children.forEach((childId) => {
      if (!state.people[childId]) return;
      if (!parentsByChild.has(childId)) parentsByChild.set(childId, []);
      parentsByChild.get(childId)?.push(person.id);
    });
  });
  return parentsByChild;
}

export function getParentIds(state: FamilyTreeState, childId: string) {
  return Object.values(state.people)
    .filter((person) => person.children.includes(childId))
    .map((person) => person.id);
}

function sortGeneration(personIds: string[], state: FamilyTreeState, parentsByChild: Map<string, string[]>) {
  const remaining = new Set(personIds);
  const groups = getSiblingGroups(personIds, state, parentsByChild);
  const orderedIds: string[] = [];

  groups.forEach((group) => {
    const siblings = group.ids.filter((id) => remaining.has(id));
    if (!siblings.length) return;

    const sortedSiblings = sortPeople(siblings, state);
    const beforePartners: string[] = [];
    const afterPartners: string[] = [];

    sortedSiblings.forEach((siblingId, index) => {
      const side = index === 0 ? beforePartners : afterPartners;
      getRowPartners(siblingId, remaining, state).forEach((partnerId) => {
        if (!sortedSiblings.includes(partnerId) && !beforePartners.includes(partnerId) && !afterPartners.includes(partnerId)) {
          side.push(partnerId);
        }
      });
    });

    [...beforePartners, ...sortedSiblings, ...afterPartners].forEach((id) => {
      if (remaining.delete(id)) orderedIds.push(id);
    });
  });

  sortPeople([...remaining], state).forEach((id) => orderedIds.push(id));
  return orderedIds;
}

function getSiblingGroups(personIds: string[], state: FamilyTreeState, parentsByChild: Map<string, string[]>) {
  const groupsByParents = new Map<string, string[]>();
  personIds.forEach((personId) => {
    const parentKey = getParentKey(personId, parentsByChild);
    if (!parentKey) return;
    if (!groupsByParents.has(parentKey)) groupsByParents.set(parentKey, []);
    groupsByParents.get(parentKey)?.push(personId);
  });

  return [...groupsByParents.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([parentKey, ids]) => ({ parentKey, ids: sortPeople(ids, state) }))
    .sort((a, b) => compareGroupAnchors(a, b, state));
}

function getParentKey(personId: string, parentsByChild: Map<string, string[]>) {
  return [...new Set(parentsByChild.get(personId) || [])].sort().join('|');
}

function getRowPartners(personId: string, remaining: Set<string>, state: FamilyTreeState) {
  return (state.people[personId]?.partners || []).filter((partnerId) => remaining.has(partnerId));
}

function compareGroupAnchors(a: { parentKey: string; ids: string[] }, b: { parentKey: string; ids: string[] }, state: FamilyTreeState) {
  const aOldest = Math.min(...a.ids.map((id) => getBirthYear(state.people[id]) || Infinity));
  const bOldest = Math.min(...b.ids.map((id) => getBirthYear(state.people[id]) || Infinity));
  if (aOldest !== bOldest) return bOldest - aOldest;
  return a.parentKey.localeCompare(b.parentKey);
}

function sortPeople(personIds: string[], state: FamilyTreeState) {
  return [...new Set(personIds)].sort((a, b) => {
    const aYear = getBirthYear(state.people[a]);
    const bYear = getBirthYear(state.people[b]);
    if (aYear !== bYear) return bYear - aYear;
    return (state.people[a]?.name || '').localeCompare(state.people[b]?.name || '');
  });
}

export function getBirthYear(person?: Person) {
  const match = person?.birthDate?.match(/\d{3,4}/);
  return match ? Number(match[0]) : 0;
}

export function formatDateForDisplay(value: string) {
  if (!value) return '';
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoDate) return value;

  const [, year, month, day] = isoDate;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function getLifeDates(person: Person) {
  if (!person.birthDate && !person.deathDate && person.isAlive) return 'Living';
  const birth = formatDateForDisplay(person.birthDate) || '?';
  const death = person.isAlive ? 'Living' : formatDateForDisplay(person.deathDate) || '?';
  return `${birth} - ${death}`;
}

export function initials(name: string) {
  const letters = (name || 'New person')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase());
  return letters.join('') || 'NP';
}
