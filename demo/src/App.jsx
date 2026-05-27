import KnowledgeTreeWidget from '../../index.jsx'
import { TreeCanvas3D } from './TreeCanvas3D.jsx'

export default function App() {
  return (
    <KnowledgeTreeWidget
      agentConfig={{ apiUrl: '/api/messages' }}
      CanvasComponent={TreeCanvas3D}
    />
  )
}
