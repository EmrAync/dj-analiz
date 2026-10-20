import { useMemo, useState } from 'react';
import { CATEGORIES, DEPTS } from '../catalog/categories';
import { DOMAINS, DOMAIN_ORDER } from '../catalog/connectors';
import { EQUIPMENT } from '../catalog/equipment';
import { runChecks, type Issue } from '../engine/checks';
import { L } from '../i18n';
import { getDef } from '../model/project';
import type { CatId, Dept, Domain, EquipDef } from '../model/types';
import { addArea, deleteArea, duplicateArea, updateArea } from '../store/actions';
import { st, useStore, useT } from '../store/store';
import { Check, Icon, Section, Seg } from './kit';

export function LeftPanel() {
  const t = useT();
  const tab = useStore((s) => s.leftTab);
  const open = useStore((s) => s.leftOpen);
  const p = useStore((s) => s.project);
  const issues = runChecks(p);
  const nErr = issues.filter((i) => i.level === 'error').length;
  const nWarn = issues.filter((i) => i.level === 'warn').length;
  const tabs: { id: typeof tab; icon: string; label: string; badge?: JSX.Element | null }[] = [
    { id: 'library', icon: 'speaker', label: t('left.library') },
    { id: 'layers', icon: 'layers', label: t('left.layers') },
    { id: 'areas', icon: 'plan', label: t('left.areas') },
    { id: 'checks', icon: 'warning', label: t('left.checks'), badge: nErr ? <span className="badge">{nErr}</span> : nWarn ? <span className="badge warn">{nWarn}</span> : null },
  ];
  return (
    <aside className={'left' + (open ? '' : ' closed')} data-testid="left-panel">
      <div className="ptabs">
        {tabs.map((x) => (
          <button key={x.id} className={'ptab' + (tab === x.id ? ' on' : '')} onClick={() => st().set({ leftTab: x.id })} data-testid={'ltab-' + x.id}>
            <Icon name={x.icon} size={15} />
            <span>{x.label}</span>
            {x.badge}
          </button>
        ))}
      </div>
      <div className="pbody">
        {tab === 'library' ? <Library /> : tab === 'layers' ? <LayersTab /> : tab === 'areas' ? <AreasTab /> : <ChecksTab issues={issues} />}
      </div>
    </aside>
  );
}

