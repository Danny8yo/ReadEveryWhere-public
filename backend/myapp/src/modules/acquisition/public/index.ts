export { AcquisitionModule } from "../acquisition.module";
export {
  SOURCE_SETTINGS_QUERY_PORT,
  type SourceSettingsQuery,
  type SourceSettingsQueryPort,
} from "./source-settings-query.port";
export type {
  DownloadedArtifact,
  DownloadSourceOptions,
  DownloadSourcePort,
  RawSearchItem,
  RawSearchPage,
  SearchSourcePort,
  SourceLoginPort,
  SourceLoginResult,
  SourcePlatform,
} from "./source-adapter.port";
