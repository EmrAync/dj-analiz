import { LANGS } from '../i18n';
import type { Lang } from '../model/types';
import { st, useStore, useT, type View } from '../store/store';
import { Icon, Menu } from './kit';
import { exportDXF, exportJSON, exportPlanPNG, exportPlanSVG, export3DPNG, importJSON, newEmptyProject, saveNow } from './fileOps';

const VIEWS: { id: View; icon: string; key: string }[] = [
  { id: 'plan', icon: 'plan', key: '1' },
  { id: '3d', icon: 'cube', key: '2' },
  { id: 'schema', icon: 'schema', key: '3' },
  { id: 'lists', icon: 'list', key: '4' },
  { id: 'analysis', icon: 'wave', key: '5' },
  { id: 'measure', icon: 'mic', key: '6' },
  { id: 'setup', icon: 'checklist', key: '7' },
];

export function TopBar() {
  const t = useT();
  const view = useStore((s) => s.view);
  const name = useStore((s) => s.project.name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const lang = useStore((s) => s.lang);
  const theme = useStore((s) => s.theme);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const installer = useStore((s) => s.installer);
  return (
    <header className="topbar">
      <button className="ibtn mob-only" onClick={() => st().set({ leftOpen: !leftOpen, rightOpen: false })} aria-label="menu">
        <Icon name="menu" size={18} />
      </button>
      <div className="brand">
        <span className="brand-mark">
          <Icon name="speakerline" size={17} color="#fff" stroke={2} />
        </span>
        <span className="brand-text">
          SahneCAD <small>{t('app.tagline')}</small>
        </span>
      </div>
      <input className="proj-name" value={name} onChange={(e) => st().mutate((d) => void (d.name = e.target.value))} title={t('top.projectName')} data-testid="project-name" />
      <nav className="tabs" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.id} className={'tab' + (view === v.id ? ' on' : '')} onClick={() => st().set({ view: v.id })} title={`${t(('view.' + v.id) as 'view.plan')} (${v.key})`} data-testid={'view-' + v.id}>
            <Icon name={v.icon} size={16} />
            <span className="tl">{t(('view.' + v.id) as 'view.plan')}</span>
          </button>
        ))}
      </nav>
      <div className="tb-group">
        {!installer ? (
          <>
            <button className="ibtn" disabled={!canUndo} onClick={() => st().undo()} title={t('top.undo') + ' (Ctrl+Z)'} data-testid="undo">
              <Icon name="undo" size={17} />
            </button>
            <button className="ibtn" disabled={!canRedo} onClick={() => st().redo()} title={t('top.redo') + ' (Ctrl+Y)'}>
              <Icon name="redo" size={17} />
            </button>
            <span className="sep hide-sm" />
            <button className="ibtn hide-sm" onClick={() => st().set({ dialog: { kind: 'wizard' } })} title={t('top.wizard')} data-testid="open-wizard">
              <Icon name="magic" size={17} />
              <span className="hide-sm">{t('top.wizardShort')}</span>
            </button>
          </>
        ) : (
          <span className="chip info">{t('top.installerMode')}</span>
        )}
        <Menu
          button={(_, toggle) => (
            <button className="ibtn" onClick={toggle} title={t('top.file')} data-testid="file-menu">
              <Icon name="folder" size={17} />
              <span className="hide-sm">{t('top.file')}</span>
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="mh">{t('top.project')}</div>
              <button onClick={() => (close(), st().set({ dialog: { kind: 'projects' } }))} data-testid="menu-projects">
                <Icon name="folder" size={15} /> {t('menu.projects')}
              </button>
              <button onClick={() => (close(), newEmptyProject(t))}>
                <Icon name="file" size={15} /> {t('menu.new')}
              </button>
              <button onClick={() => (close(), st().set({ dialog: { kind: 'wizard' } }))}>
                <Icon name="magic" size={15} /> {t('menu.wizard')}
              </button>
              <button onClick={() => (close(), st().set({ dialog: { kind: 'project' } }))} data-testid="menu-project-info">
                <Icon name="gear" size={15} /> {t('menu.projectInfo')}
              </button>
              <button onClick={() => (close(), saveNow(t))}>
                <Icon name="save" size={15} /> {t('menu.save')}
              </button>
              <hr />
              <div className="mh">{t('top.file')}</div>
              <button onClick={() => (close(), exportJSON())}>
                <Icon name="download" size={15} /> {t('menu.exportJson')}
              </button>
              <button onClick={() => (close(), importJSON(t))}>
                <Icon name="upload" size={15} /> {t('menu.importJson')}
              </button>
              <hr />
              <div className="mh">{t('menu.export')}</div>
              <button onClick={() => (close(), exportPlanPNG())}>
                <Icon name="image" size={15} /> {t('menu.planPng')}
              </button>
              <button onClick={() => (close(), exportPlanSVG())}>
                <Icon name="plan" size={15} /> {t('menu.planSvg')}
              </button>
              <button onClick={() => (close(), exportDXF())}>
                <Icon name="measure" size={15} /> {t('menu.dxf')}
              </button>
              <button onClick={() => (close(), export3DPNG(t))}>
                <Icon name="cube" size={15} /> {t('menu.png3d')}
              </button>
              <button onClick={() => (close(), st().set({ view: 'lists' }))}>
                <Icon name="list" size={15} /> {t('menu.csv')}
              </button>
              <button onClick={() => (close(), st().set({ view: 'setup' }), setTimeout(() => window.print(), 300))}>
                <Icon name="print" size={15} /> {t('menu.printSetup')}
              </button>
              <hr />
              <button onClick={() => (close(), st().set({ installer: !installer, tool: 'select', placing: null }))} data-testid="toggle-installer">
                <Icon name={installer ? 'unlock' : 'lock'} size={15} /> {installer ? t('menu.editMode') : t('menu.installerMode')}
              </button>
            </>
          )}
        </Menu>
        <Menu
          button={(_, toggle) => (
            <button className="ibtn" onClick={toggle} title={t('top.language')}>
              <Icon name="globe" size={17} />
              <span style={{ fontSize: 11, fontWeight: 700 }}>{lang.toUpperCase()}</span>
            </button>
          )}
        >
          {(close) => (
            <>
              {LANGS.map((l) => (
                <button key={l.id} onClick={() => (close(), st().set({ lang: l.id as Lang }))}>
                  {lang === l.id ? <Icon name="ok" size={15} color="var(--accent)" /> : <span style={{ width: 15 }} />} {l.name}
                </button>
              ))}
            </>
          )}
        </Menu>
        <button className="ibtn hide-sm" onClick={() => st().set({ theme: theme === 'dark' ? 'light' : 'dark' })} title={t('top.theme')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        <button className="ibtn hide-sm" onClick={() => st().set({ dialog: { kind: 'help' } })} title={t('top.help')}>
          <Icon name="question" size={17} />
        </button>
        <button className={'ibtn mob-only' + (rightOpen ? ' on' : '')} onClick={() => st().set({ rightOpen: !rightOpen, leftOpen: false })} aria-label="properties">
          <Icon name="gear" size={18} />
        </button>
      </div>
    </header>
  );
}
