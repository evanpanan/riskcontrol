import { addClientPosition, updateClientPosition, removeClientPosition, executeInstitutionTopup, requestClientExit, cancelClientExit, settleClientPosition, syncBatchFinance, type BatchLike } from './riskEngine';
export interface FinanceCommand { type: 'topup' | 'client_add' | 'client_update' | 'client_remove' | 'exit_request' | 'exit_cancel' | 'settle' | 'client_status' | 'batch_update'; input: Record<string, any>; }
export function applyFinanceCommand(batch: BatchLike, command: FinanceCommand): any {
  const p = command.input;
  switch (command.type) {
    case 'topup': return executeInstitutionTopup(batch, p as any);
    case 'client_add': return addClientPosition(batch, p as any);
    case 'client_update': return updateClientPosition(batch, p.clientId, p.patch);
    case 'client_remove': return removeClientPosition(batch, p.clientId);
    case 'exit_request': return requestClientExit(batch, p.clientId, p);
    case 'exit_cancel': return cancelClientExit(batch, p.clientId, p);
    case 'settle': return settleClientPosition(batch, p.clientId, p);
    case 'client_status': {
      if (p.status === 'EXIT_REQUESTED') return requestClientExit(batch, p.clientId, p);
      if (p.status === 'ACTIVE') return cancelClientExit(batch, p.clientId, p);
      throw new Error('请使用正式结算流程');
    }
    case 'batch_update': Object.assign(batch, p); syncBatchFinance(batch); return;
    default: throw new Error('不支持的账本操作');
  }
}
