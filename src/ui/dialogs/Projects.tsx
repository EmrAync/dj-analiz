import { useEffect, useState } from 'react';
import { makeT } from '../../i18n';
import type { EventType } from '../../model/types';
import { deleteProject, listProjects, loadProject, normalizeProject, saveProject, type ProjectMeta } from '../../store/persist';
import { st, useStore, useT } from '../../store/store';
import { exportJSON, importJSON, newEmptyProject } from '../fileOps';
import { Icon, Modal, Num, Row, Text } from '../kit';
import { demoProject } from '../../App';

export function ProjectsDialog() {
  const t = useT();
  const cur = useStore((s) => s.project.id);
  const lang = useStore((s) => s.lang);
  const [list, setList] = useState<ProjectMeta[] | null>(null);
  const refresh = () => listProjects().then(setList);
  useEffect(() => {
    void refresh();
  }, []);
  const close = () => st().set({ dialog: null });
  const open = async (id: string) => {
    const s = st();
    await saveProject(s.project);
    const p = await loadProject(id);
    const n = p ? normalizeProject(p) : null;
    if (n) {
      st().setProject(n);
      await saveProject(n);
      st().set({ dialog: null });
      setTimeout(() => window.dispatchEvent(new Event('sahnecad:fit')), 50);
    }
  };
  const dup = async (id: string) => {
    const p = await loadProject(id);
    if (!p) return;
    const c = JSON.parse(JSON.stringify(p));
    c.id = 'pr' + Math.random().toString(36).slice(2, 10);
    c.name = p.name + ' ' + t('area.copy');
    c.modified = Date.now();
    await saveProject(c);
    await refresh();
  };
  return (
    <Modal
      title={t('proj.title')}
      icon="folder"
      onClose={close}
      wide
      foot={
        <>
          <button className="btn" onClick={() => importJSON(t).then(() => st().set({ dialog: null }))}>
            <Icon name="upload" size={15} /> {t('menu.importJson')}
          </button>
          <button className="btn" onClick={exportJSON}>
            <Icon name="download" size={15} /> {t('menu.exportJson')}
          </button>
          <span className="spacer" style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={async () => {
              const p = demoProject(lang);
              st().setProject(p);
              await saveProject(p);
              st().set({ dialog: null });
            }}
          >
            <Icon name="sparkles" size={15} /> {t('proj.demo')}
          </button>
          <button className="btn" onClick={() => st().set({ dialog: { kind: 'wizard' } })}>
            <Icon name="magic" size={15} /> {t('menu.wizard')}
          </button>
          <button className="btn primary" onClick={() => newEmptyProject(makeT(lang)).then(() => st().set({ dialog: null }))}>
            <Icon name="plus" size={15} /> {t('menu.new')}
          </button>
        </>
      }
    >
      {!list ? (
        <p className="hint">…</p>
      ) : !list.length ? (
        <p className="hint">{t('proj.none')}</p>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('proj.name')}</th>
              <th>{t('wiz.event')}</th>
              <th className="n">{t('status.items')}</th>
              <th>{t('proj.modified')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id} className={m.id === cur ? 'sel' : ''}>
                <td>
                  <b style={{ cursor: 'pointer' }} onClick={() => open(m.id)}>
                    {m.name}
                  </b>
                  {m.id === cur ? <span className="chip info" style={{ marginLeft: 6 }}>{t('proj.open')}</span> : null}
                  {m.date ? <div className="hint small">{m.date}</div> : null}
                </td>
                <td>{m.eventType ? t(('event.' + m.eventType) as 'event.dugun') : ''}</td>
                <td className="n">{m.items}</td>
                <td>{new Date(m.modified).toLocaleString(lang === 'en' ? 'en-GB' : lang)}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn sm" onClick={() => open(m.id)}>
                    {t('proj.openBtn')}
                  </button>{' '}
                  <button className="ibtn sm" title={t('area.duplicate')} onClick={() => dup(m.id)}>
                    <Icon name="copy" size={14} />
                  </button>
                  {m.id !== cur ? (
                    <button
                      className="ibtn sm danger"
                      title={t('act.delete')}
                      onClick={async () => {
                        if (confirm(t('proj.confirmDelete', { n: m.name }))) {
                          await deleteProject(m.id);
                          await refresh();
                        }
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint small" style={{ marginTop: 10 }}>
        {t('proj.storageHint')}
      </p>
    </Modal>
  );
}

const EVENTS: EventType[] = ['dugun', 'kina', 'nisan', 'sunnet', 'konser', 'kurumsal', 'parti', 'festival', 'diger'];

export function ProjectInfoDialog() {
  const t = useT();
  const p = useStore((s) => s.project);
  const m = p.meta;
  const up = (patch: Partial<typeof m>) => st().mutate((d) => void Object.assign(d.meta, patch));
  return (
    <Modal title={t('menu.projectInfo')} icon="gear" onClose={() => st().set({ dialog: null })} foot={<button className="btn primary" onClick={() => st().set({ dialog: null })}>{t('btn.done')}</button>}>
      <div className="form-grid">
        <label className="field-l full">
          <span>{t('proj.name')}</span>
          <input className="inp" value={p.name} onChange={(e) => st().mutate((d) => void (d.name = e.target.value))} />
        </label>
        <label className="field-l">
          <span>{t('meta.client')}</span>
          <Text value={m.client} onChange={(v) => up({ client: v })} />
        </label>
        <label className="field-l">
          <span>{t('wiz.event')}</span>
          <select className="inp" value={m.eventType} onChange={(e) => up({ eventType: e.target.value as EventType })}>
            {EVENTS.map((e) => (
              <option key={e} value={e}>
                {t(('event.' + e) as 'event.dugun')}
              </option>
            ))}
          </select>
        </label>
        <label className="field-l">
          <span>{t('meta.date')}</span>
          <input className="inp" type="date" value={m.date} onChange={(e) => up({ date: e.target.value })} />
        </label>
        <label className="field-l">
          <span>{t('meta.time')}</span>
          <input className="inp" type="time" value={m.time} onChange={(e) => up({ time: e.target.value })} />
        </label>
        <label className="field-l">
          <span>{t('meta.venue')}</span>
          <Text value={m.venue} onChange={(v) => up({ venue: v })} />
        </label>
        <label className="field-l">
          <span>{t('meta.address')}</span>
          <Text value={m.address} onChange={(v) => up({ address: v })} />
        </label>
        <label className="field-l">
          <span>{t('meta.engineer')}</span>
          <Text value={m.engineer} onChange={(v) => up({ engineer: v })} />
        </label>
        <label className="field-l">
          <span>{t('meta.phone')}</span>
          <Text value={m.phone} onChange={(v) => up({ phone: v })} />
        </label>
        <div className="field-l">
          <span>{t('wiz.guests')}</span>
          <Num value={m.guests} onChange={(v) => up({ guests: Math.max(0, Math.round(v)) })} step={10} digits={0} />
        </div>
        <label className="field-l full">
          <span>{t('insp.notes')}</span>
          <Text value={m.notes} onChange={(v) => up({ notes: v })} multiline />
        </label>
      </div>
      <Row label="ID">
        <span className="hint small" style={{ fontFamily: 'var(--mono)' }}>
          {p.id}
        </span>
      </Row>
    </Modal>
  );
}
