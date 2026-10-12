import { ConsentCheck, Decision, FieldSchema, ModuleRun, ScreenKind, SummaryRow } from '../../dto/types';

/** Mock-only routing metadata — branchTo is never sent to the client, dropped when mapped to ChoiceOption. */
export interface ScenarioOption {
  value: string;
  label: string;
  detail?: string;
  icon?: string;
  branchTo?: string;
}

export interface ScenarioStep {
  kind: ScreenKind;
  stage: string;
  eyebrow?: string;
  title: string;
  body?: string;
  note?: string;
  cta?: string;
  secondaryCta?: string;
  captureType?: string;
  accepted?: string[];
  fields?: FieldSchema[];
  options?: ScenarioOption[];
  checks?: ConsentCheck[];
  modules?: string[];
  moduleRuns?: ModuleRun[];
  decision?: Decision;
  timing?: string;
  summary?: SummaryRow[];
  recordNote?: string;
}

export interface Scenario {
  id: string;
  label: string;
  steps: ScenarioStep[];
}

export interface MarketFixtures {
  defaultScenarioId: string;
  scenarios: Record<string, Scenario>;
}
