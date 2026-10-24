// Alternatif planlar paneli: elektrik girişi A/B/C — hangisi ne zaman, zincir, "bunu kullan"
import { useState } from 'react';
import { cableType } from '../catalog/connectors';
import { chainParts } from '../engine/setup';
import { findEntry, isEntryGear } from '../engine/powerAlt';
import type { TFn } from '../i18n';
import { getDef, portsOf } from '../model/project';
import type { Cable, Item, Project, VariantGroup } from '../model/types';
import { copyVariant, deleteVariant, dissolveGroup, editVariant, makePowerAlternatives, moveVariant, renameGroup, updateVariant, useVariant } from '../store/variantActions';
import { st, useStore, useT } from '../store/store';
import { Icon, Section } from './kit';

// Seçili öğe/kablonun bağlı olduğu alternatif grubu (sistem girişi seçiliyse onu besleyen grup)
export function groupFor(p: Project, sel: { item?: Item; cable?: Cable }): VariantGroup | undefined {
  const vid = sel.item?.variant || sel.cable?.variant || (sel.item ? p.cables.find((c) => c.variant && c.b.item === sel.item!.id)?.variant : undefined);
  if (!vid) return undefined;
  return p.variants?.find((g) => g.variants.some((v) => v.id === vid));
}

export function VariantSection({ item, cable }: { item?: Item; cable?: Cable }) {
  const t = useT();
  const p = useStore((s) => s.project);
  const installer = useStore((s) => s.installer);
  const g = groupFor(p, { item, cable });
  if (g) return <VariantGroupPanel g={g} />;
  if (installer) return null;
  // elektrik parçası/kablosu: A/B/C kur önerisi
  const isPowerCable = cable && cableType(cable.type).domain === 'power';
  // sadece elektrik parçalarında (priz, adaptör, dağıtıcı, grup priz) — hoparlör vb. değil
  const powerItem = item && (isEntryGear(p, item) || (getDef(p, item.defId).cat === 'elektrik' && portsOf(getDef(p, item.defId)).some((x) => x.group.domain === 'power' && x.group.dir === 'in')));
  if (!isPowerCable && !powerItem) return null;
  const start = item ? item.id : cable!.b.item;
  const entry = findEntry(p, start);
  if (!entry) return null;
  return (
    <Section key={start} title={t('var.offerTitle')} id="i-var-offer">
      <p className="hint" style={{ marginTop: 0 }}>
        {t('var.offerHint', { l: entry.label })}
      </p>
      <div className="var-chain" style={{ marginBottom: 8 }}>
        <span className="var-node">32 A</span>
        <span className="var-arrow">/</span>
        <span className="var-node">16 A</span>
        <span className="var-arrow">/</span>
        <span className="var-node">Schuko</span>
        <span className="var-arrow">→</span>
        <span className="var-node">PRCD-S+</span>
        <span className="var-arrow">→</span>
        <span className="var-node sys">{entry.label}</span>
      </div>
      <button className="btn primary" onClick={() => makePowerAlternatives(item ? { item: item.id } : { cable: cable!.id })} data-testid="make-alts">
        <Icon name="bolt" size={15} /> {t('var.make')}
      </button>
    </Section>
  );
}

export function VariantGroupPanel({ g, compact }: { g: VariantGroup; compact?: boolean }) {
  const t = useT();
  const installer = useStore((s) => s.installer);
  const editing = useStore((s) => s.editVariant);
  const [edit, setEdit] = useState<string | null>(null);
  return (
    <Section
      title={
        <>
          <Icon name="bolt" size={14} /> {g.name}
        </>
      }
      id="i-var"
    >
      {!compact ? <p className="hint" style={{ marginTop: 0 }}>{t('var.hint')}</p> : null}
      <div className="var-list" data-testid="variant-list">
        {g.variants.map((v, i) => (
          <VariantCard key={v.id} g={g} vid={v.id} first={i === 0} last={i === g.variants.length - 1} t={t} installer={installer} drawing={editing === v.id} edit={edit === v.id} setEdit={(on) => setEdit(on ? v.id : null)} />
        ))}
      </div>
      {!installer && !compact ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <input className="inp" style={{ flex: 1, minWidth: 140 }} value={g.name} onChange={(e) => renameGroup(g.id, e.target.value)} aria-label={t('var.groupName')} />
          <button className="btn sm ghost" onClick={() => confirm(t('var.dissolveQ')) && dissolveGroup(g.id)} title={t('var.dissolve')}>
            <Icon name="trash" size={13} /> {t('var.dissolve')}
          </button>
        </div>
      ) : null}
    </Section>
  );
}

