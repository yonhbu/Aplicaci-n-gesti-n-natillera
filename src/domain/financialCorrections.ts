import type {FinancialOperation} from '../lib/types';
const reversible=new Set(['savings_contribution_linked','loan_payment','loan_prepayment','loan_disbursement','polla_contribution','polla_prize_awarded','polla_prize_credited','polla_prize_paid','bank_fee','manual_income','manual_expense','bank_external_financing','liquidity_transfer','member_settlement_paid','loan_profit_distribution_paid','admin_withdrawal']);
export function canReverseOperation(operation:FinancialOperation,operations:FinancialOperation[]) {
  return (operation.operation_type.startsWith('personal_funds_')||operation.operation_type==='member_settlement_completion'||operation.operation_type==='bank_opening'||operation.operation_type==='admin_fine_received'||reversible.has(operation.operation_type))&&!operations.some(item=>item.reverses_operation_id===operation.id);
}
