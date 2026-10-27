import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { parseCop, toDatabaseMoney } from '../domain/money';
import { CopInput, formatCopDraft } from './CopInput';

afterEach(cleanup);
function Form({ submit = vi.fn(), initial = '' }: { submit?: (value: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <form onSubmit={event => { event.preventDefault(); submit(toDatabaseMoney(parseCop(value))); }}>
    <label>Importe<CopInput required value={value} onChange={event => setValue(event.target.value)} /></label>
    <button>Guardar</button>
  </form>;
}
function input() { return screen.getByRole('textbox', { name: 'Importe' }) as HTMLInputElement; }
function paste(text: string) { fireEvent.paste(input(), { clipboardData: { getData: () => text } }); }

it.each(['1500000', '200000', '123456789', '90071992547409931234567890,01'])('formats %s without losing decimal precision', value => {
  const formatted = formatCopDraft(value);
  expect(toDatabaseMoney(parseCop(formatted))).toBe(value.replace(',', '.') + (value.includes(',') ? '' : '.00'));
  expect(formatCopDraft(formatted)).toBe(formatted);
});
it.each(['-1', '1e6', '1,234', '12.34', 'abc123', 'NaN', '0012', '1,,2'])('preserves invalid %s without truncating it', value => {
  expect(formatCopDraft(value)).toBe(value);
  render(<Form />); paste(value);
  expect(input()).toHaveValue(value);
  expect(input().validity.valid).toBe(false);
});
it('formats each keystroke and submits the exact amount in database notation', async () => {
  const user = userEvent.setup(), submit = vi.fn(); render(<Form submit={submit} />);
  await user.type(input(), '200000,15');
  expect(input()).toHaveValue('200.000,15');
  expect(input().selectionStart).toBe(10);
  await user.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(submit).toHaveBeenCalledWith('200000.15');
});
it('keeps the cursor beside an inserted middle digit', async () => {
  const user = userEvent.setup(); render(<Form initial="12.345" />);
  input().focus(); input().setSelectionRange(1, 1);
  await user.keyboard('9');
  expect(input()).toHaveValue('192.345'); expect(input().selectionStart).toBe(2);
});
it('supports replacing a partial selection by paste and clearing the whole amount', async () => {
  const user = userEvent.setup(); render(<Form initial="1.234.567" />);
  input().focus(); input().setSelectionRange(2, 5); paste('9000');
  expect(input()).toHaveValue('19.000.567'); expect(input().selectionStart).toBe(6);
  await user.clear(input()); expect(input()).toHaveValue('');
});
it('deletes across grouping separators in both directions without getting stuck', async () => {
  const user = userEvent.setup(); render(<Form initial="12.345" />);
  input().focus(); input().setSelectionRange(3, 3); await user.keyboard('{Backspace}');
  expect(input()).toHaveValue('1.345'); expect(input().selectionStart).toBe(1);
  input().setSelectionRange(1, 1); await user.keyboard('{Delete}');
  expect(input()).toHaveValue('145'); expect(input().selectionStart).toBe(1);
});
it('keeps zero editable when deleting the leading digit before a separator', async () => {
  const user = userEvent.setup(); render(<Form initial="1.000" />);
  input().focus(); input().setSelectionRange(2, 2); await user.keyboard('{Backspace}');
  expect(input()).toHaveValue('0');
  await user.keyboard('{End}5'); expect(input()).toHaveValue('5');
});
it('keeps cents while editing and prevents submission of an invalid pasted value', async () => {
  const user = userEvent.setup(), submit = vi.fn(); render(<Form submit={submit} initial="1.000,25" />);
  input().focus(); input().setSelectionRange(0, 8); paste('500000,03');
  expect(input()).toHaveValue('500.000,03');
  input().setSelectionRange(0, input().value.length); paste('200000,123');
  expect(input()).toHaveValue('200000,123');
  await user.click(screen.getByRole('button', { name: 'Guardar' })); expect(submit).not.toHaveBeenCalled();
});
