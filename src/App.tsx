import { ChangeEvent, PointerEvent, WheelEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPerson, demoTree, listSavedTrees, loadSavedTree, loadTree, saveTree, saveTreeSnapshot } from './data';
import type { SavedTreeRecord } from './data';
import { formatDateForDisplay, getGenerationRows, getLifeDates, getParentIds, initials } from './tree';
import type { Connection, FamilyTreeState, Person } from './types';

const PDF_PAGE_MARGIN_IN = 0.18;
const DEFAULT_PRINT_PAGE_WIDTH_IN = 11;
const DEFAULT_PRINT_PAGE_HEIGHT_IN = 8.5;

function App() {
  const [treeState, setTreeState] = useState<FamilyTreeState>(() => loadTree());
  const [zoom, setZoom] = useState(1);
  const [isSimplified, setIsSimplified] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });
  const [treeSize, setTreeSize] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState({ x: 0, y: 32 });
  const [treeName, setTreeName] = useState('Family Tree');
  const [savedTrees, setSavedTrees] = useState<SavedTreeRecord[]>([]);
  const [selectedSavedTreeId, setSelectedSavedTreeId] = useState('');
  const [databaseMessage, setDatabaseMessage] = useState('');
  const [history, setHistory] = useState<FamilyTreeState[]>([]);
  const [topBarOpen, setTopBarOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 760));
  const treeRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef({ pointerId: 0, startX: 0, startY: 0, originX: 0, originY: 0, moved: false, personId: '' });
  const suppressClickRef = useRef(false);

  const rows = useMemo(() => getGenerationRows(treeState), [treeState]);
  const selectedPerson = treeState.people[treeState.selectedId];
  const peopleCount = Object.keys(treeState.people).length;

  const refreshSavedTrees = async () => {
    try {
      const records = await listSavedTrees();
      setSavedTrees(records);
      setSelectedSavedTreeId((current) => current || records[0]?.id || '');
    } catch {
      setDatabaseMessage('Saved trees are unavailable in this browser.');
    }
  };

  useEffect(() => {
    const requestPersistentStorage = async () => {
      if (!navigator.storage?.persist || !navigator.storage?.persisted) return;

      try {
        const isAlreadyPersistent = await navigator.storage.persisted();
        if (!isAlreadyPersistent) await navigator.storage.persist();
      } catch {
        // Browser storage still works without the persistent-storage permission.
      }
    };

    void requestPersistentStorage();
    void refreshSavedTrees();
  }, []);

  const saveCurrentTreeToDatabase = async () => {
    try {
      const name = treeName.trim() || 'Family Tree ' + new Date().toLocaleString();
      const record = await saveTreeSnapshot(name, treeState);
      setTreeName(name);
      setSelectedSavedTreeId(record.id);
      setDatabaseMessage('Saved ' + name + '.');
      await refreshSavedTrees();
    } catch {
      setDatabaseMessage('Could not save this tree locally.');
    }
  };

  const openSavedTreeFromDatabase = async () => {
    if (!selectedSavedTreeId) return;
    const shouldOpen = window.confirm('Open this saved tree? Your current tree is already saved as the active working tree in this browser.');
    if (!shouldOpen) return;

    try {
      const record = await loadSavedTree(selectedSavedTreeId);
      if (!record) {
        setDatabaseMessage('That saved tree could not be found.');
        await refreshSavedTrees();
        return;
      }

      applyTreeChange(() => record.tree);
      setTreeName(record.name);
      setZoom(1);
      setPan({ x: 0, y: 32 });
      setDatabaseMessage('Opened ' + record.name + '.');
    } catch {
      setDatabaseMessage('Could not open this saved tree.');
    }
  };

  useEffect(() => {
    try {
      saveTree(treeState);
    } catch {
      setDatabaseMessage('This tree is too large to auto-save. Try using smaller profile photos.');
    }
  }, [treeState]);

  const applyTreeChange = (updater: (current: FamilyTreeState) => FamilyTreeState) => {
    setTreeState((current) => {
      const next = updater(current);
      if (next === current) return current;
      setHistory((previous) => [structuredClone(current), ...previous].slice(0, 50));
      return next;
    });
  };

  const undoTreeChange = () => {
    setHistory((previous) => {
      const [lastTree, ...rest] = previous;
      if (!lastTree) return previous;
      setTreeState(lastTree);
      return rest;
    });
  };

  useLayoutEffect(() => {
    const draw = () => {
      const treeElement = treeRef.current;
      if (!treeElement) return;

      const treeSize = { width: treeElement.scrollWidth, height: treeElement.scrollHeight };
      const nextConnections: Connection[] = [];

      Object.values(treeState.people).forEach((parent) => {
        parent.children.forEach((childId) => {
          if (!treeState.people[childId]) return;
          const path = getRootPath(treeElement, childId, parent.id);
          if (path) nextConnections.push({ id: `root-${parent.id}-${childId}`, kind: 'root', d: path });
        });
      });

      Object.values(treeState.people).forEach((person) => {
        person.partners.forEach((partnerId) => {
          if (person.id >= partnerId || !treeState.people[partnerId]) return;
          const path = getPartnerPath(treeElement, person.id, partnerId);
          if (path) nextConnections.push({ id: `partner-${person.id}-${partnerId}`, kind: 'partner', d: path });
        });
      });

      setSvgSize(treeSize);
      setTreeSize(treeSize);
      setConnections(nextConnections);
    };

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [treeState, rows, zoom, isSimplified]);


  const zoomAroundCenter = (nextZoom: number) => {
    const viewport = viewportRef.current;
    const clampedZoom = Math.min(1.35, Math.max(0.55, nextZoom));

    if (!viewport) {
      setZoom(clampedZoom);
      return;
    }

    const viewportCenterY = viewport.clientHeight / 2;
    const treeWidth = treeSize.width || 1;
    const contentCenterX = treeWidth / 2 - pan.x / zoom;
    const contentCenterY = (viewportCenterY - pan.y) / zoom;

    setZoom(clampedZoom);
    setPan({
      x: (treeWidth / 2 - contentCenterX) * clampedZoom,
      y: viewportCenterY - contentCenterY * clampedZoom,
    });
  };

  const updateSelectedPerson = <K extends keyof Person>(key: K, value: Person[K]) => {
    applyTreeChange((current) => {
      const person = current.people[current.selectedId];
      if (!person) return current;
      const nextPerson = { ...person, [key]: value };
      if (key === 'isAlive' && value) nextPerson.deathDate = '';
      return { ...current, people: { ...current.people, [person.id]: nextPerson } };
    });
  };

  const closeEditor = () => {
    setTreeState((current) => ({ ...current, selectedId: '' }));
  };

  const addPerson = () => {
    applyTreeChange((current) => {
      const person = createPerson({ name: 'New person' });
      return {
        ...current,
        people: { ...current.people, [person.id]: person },
        roots: [...current.roots, person.id],
        selectedId: person.id,
      };
    });
  };

  const resetTree = () => {
    const shouldReset = window.confirm('Reset the current tree back to the demo family tree? This will replace the active working tree.');
    if (!shouldReset) return;

    applyTreeChange(() => structuredClone(demoTree));
    setTreeName('Family Tree');
    setZoom(1);
    setPan({ x: 0, y: 32 });
  };

  const addChild = () => {
    applyTreeChange((current) => {
      const person = current.people[current.selectedId];
      if (!person) return current;
      const child = createPerson({ name: 'New child' });
      const people = { ...current.people, [child.id]: child };
      people[person.id] = { ...person, children: [...person.children, child.id] };
      person.partners.forEach((partnerId) => {
        const partner = people[partnerId];
        if (partner && !partner.children.includes(child.id)) people[partnerId] = { ...partner, children: [...partner.children, child.id] };
      });
      return { ...current, people, selectedId: child.id };
    });
  };

  const addPartner = () => {
    applyTreeChange((current) => {
      const person = current.people[current.selectedId];
      if (!person) return current;
      const partner = createPerson({ name: 'New partner', children: [...person.children] });
      return {
        ...current,
        people: {
          ...current.people,
          [person.id]: { ...person, partners: [...person.partners, partner.id] },
          [partner.id]: { ...partner, partners: [person.id] },
        },
        selectedId: partner.id,
      };
    });
  };

  const addSibling = () => {
    applyTreeChange((current) => {
      const person = current.people[current.selectedId];
      if (!person) return current;
      const sibling = createPerson({ name: 'New sibling' });
      const parentIds = getParentIds(current, person.id);
      const people = { ...current.people, [sibling.id]: sibling };

      parentIds.forEach((parentId) => {
        const parent = people[parentId];
        if (parent && !parent.children.includes(sibling.id)) people[parentId] = { ...parent, children: [...parent.children, sibling.id] };
      });

      return {
        ...current,
        people,
        roots: parentIds.length ? current.roots : [...current.roots, sibling.id],
        selectedId: sibling.id,
      };
    });
  };

  const addParent = () => {
    applyTreeChange((current) => {
      const person = current.people[current.selectedId];
      if (!person) return current;
      const parent = createPerson({ name: 'New parent', children: [person.id] });
      return {
        ...current,
        people: { ...current.people, [parent.id]: parent },
        roots: [...current.roots.filter((id) => id !== person.id), parent.id],
        selectedId: parent.id,
      };
    });
  };


  const addExistingParent = (parentId: string) => {
    applyTreeChange((current) => {
      const child = current.people[current.selectedId];
      const parent = current.people[parentId];
      if (!child || !parent || parent.id === child.id || parent.children.includes(child.id)) return current;

      return {
        ...current,
        people: {
          ...current.people,
          [parent.id]: { ...parent, children: [...parent.children, child.id] },
        },
        roots: current.roots.filter((id) => id !== child.id),
      };
    });
  };

  const removeParent = (parentId: string) => {
    applyTreeChange((current) => {
      const child = current.people[current.selectedId];
      const parent = current.people[parentId];
      if (!child || !parent) return current;

      return {
        ...current,
        people: {
          ...current.people,
          [parent.id]: { ...parent, children: parent.children.filter((childId) => childId !== child.id) },
        },
      };
    });
  };

  const addExistingPartner = (partnerId: string) => {
    applyTreeChange((current) => {
      const person = current.people[current.selectedId];
      const partner = current.people[partnerId];
      if (!person || !partner || person.id === partner.id || person.partners.includes(partner.id)) return current;

      return {
        ...current,
        people: {
          ...current.people,
          [person.id]: { ...person, partners: [...person.partners, partner.id] },
          [partner.id]: { ...partner, partners: [...partner.partners, person.id] },
        },
      };
    });
  };

  const removePartner = (partnerId: string) => {
    applyTreeChange((current) => {
      const person = current.people[current.selectedId];
      const partner = current.people[partnerId];
      if (!person || !partner) return current;

      return {
        ...current,
        people: {
          ...current.people,
          [person.id]: { ...person, partners: person.partners.filter((id) => id !== partner.id) },
          [partner.id]: { ...partner, partners: partner.partners.filter((id) => id !== person.id) },
        },
      };
    });
  };

  const addExistingChild = (childId: string) => {
    applyTreeChange((current) => {
      const person = current.people[current.selectedId];
      const child = current.people[childId];
      if (!person || !child || person.id === child.id || person.children.includes(child.id)) return current;

      return {
        ...current,
        people: {
          ...current.people,
          [person.id]: { ...person, children: [...person.children, child.id] },
        },
        roots: current.roots.filter((id) => id !== child.id),
      };
    });
  };

  const removeChild = (childId: string) => {
    applyTreeChange((current) => {
      const person = current.people[current.selectedId];
      if (!person) return current;

      return {
        ...current,
        people: {
          ...current.people,
          [person.id]: { ...person, children: person.children.filter((id) => id !== childId) },
        },
      };
    });
  };

  const deleteSelectedPerson = () => {
    applyTreeChange((current) => {
      const selectedId = current.selectedId;
      if (!selectedId || !current.people[selectedId]) return current;
      const people = { ...current.people };
      delete people[selectedId];
      Object.values(people).forEach((person) => {
        people[person.id] = {
          ...person,
          children: person.children.filter((childId) => childId !== selectedId),
          partners: person.partners.filter((partnerId) => partnerId !== selectedId),
        };
      });
      const nextIds = Object.keys(people);
      return {
        ...current,
        people,
        roots: current.roots.filter((rootId) => rootId !== selectedId),
        selectedId: nextIds[0] || '',
      };
    });
  };

  const exportPdf = () => {
    const treeElement = treeRef.current;
    const treeWidth = treeElement?.scrollWidth || 1;
    const treeHeight = treeElement?.scrollHeight || 1;
    const printableWidthIn = DEFAULT_PRINT_PAGE_WIDTH_IN - PDF_PAGE_MARGIN_IN * 2;
    const printableHeightIn = DEFAULT_PRINT_PAGE_HEIGHT_IN - PDF_PAGE_MARGIN_IN * 2;
    const printableWidth = printableWidthIn * 96;
    const printableHeight = printableHeightIn * 96;
    const printScale = Math.min(printableWidth / treeWidth, printableHeight / treeHeight);

    const printPageStyle = document.getElementById('dynamic-print-page-size') || document.createElement('style');
    printPageStyle.id = 'dynamic-print-page-size';
    printPageStyle.textContent = '@page { size: landscape; margin: ' + PDF_PAGE_MARGIN_IN + 'in; }';
    if (!printPageStyle.parentElement) document.head.appendChild(printPageStyle);

    document.documentElement.style.setProperty('--print-scale', printScale.toFixed(4));
    document.documentElement.style.setProperty('--print-tree-width', Math.ceil(treeWidth) + 'px');
    document.documentElement.style.setProperty('--print-tree-height', Math.ceil(treeHeight) + 'px');
    window.setTimeout(() => window.print(), 60);
  };

  useEffect(() => {
    const cleanup = () => {
      document.documentElement.style.removeProperty('--print-scale');
      document.documentElement.style.removeProperty('--print-tree-width');
      document.documentElement.style.removeProperty('--print-tree-height');
      document.getElementById('dynamic-print-page-size')?.remove();
    };
    window.addEventListener('afterprint', cleanup);
    return () => window.removeEventListener('afterprint', cleanup);
  }, []);


  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const personElement = (event.target as HTMLElement).closest<HTMLElement>('[data-person-id]');

    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
      moved: false,
      personId: personElement?.dataset.personId || '',
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.dataset.panning = 'true';
  };

  const panCanvas = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const currentPan = panRef.current;
    if (!viewport || viewport.dataset.panning !== 'true' || currentPan.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - currentPan.startX;
    const deltaY = event.clientY - currentPan.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) currentPan.moved = true;

    if (currentPan.moved) {
      event.preventDefault();
      setPan({ x: currentPan.originX + deltaX, y: currentPan.originY + deltaY });
    }
  };

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || panRef.current.pointerId !== event.pointerId) return;

    if (panRef.current.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    } else if (panRef.current.personId) {
      const personId = panRef.current.personId;
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      setTreeState((current) => (current.people[personId] ? { ...current, selectedId: personId } : current));
    }

    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    delete viewport.dataset.panning;
    panRef.current.pointerId = 0;
    panRef.current.personId = '';
  };

  const suppressClickAfterPan = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const clearSelectionOnCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-person-id]")) return;
    closeEditor();
  };

  const panWithWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
  };

  return (
    <main className={`grid h-screen overflow-hidden bg-parchment text-bark ${selectedPerson ? "lg:grid-cols-[minmax(0,1fr)_390px]" : "lg:grid-cols-[minmax(0,1fr)]"}`}>
      <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]" aria-label="Family tree workspace">
        <header className="border-b border-bark/10 bg-[#fffdf9]/90 px-4 py-3 backdrop-blur sm:px-7">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-black tracking-normal sm:text-3xl">Family Tree</h1>
              <p className="mt-1 text-sm leading-snug text-bark/65 sm:text-base">
                {peopleCount} {peopleCount === 1 ? 'person' : 'people'} in this tree.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTopBarOpen((value) => !value)}
              aria-expanded={topBarOpen}
              className="min-h-[38px] shrink-0 rounded-lg border border-bark/15 bg-[#fffefa] px-3 font-bold text-bark transition hover:-translate-y-0.5"
            >
              {topBarOpen ? 'Hide Controls' : 'Show Controls'}
            </button>
          </div>

          {topBarOpen ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(260px,1fr)_auto] lg:items-start">
              <p className="hidden max-w-2xl text-base leading-snug text-bark/65 sm:block">
                Recent generations sit at the top; roots grow downward.
              </p>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <ToggleSwitch active={isSimplified} label="Simplify Individual Cards" onClick={() => setIsSimplified((value) => !value)} />
                <SecondaryButton onClick={undoTreeChange} disabled={!history.length}>Undo</SecondaryButton>
                <SecondaryButton onClick={exportPdf}>Export PDF</SecondaryButton>
                <PrimaryButton onClick={addPerson}>Add Person</PrimaryButton>
                <SecondaryButton onClick={resetTree}>Reset</SecondaryButton>
                <div className="flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-bark/10 bg-white/70 p-2 shadow-sm">
                  <input
                    className="field-input h-[38px] w-40 py-1.5 text-sm sm:w-44"
                    value={treeName}
                    placeholder="Tree name"
                    onChange={(event) => setTreeName(event.target.value)}
                  />
                  <SecondaryButton onClick={saveCurrentTreeToDatabase}>Save Tree</SecondaryButton>
                  <select className="field-input h-[38px] w-40 py-1.5 text-sm sm:w-44" value={selectedSavedTreeId} onChange={(event) => setSelectedSavedTreeId(event.target.value)}>
                    <option value="">No saved trees</option>
                    {savedTrees.map((tree) => (
                      <option key={tree.id} value={tree.id}>
                        {tree.name}
                      </option>
                    ))}
                  </select>
                  <SecondaryButton onClick={openSavedTreeFromDatabase}>Open</SecondaryButton>
                  {databaseMessage ? <span className="basis-full px-1 text-xs font-bold text-bark/55">{databaseMessage}</span> : null}
                </div>
              </div>
            </div>
          ) : null}
        </header>

        <div
          ref={viewportRef}
          data-print-viewport="true"
          className="relative touch-none cursor-grab overflow-hidden overscroll-contain bg-[radial-gradient(circle_at_top_left,rgba(45,122,115,0.09),transparent_280px)] active:cursor-grabbing data-[panning=true]:select-none"
          onPointerDown={beginPan}
          onPointerMove={panCanvas}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onLostPointerCapture={endPan}
          onClickCapture={suppressClickAfterPan}
          onClick={clearSelectionOnCanvasClick}
          onWheel={panWithWheel}
        >
          <div
            ref={treeRef}
            data-print-tree="true"
            className="absolute left-1/2 top-0 min-w-max origin-top px-6 pb-9 pt-2"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) translateX(-50%) scale(${zoom})` }}
          >
              <ConnectionLayer connections={connections} size={svgSize} />
              <div className="relative z-10 grid gap-[74px]">
                {rows.map((row, rowIndex) => (
                  <div key={rowIndex} className={`grid grid-cols-[92px_minmax(0,1fr)] items-stretch gap-4 ${isSimplified ? 'min-h-[132px]' : 'min-h-[250px]'}`}>
                    <div className="flex justify-end pt-2">
                      <span className="h-fit rounded-lg border border-bark/10 bg-[#fffefa]/95 px-2.5 py-1.5 text-xs font-black uppercase tracking-wide text-bark/55 shadow-sm">
                        Generation {rowIndex + 1}
                      </span>
                    </div>
                    <section className={`flex items-stretch justify-center ${isSimplified ? 'gap-8' : 'gap-5'}`}>
                      {row.map((personId) => {
                        const person = treeState.people[personId];
                        return person ? (
                          <PersonCard key={person.id} person={person} selected={person.id === treeState.selectedId} simplified={isSimplified} onSelect={() => setTreeState((current) => ({ ...current, selectedId: person.id }))} />
                        ) : null;
                      })}
                    </section>
                  </div>
                ))}
              </div>
          </div>
        </div>
        <div className={`fixed bottom-6 ${selectedPerson ? 'right-6 lg:right-[414px]' : 'right-6'} z-40 grid gap-2`} aria-label="Map controls">
          <IconButton label="Zoom in" onClick={() => zoomAroundCenter(zoom + 0.1)}>+</IconButton>
          <IconButton label="Zoom out" onClick={() => zoomAroundCenter(zoom - 0.1)}>-</IconButton>
        </div>
      </section>

      {selectedPerson ? (
        <aside className="min-h-0 overflow-y-auto overscroll-contain border-l border-bark/10 bg-[#fffefa] p-6" aria-label="Selected individual editor">
          <EditorPanel
            person={selectedPerson}
            people={treeState.people}
            parentIds={getParentIds(treeState, selectedPerson.id)}
            onChange={updateSelectedPerson}
            onAddParent={addParent}
            onAddSibling={addSibling}
            onAddChild={addChild}
            onAddPartner={addPartner}
            onDelete={deleteSelectedPerson}
            onAddExistingParent={addExistingParent}
            onRemoveParent={removeParent}
            onAddExistingPartner={addExistingPartner}
            onRemovePartner={removePartner}
            onAddExistingChild={addExistingChild}
            onRemoveChild={removeChild}
            onClose={closeEditor}
          />
        </aside>
      ) : null}
    </main>
  );
}

function ConnectionLayer({ connections, size }: { connections: Connection[]; size: { width: number; height: number } }) {
  return (
    <svg className="pointer-events-none absolute inset-0 z-0 overflow-visible" aria-hidden="true" viewBox={`0 0 ${size.width} ${size.height}`} width={size.width} height={size.height}>
      <defs>
        <marker id="root-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 1 1 L 9 5 L 1 9 z" className="fill-[#9fb3aa]" />
        </marker>
      </defs>
      {connections.map((connection) => (
        <path
          key={connection.id}
          d={connection.d}
          markerStart={connection.kind === 'root' ? 'url(#root-arrow)' : undefined}
          className={connection.kind === 'root' ? 'fill-none stroke-[#9fb3aa] stroke-[2.5] [stroke-linecap:square] [stroke-linejoin:round]' : 'fill-none stroke-moss/85 stroke-[6] [stroke-linecap:round]'}
        />
      ))}
    </svg>
  );
}

function PersonCard({ person, selected, simplified, onSelect }: { person: Person; selected: boolean; simplified: boolean; onSelect: () => void }) {
  const selectPerson = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onSelect();
  };
  const selectedClasses = selected ? 'border-moss bg-[#f8fffd] shadow-[0_0_0_2px_rgba(45,122,115,0.14),0_14px_36px_rgba(34,43,39,0.1)]' : 'border-bark/10';

  if (simplified) {
    return (
      <button
        type="button"
        data-person-id={person.id}
        onClick={selectPerson}
        className={`grid w-[128px] justify-items-center gap-3 rounded-xl border bg-[#fffefa]/95 p-3 text-center shadow-card transition hover:-translate-y-0.5 ${selectedClasses}`}
      >
        <Portrait person={person} size="icon" placeholder="gray" />
        <span className="max-w-full text-sm font-black leading-tight text-bark">{person.name || 'Unnamed person'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-person-id={person.id}
      onClick={selectPerson}
      className={`grid min-h-[250px] w-[250px] content-start gap-3 rounded-xl border bg-[#fffefa] p-4 text-left shadow-card transition hover:-translate-y-0.5 ${selectedClasses}`}
    >
      <div className="flex items-start gap-3">
        <Portrait person={person} size="sm" />
        <span className="min-w-0">
          <span className="block break-words text-lg font-black leading-tight">{person.name || 'Unnamed person'}</span>
          <span className="mt-1 block text-sm leading-snug text-bark/65">{person.isAlive ? 'Living' : 'Deceased'}</span>
        </span>
      </div>

      <span className="grid gap-1 text-sm leading-snug text-bark/70">
        {person.sex ? <span><strong className="text-bark">Sex:</strong> {person.sex}</span> : null}
        <span><strong className="text-bark">Born:</strong> {formatDateForDisplay(person.birthDate) || 'Unknown'}</span>
        {!person.isAlive ? <span><strong className="text-bark">Died:</strong> {formatDateForDisplay(person.deathDate) || 'Unknown'}</span> : null}
        {person.occupation ? <span><strong className="text-bark">Occupation:</strong> {person.occupation}</span> : null}
        {person.birthPlace ? <span><strong className="text-bark">Place of birth:</strong> {person.birthPlace}</span> : null}
        {person.deathPlace ? <span><strong className="text-bark">{person.isAlive ? 'Current residence' : 'Place of death'}:</strong> {person.deathPlace}</span> : null}
        {person.description ? <span className="mt-1 line-clamp-4 text-bark/65">{person.description}</span> : null}
      </span>
    </button>
  );
}

