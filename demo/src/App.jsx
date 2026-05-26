import KnowledgeTreeWidget from '../../index.jsx'

export default function App() {
  return (
    <KnowledgeTreeWidget
      agentConfig={{ apiUrl: '/api/messages' }}
    />
  )
}
