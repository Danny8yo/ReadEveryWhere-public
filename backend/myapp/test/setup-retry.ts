// CI 上偶发失败的用例自动重跑一次，并先打印首次失败的完整错误，留下排查证据；
// 重跑仍失败才算失败。本地不重试，失败直接暴露。
if (process.env.CI) jest.retryTimes(1, { logErrorsBeforeRetry: true });
