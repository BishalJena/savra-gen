import {
  buildDraftOutline as sharedBuildDraftOutline,
  generateApprovedCacheKey as sharedGenerateApprovedCacheKey,
  validatePresentation as sharedValidatePresentation,
} from '../shared';
import type { GenerateFromOutlineRequest, OutlineRequest, PresentationData } from '../shared';

export function buildDraftOutline(req: OutlineRequest): PresentationData {
  return sharedBuildDraftOutline(req);
}

export function generateApprovedCacheKey(req: GenerateFromOutlineRequest): string {
  return sharedGenerateApprovedCacheKey(req);
}

export function validatePresentation(presentation: PresentationData): string | null {
  return sharedValidatePresentation(presentation);
}
