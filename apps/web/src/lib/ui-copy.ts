export type UiLocale = 'zh-CN' | 'en-US'

export const COMMON_UI_COPY_BY_LOCALE = {
  'zh-CN': {
    backToPersonas: '返回虚拟人列表',
    openChat: '打开聊天',
    unifiedEntry: '统一入口',
    agent: '虚拟人',
    scheme: '方案',
    saveChanges: '保存更改',
    saving: '保存中…',
    expand: '展开',
    collapse: '收起',
    unconfigured: '未配置',
  },
  'en-US': {
    backToPersonas: 'Back to Personas',
    openChat: 'Open Chat',
    unifiedEntry: 'Unified Entry',
    agent: 'Persona',
    scheme: 'Scheme',
    saveChanges: 'Save Changes',
    saving: 'Saving...',
    expand: 'Expand',
    collapse: 'Collapse',
    unconfigured: 'Unconfigured',
  },
} as const

export const COMMON_UI_COPY = COMMON_UI_COPY_BY_LOCALE['zh-CN']

export function getCommonUiCopy(locale: UiLocale) {
  return COMMON_UI_COPY_BY_LOCALE[locale]
}

export const PROMPT_TEST_COPY_BY_LOCALE = {
  'zh-CN': {
    emptyResponse: '接口返回了空响应',
    emptyErrorResponse: '接口返回了空错误响应',
    nonJsonResponse: '接口返回了非 JSON 响应',
    nonJsonErrorResponse: '接口返回了非 JSON 错误响应',
    loadSampleFailed: '加载 prompt 测试样例失败',
    invalidJson: '输入必须是 JSON',
    invalidJsonPrefix: '输入 JSON 无效',
    runFailed: '运行 prompt 测试失败',
    saveFailed: '保存 prompt 测试样例失败',
    resetFailed: '重置 prompt 测试样例失败',
    panelTitle: '测试面板',
    saving: '保存中…',
    saveSample: '保存样例',
    resetSample: '重置样例',
    running: '运行中…',
    runTest: '运行测试',
    outputPlaceholder: '运行后显示实际输出。',
  },
  'en-US': {
    emptyResponse: 'The API returned an empty response',
    emptyErrorResponse: 'The API returned an empty error response',
    nonJsonResponse: 'The API returned a non-JSON response',
    nonJsonErrorResponse: 'The API returned a non-JSON error response',
    loadSampleFailed: 'Failed to load the prompt test sample',
    invalidJson: 'Input must be JSON',
    invalidJsonPrefix: 'Invalid input JSON',
    runFailed: 'Failed to run the prompt test',
    saveFailed: 'Failed to save the prompt test sample',
    resetFailed: 'Failed to reset the prompt test sample',
    panelTitle: 'Test Panel',
    saving: 'Saving...',
    saveSample: 'Save Sample',
    resetSample: 'Reset Sample',
    running: 'Running...',
    runTest: 'Run Test',
    outputPlaceholder: 'Run the test to show the actual output.',
  },
} as const

export function getPromptTestCopy(locale: UiLocale) {
  return PROMPT_TEST_COPY_BY_LOCALE[locale]
}

