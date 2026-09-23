export interface TokenEstimator {
  readonly tokenizerId: string;
  encode(value: string): number[];
  count(value: string): number;
}

export interface TokenEstimatorCatalog {
  require(tokenizerId: string): TokenEstimator;
}

export class TokenEstimatorRegistry implements TokenEstimatorCatalog {
  private readonly estimators: Map<string, TokenEstimator>;

  constructor(estimators: readonly TokenEstimator[]) {
    this.estimators = new Map(estimators.map((estimator) => [estimator.tokenizerId, estimator]));
    if (this.estimators.size !== estimators.length) throw new Error("DUPLICATE_TOKEN_ESTIMATOR");
  }

  require(tokenizerId: string): TokenEstimator {
    const estimator = this.estimators.get(tokenizerId);
    if (!estimator) throw new Error(`TOKENIZER_UNAVAILABLE:${tokenizerId}`);
    return estimator;
  }
}
