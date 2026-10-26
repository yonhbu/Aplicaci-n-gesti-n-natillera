import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { Cycle, CycleMember, SavingsContribution } from '../lib/types';
import { MemberPeriodContext, memberPeriodContext } from './MemberPeriodContext';
const cycle = { year: 2026 } as Cycle;
const member = (id:string, patch:Partial<CycleMember> = {}) => ({ id, monthly_quota:'100', participation_start_month:1, participation_end_month:12, savings_status:'active', participates_in_savings:true, participates_in_polla:true, ...patch } as CycleMember);
const pay = (id:string, month:number, amount:string, date='2026-10-01') => ({cycle_member_id:id,applied_year:2026,applied_month:month,amount,effective_date:date} as SavingsContribution);
afterEach(cleanup);
it('counts mode B savings, partials, future entrants and withdrawn people without treating all members as eligible',()=>{
  const members=[member('a'),member('b',{participates_in_polla:false}),member('retired',{savings_status:'withdrawn',participation_end_month:9}),member('future',{participation_start_month:11})];
  expect(memberPeriodContext(cycle,members,[pay('a',10,'100'),pay('b',10,'40')],'2026-10-20')).toEqual({month:10,active:2,withdrawn:1,eligible:2,complete:1,pending:1});
});
it('keeps the existing historic withdrawal population and excludes future and reversed receipts',()=>{
  const members=[member('a'),member('r',{savings_status:'withdrawn',participates_in_savings:false})];
  const payments=[pay('r',9,'100','2026-09-01'),pay('a',9,'100','2026-10-21'),{...pay('a',9,'100','2026-09-01'),status:'reversed'} as SavingsContribution];
  expect(memberPeriodContext(cycle,members,payments,'2026-10-20')).toMatchObject({eligible:1,complete:0,pending:1});
  expect(memberPeriodContext(cycle,members,payments,'2026-09-20')).toMatchObject({eligible:2,complete:1,pending:1});
});
it('renders an empty month without a fabricated participant or division by zero',()=>{
  render(<MemberPeriodContext cycle={cycle} members={[]} contributions={[]} cutDate="2026-10-20" compact />);
  expect(screen.getByText(/0\/0 cuotas completas/)).toHaveTextContent('sin cuotas exigibles');
});
it('shows a complete month dynamically and retains the reference year',()=>{
  render(<MemberPeriodContext cycle={cycle} members={[member('a')]} contributions={[pay('a',9,'100','2026-09-01')]} cutDate="2026-09-20" compact />);
  expect(screen.getByText(/septiembre de 2026/)).toHaveTextContent('1/1 cuotas completas · al día');
});
it('labels current statuses explicitly at a historical cut while keeping the existing quota population',()=>{
  render(<MemberPeriodContext cycle={cycle} members={[member('a'),member('r',{savings_status:'withdrawn'})]} contributions={[pay('r',9,'100','2026-09-01')]} cutDate="2026-09-20" />);
  expect(screen.getByText('Activos actuales del periodo')).toBeVisible();
  expect(screen.getByText('Retirados actuales')).toBeVisible();
  expect(screen.getByText('Estado actual; historial de cambios no disponible.')).toBeVisible();
  expect(screen.getByText('1 de 2')).toBeVisible();
  expect(screen.queryByText('Activos en el periodo')).not.toBeInTheDocument();
});