export const OBSERVER_UI_COPY_BY_LOCALE = {
  'zh-CN': {
    title: '观测器',
    sessions: '会话',
    untitled: '未命名',
    clearAllData: '清空全部观测记录',
    clearAllDataConfirm: '删除全部 Observer 数据？此操作无法撤销。',
    selectCall: '选择一个调用查看详情。',
    loading: '加载中…',
    input: '输入',
    output: '输出',
    system: '系统提示',
    tools: '工具',
    history: '历史消息',
    metadata: '元数据',
    compaction: '压缩',
    emotion: '情绪',
    memory: '记忆',
    response: '响应',
    messages: '消息',
    toolsSchema: '工具 schema',
    finalSystemPrompt: '最终 system prompt',
    model: '模型',
    duration: '耗时',
    fragments: '片段',
    stop: '停止原因',
    inputTokens: '输入',
    outputTokens: '输出',
    running: '运行中',
    finished: '已结束',
    phase: '阶段',
    keywords: '关键词',
    timeRange: '时间范围',
    hits: '命中',
    written: '写入结果',
    report: '报告',
    before: '变更前',
    after: '变更后',
    delta: '变化量',
    trigger: '触发原因',
    analysis: '分析',
    latestEmotionState: '最新 emotion_state 记录',
    waitingMessageSnapshot: '等待该调用的消息快照…',
    pending: '等待中',
    none: '无',
    empty: '（空）',
    expand: '展开',
    collapse: '收起',
    originalPrompt: '原 prompt',
    originalResponse: '原 response',
    emotionDeltaTitle: '情绪.变化量',
    relationshipDeltaTitle: '关系.变化量',
    counterpart: '对象',
    counterpartId: '对象 ID',
    thinking: '思考',
    personality: '性格',
    turnCompactionLine: (count: string | number) => `本轮压缩：${count} 条 → 1 条摘要`,
    graphTrace: 'Graph Trace',
    textQuery: 'Text Query',
    mentions: 'Mentions',
    mentionCandidates: 'Mention Candidates',
    activatedEntities: 'Activated Entities',
    hitEntityLinks: 'Hit Entity Links',
    start: '开始',
    end: '结束',
    error: '错误',
    mode: '模式',
    retrievalRewrite: '检索改写',
    inputPreview: '输入预览',
    mergedQuery: 'Merged Query',
    noHits: '无命中',
    memoryId: '记忆 ID',
    layer: '层级',
    summaryRetrievalText: '摘要 / 检索文本',
    importance: '重要性',
    writeId: '写入 ID',
    beforeCount: '整理前',
    afterCount: '整理后',
    kept: '保留',
    rewritten: '重写',
    merged: '合并',
    toolUse: '工具调用',
    toolResult: '工具结果',
    result: '结果',
    summaryCompaction: '本轮压缩',
    mainTurn: '主对话',
    retrieve: '检索',
    summarize: '总结',
    consolidate: '整理',
  },
  'en-US': {
    title: 'Observer',
    sessions: 'Sessions',
    untitled: 'Untitled',
    clearAllData: 'Clear all observer records',
    clearAllDataConfirm: 'Delete all Observer data? This cannot be undone.',
    selectCall: 'Select a call to inspect details.',
    loading: 'Loading...',
    input: 'Input',
    output: 'Output',
    system: 'System Prompt',
    tools: 'Tools',
    history: 'Message History',
    metadata: 'Metadata',
    compaction: 'Compaction',
    emotion: 'Emotion',
    memory: 'Memory',
    response: 'Response',
    messages: 'Messages',
    toolsSchema: 'Tool Schema',
    finalSystemPrompt: 'Final System Prompt',
    model: 'Model',
    duration: 'Duration',
    fragments: 'Fragments',
    stop: 'Stop Reason',
    inputTokens: 'Input',
    outputTokens: 'Output',
    running: 'Running',
    finished: 'Finished',
    phase: 'Phase',
    keywords: 'Keywords',
    timeRange: 'Time Range',
    hits: 'Hits',
    written: 'Write Result',
    report: 'Report',
    before: 'Before',
    after: 'After',
    delta: 'Delta',
    trigger: 'Trigger',
    analysis: 'Analysis',
    latestEmotionState: 'Latest emotion_state record',
    waitingMessageSnapshot: 'Waiting for the message snapshot for this call...',
    pending: 'Pending',
    none: 'None',
    empty: '(empty)',
    expand: 'Expand',
    collapse: 'Collapse',
    originalPrompt: 'Raw Prompt',
    originalResponse: 'Raw Response',
    emotionDeltaTitle: 'Emotion Delta',
    relationshipDeltaTitle: 'Relationship Delta',
    counterpart: 'Counterpart',
    counterpartId: 'Counterpart ID',
    thinking: 'Thinking',
    personality: 'Personality',
    turnCompactionLine: (count: string | number) => `Turn compaction: ${count} messages -> 1 summary`,
    graphTrace: 'Graph Trace',
    textQuery: 'Text Query',
    mentions: 'Mentions',
    mentionCandidates: 'Mention Candidates',
    activatedEntities: 'Activated Entities',
    hitEntityLinks: 'Hit Entity Links',
    start: 'Start',
    end: 'End',
    error: 'Error',
    mode: 'Mode',
    retrievalRewrite: 'Retrieval Rewrite',
    inputPreview: 'Input Preview',
    mergedQuery: 'Merged Query',
    noHits: 'No hits',
    memoryId: 'Memory ID',
    layer: 'Layer',
    summaryRetrievalText: 'Summary / Retrieval Text',
    importance: 'Importance',
    writeId: 'Write ID',
    beforeCount: 'Before',
    afterCount: 'After',
    kept: 'Kept',
    rewritten: 'Rewritten',
    merged: 'Merged',
    toolUse: 'Tool Use',
    toolResult: 'Tool Result',
    result: 'Result',
    summaryCompaction: 'Turn Compaction',
    mainTurn: 'Main Turn',
    retrieve: 'Retrieve',
    summarize: 'Summarize',
    consolidate: 'Consolidate',
  },
} as const

export const OBSERVER_UI_COPY = OBSERVER_UI_COPY_BY_LOCALE['zh-CN']

export function getObserverUiCopy(locale: UiLocale) {
  return OBSERVER_UI_COPY_BY_LOCALE[locale]
}

export const LEGACY_COMMON_UI_COPY = {
  backToPersonas: '返回虚拟人列表',
  openChat: '打开聊天',
  unifiedEntry: '统一入口',
  agent: '虚拟人',
  scheme: '方案',
  saveChanges: '保存更改',
  saving: '保存中…',
  expand: '展开',
  collapse: '收起',
  unconfigured: '未配置',
} as const

export function translateRole(role: string, locale: UiLocale = 'zh-CN') {
  if (locale === 'en-US') {
    if (role === 'user') return 'User'
    if (role === 'assistant') return 'Assistant'
    if (role === 'system') return 'System'
    return role
  }
  if (role === 'user') return '用户'
  if (role === 'assistant') return '助手'
  if (role === 'system') return '系统'
  return role
}

export function translateObserverTab(tab: string, locale: UiLocale = 'zh-CN') {
  const copy = getObserverUiCopy(locale)
  if (tab === 'system') return copy.system
  if (tab === 'tools') return copy.tools
  if (tab === 'history') return copy.history
  if (tab === 'metadata') return copy.metadata
  if (tab === 'compaction') return copy.compaction
  if (tab === 'emotion') return copy.emotion
  if (tab === 'memory') return copy.memory
  if (tab === 'response') return copy.response
  return tab
}

export function translateCallKind(kind: string, locale: UiLocale = 'zh-CN') {
  const copy = getObserverUiCopy(locale)
  if (kind === 'compaction') return copy.compaction
  if (kind === 'memory') return copy.memory
  if (kind === 'emotion') return copy.emotion
  if (kind === 'relationship') return locale === 'en-US' ? 'Relationship' : '关系'
  if (kind === 'turn') return copy.mainTurn
  return kind
}

export function translateMemoryPhase(phase: string, locale: UiLocale = 'zh-CN') {
  const copy = getObserverUiCopy(locale)
  if (phase === 'retrieve') return copy.retrieve
  if (phase === 'summarize') return copy.summarize
  if (phase === 'consolidate') return copy.consolidate
  return phase
}