// —————————— Kütüphane ——————————
function matches(def: EquipDef, q: string): boolean {
  if (!q) return true;
  const n = def.name;
  const hay = [typeof n === 'string' ? n : [n.tr, n.de, n.en].join(' '), def.brand, def.model, ...(def.tags || [])].join(' ').toLocaleLowerCase('tr');
  return q
    .toLocaleLowerCase('tr')
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

function Library() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const placing = useStore((s) => s.placing);
  const libDefs = useStore((s) => s.library.defs);
  const p = useStore((s) => s.project);
  const [q, setQ] = useState('');
  const [openCats, setOpenCats] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('sahnecad.cats') || '{"hoparlor":true,"sub":true}');
    } catch {
      return { hoparlor: true };
    }
  });
  const custom = useMemo(() => {
    const m = new Map<string, EquipDef>();
    for (const d of p.defs) m.set(d.id, d);
    for (const d of libDefs) if (!m.has(d.id)) m.set(d.id, d);
    return [...m.values()];
  }, [p.defs, libDefs]);
  const toggle = (c: string) => {
    const n = { ...openCats, [c]: !openCats[c] };
    setOpenCats(n);
    try {
      localStorage.setItem('sahnecad.cats', JSON.stringify(n));
    } catch {
      /* yok */
    }
  };
  const byCat = (c: CatId) => EQUIPMENT.filter((d) => d.cat === c && matches(d, q));
  const customHits = custom.filter((d) => matches(d, q));
  return (
    <div data-testid="library">
      <div className="search">
        <div className="field">
          <Icon name="search" size={15} color="var(--faint)" />
          <input placeholder={t('lib.search')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="lib-search" />
          {q ? (
            <button className="ibtn sm" onClick={() => setQ('')}>
              <Icon name="close" size={12} />
            </button>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button className="btn sm" onClick={() => st().set({ dialog: { kind: 'defEditor', data: {} } })} data-testid="new-def">
            <Icon name="plus" size={13} /> {t('lib.newDef')}
          </button>
          <span className="hint small" style={{ alignSelf: 'center' }}>
            {t('lib.hint')}
          </span>
        </div>
      </div>
      {customHits.length ? (
        <div className="cat">
          <button className="cat-head" onClick={() => toggle('_mine')}>
            <span className="cat-dot" style={{ background: '#0d9488' }}>
              <Icon name="user" size={14} />
            </span>
            {t('lib.mine')}
            <span className="count">{customHits.length}</span>
          </button>
          {openCats._mine !== false || q ? <LibGrid defs={customHits} lang={lang} placing={placing} custom /> : null}
        </div>
      ) : null}
      {CATEGORIES.map((c) => {
        const defs = byCat(c.id);
        if (!defs.length) return null;
        const isOpen = !!openCats[c.id] || !!q;
        return (
          <div className="cat" key={c.id}>
            <button className="cat-head" onClick={() => toggle(c.id)} data-testid={'cat-' + c.id}>
              <span className="cat-dot" style={{ background: c.color }}>
                <Icon name={c.icon} size={14} />
              </span>
              {L(c.name, lang)}
              <span className="count">{defs.length}</span>
            </button>
            {isOpen ? <LibGrid defs={defs} lang={lang} placing={placing} /> : null}
          </div>
        );
      })}
      <div className="hint small" style={{ padding: 10 }}>
        {t('lib.approx')}
      </div>
    </div>
  );
}

function LibGrid({ defs, lang, placing, custom }: { defs: EquipDef[]; lang: 'tr' | 'de' | 'en'; placing: string | null; custom?: boolean }) {
  const p = useStore((s) => s.project);
  const t = useT();
  return (
    <div className="lib-grid">
      {defs.map((d) => {
        const col = CATEGORIES.find((c) => c.id === d.cat)?.color || '#64748b';
        const imgId = p.defImages[d.id] || d.imageId;
        const img = imgId ? p.assets[imgId]?.data : undefined;
        const title = [d.brand, d.model].filter(Boolean).join(' ');
        return (
          <div
            key={d.id}
            className={'lib-item' + (placing === d.id ? ' on' : '')}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-sahnecad-def', d.id);
              e.dataTransfer.setData('text/plain', d.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => {
              const s = st();
              s.set({ placing: s.placing === d.id ? null : d.id, tool: 'select', cableDraft: null, view: s.view === 'plan' || s.view === '3d' ? s.view : 'plan' });
            }}
            title={`${L(d.name, lang)}${title ? ' — ' + title : ''}\n${t('lib.clickPlace')}`}
            data-testid={'lib-' + d.id}
          >
            {custom || d.custom ? <span className="tagc">{t('lib.custom')}</span> : null}
            {img ? <img className="ic" src={img} alt="" /> : (
              <span className="ic">
                <Icon name={d.icon} size={36} color={col} stroke={1.6} />
              </span>
            )}
            <span className="nm">{title || L(d.name, lang)}</span>
            {title ? <span className="sub">{L(d.name, lang)}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

// —————————— Katmanlar ——————————
const ROLE_PRESETS: { id: string; depts: Dept[] | 'all'; domains: Domain[] | 'all' }[] = [
  { id: 'all', depts: 'all', domains: 'all' },
  { id: 'sound', depts: ['ses', 'dj', 'enstruman', 'sahne', 'hazirlik'], domains: ['audio', 'speaker', 'digital', 'network', 'wireless', 'data'] },
  { id: 'power', depts: ['ses', 'dj', 'enstruman', 'isik', 'video', 'elektrik', 'ag', 'sahne', 'hazirlik'], domains: ['power'] },
  { id: 'light', depts: ['isik', 'elektrik', 'sahne', 'hazirlik'], domains: ['dmx', 'power', 'network', 'wireless'] },
  { id: 'video', depts: ['video', 'elektrik', 'sahne', 'hazirlik'], domains: ['video', 'network', 'power'] },
];

function LayersTab() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const layers = useStore((s) => s.layers);
  const heat = useStore((s) => s.heat);
  const settings = useStore((s) => s.project.settings);
  const set = (patch: Partial<typeof layers>) => st().set({ layers: { ...layers, ...patch } });
  const applyRole = (r: (typeof ROLE_PRESETS)[number]) => {
    const depts = Object.fromEntries(DEPTS.map((d) => [d.id, r.depts === 'all' || r.depts.includes(d.id)])) as Record<Dept, boolean>;
    const domains = Object.fromEntries(DOMAIN_ORDER.map((d) => [d, r.domains === 'all' || r.domains.includes(d)])) as Record<Domain, boolean>;
    set({ depts, domains, cables: true });
  };
  return (
    <div>
      <Section title={t('layers.roles')} id="l-roles">
        <div className="hint small" style={{ marginBottom: 6 }}>
          {t('layers.rolesHint')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ROLE_PRESETS.map((r) => (
            <button key={r.id} className="btn sm" onClick={() => applyRole(r)} data-testid={'role-' + r.id}>
              {t(('role.' + r.id) as 'role.all')}
            </button>
          ))}
        </div>
      </Section>
      <Section title={t('layers.domains')} id="l-dom">
        {DOMAIN_ORDER.map((d) => (
          <Check key={d} checked={layers.domains[d]} onChange={(v) => set({ domains: { ...layers.domains, [d]: v } })}>
            <span style={{ display: 'inline-block', width: 18, height: 3, background: DOMAINS[d].color, borderRadius: 2, verticalAlign: 'middle', marginRight: 6, borderTop: DOMAINS[d].dash ? '1px dashed #fff' : undefined }} />
            {L(DOMAINS[d].name, lang)}
          </Check>
        ))}
      </Section>
      <Section title={t('layers.depts')} id="l-dept">
        {DEPTS.map((d) => (
          <Check key={d.id} checked={layers.depts[d.id]} onChange={(v) => set({ depts: { ...layers.depts, [d.id]: v } })}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: d.color, borderRadius: 3, marginRight: 6 }} />
            {L(d.name, lang)}
          </Check>
        ))}
      </Section>
      <Section title={t('layers.show')} id="l-show">
        <Check checked={layers.labels} onChange={(v) => set({ labels: v })}>
          {t('layer.labels')}
        </Check>
        <Check checked={layers.cables} onChange={(v) => set({ cables: v })}>
          {t('layer.cables')}
        </Check>
        <Check checked={layers.cableTags} onChange={(v) => set({ cableTags: v })}>
          {t('layer.cableTags')}
        </Check>
        <Check checked={layers.zones} onChange={(v) => set({ zones: v })}>
          {t('layer.zones')}
        </Check>
        <Check checked={layers.notes} onChange={(v) => set({ notes: v })}>
          {t('layer.notes')}
        </Check>
        <Check checked={layers.grid} onChange={(v) => set({ grid: v })}>
          {t('layer.grid')}
        </Check>
        <Check checked={layers.dims} onChange={(v) => set({ dims: v })}>
          {t('layer.dims')}
        </Check>
        <Check checked={layers.bg} onChange={(v) => set({ bg: v })}>
          {t('layer.bg')}
        </Check>
        <Check checked={layers.room} onChange={(v) => set({ room: v })}>
          {t('layer.room')}
        </Check>
      </Section>
      <Section title={t('layers.acoustic')} id="l-ac">
        <Check checked={layers.coverage} onChange={(v) => set({ coverage: v })}>
          {t('layer.coverage')}
        </Check>
        <Check checked={layers.heatmap} onChange={(v) => set({ heatmap: v })}>
          {t('layer.heatmap')}
        </Check>
        <div style={{ marginTop: 6 }}>
          <Seg
            value={heat.band}
            options={[
              { v: 'mid', l: t('heat.mid') },
              { v: 'low', l: t('heat.low') },
            ]}
            onChange={(v) => st().set({ heat: { ...heat, band: v } })}
          />
        </div>
        {heat.band === 'low' ? (
          <>
            <div style={{ marginTop: 6 }}>
              <Seg
                value={heat.freq}
                options={[31.5, 40, 50, 63, 80, 100].map((f) => ({ v: f, l: String(f) }))}
                onChange={(v) => st().set({ heat: { ...heat, freq: v } })}
              />
            </div>
            <Check checked={heat.coherent} onChange={(v) => st().set({ heat: { ...heat, coherent: v } })}>
              {t('heat.coherent')}
            </Check>
          </>
        ) : null}
        <div className="hint small" style={{ marginTop: 6 }}>
          {t('heat.earH', { h: settings.earH })}
        </div>
      </Section>
    </div>
  );
}

// —————————— Bölümler ——————————
function AreasTab() {
  const t = useT();
  const p = useStore((s) => s.project);
  const areaId = useStore((s) => s.areaId);
  const cross = p.cables.filter((c) => {
    const a = p.items.find((i) => i.id === c.a.item);
    const b = p.items.find((i) => i.id === c.b.item);
    return a && b && a.areaId !== b.areaId;
  });
  return (
    <div>
      <div style={{ padding: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => addArea(t('area.newName', { n: p.areas.length + 1 }))} data-testid="add-area">
          <Icon name="plus" size={13} /> {t('area.add')}
        </button>
      </div>
      <div className="hint small" style={{ padding: '0 10px 8px' }}>
        {t('area.hint')}
      </div>
      {p.areas.map((a) => {
        const n = p.items.filter((i) => i.areaId === a.id).length;
        const on = a.id === areaId;
        return (
          <div key={a.id} style={{ borderTop: '1px solid var(--line)', padding: '8px 10px', background: on ? 'var(--accent-soft)' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="ibtn sm" onClick={() => st().set({ areaId: a.id, sel: { items: [], cables: [], zones: [], notes: [] } })} title={t('area.open')}>
                <Icon name={a.indoor ? 'house' : 'tree'} size={15} color={on ? 'var(--accent)' : undefined} />
              </button>
              <input className="inp" value={a.name} onChange={(e) => updateArea(a.id, { name: e.target.value })} style={{ height: 28, fontWeight: on ? 700 : 500 }} />
              <button className="ibtn sm" title={t('area.settings')} onClick={() => st().set({ dialog: { kind: 'area', data: { id: a.id } } })}>
                <Icon name="gear" size={14} />
              </button>
              <button className="ibtn sm" title={t('area.duplicate')} onClick={() => duplicateArea(a.id, t('area.copy'))}>
                <Icon name="copy" size={14} />
              </button>
              {p.areas.length > 1 ? (
                <button
                  className="ibtn sm danger"
                  title={t('area.delete')}
                  onClick={() => {
                    if (confirm(t('area.confirmDelete', { a: a.name, n }))) deleteArea(a.id);
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              ) : null}
            </div>
            <div className="hint small" style={{ marginTop: 4, paddingLeft: 30 }}>
              {a.w} × {a.d} × {a.h} m · {n} {t('area.items')} · {a.indoor ? t('area.indoor') : t('area.outdoor')}
            </div>
          </div>
        );
      })}
      {cross.length ? (
        <Section title={t('area.cross', { n: cross.length })} id="l-cross">
          {cross.map((c) => {
            const a = p.items.find((i) => i.id === c.a.item)!;
            const b = p.items.find((i) => i.id === c.b.item)!;
            return (
              <div key={c.id} className="port" style={{ gridTemplateColumns: '1fr', cursor: 'pointer' }} onClick={() => st().select({ cables: [c.id] })}>
                <span>
                  <b>{c.label}</b> {a.label} ({p.areas.find((x) => x.id === a.areaId)?.name}) → {b.label} ({p.areas.find((x) => x.id === b.areaId)?.name})
                </span>
              </div>
            );
          })}
        </Section>
      ) : null}
    </div>
  );
}

// —————————— Kontroller ——————————
function ChecksTab({ issues }: { issues: Issue[] }) {
  const t = useT();
  const p = useStore((s) => s.project);
  const [lv, setLv] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const list = issues.filter((i) => lv === 'all' || i.level === lv);
  if (!issues.length)
    return (
      <div className="empty">
        <Icon name="ok" size={36} color="var(--ok)" />
        <b>{t('checks.allGood')}</b>
        <span className="hint">{t('checks.allGoodHint')}</span>
      </div>
    );
  return (
    <div data-testid="checks">
      <div style={{ padding: 8, position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1, borderBottom: '1px solid var(--line)' }}>
        <Seg
          value={lv}
          options={[
            { v: 'all', l: `${t('checks.all')} ${issues.length}` },
            { v: 'error', l: `${t('checks.err')} ${issues.filter((i) => i.level === 'error').length}` },
            { v: 'warn', l: `${t('checks.warn')} ${issues.filter((i) => i.level === 'warn').length}` },
            { v: 'info', l: `${t('checks.info')} ${issues.filter((i) => i.level === 'info').length}` },
          ]}
          onChange={setLv}
        />
      </div>
      {list.map((i) => (
        <div
          key={i.id}
          className={'issue ' + i.level}
          onClick={() => {
            const s = st();
            const firstItem = i.items?.[0] ? p.items.find((x) => x.id === i.items![0]) : undefined;
            const firstCable = i.cables?.[0] ? p.cables.find((x) => x.id === i.cables![0]) : undefined;
            const anchor = firstItem || (firstCable ? p.items.find((x) => x.id === firstCable.a.item) : undefined);
            const areaId = anchor?.areaId || i.areaId || s.areaId;
            s.set({ areaId, sel: { items: i.items || [], cables: i.cables || [], zones: [], notes: [] }, view: s.view === 'plan' || s.view === '3d' || s.view === 'schema' ? s.view : 'plan' });
            if (anchor) s.set({ focus: { x: anchor.x, y: anchor.y, at: Date.now() } });
          }}
        >
          <span className="ic">
            <Icon name={i.level === 'error' ? 'error' : i.level === 'warn' ? 'warning' : 'info'} size={16} />
          </span>
          <span>{t(i.code as 'chk.overload', i.vars)}</span>
        </div>
      ))}
    </div>
  );
}

export function defName(p: ReturnType<typeof st>['project'], id: string, lang: 'tr' | 'de' | 'en'): string {
  const d = getDef(p, id);
  return [d.brand, d.model].filter(Boolean).join(' ') || L(d.name, lang);
}
