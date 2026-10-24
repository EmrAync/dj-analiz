import type { EquipDef } from '../../model/types';
import { st, useStore, useT } from '../../store/store';
import { AreaForm } from '../Inspector';
import { Icon, Modal } from '../kit';
import { ConnectDialog } from './Connect';
import { DefEditor } from './DefEditor';
import { ProjectInfoDialog, ProjectsDialog } from './Projects';
import { WizardDialog } from './Wizard';

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  const d = dialog.data || {};
  switch (dialog.kind) {
    case 'wizard':
      return <WizardDialog />;
    case 'projects':
      return <ProjectsDialog />;
    case 'project':
      return <ProjectInfoDialog />;
    case 'connect':
      return <ConnectDialog a={d.a as string} ap={d.ap as string | undefined} b={d.b as string} />;
    case 'defEditor':
      return <DefEditor def={d.def as EquipDef | undefined} applyTo={d.applyTo as string | undefined} />;
    case 'area':
      return <AreaDialog id={d.id as string} />;
    case 'help':
      return <HelpDialog welcome={!!d.welcome} />;
    default:
      return null;
  }
}

function AreaDialog({ id }: { id: string }) {
  const t = useT();
  const area = useStore((s) => s.project.areas.find((a) => a.id === id));
  if (!area) return null;
  return (
    <Modal title={`${t('area.settings')} — ${area.name}`} icon="house" onClose={() => st().set({ dialog: null })} foot={<button className="btn primary" onClick={() => st().set({ dialog: null })}>{t('btn.done')}</button>}>
      <AreaForm area={area} />
    </Modal>
  );
}

function HelpDialog({ welcome }: { welcome: boolean }) {
  const t = useT();
  const keys: [string, string][] = [
    ['V / K / B / M / T', t('help.k.tools')],
    ['Del', t('help.k.delete')],
    ['Ctrl+Z / Ctrl+Y', t('help.k.undo')],
    ['Ctrl+D', t('help.k.dup')],
    ['Shift+M', t('help.k.mirror')],
    ['Ctrl+C / Ctrl+V', t('help.k.copy')],
    ['R / Shift+R', t('help.k.rotate')],
    ['← ↑ → ↓', t('help.k.nudge')],
    ['L', t('help.k.lock')],
    ['F', t('help.k.fit')],
    ['H / C / G', t('help.k.layers')],
    ['1 … 9', t('help.k.views')],
    [t('help.k.mouse'), t('help.k.mouseDesc')],
  ];
  return (
    <Modal
      title={welcome ? t('help.welcome') : t('help.title')}
      icon={welcome ? 'sparkles' : 'question'}
      onClose={() => st().set({ dialog: null })}
      wide
      foot={
        <>
          {welcome ? (
            <button className="btn" onClick={() => st().set({ dialog: { kind: 'wizard' } })}>
              <Icon name="magic" size={15} /> {t('menu.wizard')}
            </button>
          ) : null}
          <button className="btn primary" onClick={() => st().set({ dialog: null })} data-testid="help-close">
            {welcome ? t('help.start') : t('btn.done')}
          </button>
        </>
      }
    >
      {welcome ? <p style={{ marginTop: 0 }}>{t('help.welcomeText')}</p> : null}
      <div className="grid-2">
        <div>
          <h3 style={{ marginTop: 0 }}>{t('help.how')}</h3>
          <ol style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 6 }}>
            <li>{t('help.s1')}</li>
            <li>{t('help.s2')}</li>
            <li>{t('help.s3')}</li>
            <li>{t('help.s4')}</li>
            <li>{t('help.s5')}</li>
            <li>{t('help.s6')}</li>
            <li>{t('help.s7')}</li>
          </ol>
        </div>
        <div>
          <h3 style={{ marginTop: 0 }}>{t('help.keys')}</h3>
          <table className="tbl">
            <tbody>
              {keys.map(([k, v]) => (
                <tr key={k}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <code>{k}</code>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint small" style={{ marginTop: 12 }}>
        {t('help.disclaimer')}
      </p>
    </Modal>
  );
}
