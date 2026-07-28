export type PhotoCrop = {
  x: number;
  y: number;
  zoom: number;
  mode?: 'offset';
};

export type Person = {
  id: string;
  name: string;
  birthDate: string;
  deathDate: string;
  isAlive: boolean;
  sex: string;
  occupation: string;
  birthPlace: string;
  deathPlace: string;
  description: string;
  photo: string;
  photoCrop: PhotoCrop;
  partners: string[];
  children: string[];
};

export type FamilyTreeState = {
  people: Record<string, Person>;
  roots: string[];
  selectedId: string;
};

export type Connection = {
  id: string;
  kind: 'root' | 'partner';
  d: string;
};
