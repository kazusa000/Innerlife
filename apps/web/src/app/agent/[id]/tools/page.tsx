import ToolsManagerShell from './ToolsManagerShell'

export default async function AgentToolsPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return <ToolsManagerShell agentId={id} />
}
