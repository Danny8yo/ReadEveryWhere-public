export function qaReason(code: string): string {
  return (
    (
      {
        TOOL_ARGUMENTS_INVALID: "模型生成的书内工具参数不合法，本轮未完成。",
        MODEL_DECISION_REQUIRED: "模型未提交有效的查阅结论，本轮已停止。",
        MODEL_CONTROL_TOOL_MIXED: "模型混用了结束查阅和书内操作，本轮已停止。",
        MODEL_SEARCH_LIMIT: "模型超出本轮查询改写限制，本轮已停止。",
        EVIDENCE_INVALID: "模型选用了不属于当前轮次的证据，本轮已停止。",
        MODEL_USAGE_INVALID: "模型服务返回的用量数据不合法，本轮已停止，请联系维护者检查。",
        MODEL_OUTPUT_BUDGET_EXCEEDED: "模型输出超过本轮允许的预算，回答未完成。",
        EPUB_PARSE_FAILED: "读取书籍正文失败，本轮已停止，请联系维护者检查。",
        EMPTY_MODEL_ANSWER: "模型未返回回答内容，请重新提问。",
        MODEL_NOT_CONFIGURED: "尚未配置 AI 模型，请前往设置中的模型配置。",
        MODEL_CONFIG_CHANGED: "模型配置已变化，请重新提交新一轮问答。",
        INDEX_RESOURCE_LIMIT:
          "索引达到内存或书籍大小限制，本轮未完成；请检查服务资源后显式重新提问。",
        INDEX_BUILD_FAILED:
          "本书索引构建失败，本轮未完成；这不表示书中没有相关内容。",
        INDEX_NOT_READY: "本书索引尚未完成，请稍后显式重试。",
        CONTENT_VERSION_CHANGED:
          "书籍内容已变化，请重新打开书籍。旧问答仅供查看。",
        CONVERSATION_FROZEN: "这是旧版本会话，请重新打开书籍并选择文字。",
        CONTENT_REVISION_MISMATCH:
          "已加载文件与当前版本不一致，请重新打开书籍。",
        ANNOTATION_CONFLICT: "批注已在其他设备修改，请核对最新原文后重新确认。",
        ANNOTATION_NOT_FOUND: "目标批注已删除，请明确选择其他目标或新建。",
        ANNOTATION_SELECTION_INVALID:
          "该批注并不对应此问答的原选区，请重新选择目标。",
        ACTIVE_TURN_EXISTS: "此会话仍有回答生成中，请先停止或等待完成。",
        USER_STOPPED: "已停止",
        DEADLINE_EXCEEDED: "超过本轮总时间限制",
        OUTPUT_LIMIT: "回答达到输出上限",
        MODEL_STREAM_INCOMPLETE: "模型回答未完整结束",
        CITATION_INVALID: "模型生成了本轮不存在或格式不完整的引用标记，回答已停止；这不代表已核实回答内容",
        worker_interrupted: "服务中断，请显式重试",
        MODEL_CANCELLED: "模型请求已取消",
        READ_BUDGET_EXHAUSTED: "本轮读取字数已达上限",
        RESEARCH_BUDGET_EXHAUSTED: "本轮检索预算已用完",
        INPUT_TOKEN_LIMIT: "本轮上下文过长，请缩短问题或新建对话",
        CONVERSATION_NOT_FOUND: "该对话已删除或无权访问",
        TURN_NOT_FOUND: "该轮问答已删除或无权访问",
        DEEPSEEK_REQUEST_REJECTED: "模型服务拒绝了请求，请联系维护者检查调用协议。",
        DEEPSEEK_AUTH_FAILED: "模型凭据无效，请到设置检查模型配置",
        DEEPSEEK_RATE_LIMITED: "模型服务繁忙，请稍后显式重试",
        DEEPSEEK_TIMEOUT: "模型服务超时",
        DEEPSEEK_NETWORK_ERROR: "无法连接模型服务",
      } as Record<string, string>
    )[code] ?? "本次操作未完成，请刷新记录核对后重试。"
  );
}
