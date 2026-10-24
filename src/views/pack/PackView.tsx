// Paketleme: hangi malzeme hangi çantada — giderken yükle, dönüşte geri topla
import { useMemo, useState } from 'react';
import { caseProgress, lineKey, lineName, packingNeeds, type PackNeed } from '../../engine/packing';
import type { TFn } from '../../i18n';
import type { CaseDef, CaseLine, Project } from '../../model/types';
import { pickFile } from '../../store/persist';
import {
  addCase,
  addCaseFromTpl,
  addLine,
  deleteCase,
  deleteCaseTpl,
  moveLine,
  removeLine,
  resetPacking,
  saveCaseTpl,
  setCaseAll,
  setCaseImage,
  setPacked,
  suggestPacking,
  updateCase,
  updateLine,
  type PackMode,
} from '../../store/packActions';
import { st, useStore, useT } from '../../store/store';
import { Icon, Menu, Seg } from '../../ui/kit';
import { PrintHeader } from '../lists/ListsView';

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#64748b', '#111827'];

export function PackView() {
  const open = useStore((s) => s.packCase);
  const exists = useStore((s) => !!s.project.cases?.some((c) => c.id === s.packCase));
  return <div className="page pack" data-testid="pack-view">{open && exists ? <CasePage id={open} /> : <PackHome />}</div>;
}

function ModeSeg() {
  const t = useT();
  const mode = useStore((s) => s.packMode);
  return (
    <Seg
      value={mode}
      options={[
        { v: 'out', l: t('pack.modeOut') },
        { v: 'back', l: t('pack.modeBack') },
      ]}
      onChange={(v) => st().set({ packMode: v })}
    />
  );
}

function Bar({ v, total, color }: { v: number; total: number; color?: string }) {
  const pct = total ? Math.round((v / total) * 100) : 0;
  return (
    <div className="pk-bar" title={`${v}/${total}`}>
      <span style={{ width: pct + '%', background: pct >= 100 ? 'var(--ok)' : color || 'var(--accent)' }} />
    </div>
  );
}

