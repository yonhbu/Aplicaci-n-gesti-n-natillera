import { useLayoutEffect, useRef, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { parseCop } from '../domain/money';

/** Group strings rather than converting to Number: even very large amounts keep every digit. */
export function formatCopDraft(value: string): string {
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)(?:,\d{0,2})?$/.test(value)) return value;
  const [integer, cents] = value.split(',');
  const grouped = integer.replaceAll('.', '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return grouped + (cents === undefined ? '' : `,${cents}`);
}

function monetaryError(value: string): string {
  if (!value) return '';
  try { parseCop(value); return ''; }
  catch { return 'Escribe un importe COP válido: miles con punto y hasta dos centavos con coma.'; }
}

function positionAfterFormatting(before: string, position: number, after: string) {
  const characters = before.slice(0, position).replaceAll('.', '').length;
  if (characters === 0) return 0;
  let count = 0;
  for (let index = 0; index < after.length; index++) {
    if (after[index] !== '.') count++;
    if (count === characters) return index + 1;
  }
  return after.length;
}

type CopInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue'> & { value: string };

/** Keeps the existing form contract: onChange receives the displayed COP string, parsed with parseCop on submit. */
export function CopInput({ value, onChange, onKeyDown, onPaste, ...props }: CopInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const formatted = formatCopDraft(value);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.setCustomValidity(monetaryError(formatted));
    if (selection.current) {
      input.setSelectionRange(selection.current.start, selection.current.end);
      selection.current = null;
    }
  });

  function update(input: HTMLInputElement, raw: string, start: number, end: number, event: React.SyntheticEvent<HTMLInputElement>, editing: boolean) {
    // Existing grouping can become uneven during middle edits. Only local edits may regroup it;
    // a pasted malformed amount is preserved and reported rather than silently reinterpreted.
    const candidate = editing && /^[\d.]+(?:,\d{0,2})?$/.test(raw)
      ? raw.replaceAll('.', '').replace(/^0+(?=\d)/, '') : raw;
    const next = formatCopDraft(candidate);
    selection.current = { start: positionAfterFormatting(raw, start, next), end: positionAfterFormatting(raw, end, next) };
    input.value = next;
    input.setCustomValidity(monetaryError(next));
    // Clipboard and separator deletion follow the same change contract as a native edit.
    onChange?.({ ...event, target: input, currentTarget: input, type: 'change' } as ChangeEvent<HTMLInputElement>);
    if (selection.current) input.setSelectionRange(selection.current.start, selection.current.end);
  }

  return <input {...props} ref={ref} type="text" inputMode="decimal" lang="es-CO" value={formatted}
    onChange={event => update(event.currentTarget, event.currentTarget.value, event.currentTarget.selectionStart ?? 0, event.currentTarget.selectionEnd ?? 0, event, true)}
    onPaste={event => {
      onPaste?.(event);
      if (event.defaultPrevented || props.readOnly || props.disabled) return;
      event.preventDefault();
      const input = event.currentTarget;
      const start = input.selectionStart ?? 0, end = input.selectionEnd ?? start;
      const pasted = event.clipboardData.getData('text').trim();
      const raw = input.value.slice(0, start) + pasted + input.value.slice(end);
      const validPaste = pasted === '' || /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)(?:,\d{0,2})?$/.test(pasted);
      update(input, raw, start + pasted.length, start + pasted.length, event, validPaste);
    }}
    onKeyDown={event => {
      onKeyDown?.(event);
      if (event.defaultPrevented || props.readOnly || props.disabled) return;
      const input = event.currentTarget, start = input.selectionStart ?? 0, end = input.selectionEnd ?? start;
      if (start !== end || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Backspace' && start > 1 && input.value[start - 1] === '.') {
        event.preventDefault();
        update(input, input.value.slice(0, start - 2) + input.value.slice(start), start - 2, start - 2, event, true);
      } else if (event.key === 'Delete' && input.value[start] === '.') {
        event.preventDefault();
        update(input, input.value.slice(0, start) + input.value.slice(start + 2), start, start, event, true);
      }
    }} />;
}
