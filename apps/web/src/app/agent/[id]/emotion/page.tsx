import EmotionManagerShell from './EmotionManagerShell'

export default async function AgentEmotionPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return <EmotionManagerShell agentId={id} />
}
