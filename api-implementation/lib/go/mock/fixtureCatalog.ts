import { marketConfig } from '../../config';
import { buildMeridianHealthFixtures } from './fixtures/meridianHealth';
import { buildNorthbankFixtures } from './fixtures/northbank';
import { buildRidgelinePlayFixtures } from './fixtures/ridgelinePlay';
import { MarketFixtures } from './types';

function selectFixtures(): MarketFixtures {
  switch (marketConfig.app.market) {
    case 'meridian-health':
      return buildMeridianHealthFixtures();
    case 'ridgeline-play':
      return buildRidgelinePlayFixtures();
    default:
      // Covers "northbank" and any unrecognised value.
      return buildNorthbankFixtures();
  }
}

export const fixtures: MarketFixtures = selectFixtures();
