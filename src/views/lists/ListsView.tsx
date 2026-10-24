import { useMemo, useState } from 'react';
import { CAT_BY_ID } from '../../catalog/categories';
import { DOMAINS } from '../../catalog/connectors';
import { buildBom } from '../../engine/bom';
import { analyzeCables } from '../../engine/cables';
import { cableRow, cableRows, patchList, powerRows, toCSV, itemTitle } from '../../engine/lists';
import { analyzePower } from '../../engine/power';
import { fmt, L } from '../../i18n';
import { getDef } from '../../model/project';
import { downloadText } from '../../store/persist';
import { st, useStore, useT } from '../../store/store';
import { Icon, Seg } from '../../ui/kit';
import { safeName } from '../../ui/fileOps';

type Tab = 'bom' | 'cables' | 'pack' | 'patch' | 'power';

export function ListsView() {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const [tab, setTab] = useState<Tab>('bom');
  const bom = useMemo(() => buildBom(p, t, lang), [p, t, lang]);
  const csv = (name: string, rows: (string | number | boolean | undefined)[][]) => downloadText(`${safeName(p.name)}-${safeName(name)}.csv`, toCSV(rows), 'text/csv');
  const exportCurrent = () => {
    if (tab === 'bom') {
      csv(t('lists.bom'), [[t('col.group'), t('col.qty'), t('col.name'), t('col.brand'), t('col.model'), t('col.weight'), t('col.power'), t('col.labels')], ...bom.rows.map((r) => [groupName(r.group, lang, t), r.qty, r.name, r.brand || '', r.model || '', fmt(r.kg, 1, lang), Math.round(r.watt), r.items.map((id) => p.items.find((i) => i.id === id)?.label).join(', ')])]);
    } else if (tab === 'cables') csv(t('lists.cables'), cableRows(p, t, lang));
    else if (tab === 'pack') csv(t('lists.pack'), [[t('col.qty'), t('col.spare'), t('col.type'), t('col.length'), t('col.labels')], ...bom.cables.map((r) => [r.qty, r.spare, r.name, r.len, r.labels.join(' ')])]);
    else if (tab === 'patch') csv(t('lists.patch'), [[t('col.dest'), t('col.ch'), t('col.channel'), t('col.source'), t('col.model'), t('col.stand'), '+48V', t('col.label')], ...patchList(p, lang).map((r) => [r.dest, r.ch, r.channel, r.source, r.model, r.stand ? t(('stand.' + r.stand) as 'stand.boom') : '', r.phantom ? '✓' : '', r.cable])]);
    else csv(t('lists.power'), powerRows(p, t, lang));
  };
  return (
    <div className="page" data-testid="lists-view">
      <div className="page-inner">
        <div className="page-head">
          <h1>{t('view.lists')}</h1>
          <div className="no-print" style={{ minWidth: 0 }}>
            <Seg
              value={tab}
              options={[
                { v: 'bom', l: t('lists.bom') },
                { v: 'cables', l: t('lists.cables') },
                { v: 'pack', l: t('lists.pack') },
                { v: 'patch', l: t('lists.patch') },
                { v: 'power', l: t('lists.power') },
              ]}
              onChange={setTab}
            />
          </div>
          <button className="btn no-print" onClick={exportCurrent}>
            <Icon name="download" size={15} /> CSV
          </button>
          <button className="btn no-print" onClick={() => window.print()}>
            <Icon name="print" size={15} /> {t('lists.print')}
          </button>
        </div>
        <PrintHeader />
        {tab === 'bom' ? <BomTable bom={bom} /> : tab === 'cables' ? <CableTable /> : tab === 'pack' ? <PackTable bom={bom} /> : tab === 'patch' ? <PatchTable /> : <PowerTable />}
      </div>
    </div>
  );
}

function groupName(g: string, lang: 'tr' | 'de' | 'en', t: ReturnType<typeof useT>): string {
  if (g === 'acc') return t('bomg.acc');
  if (g === 'stage') return t('bomg.stage');
  if (g === 'cons') return t('bomg.cons');
  if (g === 'alt') return t('bomg.alt');
  return L(CAT_BY_ID[g as keyof typeof CAT_BY_ID]?.name, lang) || g;
}

