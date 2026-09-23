export interface SourceSettingsQuery {
  sourcePlatform: "zlibrary";
  userId?: number;
}

export interface SourceSettingsQueryPort {
  resolveBaseUrl(query: Readonly<SourceSettingsQuery>): string;
}

export const SOURCE_SETTINGS_QUERY_PORT = Symbol(
  "ACQUISITION_SOURCE_SETTINGS_QUERY_PORT",
);