function VariantCard({ g, vid, first, last, t, installer, drawing, edit, setEdit }: { g: VariantGroup; vid: string; first: boolean; last: boolean; t: TFn; installer: boolean; drawing: boolean; edit: boolean; setEdit: (on: boolean) => void }) {
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const v = g.variants.find((x) => x.id === vid)!;
  const on = g.active === vid;
  const parts = chainParts(p, vid, lang, t);
  return (
    <div className={'var-card' + (on ? ' on' : '')} data-testid={'variant-' + v.label}>
      <div className="var-head">
        <span className="var-letter">{v.label}</span>
        <b className="var-name">{v.name || t('var.unnamed')}</b>
        {on ? <span className="chip ok">{t('var.active')}</span> : <button className="btn sm" onClick={() => useVariant(vid)} data-testid={'use-' + v.label}>{t('var.use')}</button>}
      </div>
      {edit ? (
        <div style={{ display: 'grid', gap: 4, margin: '6px 0' }}>
          <input className="inp" value={v.name} placeholder={t('var.namePh')} onChange={(e) => updateVariant(vid, { name: e.target.value })} />
          <input className="inp" value={v.when} placeholder={t('var.whenPh')} onChange={(e) => updateVariant(vid, { when: e.target.value })} />
        </div>
      ) : v.when ? (
        <div className="var-when">
          {first ? t('var.firstChoice') : t('var.ifNot')} {v.when}
        </div>
      ) : null}
      <div className="var-chain">
        {parts.length ? (
          parts.map((x, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i ? <span className="var-arrow">→</span> : null}
              <span className={'var-node ' + x.kind + (i === parts.length - 1 && x.kind === 'item' ? ' sys' : '')} onClick={() => (x.kind === 'item' ? st().select({ items: [x.id] }) : st().select({ cables: [x.id] }))}>
                {x.text}
              </span>
            </span>
          ))
        ) : (
          <span className="hint">{t('var.empty')}</span>
        )}
      </div>
      {!installer ? (
        <div className="var-tools">
          <button className={'ibtn sm' + (drawing ? ' on' : '')} onClick={() => editVariant(drawing ? null : vid)} title={t('var.draw')}>
            <Icon name="pencil" size={13} /> {drawing ? t('var.drawing') : t('var.draw')}
          </button>
          <button className={'ibtn sm' + (edit ? ' on' : '')} onClick={() => setEdit(!edit)} title={t('var.rename')}>
            <Icon name="text" size={13} />
          </button>
          <button className="ibtn sm" onClick={() => copyVariant(vid)} title={t('var.copy')}>
            <Icon name="copy" size={13} />
          </button>
          <button className="ibtn sm" disabled={first} onClick={() => moveVariant(vid, -1)} title={t('var.up')}>
            ↑
          </button>
          <button className="ibtn sm" disabled={last} onClick={() => moveVariant(vid, 1)} title={t('var.down')}>
            ↓
          </button>
          <span className="spacer" />
          <button className="ibtn sm danger" onClick={() => confirm(t('var.deleteQ', { v: v.label })) && deleteVariant(vid)} title={t('act.delete')}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Kurulum talimatında: A/B/C seçenekleri (işçi uyanı seçer)
export function AltChoices({ gid }: { gid: string }) {
  const t = useT();
  const g = useStore((s) => s.project.variants?.find((x) => x.id === gid));
  if (!g) return null;
  return (
    <div className="var-list no-print" style={{ margin: '6px 0' }}>
      {g.variants.map((v, i) => (
        <VariantCard key={v.id} g={g} vid={v.id} first={i === 0} last={i === g.variants.length - 1} t={t} installer drawing={false} edit={false} setEdit={() => undefined} />
      ))}
    </div>
  );
}

// Çizim modu şeridi: "B planını çiziyorsun"
export function VariantBanner() {
  const t = useT();
  const p = useStore((s) => s.project);
  const ev = useStore((s) => s.editVariant);
  if (!ev) return null;
  const g = p.variants?.find((x) => x.variants.some((v) => v.id === ev));
  const v = g?.variants.find((x) => x.id === ev);
  if (!g || !v) return null;
  return (
    <div className="var-banner no-print" data-testid="variant-banner">
      <span className="var-letter">{v.label}</span>
      <span>{t('var.banner', { v: v.label, g: g.name })}</span>
      <button className="btn sm primary" onClick={() => editVariant(null)}>
        {t('var.done')}
      </button>
    </div>
  );
}
