import { describe, expect, it } from 'vitest';
import { buildStagePlan, createMockGoClient } from '@/lib/go/mock/mockGoClient';
import { MarketFixtures, ScenarioStep } from '@/lib/go/mock/types';

describe('buildStagePlan', () => {
  const steps: ScenarioStep[] = [
    { kind: 'intro', stage: 'Start', title: 'Start' },
    { kind: 'result', stage: 'Decision', title: 'Referred' },
    { kind: 'upload', stage: 'Proof', title: 'Proof' },
    { kind: 'result', stage: 'Decision', title: 'Final' },
  ];

  it('marks earlier stages done and later ones upcoming, one entry per distinct label', () => {
    expect(buildStagePlan(steps, 0)).toEqual([
      { label: 'Start', state: 'active' },
      { label: 'Decision', state: 'upcoming' },
      { label: 'Proof', state: 'upcoming' },
    ]);
  });

  it('flips a repeated stage label back to active on its second occurrence', () => {
    // Northbank's own "Decision" stage appears twice (the referral result,
    // then the final result after manual review) — matching by label against
    // the current step, not by position, is what lets the rail show it as
    // active again rather than stuck on "done".
    expect(buildStagePlan(steps, 3)).toEqual([
      { label: 'Start', state: 'done' },
      { label: 'Decision', state: 'active' },
      { label: 'Proof', state: 'done' },
    ]);
  });
});

const fixtures: MarketFixtures = {
  defaultScenarioId: 'a',
  scenarios: {
    a: {
      id: 'a',
      label: 'A',
      steps: [
        {
          kind: 'choice',
          stage: 'Who',
          title: 'Who are you?',
          options: [
            { value: 'self', label: 'Self' },
            { value: 'other', label: 'Other', branchTo: 'b' },
          ],
        },
        { kind: 'result', stage: 'Decision', title: 'A wins', summary: [{ k: 'x', v: 'y' }] },
      ],
    },
    b: {
      id: 'b',
      label: 'B',
      steps: [
        { kind: 'choice', stage: 'Who', title: 'Who are you?' },
        { kind: 'result', stage: 'Decision', title: 'B wins', summary: [{ k: 'x', v: 'y' }] },
      ],
    },
  },
};

describe('createMockGoClient', () => {
  it('rejects a submit against a stale interactionId', async () => {
    const client = createMockGoClient(fixtures);
    const { instanceId } = await client.startJourney('resource', undefined, null);

    await expect(client.submitInteraction(instanceId, 'not-the-current-one', {})).rejects.toMatchObject({
      code: 'INTERACTION_STALE',
    });
  });

  it('switches scenario when the chosen option has a branchTo differing from the current scenario', async () => {
    const client = createMockGoClient(fixtures);
    const { instanceId, interaction } = await client.startJourney('resource', undefined, null);

    const result = await client.submitInteraction(instanceId, interaction.interactionId, { value: 'other' });

    expect(result.interaction.title).toBe('B wins');
  });

  it('stays on the same scenario when the chosen option has no branchTo', async () => {
    const client = createMockGoClient(fixtures);
    const { instanceId, interaction } = await client.startJourney('resource', undefined, null);

    const result = await client.submitInteraction(instanceId, interaction.interactionId, { value: 'self' });

    expect(result.interaction.title).toBe('A wins');
  });

  it('falls back to the default scenario when scenarioHint is unrecognised', async () => {
    const client = createMockGoClient(fixtures);

    const started = await client.startJourney('resource', undefined, 'not-a-real-scenario');

    expect(started.interaction.stage).toBe('Who');
  });

  it('clamps advancing past the final step rather than throwing', async () => {
    const client = createMockGoClient(fixtures);
    const { instanceId, interaction } = await client.startJourney('resource', undefined, 'b');
    const afterFirst = await client.submitInteraction(instanceId, interaction.interactionId, {});

    const afterSecond = await client.submitInteraction(instanceId, afterFirst.interaction.interactionId, {});

    expect(afterSecond.interaction.title).toBe('B wins');
    expect(afterSecond.status).toBe('Completed');
  });
});
