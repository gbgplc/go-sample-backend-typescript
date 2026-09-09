import { describe, expect, it } from 'vitest';
import { validateScreenPlanStage } from '@/lib/config';
import { meridianHealth } from '@/lib/config/markets/meridianHealth';
import { northbank } from '@/lib/config/markets/northbank';
import { ridgelinePlay } from '@/lib/config/markets/ridgelinePlay';
import { ScreenPlanStage } from '@/lib/config/types';

describe('each market config validates cleanly as-is', () => {
  it.each([
    ['northbank', northbank],
    ['meridian-health', meridianHealth],
    ['ridgeline-play', ridgelinePlay],
  ])('%s', (marketId, config) => {
    expect(() =>
      config.screenPlan.stages.forEach((stage, i) => validateScreenPlanStage(stage, marketId, i))
    ).not.toThrow();
  });

  it('meridian-health has a populated screen plan; the other two are empty (no published journey yet)', () => {
    expect(meridianHealth.screenPlan.stages).toHaveLength(3);
    expect(meridianHealth.screenPlan.consentChecks).toHaveLength(3);
    expect(northbank.screenPlan.stages).toHaveLength(0);
    expect(ridgelinePlay.screenPlan.stages).toHaveLength(0);
  });
});

describe('validateScreenPlanStage', () => {
  const validStage: ScreenPlanStage = {
    name: 'document',
    kind: 'capture',
    prefix: 'PrimaryDocument/',
    stage: 'Document',
    title: 'Scan your photo ID',
    body: 'We check the document is genuine.',
  };

  it('accepts a fully populated stage', () => {
    expect(() => validateScreenPlanStage(validStage, 'test-market', 0)).not.toThrow();
  });

  it.each(['name', 'prefix', 'stage', 'title', 'body'] as const)(
    'rejects a stage missing %s — the same mistake compile-time typing used to catch',
    (field) => {
      const broken = { ...validStage, [field]: '' };
      expect(() => validateScreenPlanStage(broken, 'test-market', 0)).toThrow(/test-market/);
    }
  );
});
