import { ConsentCheck, ScreenKind } from '../dto/types';

/** One screen: which outstanding elements it satisfies, and the copy that goes with it. Mirrors Java's ScreenPlanProperties.Stage. */
export interface ScreenPlanStage {
  name: string;
  kind: ScreenKind;
  prefix: string;
  /**
   * Extra ref prefixes this screen collects, beyond `prefix`.
   *
   * One screen often collects several domain elements — a personal-details
   * page asking for MothersMaidenName, Gender and NationalInsuranceNumber is
   * three separate top-level elements in `collects`. A single prefix claims
   * only the first, and the screen renders one field out of three.
   */
  alsoPrefixes?: string[];
  /**
   * Run this stage even when Go never lists its elements as outstanding.
   *
   * A journey can accept an element it does not advertise: a document
   * collected lazily is never named in `outstanding`, yet submitting one
   * returns success. Off by default, so a stage nothing claims stays skipped.
   */
  alwaysCollect?: boolean;
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
  consentTerms: string;
}

export interface MarketConfig {
  app: AppConfig;
  go: GoConfig;
  screenPlan: ScreenPlanConfig;
}
