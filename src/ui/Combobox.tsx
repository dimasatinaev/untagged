import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * Searchable select. Built for the mapping screen where real exports have
 * 50+ columns and native <select> becomes a scroll hunt.
 * Keyboard: Enter/Space/ArrowDown opens; arrows move; Enter selects; Esc closes.
 */

export interface ComboOption {
  value: string;
  label: string;
}

export interface ComboGroup {
  label?: string;
  options: ComboOption[];
}

interface Props {
  value: string;
  groups: ComboGroup[];
  onChange: (value: string) => void;
  ariaLabel: string;
  /** value(s) that render dimmed as placeholder-like, e.g. "— none —" */
  placeholderValues?: string[];
  disabled?: boolean;
}

export default function Combobox({
  value,
  groups,
  onChange,
  ariaLabel,
  placeholderValues = [],
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  const listId = `${id}-listbox`;
  const optionId = (idx: number) => `${id}-opt-${idx}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const currentLabel = useMemo(() => {
    for (const g of groups) for (const o of g.options) if (o.value === value) return o.label;
    return value;
  }, [groups, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({
        label: g.label,
        options: q === '' ? g.options : g.options.filter((o) => o.label.toLowerCase().includes(q)),
      }))
      .filter((g) => g.options.length > 0);
  }, [groups, query]);

  const flat = useMemo(() => filtered.flatMap((g) => g.options), [filtered]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(Math.max(0, flat.findIndex((o) => o.value === value)));
    searchRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (active >= flat.length) setActive(Math.max(0, flat.length - 1));
  }, [flat, active]);

  useEffect(() => {
    listRef.current
      ?.querySelector('.combobox-option--active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function close() {
    setOpen(false);
    // restore focus to the trigger so keyboard users don't lose their place
    triggerRef.current?.focus();
  }

  function select(v: string) {
    onChange(v);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[active]) select(flat[active].value);
    }
  }

  let flatIndex = -1;

  return (
    <div className="combobox" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={
          'combobox-trigger' + (placeholderValues.includes(value) ? ' combobox-trigger--placeholder' : '')
        }
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        title={currentLabel}
      >
        {currentLabel}
      </button>
      {open && (
        <div className="combobox-panel" onKeyDown={onKeyDown}>
          <input
            ref={searchRef}
            className="combobox-search"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={flat[active] ? optionId(active) : undefined}
            aria-autocomplete="list"
            placeholder="Search…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            aria-label={`Search options for ${ariaLabel}`}
          />
          <ul className="combobox-list" role="listbox" id={listId} aria-label={ariaLabel} ref={listRef}>
            {flat.length === 0 && <li className="combobox-empty">No matching columns</li>}
            {filtered.map((g, gi) => (
              <li key={gi}>
                {g.label && <div className="combobox-group">{g.label}</div>}
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {g.options.map((o) => {
                    flatIndex++;
                    const idx = flatIndex;
                    return (
                      <li
                        key={o.value}
                        id={optionId(idx)}
                        role="option"
                        aria-selected={o.value === value}
                        className={'combobox-option' + (idx === active ? ' combobox-option--active' : '')}
                        onPointerMove={() => setActive(idx)}
                        onClick={() => select(o.value)}
                      >
                        {o.label}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