export function PrintHeader() {
  const p = useStore((s) => s.project);
  const t = useT();
  const m = p.meta;
  return (
    <div className="print-only" style={{ marginBottom: 10 }}>
      <h2 style={{ margin: 0 }}>{p.name}</h2>
      <div>
        {[m.client, m.venue, m.address, m.date + (m.time ? ' ' + m.time : ''), m.engineer ? t('meta.engineer') + ': ' + m.engineer : '', m.phone].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

function BomTable({ bom }: { bom: ReturnType<typeof buildBom> }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const p = useStore((s) => s.project);
  const groups = new Map<string, typeof bom.rows>();
  for (const r of bom.rows) {
    const g = groups.get(r.group);
    if (g) g.push(r);
    else groups.set(r.group, [r]);
  }
  const order = ['hoparlor', 'sub', 'linearray', 'monitor', 'mikser', 'islem', 'dj', 'mikrofon', 'enstruman', 'isik', 'truss', 'video', 'elektrik', 'ag', 'sahne', 'hazirlik', 'stage', 'acc', 'cons', 'alt'];
  const keys = [...groups.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return (
    <>
      <div className="grid-3" style={{ marginBottom: 12 }}>
        <div className="stat">
          <span className="l">{t('lists.totalItems')}</span>
          <span className="v">{bom.rows.filter((r) => r.group !== 'cons').reduce((s, r) => s + r.qty, 0)}</span>
        </div>
        <div className="stat">
          <span className="l">{t('lists.totalWeight')}</span>
          <span className="v">{fmt(bom.totalKg, 0, lang)} kg</span>
        </div>
        <div className="stat">
          <span className="l">{t('lists.totalPower')}</span>
          <span className="v">{fmt(bom.totalW / 1000, 1, lang)} kW</span>
        </div>
      </div>
      <div className="panel">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 40 }}>✓</th>
                <th className="n">{t('col.qty')}</th>
                <th>{t('col.name')}</th>
                <th>{t('col.brandModel')}</th>
                <th className="n">{t('col.weight')}</th>
                <th className="n">{t('col.power')}</th>
                <th>{t('col.labels')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((g) => (
                <GroupRows key={g} title={groupName(g, lang, t)} rows={groups.get(g)!} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint">{t('lists.bomHint')}</p>
    </>
  );
}

function GroupRows({ title, rows, p }: { title: string; rows: ReturnType<typeof buildBom>['rows']; p: ReturnType<typeof st>['project'] }) {
  const lang = useStore((s) => s.lang);
  return (
    <>
      <tr className="grp">
        <td colSpan={7}>
          {title} <span className="chip">{rows.reduce((s, r) => s + r.qty, 0)}</span>
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.key} onClick={() => r.items.length && st().select({ items: r.items })} style={{ cursor: r.items.length ? 'pointer' : 'default' }}>
          <td>
            <input type="checkbox" />
          </td>
          <td className="n">
            <b>{r.qty}</b>
          </td>
          <td>
            {r.name}
            {r.note ? <span className="hint"> · {r.note}</span> : null}
          </td>
          <td>{[r.brand, r.model].filter(Boolean).join(' ')}</td>
          <td className="n">{r.kg ? fmt(r.kg, 1, lang) : ''}</td>
          <td className="n">{r.watt ? Math.round(r.watt) + ' W' : ''}</td>
          <td style={{ maxWidth: 320, color: 'var(--muted)' }}>
            {r.items
              .slice(0, 24)
              .map((id) => p.items.find((i) => i.id === id)?.label)
              .join(', ')}
            {r.items.length > 24 ? '…' : ''}
          </td>
        </tr>
      ))}
    </>
  );
}

function CableTable() {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const sel = useStore((s) => s.sel);
  const ci = analyzeCables(p);
  const list = [...ci.values()].sort((a, b) => a.cable.label.localeCompare(b.cable.label, undefined, { numeric: true }));
  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('col.label')}</th>
              <th>{t('col.type')}</th>
              <th className="n">{t('col.length')}</th>
              <th>{t('col.from')}</th>
              <th>{t('col.fromPort')}</th>
              <th>{t('col.to')}</th>
              <th>{t('col.toPort')}</th>
              <th>{t('col.channel')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((inf) => {
              const r = cableRow(inf, lang);
              const col = inf.cable.color || DOMAINS[inf.type.domain].color;
              return (
                <tr key={inf.cable.id} className={sel.cables.includes(inf.cable.id) ? 'sel' : ''} onClick={() => st().select({ cables: [inf.cable.id] })} style={{ cursor: 'pointer' }}>
                  <td>
                    <span className="cable-tag" style={{ color: col }}>
                      {inf.cable.label}
                    </span>
                  </td>
                  <td>{r[1]}</td>
                  <td className="n">{r[3]}</td>
                  <td>
                    <b>{r[4]}</b> <span className="hint">{inf.a ? itemTitle(p, inf.a, lang) : ''}</span>
                  </td>
                  <td>{r[5]}</td>
                  <td>
                    <b>{r[6]}</b> <span className="hint">{inf.b ? itemTitle(p, inf.b, lang) : ''}</span>
                  </td>
                  <td>{r[7]}</td>
                  <td>{r[8]}</td>
                  <td>{inf.issues.filter((x) => x !== 'chk.cableCrossArea').length ? <Icon name="warning" size={14} color="var(--warn)" /> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PackTable({ bom }: { bom: ReturnType<typeof buildBom> }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const total = bom.cables.reduce((s, r) => s + r.qty, 0);
  const meters = bom.cables.reduce((s, r) => s + r.qty * r.len, 0);
  return (
    <>
      <div className="grid-3" style={{ marginBottom: 12 }}>
        <div className="stat">
          <span className="l">{t('lists.cableCount')}</span>
          <span className="v">{total}</span>
        </div>
        <div className="stat">
          <span className="l">{t('lists.cableMeters')}</span>
          <span className="v">{fmt(meters, 0, lang)} m</span>
        </div>
        <div className="stat">
          <span className="l">{t('lists.cableWeight')}</span>
          <span className="v">{fmt(bom.cables.reduce((s, r) => s + r.kg, 0), 0, lang)} kg</span>
        </div>
      </div>
      <div className="panel">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 40 }}>✓</th>
              <th className="n">{t('col.qty')}</th>
              <th className="n">{t('col.spare')}</th>
              <th>{t('col.type')}</th>
              <th className="n">{t('col.length')}</th>
              <th>{t('col.labels')}</th>
            </tr>
          </thead>
          <tbody>
            {bom.cables.map((r) => (
              <tr key={r.key}>
                <td>
                  <input type="checkbox" />
                </td>
                <td className="n">
                  <b>{r.qty}</b>
                </td>
                <td className="n">{r.spare ? '+' + r.spare : ''}</td>
                <td>
                  <span className="cable-tag" style={{ color: DOMAINS[r.domain as keyof typeof DOMAINS].color, marginRight: 8 }}>
                    {r.short}
                  </span>
                  {r.name}
                </td>
                <td className="n">{fmt(r.len, r.len % 1 ? 1 : 0, lang)} m</td>
                <td style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>{r.labels.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{t('lists.packHint')}</p>
    </>
  );
}

function PatchTable() {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const rows = patchList(p, lang);
  if (!rows.length)
    return (
      <div className="panel empty">
        <Icon name="mixer" size={36} color="var(--faint)" />
        {t('lists.patchEmpty')}
      </div>
    );
  let last = '';
  return (
    <div className="panel">
      <table className="tbl">
        <thead>
          <tr>
            <th className="n">{t('col.ch')}</th>
            <th>{t('col.channel')}</th>
            <th>{t('col.source')}</th>
            <th>{t('col.model')}</th>
            <th>{t('col.stand')}</th>
            <th>+48V</th>
            <th>{t('col.label')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r) => {
            const out: JSX.Element[] = [];
            if (r.dest !== last) {
              last = r.dest;
              const dest = p.items.find((i) => i.id === r.destId);
              out.push(
                <tr className="grp" key={'g' + r.dest + r.ch}>
                  <td colSpan={7}>
                    {r.dest} · {dest ? itemTitle(p, dest, lang) : ''}
                  </td>
                </tr>,
              );
            }
            out.push(
              <tr key={r.dest + r.ch + r.cable} onClick={() => st().select({ items: [r.sourceId] })} style={{ cursor: 'pointer' }}>
                <td className="n">
                  <b>{r.ch}</b>
                </td>
                <td>
                  <b>{r.channel}</b>
                </td>
                <td>{r.source}</td>
                <td>{r.model}</td>
                <td>{r.stand ? t(('stand.' + r.stand) as 'stand.boom') : ''}</td>
                <td>{r.phantom ? <span className="chip warn">+48V</span> : ''}</td>
                <td style={{ fontFamily: 'var(--mono)' }}>{r.cable}</td>
              </tr>,
            );
            return out;
          })}
        </tbody>
      </table>
    </div>
  );
}

function PowerTable() {
  const t = useT();
  const p = useStore((s) => s.project);
  const lang = useStore((s) => s.lang);
  const pw = analyzePower(p);
  return (
    <>
      <div className="grid-3" style={{ marginBottom: 12 }}>
        <div className="stat">
          <span className="l">{t('lists.totalPower')}</span>
          <span className="v">{fmt(pw.totalW / 1000, 2, lang)} kW</span>
        </div>
        <div className="stat">
          <span className="l">{t('lists.connected')}</span>
          <span className="v">{fmt(pw.connectedW / 1000, 2, lang)} kW</span>
        </div>
        <div className="stat">
          <span className="l">{t('lists.unpowered')}</span>
          <span className="v" style={{ color: pw.unpowered.length ? 'var(--warn)' : 'var(--ok)' }}>
            {pw.unpowered.length}
          </span>
        </div>
      </div>
      <div className="panel">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('col.circuit')}</th>
              <th>{t('col.phase')}</th>
              <th className="n">{t('col.load')}</th>
              <th className="n">{t('col.current')}</th>
              <th className="n">{t('col.breaker')}</th>
              <th style={{ width: '30%' }}>{t('col.usage')}</th>
            </tr>
          </thead>
          <tbody>
            {pw.circuits.map((c, i) => {
              const pct = Math.min(1.3, c.pct);
              const col = c.pct > 1 ? 'var(--err)' : c.pct > 0.8 ? 'var(--warn)' : 'var(--ok)';
              return (
                <tr key={i} onClick={() => st().select({ items: [c.itemId] })} style={{ cursor: 'pointer' }}>
                  <td>
                    <b>{c.label}</b>
                    {c.perPhase ? (
                      <div className="hint small">
                        L1 {Math.round(c.perPhase.L1)} W · L2 {Math.round(c.perPhase.L2)} W · L3 {Math.round(c.perPhase.L3)} W
                      </div>
                    ) : null}
                  </td>
                  <td>{c.phase}</td>
                  <td className="n">{Math.round(c.loadW)} W</td>
                  <td className="n">{fmt(c.amps, 1, lang)} A</td>
                  <td className="n">{c.breakerA} A</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="bar-track" style={{ flex: 1 }}>
                        <div className="bar-fill" style={{ width: `${(pct / 1.3) * 100}%`, background: col }} />
                      </div>
                      <b style={{ color: col, minWidth: 42, textAlign: 'right' }}>{Math.round(c.pct * 100)} %</b>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pw.unpowered.length ? (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-h">
            <Icon name="warning" size={16} color="var(--warn)" /> {t('lists.unpoweredList')}
          </div>
          <div className="panel-b">
            {pw.unpowered.map((id) => {
              const it = p.items.find((i) => i.id === id)!;
              return (
                <span key={id} className="chip warn" style={{ margin: 2, cursor: 'pointer' }} onClick={() => st().select({ items: [id] })}>
                  {it.label} · {L(getDef(p, it.defId).name, lang)}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
      <p className="hint">{t('lists.powerHint')}</p>
    </>
  );
}
