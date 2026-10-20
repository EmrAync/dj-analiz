import { useEffect, useRef, useState, type ReactNode } from 'react';
import { iconMarkup } from '../catalog/icons';

export function Icon({ name, size = 18, color, stroke = 1.8, title }: { name: string; size?: number; color?: string; stroke?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color || 'currentColor'} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ color: color || undefined, flex: 'none' }} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <g dangerouslySetInnerHTML={{ __html: iconMarkup(name) }} />
    </svg>
  );
}

// Sayı girişi: yazarken değil, onay (Enter/blur) ile kaydeder; yukarı/aşağı ok ile adım
export function Num({ value, onChange, step = 0.1, min, max, unit, label, digits = 2, width, disabled }: { value: number | undefined; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; label?: string; digits?: number; width?: number | string; disabled?: boolean }) {
  const fmt = (v: number | undefined) => (v == null || !isFinite(v) ? '' : String(Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits)));
  const [txt, setTxt] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setTxt(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = (s: string) => {
    const v = parseFloat(s.replace(',', '.'));
    if (!isFinite(v)) {
      setTxt(fmt(value));
      return;
    }
    let c = v;
    if (min != null) c = Math.max(min, c);
    if (max != null) c = Math.min(max, c);
    if (c !== value) onChange(c);
    setTxt(fmt(c));
  };
  return (
    <div className="num" style={{ width }}>
      {label ? <span className="lab">{label}</span> : null}
      <input
        inputMode="decimal"
        value={txt}
        disabled={disabled}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.currentTarget.value);
        }}
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const cur = parseFloat(txt.replace(',', '.')) || 0;
            const nv = cur + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const r = Math.round(nv / step) * step;
            commit(String(r));
          }
        }}
      />
      {unit ? <span className="u">{unit}</span> : null}
    </div>
  );
}

export function Text({ value, onChange, placeholder, multiline }: { value: string | undefined; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const [txt, setTxt] = useState(value || '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setTxt(value || '');
  }, [value]);
  const props = {
    className: 'inp',
    value: txt,
    placeholder,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      if (txt !== (value || '')) onChange(txt);
    },
    onChange: (e: { target: { value: string } }) => setTxt(e.target.value),
  };
  if (multiline) return <textarea {...props} rows={3} />;
  return <input {...props} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; l: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)} title={o.title} type="button">
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, right, id }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; right?: ReactNode; id?: string }) {
  const key = id ? 'sahnecad.sec.' + id : '';
  const [open, setOpen] = useState(() => {
    if (!key) return defaultOpen;
    try {
      const v = localStorage.getItem(key);
      return v == null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });
  return (
    <div className="sec">
      <button
        className="sec-head"
        type="button"
        onClick={() => {
          setOpen(!open);
          try {
            if (key) localStorage.setItem(key, !open ? '1' : '0');
          } catch {
            /* yok */
          }
        }}
      >
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', display: 'inline-flex' }}>
          <Icon name="chevron" size={12} />
        </span>
        <span style={{ flex: 1, textAlign: 'left' }}>{title}</span>
        {right}
      </button>
      {open ? <div className="sec-body">{children}</div> : null}
    </div>
  );
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="chk">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Modal({ title, onClose, children, foot, wide, icon }: { title: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean; icon?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="modal-head">
          {icon ? <Icon name={icon} size={20} /> : null}
          <h2>{title}</h2>
          <button className="ibtn" onClick={onClose} aria-label="close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {foot ? <div className="modal-foot">{foot}</div> : null}
      </div>
    </div>
  );
}

export function Menu({ button, children, align = 'right' }: { button: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {button(open, () => setOpen(!open))}
      {open ? <div className={'menu' + (align === 'left' ? ' left-al' : '')}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

export function useSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