function Portrait({ person, size, placeholder = 'initials' }: { person: Person; size: 'sm' | 'lg' | 'icon'; placeholder?: 'initials' | 'gray' }) {
  const sizeClass = size === 'lg' ? 'h-[76px] w-[76px]' : size === 'icon' ? 'h-20 w-20 rounded-2xl' : 'h-12 w-12';
  const crop = getPhotoCrop(person);

  if (person.photo) {
    return (
      <span data-photo-frame="true" className={`relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-leaf font-black text-moss ${sizeClass}`}>
        <CroppedPhoto src={person.photo} crop={crop} />
      </span>
    );
  }

  if (placeholder === 'gray') {
    return (
      <span className={`grid shrink-0 place-items-center overflow-hidden bg-zinc-200 text-zinc-500 ${sizeClass}`}>
        <svg viewBox="0 0 48 48" aria-hidden="true" className="h-11 w-11 fill-current">
          <path d="M24 24.5c5.1 0 9.2-4.1 9.2-9.2S29.1 6.1 24 6.1s-9.2 4.1-9.2 9.2 4.1 9.2 9.2 9.2Zm0 4.4c-8 0-14.8 4.3-17.1 10.4-.5 1.4.5 2.8 2 2.8h30.2c1.5 0 2.5-1.5 2-2.8C38.8 33.2 32 28.9 24 28.9Z" />
        </svg>
      </span>
    );
  }

  return <span className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-leaf font-black text-moss ${sizeClass}`}>{initials(person.name)}</span>;
}

function CroppedPhoto({ src, crop, draggable }: { src: string; crop: ReturnType<typeof getPhotoCrop>; draggable?: boolean }) {
  const [aspectRatio, setAspectRatio] = useState(1);
  const fitStyle = aspectRatio >= 1
    ? { width: '100%', height: 100 / aspectRatio + '%' }
    : { width: aspectRatio * 100 + '%', height: '100%' };

  return (
    <span
      className="absolute left-1/2 top-1/2 grid place-items-center"
      style={{
        ...fitStyle,
        transform: 'translate(-50%, -50%) translate(' + crop.x + '%, ' + crop.y + '%) scale(' + crop.zoom + ')',
      }}
    >
      <img
        src={src}
        alt=""
        className="h-full w-full select-none object-contain"
        draggable={draggable}
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalWidth && image.naturalHeight) setAspectRatio(image.naturalWidth / image.naturalHeight);
        }}
      />
    </span>
  );
}

function EditorPanel({
  person,
  people,
  parentIds,
  onChange,
  onAddParent,
  onAddSibling,
  onAddChild,
  onAddPartner,
  onDelete,
  onAddExistingParent,
  onRemoveParent,
  onAddExistingPartner,
  onRemovePartner,
  onAddExistingChild,
  onRemoveChild,
  onClose,
}: {
  person: Person;
  people: Record<string, Person>;
  parentIds: string[];
  onChange: <K extends keyof Person>(key: K, value: Person[K]) => void;
  onAddParent: () => void;
  onAddSibling: () => void;
  onAddChild: () => void;
  onAddPartner: () => void;
  onDelete: () => void;
  onAddExistingParent: (parentId: string) => void;
  onRemoveParent: (parentId: string) => void;
  onAddExistingPartner: (partnerId: string) => void;
  onRemovePartner: (partnerId: string) => void;
  onAddExistingChild: (childId: string) => void;
  onRemoveChild: (childId: string) => void;
  onClose: () => void;
}) {
  const [photoMessage, setPhotoMessage] = useState('');

  const updatePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setPhotoMessage('Please choose a standard image file.');
      return;
    }

    setPhotoMessage('Preparing photo...');
    try {
      const photo = await prepareProfilePhoto(file);
      onChange('photo', photo);
      onChange('photoCrop', DEFAULT_PHOTO_CROP);
      setPhotoMessage('Photo added.');
    } catch {
      setPhotoMessage('This photo could not be loaded. Try exporting it as JPG or PNG first.');
    }
  };

  const updatePhotoCrop = (crop: Person['photoCrop']) => {
    onChange('photoCrop', crop);
  };



  const allPeople = Object.values(people).sort((a, b) => a.name.localeCompare(b.name));
  const parentOptions = allPeople.filter((candidate) => candidate.id !== person.id && !parentIds.includes(candidate.id) && !person.children.includes(candidate.id));
  const partnerOptions = allPeople.filter((candidate) => candidate.id !== person.id && !person.partners.includes(candidate.id));
  const childOptions = allPeople.filter((candidate) => candidate.id !== person.id && !person.children.includes(candidate.id) && !parentIds.includes(candidate.id));

  return (
    <form className="grid gap-4" onSubmit={(event) => event.preventDefault()}>
      <div className="mb-1 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Portrait person={person} size="lg" />
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-moss">Editing</p>
            <h2 className="break-words text-2xl font-black leading-tight">{person.name || 'Unnamed person'}</h2>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close editor"
          aria-label="Close editor"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-bark/15 bg-[#fffefa] text-base font-black text-bark/65 transition hover:-translate-y-0.5 hover:border-moss/40 hover:text-bark"
        >
          X
        </button>
      </div>

      <Field label="Full name">
        <input className="field-input" value={person.name} autoComplete="name" onChange={(event) => onChange('name', event.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of birth">
          <input className="field-input" type="date" value={person.birthDate} onChange={(event) => onChange('birthDate', event.target.value)} />
        </Field>
        <Field label="Date of death">
          <input className="field-input" type="date" value={person.deathDate} disabled={person.isAlive} onChange={(event) => onChange('deathDate', event.target.value)} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm font-bold text-bark/90">
        <input className="h-[18px] w-[18px]" type="checkbox" checked={person.isAlive} onChange={(event) => onChange('isAlive', event.target.checked)} />
        Still alive
      </label>

      <Field label="Sex">
        <select className="field-input" value={person.sex || ''} onChange={(event) => onChange('sex', event.target.value)}>
          <option value="">Not specified</option>
          <option value="Female">Female</option>
          <option value="Male">Male</option>
          <option value="Intersex">Intersex</option>
          <option value="Other">Other</option>
        </select>
      </Field>

      <Field label="Occupation">
        <input className="field-input" value={person.occupation} placeholder="e.g. Teacher, farmer, engineer" onChange={(event) => onChange('occupation', event.target.value)} />
      </Field>

      <Field label="Place of birth">
        <input className="field-input" value={person.birthPlace} placeholder="Town, region, or country" onChange={(event) => onChange('birthPlace', event.target.value)} />
      </Field>

      <Field label={person.isAlive ? 'Current residence' : 'Place of death'}>
        <input className="field-input" value={person.deathPlace} placeholder={person.isAlive ? 'Where they live now' : 'Town, region, or country'} onChange={(event) => onChange('deathPlace', event.target.value)} />
      </Field>

      <Field label="Short description">
        <textarea className="field-input min-h-28 resize-y" value={person.description} placeholder="A few notes, memories, or biographical details" onChange={(event) => onChange('description', event.target.value)} />
      </Field>

      <Field label="Picture">
        <input className="field-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={updatePhoto} />
        {photoMessage ? <span className="text-xs font-bold text-bark/55">{photoMessage}</span> : null}
      </Field>

      {person.photo ? <PhotoCropEditor person={person} onChange={updatePhotoCrop} /> : null}

      <div className="grid grid-cols-2 gap-2">
        <PrimaryButton onClick={onAddParent}>Add Parent</PrimaryButton>
        <PrimaryButton onClick={onAddSibling}>Add Sibling</PrimaryButton>
        <PrimaryButton onClick={onAddChild}>Add Child</PrimaryButton>
        <PrimaryButton onClick={onAddPartner}>Add Partner</PrimaryButton>
      </div>

      <RelationshipEditor
        title="Parents"
        emptyText="No parents connected"
        selectLabel="Add existing parent"
        relatedIds={parentIds}
        options={parentOptions}
        people={people}
        onAdd={onAddExistingParent}
        onRemove={onRemoveParent}
      />
      <RelationshipEditor
        title="Partners"
        emptyText="No partners connected"
        selectLabel="Add existing partner"
        relatedIds={person.partners}
        options={partnerOptions}
        people={people}
        onAdd={onAddExistingPartner}
        onRemove={onRemovePartner}
      />
      <RelationshipEditor
        title="Children"
        emptyText="No children connected"
        selectLabel="Add existing child"
        relatedIds={person.children}
        options={childOptions}
        people={people}
        onAdd={onAddExistingChild}
        onRemove={onRemoveChild}
      />

      <button type="button" onClick={onDelete} className="min-h-[38px] rounded-lg border border-rose/30 bg-[#fff5f6] px-3 font-bold text-rose transition hover:-translate-y-0.5">
        Delete Person
      </button>
    </form>
  );
}


function RelationshipEditor({
  title,
  emptyText,
  selectLabel,
  relatedIds,
  options,
  people,
  onAdd,
  onRemove,
}: {
  title: string;
  emptyText: string;
  selectLabel: string;
  relatedIds: string[];
  options: Person[];
  people: Record<string, Person>;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="rounded-xl border border-bark/10 bg-bark/[0.03] p-3">
      <h3 className="text-sm font-black text-bark">{title}</h3>
      <div className="mt-2 grid gap-2">
        {relatedIds.filter((id) => people[id]).length ? (
          relatedIds.filter((id) => people[id]).map((id) => (
            <div key={id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm text-bark/75">
              <span className="font-bold text-bark">{people[id].name || 'Unnamed person'}</span>
              <button type="button" onClick={() => onRemove(id)} className="rounded-md border border-bark/10 px-2 py-1 text-xs font-bold text-bark/60 transition hover:border-rose/30 hover:text-rose">
                Remove
              </button>
            </div>
          ))
        ) : (
          <p className="rounded-lg bg-white px-3 py-2 text-sm text-bark/50">{emptyText}</p>
        )}
      </div>
      <label className="mt-3 grid gap-2 text-xs font-black uppercase text-bark/60">
        {selectLabel}
        <select
          className="field-input text-sm normal-case"
          value=""
          onChange={(event) => {
            if (!event.target.value) return;
            onAdd(event.target.value);
            event.target.value = '';
          }}
        >
          <option value="">Choose a person</option>
          {options.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name || 'Unnamed person'}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

const DEFAULT_PHOTO_CROP = { x: 0, y: 0, zoom: 1, mode: 'offset' as const };
const MAX_PHOTO_CROP_ZOOM = 5;
const PROFILE_PHOTO_MAX_SIZE = 1400;
const PROFILE_PHOTO_QUALITY = 0.84;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error('Could not decode image')));
    image.src = dataUrl;
  });
}

async function prepareProfilePhoto(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const largestSide = Math.max(image.naturalWidth, image.naturalHeight);

  if (!largestSide) throw new Error('Invalid image dimensions');
  if (largestSide <= PROFILE_PHOTO_MAX_SIZE && dataUrl.length < 750_000) return dataUrl;

  const scale = Math.min(1, PROFILE_PHOTO_MAX_SIZE / largestSide);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');

  context.fillStyle = '#f8f7f2';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', PROFILE_PHOTO_QUALITY);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getCropPanLimit(zoom: number) {
  return (Math.max(zoom, 1) - 1) * 50;
}

function clampCropAxis(value: number, zoom: number) {
  const limit = getCropPanLimit(zoom);
  return clamp(value, -limit, limit);
}

function getPhotoCrop(person: Person) {
  const crop = person.photoCrop;
  if (!crop) return DEFAULT_PHOTO_CROP;

  const zoom = clamp(crop.zoom || 1, 1, MAX_PHOTO_CROP_ZOOM);

  if (crop.mode === 'offset') {
    return {
      x: clampCropAxis(crop.x || 0, zoom),
      y: clampCropAxis(crop.y || 0, zoom),
      zoom,
      mode: 'offset' as const,
    };
  }

  return {
    x: clampCropAxis((crop.x ?? 50) - 50, zoom),
    y: clampCropAxis((crop.y ?? 50) - 50, zoom),
    zoom,
    mode: 'offset' as const,
  };
}

function PhotoCropEditor({ person, onChange }: { person: Person; onChange: (crop: Person['photoCrop']) => void }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({ pointerId: 0, startX: 0, startY: 0, originX: 0, originY: 0 });
  const crop = getPhotoCrop(person);

  const commitCrop = (nextCrop: Partial<typeof DEFAULT_PHOTO_CROP>) => {
    const nextZoom = clamp(nextCrop.zoom ?? crop.zoom, 1, MAX_PHOTO_CROP_ZOOM);
    onChange({
      x: clampCropAxis(nextCrop.x ?? crop.x, nextZoom),
      y: clampCropAxis(nextCrop.y ?? crop.y, nextZoom),
      zoom: nextZoom,
      mode: 'offset',
    });
  };

  const updateZoom = (nextZoom: number) => {
    const clampedZoom = clamp(nextZoom, 1, MAX_PHOTO_CROP_ZOOM);
    const previousLimit = getCropPanLimit(crop.zoom);
    const nextLimit = getCropPanLimit(clampedZoom);
    const scale = previousLimit > 0 ? nextLimit / previousLimit : 1;

    commitCrop({
      x: previousLimit > 0 ? crop.x * scale : crop.x,
      y: previousLimit > 0 ? crop.y * scale : crop.y,
      zoom: clampedZoom,
    });
  };

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const frame = frameRef.current;
    if (!frame) return;

    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: crop.x,
      originY: crop.y,
    };
    frame.setPointerCapture(event.pointerId);
  };

  const dragPhoto = (event: PointerEvent<HTMLDivElement>) => {
    const frame = frameRef.current;
    const drag = dragRef.current;
    if (!frame || drag.pointerId !== event.pointerId) return;

    const rect = frame.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.startX) / rect.width) * 100;
    const deltaY = ((event.clientY - drag.startY) / rect.height) * 100;
    commitCrop({ x: drag.originX + deltaX, y: drag.originY + deltaY });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const frame = frameRef.current;
    if (!frame || dragRef.current.pointerId !== event.pointerId) return;
    if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
    dragRef.current.pointerId = 0;
  };

  return (
    <section className="grid gap-3 rounded-xl border border-bark/10 bg-bark/[0.03] p-3">
      <div>
        <h3 className="text-sm font-black text-bark">Photo crop</h3>
        <p className="text-xs font-bold text-bark/55">Drag the photo to reposition it, then adjust zoom.</p>
      </div>
      <div
        ref={frameRef}
        data-photo-frame="true"
        className="relative mx-auto h-44 w-44 touch-none overflow-hidden rounded-2xl border border-moss/30 bg-white shadow-inner cursor-move"
        onPointerDown={beginDrag}
        onPointerMove={dragPhoto}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label="Drag to crop profile photo"
      >
        <CroppedPhoto src={person.photo} crop={crop} draggable={false} />
        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/70" />
      </div>
      <label className="grid gap-1.5 text-xs font-black uppercase text-bark/60">
        <span className="flex items-center justify-between gap-2">
          Zoom
          <span className="font-bold text-bark/45">{crop.zoom.toFixed(2)}x</span>
        </span>
        <input
          className="accent-moss"
          type="range"
          min={1}
          max={MAX_PHOTO_CROP_ZOOM}
          step={0.05}
          value={crop.zoom}
          onChange={(event) => updateZoom(Number(event.target.value))}
        />
      </label>
      <button type="button" onClick={() => onChange(DEFAULT_PHOTO_CROP)} className="min-h-[34px] rounded-lg border border-bark/15 bg-white px-3 text-sm font-bold text-bark transition hover:-translate-y-0.5">
        Reset Crop
      </button>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-black text-bark/90">
      {label}
      {children}
    </label>
  );
}

function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-[38px] rounded-lg border border-transparent bg-moss px-3 font-bold text-white transition hover:-translate-y-0.5">
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="min-h-[38px] rounded-lg border border-bark/15 bg-[#fffefa] px-3 font-bold text-bark transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0">
      {children}
    </button>
  );
}

function ToggleSwitch({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex min-h-[38px] items-center gap-2 rounded-lg border border-bark/15 bg-[#fffefa] px-3 font-bold text-bark transition hover:-translate-y-0.5"
    >
      <span className={`relative h-5 w-9 rounded-full transition ${active ? 'bg-moss' : 'bg-bark/20'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${active ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      <span>{label}</span>
      <span className="text-xs font-black uppercase text-bark/45">{active ? 'On' : 'Off'}</span>
    </button>
  );
}

function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="grid h-[38px] w-[38px] place-items-center rounded-lg border border-bark/15 bg-[#fffefa] text-xl font-black text-bark transition hover:-translate-y-0.5">
      {children}
    </button>
  );
}

type LayoutRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

function getRootPath(treeElement: HTMLElement, childId: string, parentId: string) {
  const childCard = treeElement.querySelector<HTMLElement>(`[data-person-id="${childId}"]`);
  const parentCard = treeElement.querySelector<HTMLElement>(`[data-person-id="${parentId}"]`);
  if (!childCard || !parentCard) return '';

  const child = getLayoutRect(childCard, treeElement);
  const parent = getLayoutRect(parentCard, treeElement);
  const startX = child.left + child.width / 2;
  const startY = child.bottom;
  const endX = parent.left + parent.width / 2;
  const endY = parent.top;
  const midY = startY + Math.max(28, (endY - startY) / 2);

  return `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;
}

function getPartnerPath(treeElement: HTMLElement, firstId: string, secondId: string) {
  const firstCard = treeElement.querySelector<HTMLElement>(`[data-person-id="${firstId}"]`);
  const secondCard = treeElement.querySelector<HTMLElement>(`[data-person-id="${secondId}"]`);
  if (!firstCard || !secondCard) return '';

  const first = getLayoutRect(firstCard, treeElement);
  const second = getLayoutRect(secondCard, treeElement);
  const y = first.top + first.height / 2;
  const startsOnLeft = first.left <= second.left;
  const startX = startsOnLeft ? first.right : first.left;
  const endX = startsOnLeft ? second.left : second.right;
  return `M ${startX} ${y} L ${endX} ${y}`;
}

function getLayoutRect(element: HTMLElement, root: HTMLElement): LayoutRect {
  let left = 0;
  let top = 0;
  let current: HTMLElement | null = element;

  while (current && current !== root) {
    left += current.offsetLeft;
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }

  return {
    top,
    right: left + element.offsetWidth,
    bottom: top + element.offsetHeight,
    left,
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
}

export default App;
