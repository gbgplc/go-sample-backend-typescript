import { ConsentCheck, ScreenKind } from '../dto/types';

/** One screen: which outstanding elements it satisfies, and the copy that goes with it. Mirrors Java's ScreenPlanProperties.Stage. */
export interface ScreenPlanStage {
  name: string;
  kind: ScreenKind;
  prefix: string;
  stage: string;
  title: string;
  body: string;
  cta?: string;
  captureType?: string;
  accepted?: string[];
  modules?: string[];
}

/** Live-mode only. Empty for a market with no published Go journey yet (see HANDOFF.md). */
export interface ScreenPlanConfig {
  stages: ScreenPlanStage[];
  consentChecks: ConsentCheck[];
}

/** Live-mode Go connection shape. Credentials always come from env vars (GBG_CLIENT_ID etc.), never from these market files. */
export interface GoConfig {
  region: string;
  authUrl: string;
  scope: string;
  grantType: 'client_credentials' | 'password';
  baseUrl?: string;
}

export interface AppConfig {
  market: string;
  brand: string;
  mark: string;
  tagline: string;
  accent: string;
  accentSoft: string;
  helpLine: string;
  journeyName: string;
  resourceId: string;
  corsAllowedOrigins: string[];
  consentUrl: string;
}

export interface MarketConfig {
  app: AppConfig;
  go: GoConfig;
  screenPlan: ScreenPlanConfig;
}
