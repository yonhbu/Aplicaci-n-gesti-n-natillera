import {useState} from 'react';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Cycle,CycleMember,PollaActivity,PollaContribution,MemberSettlement} from '../lib/types';
const mocks=vi.hoisted(()=>({create:vi.fn(),award:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:{}}));
vi.mock('../data/polla',async original=>({...await original<object>(),createPollaActivity:mocks.create,awardPollaPrizeToCapital:mocks.award}));
import {PollaPanel} from './App';
const cycle={id:'polla-cycle',year:2026,starts_on:'2026-01-01',closes_on:'2026-12-05',status:'active',settlement_rules_version:'fin03-2026'} as Cycle;
const activity={id:'a',name:'Marzo A',period_year:2026,period_month:3,status:'open'} as PollaActivity;
const member=(id:string,status='active')=>({id,participates_in_polla:true,savings_status:status,economic_mode:'collective',member:{display_name:id}} as CycleMember);
const paid=(id:string,status='posted')=>({id:'payment-'+id,activity_id:'a',cycle_member_id:id,amount:'10000',status,paid_date:'2026-03-10'} as PollaContribution);
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(cleanup);
function show(activities=[activity],contributions=[paid('activo'),paid('retirado')]){
 render(<PollaPanel cycle={cycle} cycleMembers={[member('activo'),member('retirado','withdrawn'),member('sin-aporte'),member('revertido')]} activities={activities} contributions={contributions} prizes={[]} ledgerEntries={[]} onSaved={vi.fn().mockResolvedValue(undefined)} onError={vi.fn()}/>);
}
it('ofrece como ganador solo derechos completos de la actividad, conservando al retirado que pagó',()=>{
 show([activity],[paid('activo'),paid('retirado'),paid('revertido','reversed')]);
 fireEvent.click(screen.getByRole('button',{name:'Asignar ganador'}));
 const choices=within(screen.getByRole('combobox',{name:'Ganador'})).getAllByRole('option').map(x=>x.getAttribute('value'));
 expect(choices).toEqual(['','activo','retirado']);
});
it('control: conserva la validación autoritativa de la cuota duplicada',()=>{
 show();fireEvent.click(screen.getByRole('button',{name:'Registrar aporte'}));
 expect(within(screen.getByRole('combobox',{name:'Participante'})).getByRole('option',{name:/activo/})).toBeEnabled();
});
it('contrasta la fecha del aporte con la liquidación, sin excluir derechos anteriores del retirado',()=>{
 render(<PollaPanel {...{settlements:[{cycle_member_id:'retirado',status:'paid',cut_date:'2026-05-15'} as MemberSettlement]}} cycle={cycle} cycleMembers={[member('retirado','withdrawn')]} activities={[activity]} contributions={[]} prizes={[]} ledgerEntries={[]} onSaved={vi.fn()} onError={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Registrar aporte'}));
 const option=within(screen.getByRole('combobox',{name:'Participante'})).getByRole('option',{name:/retirado/});
 expect(option).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Fecha aporte'),{target:{value:'2026-03-10'}});
 expect(option).toBeEnabled();
});
it('selecciona el UUID de la actividad recién creada en el mismo mes',async()=>{
 const created={...activity,id:'b',name:'Marzo B'};mocks.create.mockResolvedValue(created);
 function Harness(){const [activities,setActivities]=useState([activity]);return <PollaPanel cycle={cycle} cycleMembers={[]} activities={activities} contributions={[]} prizes={[]} ledgerEntries={[]} onSaved={async()=>{setActivities([activity,created]);}} onError={vi.fn()}/>;}
 render(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'Nueva polla'}));
 fireEvent.change(screen.getByLabelText('Nombre actividad'),{target:{value:'Marzo B'}});
 fireEvent.change(screen.getByRole('combobox',{name:'Mes'}),{target:{value:'3'}});
 fireEvent.click(screen.getByRole('button',{name:'Crear actividad'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Marzo B'})).toHaveAttribute('aria-pressed','true'));
 expect(screen.getByRole('button',{name:'Marzo A'})).toHaveAttribute('aria-pressed','false');
});
it('conserva consulta de una actividad cancelada y bloquea nuevas operaciones',()=>{
 show([{...activity,cancelled_at:'2026-11-20T10:00:00Z',status:'closed'}]);
 fireEvent.click(screen.getByRole('button',{name:/Ver actividades canceladas/}));
 expect(screen.getByText(/Cancelada/)).toBeVisible();
 expect(screen.getByRole('button',{name:'Registrar aporte'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Asignar ganador'})).toBeDisabled();
});
