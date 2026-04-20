import RelationshipManagerShell from './RelationshipManagerShell'

export default async function AgentRelationshipsPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  return <RelationshipManagerShell agentId={id} />
}
