import TuringWorkbench from './TuringWorkbench'

export default async function AgentTuringPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return <TuringWorkbench agentId={id} />
}
