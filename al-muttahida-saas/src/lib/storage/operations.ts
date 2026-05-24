import { ClosingPeriod, InstallmentCollectionTask, RescheduleRequest } from '../../types';
import { DB_KEYS, createAuditLog, generateId, getStorage, setStorage } from './core';

export function getCollectionTasks(): InstallmentCollectionTask[] {
  return getStorage<InstallmentCollectionTask>(DB_KEYS.COLLECTION_TASKS);
}

export function createCollectionTask(
  task: Omit<InstallmentCollectionTask, 'id' | 'createdAt' | 'updatedAt'>,
  createdBy: string,
): InstallmentCollectionTask {
  const tasks = getCollectionTasks();
  const newTask: InstallmentCollectionTask = {
    ...task,
    id: generateId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tasks.push(newTask);
  setStorage(DB_KEYS.COLLECTION_TASKS, tasks);
  createAuditLog({ action: 'collection_task.create', entityType: 'collection_task', entityId: newTask.id, payload: newTask, createdBy });
  return newTask;
}

export function getRescheduleRequests(): RescheduleRequest[] {
  return getStorage<RescheduleRequest>(DB_KEYS.RESCHEDULE_REQUESTS);
}

export function createRescheduleRequest(
  req: Omit<RescheduleRequest, 'id' | 'requestedAt' | 'status'>,
): RescheduleRequest {
  const requests = getRescheduleRequests();
  const newReq: RescheduleRequest = {
    ...req,
    id: generateId(),
    requestedAt: new Date().toISOString(),
    status: 'pending',
  };
  requests.push(newReq);
  setStorage(DB_KEYS.RESCHEDULE_REQUESTS, requests);
  createAuditLog({ action: 'reschedule.request', entityType: 'reschedule_request', entityId: newReq.id, payload: newReq, createdBy: req.requestedBy });
  return newReq;
}

export function updateRescheduleRequestStatus(id: string, status: 'approved' | 'rejected', reviewedBy: string): RescheduleRequest {
  const requests = getRescheduleRequests();
  const index = requests.findIndex((r) => r.id === id);
  if (index === -1) throw new Error('طلب إعادة الجدولة غير موجود');
  requests[index] = { ...requests[index], status, reviewedBy, reviewedAt: new Date().toISOString() };
  setStorage(DB_KEYS.RESCHEDULE_REQUESTS, requests);
  createAuditLog({ action: 'reschedule.review', entityType: 'reschedule_request', entityId: id, payload: { status }, createdBy: reviewedBy });
  return requests[index];
}

export function getClosingPeriods(): ClosingPeriod[] {
  return getStorage<ClosingPeriod>(DB_KEYS.CLOSING_PERIODS);
}

export function closePeriod(periodType: 'daily' | 'monthly', periodDate: string, closedBy: string, notes?: string): ClosingPeriod {
  const periods = getClosingPeriods();
  const index = periods.findIndex((p) => p.periodType === periodType && p.periodDate === periodDate);
  if (index !== -1 && periods[index].status === 'closed') return periods[index];

  const period: ClosingPeriod = index === -1
    ? { id: generateId(), periodType, periodDate, status: 'closed', closedBy, closedAt: new Date().toISOString(), notes }
    : { ...periods[index], status: 'closed', closedBy, closedAt: new Date().toISOString(), notes };

  if (index === -1) periods.push(period);
  else periods[index] = period;
  setStorage(DB_KEYS.CLOSING_PERIODS, periods);
  createAuditLog({ action: 'period.close', entityType: 'closing_period', entityId: period.id, payload: { periodType, periodDate }, createdBy: closedBy });
  return period;
}

export function isDateClosed(date: string): boolean {
  const periods = getClosingPeriods();
  const month = date.slice(0, 7);
  return periods.some((p) => p.status === 'closed' && ((p.periodType === 'daily' && p.periodDate === date) || (p.periodType === 'monthly' && p.periodDate === month)));
}

