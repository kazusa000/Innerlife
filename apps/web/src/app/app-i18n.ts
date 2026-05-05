import { AGENT_MANAGER_TILES, type AgentManagerTile } from './manager-tiles'

export type AppLocale = 'zh-CN' | 'en-US'

export function normalizeLocale(value: unknown): AppLocale {
  return value === 'en-US' ? 'en-US' : 'zh-CN'
}

const MANAGER_TILE_COPY: Record<AppLocale, Record<AgentManagerTile['section'], Pick<AgentManagerTile, 'title' | 'subtitle'>>> = {
  'zh-CN': {
    personality: { title: '人设', subtitle: 'system prompt、persona prompt' },
    emotion: { title: '情绪', subtitle: '状态、衰减、分析' },
    relationships: { title: '关系', subtitle: '连结、信任、历史' },
    memory: { title: '记忆', subtitle: '归档、搜索、整理' },
    tools: { title: '工具', subtitle: '开关、提示、可用性' },
    turing: { title: '图灵测试', subtitle: '自动评测、报告、回放' },
  },
  'en-US': {
    personality: { title: 'Persona', subtitle: 'system prompt, persona prompt' },
    emotion: { title: 'Emotion', subtitle: 'state, decay, analysis' },
    relationships: { title: 'Relationships', subtitle: 'connection, trust, history' },
    memory: { title: 'Memory', subtitle: 'archive, search, consolidation' },
    tools: { title: 'Tools', subtitle: 'toggles, prompts, availability' },
    turing: { title: 'Turing Tests', subtitle: 'evaluation, reports, replay' },
  },
}

export function getManagerTiles(locale: AppLocale): AgentManagerTile[] {
  const copy = MANAGER_TILE_COPY[locale]
  return AGENT_MANAGER_TILES.map((tile) => ({
    ...tile,
    ...copy[tile.section],
  }))
}

export function getHomeCopy(locale: AppLocale) {
  if (locale === 'en-US') {
    return {
      title: 'Persona Hall',
      subtitle: 'Manage virtual personas, relationship state, memory systems, and runtime entry points from one control surface.',
      systemLanguage: 'System language',
      zhLanguage: '中文',
      enLanguage: 'English',
      newAgent: 'New Persona',
      personaBuilder: 'Persona Builder',
      editAgent: 'Edit Persona',
      createAgent: 'Create Persona',
      collapse: 'Collapse',
      name: 'Name',
      namePlaceholder: 'For example Hazel, Orion, Sage',
      description: 'Description',
      descriptionPlaceholder: 'For example: a quiet companion who listens late at night and likes stargazing',
      provider: 'Model provider',
      model: 'Model',
      modelOpenRouterPlaceholder: 'For example anthropic/claude-sonnet-4.6, openai/gpt-5.2',
      modelAnthropicPlaceholder: 'For example claude-sonnet-4-6, claude-haiku-4-5-20251001',
      emotionScheme: 'Emotion scheme',
      relationshipScheme: 'Relationship scheme',
      memoryScheme: 'Memory scheme',
      saveChanges: 'Save changes',
      cancel: 'Cancel',
      noPersonaOnline: 'No persona online',
      emptyTitle: 'No personas yet',
      emptyBody: 'Create a persona first, then open chat, persona, emotion, relationship, and memory management.',
      createFirst: 'Create first persona',
      rosterLabel: 'Roster',
      rosterTitle: 'Virtual Personas',
      currentAgentLabel: 'Current persona',
      noDescription: 'This persona has no description yet. Open the persona page to add background, voice, and interaction boundaries.',
      coreModules: 'Core modules',
      relationshipSystem: 'Relationship system',
      memorySystem: 'Memory system',
      openChat: 'Open Chat',
      personaProfile: 'Persona Profile',
      editBasicInfo: 'Edit Basic Info',
      deleteAgent: 'Delete Persona',
      systemsLabel: 'Systems',
      systemsTitle: 'Persona Systems',
      deleteConfirm: 'Delete this persona and all of its conversations?',
      deleteFailed: 'Delete failed',
      languageUpdateFailed: 'Failed to update language.',
      moduleTitles: {
        personality: 'Persona',
        emotion: 'Emotion',
        relationships: 'Relationships',
        memory: 'Memory',
      },
      moduleSubtitles: {
        personality: 'Prompt and profile',
        emotion: 'Mood, energy, stress',
        relationships: 'Trust, familiarity, affinity',
        memory: 'Search, archive, context',
      },
      moduleValues: {
        configured: 'Configured',
        unconfigured: 'Not configured',
        off: 'Off',
        multiObject: 'Multi-object',
        multiDim: 'Multi-dimensional',
      },
    }
  }

  return {
    title: '角色大厅',
    subtitle: '管理你的虚拟人格、关系状态、记忆系统和运行入口。这里是进入每个角色之前的总控台。',
    systemLanguage: '系统语言',
    zhLanguage: '中文',
    enLanguage: 'English',
    newAgent: '新建虚拟人',
    personaBuilder: 'Persona Builder',
    editAgent: '编辑虚拟人',
    createAgent: '创建虚拟人',
    collapse: '收起',
    name: '名称',
    namePlaceholder: '例如 Hazel、Orion、Sage',
    description: '描述',
    descriptionPlaceholder: '例如：一位喜欢深夜倾听和看星星的安静陪伴者',
    provider: '模型提供方',
    model: '模型',
    modelOpenRouterPlaceholder: '例如 anthropic/claude-sonnet-4.6、openai/gpt-5.2',
    modelAnthropicPlaceholder: '例如 claude-sonnet-4-6、claude-haiku-4-5-20251001',
    emotionScheme: '情绪方案',
    relationshipScheme: '关系方案',
    memoryScheme: '记忆方案',
    saveChanges: '保存更改',
    cancel: '取消',
    noPersonaOnline: 'No persona online',
    emptyTitle: '还没有虚拟人',
    emptyBody: '先创建一个角色，再进入聊天、人设、情绪、关系和记忆管理。',
    createFirst: '创建第一个虚拟人',
    rosterLabel: 'Roster',
    rosterTitle: '虚拟人格',
    currentAgentLabel: '当前虚拟人',
    noDescription: '这个虚拟人还没有描述。可以进入人设页补充角色背景、说话风格和互动边界。',
    coreModules: '核心模块',
    relationshipSystem: '关系系统',
    memorySystem: '记忆系统',
    openChat: '打开聊天',
    personaProfile: '人设档案',
    editBasicInfo: '编辑基础信息',
    deleteAgent: '删除虚拟人',
    systemsLabel: 'Systems',
    systemsTitle: '角色系统',
    deleteConfirm: '删除这个虚拟人及其全部对话吗？',
    deleteFailed: '删除失败',
    languageUpdateFailed: '语言更新失败。',
    moduleTitles: {
      personality: '人设',
      emotion: '情绪',
      relationships: '关系',
      memory: '记忆',
    },
    moduleSubtitles: {
      personality: 'Prompt 与角色档案',
      emotion: '心境、能量、压力',
      relationships: '信任、熟悉、亲近',
      memory: '检索、归档、上下文',
    },
    moduleValues: {
      configured: '已配置',
      unconfigured: '未配置',
      off: '关闭',
      multiObject: '多对象',
      multiDim: '多维',
    },
  }
}
