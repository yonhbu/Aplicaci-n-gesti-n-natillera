import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import type { Cycle } from '../lib/types';
import { validCutDate } from '../domain/financialReconstruction';

const Context = createContext({ cutDate: '', start: '', end: '', setCutDate: (_value: string) => {} });
export function FinancialCut({ cycle, today, children }: { cycle: Cycle; today: string; children: ReactNode }) {
  const start = cycle.starts_on, end = today < cycle.closes_on ? today : cycle.closes_on;
  const key = 'natillera:financial-cut:' + cycle.id;
  const [selected, setSelected] = useState(() => sessionStorage.getItem(key) ?? end);
  const cutDate = validCutDate(selected, start, end) ? selected : end;
  function setCutDate(value: string) { if (validCutDate(value, start, end)) { setSelected(value); sessionStorage.setItem(key, value); } }
  return <Context.Provider value={{ cutDate, start, end, setCutDate }}>{children}</Context.Provider>;
}
export const useFinancialCut = () => useContext(Context);
export function FinancialCutPicker({ appearance }: { appearance?: 'capsule' | 'card' } = {}) {
  const { cutDate, start, end, setCutDate } = useFinancialCut();
  return <FinancialCutField value={cutDate} min={start} max={end} onChange={setCutDate} appearance={appearance} />;
}
export function FinancialCutField({ value, min, max, disabled, invalid, onChange, appearance }: {
  value: string; min?: string; max?: string; disabled?: boolean; invalid?: boolean; appearance?: 'capsule' | 'card'; onChange: (value: string) => void;
}) {
  const id = useId();
  return <div className={`financial-cut-picker${appearance ? ` cut-${appearance}` : ''}`}><label htmlFor={id}>Fecha de corte</label><input id={id} lang="es-CO" type="date" min={min} max={max} disabled={disabled} aria-invalid={invalid} value={value} onChange={event => onChange(event.target.value)} /></div>;
}
