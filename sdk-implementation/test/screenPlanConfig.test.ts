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

  it('every market has a populated screen plan', () => {
    // Six collection pages, consent first: a patient agrees to their record
    // being opened before anything is collected.
    expect(meridianHealth.screenPlan.stages.map((s) => s.name)).toEqual([
      'consent',
      'personal',
      'contact',
      'address',
      'document',
      'biometrics',
    ]);
    expect(meridianHealth.screenPlan.consentChecks).toHaveLength(3);
    // All three markets now have published journeys and populated plans.
    expect(northbank.screenPlan.stages.map((s) => s.name)).toEqual([
      'personal',
      'contact',
      'details',
      'document',
      'biometrics',
    ]);
    expect(ridgelinePlay.screenPlan.stages.map((s) => s.name)).toEqual([
      'personal',
      'contact',
      'address',
      'previous-addresses',
      'document',
      'biometrics',
    ]);
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
