'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface AppDefaults {
  defaults: { gstPercent: string; wastagePercent: string; markupPercent: string; profitMethod: 'PERCENT' | 'FIXED'; profitValue: string; quotationValidityDays: number; quotationTerms: string; unitId?: string; dimensionUnitId?: string };
  print: { orientation: 'portrait' | 'landscape'; costingMode: 'detailed' | 'summary' | 'product' | 'materials' | 'labour' };
  approval: { costing: { required: boolean; allowSelfApproval: boolean }; quotation: { required: boolean; allowSelfApproval: boolean } };
  financialYearStartMonth: number;
  rules: { decimals: number };
  recalcMode: 'AUTO' | 'CONFIRM' | 'MANUAL';
}

/** Business defaults for pre-filling new documents and for the approval workflow (any signed-in user). */
export function useDefaults() {
  return useQuery({ queryKey: ['settings-defaults'], queryFn: () => api<AppDefaults>('/settings/defaults'), staleTime: 60_000 });
}