function PackHome() {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const mode = useStore((s) => s.packMode);
  const installer = useStore((s) => s.installer);
  const tpls = useStore((s) => s.library.cases);
  const cases = p.cases || [];
  const needs = useMemo(() => packingNeeds(p, t, lang), [p, t, lang]);
  const missing = needs.filter((n) => n.need > n.packed);
  const prog = cases.map((c) => caseProgress(p, c));
  const total = prog.reduce((s, x) => s + x.total, 0);
  const done = prog.reduce((s, x) => s + (mode === 'out' ? x.out : x.back), 0);
  const newCase = () => {
    const id = addCase(t('pack.newName', { n: cases.length + 1 }));
    st().set({ packCase: id });
  };
  return (
    <div className="page-inner">
      <div className="page-head">
        <h1>{t('view.pack')}</h1>
        <div className="no-print">
          <ModeSeg />
        </div>
        {!installer ? (
          <>
            <button className="btn no-print primary" onClick={newCase} data-testid="pack-new">
              <Icon name="plus" size={15} /> {t('pack.new')}
            </button>
            <Menu
              button={(_, toggle) => (
                <button className="btn no-print" onClick={toggle} data-testid="pack-lib">
                  <Icon name="folder" size={15} /> {t('pack.fromLib')}
                </button>
              )}
            >
              {(close) => (
                <div>
                  {!tpls.length ? <div className="hint small" style={{ padding: 10 }}>{t('pack.libEmpty')}</div> : null}
                  {tpls.map((c) => (
                    <div key={c.id} className="pk-tpl">
                      <span className="pk-dot" style={{ background: c.color }} />
                      <button
                        className="btn ghost sm"
                        style={{ flex: 1, justifyContent: 'flex-start' }}
                        onClick={() => {
                          addCaseFromTpl(c);
                          close();
                        }}
                      >
                        {c.name} <span className="hint">· {c.lines.length}</span>
                      </button>
                      <button className="ibtn sm danger" title={t('act.delete')} onClick={() => confirm(t('pack.tplDeleteQ', { n: c.name })) && deleteCaseTpl(c.id)}>
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Menu>
          </>
        ) : null}
        <button className="btn no-print" onClick={() => window.print()}>
          <Icon name="print" size={15} /> {t('lists.print')}
        </button>
      </div>
      <PrintHeader />
      <div className="grid-3 no-print" style={{ marginBottom: 12 }}>
        <div className="stat">
          <span className="l">{t('pack.cases')}</span>
          <span className="v">{cases.length}</span>
        </div>
        <div className="stat">
          <span className="l">{mode === 'out' ? t('pack.loaded') : t('pack.returned')}</span>
          <span className="v">
            {done}/{total}
          </span>
          <Bar v={done} total={total} />
        </div>
        <div className="stat">
          <span className="l">{t('pack.notInCase')}</span>
          <span className="v" style={{ color: missing.length ? 'var(--warn)' : 'var(--ok)' }}>{missing.length ? missing.reduce((s, n) => s + n.need - n.packed, 0) : '✓'}</span>
        </div>
      </div>
      {!cases.length ? (
        <div className="panel panel-b empty-card no-print">
          <Icon name="bag" size={40} color="var(--faint)" />
          <p>{t('pack.emptyHint')}</p>
          {!installer ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => st().notify(t('pack.suggested', { n: suggestPacking() }))} data-testid="pack-suggest">
                <Icon name="magic" size={15} /> {t('pack.suggest')}
              </button>
              <button className="btn" onClick={newCase}>
                <Icon name="plus" size={15} /> {t('pack.new')}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="pk-grid no-print">
          {cases.map((c, i) => (
            <button key={c.id} className="pk-card" style={{ ['--c' as string]: c.color }} onClick={() => st().set({ packCase: c.id })} data-testid="pack-card">
              <div className="pk-photo">{c.image ? <img src={c.image} alt="" /> : <Icon name="bag" size={34} color={c.color} />}</div>
              <div className="pk-body">
                <b>{c.name}</b>
                {c.desc ? <span className="pk-desc">{c.desc}</span> : null}
                <span className="hint small">
                  {t('pack.items', { n: prog[i].total })} · {mode === 'out' ? prog[i].out : prog[i].back}/{prog[i].total}
                </span>
                <Bar v={mode === 'out' ? prog[i].out : prog[i].back} total={prog[i].total} color={c.color} />
              </div>
              <Icon name="chevron" size={16} color="var(--faint)" />
            </button>
          ))}
        </div>
      )}
      {missing.length && cases.length && !installer ? (
        <div className="panel no-print" style={{ marginTop: 14 }}>
          <div className="panel-h">
            <Icon name="warning" size={16} color="var(--warn)" />
            <span style={{ flex: 1 }}>{t('pack.missingTitle')}</span>
            <button className="btn sm" onClick={() => st().notify(t('pack.suggested', { n: suggestPacking() }))} data-testid="pack-suggest">
              <Icon name="magic" size={13} /> {t('pack.suggest')}
            </button>
          </div>
          <div className="panel-b" style={{ padding: 0 }}>
            {missing.map((n) => (
              <MissingRow key={n.key} n={n} cases={cases} t={t} />
            ))}
          </div>
        </div>
      ) : null}
      {cases.length && !installer ? (
        <div className="no-print" style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm ghost" onClick={() => confirm(t('pack.resetQ')) && resetPacking(mode)}>
            <Icon name="undo" size={13} /> {mode === 'out' ? t('pack.resetOut') : t('pack.resetBack')}
          </button>
        </div>
      ) : null}
      {/* yazdırma: tüm çantalar */}
      <div className="print-only">
        {cases.map((c) => (
          <CasePrint key={c.id} c={c} p={p} t={t} />
        ))}
      </div>
    </div>
  );
}

function MissingRow({ n, cases, t }: { n: PackNeed; cases: CaseDef[]; t: TFn }) {
  return (
    <div className="pk-miss">
      <span className="pk-qty">{n.need - n.packed}×</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {n.name}
        {n.packed ? <span className="hint small"> · {t('pack.partly', { a: n.packed, b: n.need })}</span> : null}
      </span>
      <select
        className="inp"
        style={{ width: 'auto', maxWidth: 170 }}
        value=""
        onChange={(e) => e.target.value && addLine(e.target.value, { kind: n.kind, ref: n.ref, qty: n.need - n.packed, name: n.name })}
        aria-label={t('pack.toCase')}
      >
        <option value="">{t('pack.toCase')}</option>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function CasePage({ id }: { id: string }) {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const mode = useStore((s) => s.packMode);
  const installer = useStore((s) => s.installer);
  const c = p.cases!.find((x) => x.id === id)!;
  const [edit, setEdit] = useState(!c.lines.length && !installer);
  const prog = caseProgress(p, c);
  const doneN = mode === 'out' ? prog.out : prog.back;
  const back = () => st().set({ packCase: null });
  return (
    <div className="page-inner pk-case" style={{ ['--c' as string]: c.color }}>
      <div className="pk-top no-print">
        <button className="btn ghost" onClick={back} data-testid="pack-back">
          <Icon name="arrowback" size={16} /> {t('pack.allCases')}
        </button>
        <span className="spacer" />
        <ModeSeg />
        {!installer ? (
          <button className={'btn' + (edit ? ' primary' : '')} onClick={() => setEdit(!edit)} data-testid="pack-edit">
            <Icon name="pencil" size={15} /> {edit ? t('var.done') : t('pack.edit')}
          </button>
        ) : null}
      </div>
      <div className="pk-head">
        <button className="pk-photo big" onClick={async () => !installer && edit && (await pickFile('image/*').then((f) => f && setCaseImage(c.id, f)))} title={edit ? t('pack.photo') : undefined}>
          {c.image ? <img src={c.image} alt="" /> : <Icon name={edit ? 'camera2' : 'bag'} size={40} color={c.color} />}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          {edit ? (
            <>
              <input className="inp pk-name" value={c.name} onChange={(e) => updateCase(c.id, { name: e.target.value })} data-testid="case-name" />
              <textarea className="inp" rows={2} value={c.desc} placeholder={t('pack.descPh')} onChange={(e) => updateCase(c.id, { desc: e.target.value })} style={{ marginTop: 6, height: 'auto' }} />
              <div className="pk-colors">
                {COLORS.map((col) => (
                  <button key={col} className={'pk-dot big' + (c.color === col ? ' on' : '')} style={{ background: col }} onClick={() => updateCase(c.id, { color: col })} aria-label={col} />
                ))}
              </div>
            </>
          ) : (
            <>
              <h1 className="pk-title">{c.name}</h1>
              {c.desc ? <p className="pk-desc2">{c.desc}</p> : null}
            </>
          )}
        </div>
      </div>
      <div className="pk-progress no-print">
        <b>
          {doneN}/{prog.total}
        </b>
        <span>{mode === 'out' ? t('pack.loaded') : t('pack.returned')}</span>
        <Bar v={doneN} total={prog.total} color={c.color} />
        <button className="btn sm" onClick={() => setCaseAll(c.id, mode, doneN < prog.total)}>
          {doneN < prog.total ? t('pack.all') : t('pack.none')}
        </button>
      </div>
      <div className="pk-lines no-print" data-testid="case-lines">
        {c.lines.map((l) => (
          <LineRow key={l.id} c={c} l={l} p={p} mode={mode} edit={edit} t={t} lang={lang} />
        ))}
        {!c.lines.length ? <div className="hint" style={{ padding: 14 }}>{t('pack.noLines')}</div> : null}
      </div>
      {edit ? <AddLine c={c} t={t} /> : null}
      {doneN >= prog.total && prog.total > 0 ? <div className="pk-done no-print">✓ {mode === 'out' ? t('pack.doneOut') : t('pack.doneBack')}</div> : null}
      {!installer ? (
        <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button className="btn" onClick={() => saveCaseTpl(c.id).then(() => st().notify(t('pack.tplSaved')))} data-testid="case-save-tpl">
            <Icon name="save" size={15} /> {t('pack.saveTpl')}
          </button>
          <button className="btn" onClick={() => window.print()}>
            <Icon name="print" size={15} /> {t('pack.printLabel')}
          </button>
          <span className="spacer" />
          <button
            className="btn danger"
            onClick={() => {
              if (confirm(t('pack.deleteQ', { n: c.name }))) {
                back();
                deleteCase(c.id);
              }
            }}
          >
            <Icon name="trash" size={15} /> {t('act.delete')}
          </button>
        </div>
      ) : null}
      <div className="print-only">
        <CasePrint c={c} p={p} t={t} />
      </div>
    </div>
  );
}

function LineRow({ c, l, p, mode, edit, t, lang }: { c: CaseDef; l: CaseLine; p: Project; mode: PackMode; edit: boolean; t: TFn; lang: 'tr' | 'de' | 'en' }) {
  const n = Math.min(l.qty, p.packing?.[c.id + ':' + l.id]?.[mode] || 0);
  const full = n >= l.qty;
  const tap = () => setPacked(c.id, l.id, mode, full ? 0 : l.qty > 1 ? n + 1 : 1);
  const others = (p.cases || []).filter((x) => x.id !== c.id);
  return (
    <div className={'pk-line' + (full ? ' done' : n ? ' part' : '')} data-testid="case-line">
      <button className="pk-check" onClick={tap} aria-label={lineName(p, l, lang)}>
        {full ? <Icon name="ok" size={20} color="#fff" /> : n ? <b>{n}</b> : null}
      </button>
      <div className="pk-ltext" onClick={edit ? undefined : tap}>
        <span className="pk-lname">{lineName(p, l, lang)}</span>
        {l.note && !edit ? <span className="hint small">{l.note}</span> : null}
        {edit ? <input className="inp" value={l.note || ''} placeholder={t('pack.notePh')} onChange={(e) => updateLine(c.id, l.id, { note: e.target.value })} style={{ height: 26, marginTop: 4 }} /> : null}
      </div>
      {edit ? (
        <>
          <div className="pk-stepper">
            <button className="ibtn sm" onClick={() => (l.qty > 1 ? updateLine(c.id, l.id, { qty: l.qty - 1 }) : removeLine(c.id, l.id))}>
              −
            </button>
            <b>{l.qty}</b>
            <button className="ibtn sm" onClick={() => updateLine(c.id, l.id, { qty: l.qty + 1 })}>
              +
            </button>
          </div>
          {others.length ? (
            <select className="inp" value="" onChange={(e) => e.target.value && moveLine(c.id, l.id, e.target.value)} style={{ width: 34, padding: 0 }} title={t('pack.moveTo')} aria-label={t('pack.moveTo')}>
              <option value="">⇄</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : null}
          <button className="ibtn sm danger" onClick={() => removeLine(c.id, l.id)} title={t('act.delete')}>
            <Icon name="trash" size={13} />
          </button>
        </>
      ) : (
        <span className="pk-count">{l.qty > 1 ? `${n}/${l.qty}` : ''}</span>
      )}
    </div>
  );
}

function AddLine({ c, t }: { c: CaseDef; t: TFn }) {
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const [txt, setTxt] = useState('');
  const needs = useMemo(() => packingNeeds(p, t, lang), [p, t, lang]);
  const inCase = new Set(c.lines.map(lineKey));
  const opts = needs.filter((n) => !inCase.has(n.key)).sort((a, b) => b.need - b.packed - (a.need - a.packed));
  return (
    <div className="pk-add" data-testid="case-add">
      <select
        className="inp"
        value=""
        onChange={(e) => {
          const n = opts.find((x) => x.key === e.target.value);
          if (n) addLine(c.id, { kind: n.kind, ref: n.ref, qty: Math.max(1, n.need - n.packed), name: n.name });
        }}
        data-testid="case-add-select"
      >
        <option value="">{t('pack.addFromList')}</option>
        {opts.map((n) => (
          <option key={n.key} value={n.key}>
            {n.need > n.packed ? `${n.need - n.packed}× ` : ''}
            {n.name}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="inp" value={txt} placeholder={t('pack.addTextPh')} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && txt.trim() && (addLine(c.id, { kind: 'text', ref: txt.trim(), qty: 1, name: txt.trim() }), setTxt(''))} />
        <button className="btn" disabled={!txt.trim()} onClick={() => (addLine(c.id, { kind: 'text', ref: txt.trim(), qty: 1, name: txt.trim() }), setTxt(''))}>
          <Icon name="plus" size={14} />
        </button>
      </div>
    </div>
  );
}

function CasePrint({ c, p, t }: { c: CaseDef; p: Project; t: TFn }) {
  const lang = useStore((s) => s.lang);
  return (
    <div className="pk-print">
      <h2 style={{ borderLeft: `10px solid ${c.color}`, paddingLeft: 10 }}>{c.name}</h2>
      {c.desc ? <p>{c.desc}</p> : null}
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 30 }}>↗</th>
            <th style={{ width: 30 }}>↙</th>
            <th className="n">{t('col.qty')}</th>
            <th>{t('col.name')}</th>
            <th>{t('insp.notes')}</th>
          </tr>
        </thead>
        <tbody>
          {c.lines.map((l) => (
            <tr key={l.id}>
              <td>☐</td>
              <td>☐</td>
              <td className="n">{l.qty}</td>
              <td>{lineName(p, l, lang)}</td>
              <td>{l.note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
