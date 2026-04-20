import MemoryManagerShell from './MemoryManagerShell'

export default async function AgentMemoryPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return <MemoryManagerShell agentId={id} />
}
