import { IsBoolean, IsOptional, IsString } from "class-validator";

export class RequestBookAnalysisDto {
  @IsOptional()
  @IsBoolean()
  force = false;
}

export class ApplyBookAnalysisCandidateDto {
  @IsString()
  candidateId!: string;

  @IsOptional()
  @IsBoolean()
  override = false;
}
