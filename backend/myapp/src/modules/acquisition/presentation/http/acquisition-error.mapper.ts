import { AppException } from "../../../../platform/http/app-exception";
import { AcquisitionError } from "../../domain/acquisition.error";

export function throwAcquisitionHttpError(error: unknown): never {
  if (!(error instanceof AcquisitionError)) throw error;
  if (error.kind === "VALIDATION") throw AppException.validation(error.field, error.message);
  if (error.kind === "NOT_FOUND") throw AppException.notFound(error.field, error.message);
  if (error.kind === "UPSTREAM") throw AppException.upstreamUnavailable(error.message);
  throw AppException.internal(error.message);
}
