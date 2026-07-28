import type { FamilyTreeState, Person } from "./types";

export const STORAGE_KEY = "dynamic-family-tree-v1";

export const TREE_DATABASE_NAME = "family-tree-database";
export const TREE_STORE_NAME = "saved-trees";

export type SavedTreeRecord = {
  id: string;
  name: string;
  savedAt: string;
  tree: FamilyTreeState;
};

function openTreeDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TREE_DATABASE_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(TREE_STORE_NAME)) {
        database.createObjectStore(TREE_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTreeStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openTreeDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(TREE_STORE_NAME, mode);
        const store = transaction.objectStore(TREE_STORE_NAME);
        const request = action(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
      }),
  );
}

export async function listSavedTrees(): Promise<SavedTreeRecord[]> {
  const records = await runTreeStore<SavedTreeRecord[]>("readonly", (store) => store.getAll());
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function loadSavedTree(id: string): Promise<SavedTreeRecord | undefined> {
  return runTreeStore<SavedTreeRecord | undefined>("readonly", (store) => store.get(id));
}

export async function saveTreeSnapshot(name: string, tree: FamilyTreeState): Promise<SavedTreeRecord> {
  const record: SavedTreeRecord = {
    id: `tree-${Date.now()}`,
    name,
    savedAt: new Date().toISOString(),
    tree: structuredClone(tree),
  };

  await runTreeStore("readwrite", (store) => store.put(record));
  return record;
}


export const demoTree: FamilyTreeState = {
  people: {
    p1: {
      id: "p1",
      name: "Evelyn Clement",
      sex: "Female",
      birthDate: "1928-06-12",
      deathDate: "",
      isAlive: true,
      occupation: "Archivist",
      birthPlace: "Portland, Oregon",
      deathPlace: "Portland, Oregon",
      description:
        "Known for keeping letters, recipes, and family stories carefully organized.",
      photo: "",
      photoCrop: { x: 0, y: 0, zoom: 1, mode: 'offset' },
      partners: ["p2"],
      children: ["p3", "p4"],
    },
    p2: {
      id: "p2",
      name: "Arthur Clement",
      sex: "Male",
      birthDate: "1926-03-08",
      deathDate: "2009-10-21",
      isAlive: false,
      occupation: "Carpenter",
      birthPlace: "Portland, Oregon",
      deathPlace: "Portland, Oregon",
      description:
        "Built cabinets, garden gates, and half the shelves in the family homes.",
      photo: "",
      photoCrop: { x: 0, y: 0, zoom: 1, mode: 'offset' },
      partners: ["p1"],
      children: ["p3", "p4"],
    },
    p3: {
      id: "p3",
      name: "Marian Clement",
      sex: "Female",
      birthDate: "1954-09-04",
      deathDate: "",
      isAlive: true,
      occupation: "Teacher",
      birthPlace: "Portland, Oregon",
      deathPlace: "Seattle, Washington",
      description:
        "Collected oral histories and taught literature for three decades.",
      photo: "",
      photoCrop: { x: 0, y: 0, zoom: 1, mode: 'offset' },
      partners: [],
      children: ["p5"],
    },
    p4: {
      id: "p4",
      name: "Daniel Clement",
      sex: "Male",
      birthDate: "1958-01-19",
      deathDate: "",
      isAlive: true,
      occupation: "Nurse",
      birthPlace: "Portland, Oregon",
      deathPlace: "Bend, Oregon",
      description: "A calm presence at every reunion and family gathering.",
      photo: "",
      photoCrop: { x: 0, y: 0, zoom: 1, mode: 'offset' },
      partners: [],
      children: [],
    },
    p5: {
      id: "p5",
      name: "Avery Clement",
      sex: "",
      birthDate: "1985-07-16",
      deathDate: "",
      isAlive: true,
      occupation: "Designer",
      birthPlace: "Seattle, Washington",
      deathPlace: "San Francisco, California",
      description:
        "Started digitizing the family tree and scanning old photos.",
      photo: "",
      photoCrop: { x: 0, y: 0, zoom: 1, mode: 'offset' },
      partners: [],
      children: [],
    },
  },
  roots: ["p1"],
  selectedId: "p5",
};

export function createPerson(overrides: Partial<Person> = {}): Person {
  return {
    id: `p${Date.now()}${Math.floor(Math.random() * 1000)}`,
    name: "New person",
    birthDate: "",
    deathDate: "",
    isAlive: true,
    sex: "",
    occupation: "",
    birthPlace: "",
    deathPlace: "",
    description: "",
    photo: "",
    photoCrop: { x: 0, y: 0, zoom: 1, mode: 'offset' },
    partners: [],
    children: [],
    ...overrides,
  };
}

export function loadTree(): FamilyTreeState {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return structuredClone(demoTree);

  try {
    return JSON.parse(stored) as FamilyTreeState;
  } catch {
    return structuredClone(demoTree);
  }
}

export function saveTree(state: FamilyTreeState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
