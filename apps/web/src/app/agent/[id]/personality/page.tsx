import PersonalityManagerShell from './PersonalityManagerShell'

export default async function AgentPersonalityPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return <PersonalityManagerShell agentId={id} />
}
