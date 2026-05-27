/**
 * TreeCanvas3D.jsx  v4  —  Multi-root 3D canvas
 *
 * Key fix v4: float animation applied to inner <group> so that
 * mesh + HTML labels + click collider all move together.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars, Html, Line, Sparkles } from '@react-three/drei'
import { EffectComposer, Bloom, ChromaticAberration } from '@react-three/postprocessing'
import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import { LEVEL_COLORS } from '../../index.jsx'

// ── Constants ─────────────────────────────────────────────────────

const RADII      = [0, 3.5, 7.0, 10.5, 14.0]   // wider radial spacing to prevent crowding
const NODE_RADII = [0.30, 0.22, 0.17, 0.13, 0.11] // actual sphere mesh radii per level
const Y_STEP     = -2.4
const TREE_X_GAP = 20

const ROOT_THEME_COLORS = ['#f59e0b', '#38bdf8', '#fb7185', '#a78bfa']

// ── Radial layout ─────────────────────────────────────────────────

function countLeaves(nodeId, childMap) {
  const kids = childMap.get(nodeId) || []
  if (!kids.length) return 1
  return kids.reduce((s, c) => s + countLeaves(c.id, childMap), 0)
}

function computeTreeLayout(nodes, edges) {
  const pos  = new Map()
  if (!nodes.length) return pos
  const root = nodes.find(n => n.level === 0)
  if (!root) return pos
  pos.set(root.id, new THREE.Vector3(0, 0, 0))

  const childMap = new Map()
  edges.forEach(([p, c]) => {
    if (!childMap.has(p.id)) childMap.set(p.id, [])
    childMap.get(p.id).push(c)
  })

  function assign(nodeId, a0, a1) {
    const kids   = childMap.get(nodeId) || []
    if (!kids.length) return
    const leaves = kids.map(c => countLeaves(c.id, childMap))
    const total  = leaves.reduce((s, v) => s + v, 0) || 1

    // Enforce minimum arc per child so siblings never crowd/overlap
    const MIN_ARC = 0.38
    const requested = a1 - a0
    const effective = Math.max(requested, kids.length * MIN_ARC)
    const center    = (a0 + a1) / 2
    let a = center - effective / 2

    kids.forEach((kid, i) => {
      const da  = effective * (leaves[i] / total)
      const mid = a + da / 2
      const r   = RADII[Math.min(kid.level, RADII.length - 1)]
      pos.set(kid.id, new THREE.Vector3(r * Math.cos(mid), Y_STEP * kid.level, r * Math.sin(mid)))
      assign(kid.id, a, a + da)
      a += da
    })
  }

  assign(root.id, 0, Math.PI * 2)
  return pos
}

function computeMultiLayout(roots) {
  const allPos = new Map()
  roots.forEach((r, treeIdx) => {
    const offsetX  = treeIdx * TREE_X_GAP
    const treeEdges = (r.edges || []).map(([a, b]) => [
      r.nodes.find(n => n.id === a.id) || a,
      r.nodes.find(n => n.id === b.id) || b,
    ])
    const localPos = computeTreeLayout(r.nodes || [], treeEdges)
    localPos.forEach((v, id) => {
      allPos.set(id, new THREE.Vector3(v.x + offsetX, v.y, v.z))
    })
  })
  return allPos
}

// ── Click burst particles ─────────────────────────────────────────

function ClickBurst({ position, color, onDone }) {
  const age    = useRef(0)
  const groupRef = useRef()

  useFrame((_, delta) => {
    age.current += delta
    if (!groupRef.current) return
    const s = 1 + age.current * 3
    groupRef.current.scale.setScalar(s)
    groupRef.current.children.forEach(c => {
      if (c.material) c.material.opacity = Math.max(0, 1 - age.current * 2.5)
    })
    if (age.current > 0.5) onDone?.()
  })

  const pts = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const angle = (i / 8) * Math.PI * 2
      return new THREE.Vector3(Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, 0)
    })
  }, [])

  return (
    <group ref={groupRef} position={position}>
      {pts.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.05, 4, 4]} />
          <meshBasicMaterial color={color} transparent opacity={1} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

// ── NodeMesh ──────────────────────────────────────────────────────
// Fix: outer group is STATIC at pos; inner floatGroup holds mesh+HTML
// so click collider and visual sphere are always at same position.

function NodeMesh({ node, pos, selected, isAssocHighlight, assocMode, onSelect, onExpand, themeColor, onClickBurst }) {
  const floatGroupRef = useRef()   // inner group — floats up/down
  const meshRef       = useRef()   // mesh — only rotation/scale
  const [hovered, setHovered] = useState(false)

  const c          = LEVEL_COLORS[Math.min(node.level, LEVEL_COLORS.length - 1)]
  const strokeHex  = (node.level === 0 && themeColor) ? themeColor : c.stroke
  const r          = [0.30, 0.22, 0.17, 0.13, 0.11][Math.min(node.level, 4)]
  const strokeColor = useMemo(() => new THREE.Color(strokeHex), [strokeHex])

  const isDone = node.status === 'done'
  const isLoad = node.status === 'loading'
  const isPend = node.status === 'pending'
  const canExp = isDone && !node.children.length && node.hasStrongRelations !== false

  useFrame(state => {
    const t = state.clock.elapsedTime

    // Float inner group (mesh + labels move together — fixes click offset)
    if (floatGroupRef.current && isDone) {
      floatGroupRef.current.position.y = Math.sin(t * 0.9 + node.id * 1.4) * 0.09
    }

    if (!meshRef.current) return

    // Rotation for loading spinner
    if (isLoad) {
      meshRef.current.rotation.y += 0.07
      meshRef.current.rotation.x += 0.04
    }

    // Scale pulse
    const targetScale = selected
      ? 1.3 + Math.sin(t * 4) * 0.08
      : isAssocHighlight ? 1.4 + Math.sin(t * 3) * 0.12
      : hovered ? 1.18 : 1
    meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1)
  })

  const emissiveIntensity = isPend ? 0 : isLoad ? 0.22 : selected ? 1.8 : isAssocHighlight ? 2.2 : hovered ? 1.2 : 0.6

  const handleClick = useCallback(e => {
    e.stopPropagation()
    if (!isDone) return
    onClickBurst?.(pos.clone(), strokeHex)
    onSelect?.(node)
  }, [isDone, pos, strokeHex, node])

  return (
    // Outer group: purely a position anchor, no geometry here.
    <group position={pos}>
      {/* Float group: EVERYTHING visual lives here — glow, ring, mesh, labels.
          This ensures all elements move together so click area = visual position. */}
      <group ref={floatGroupRef}>

        {/* Outer glow halo — skip for root to avoid visual clutter */}
        {!isPend && node.level !== 0 && (
          <mesh>
            <sphereGeometry args={[r * 3.6, 10, 10]} />
            <meshBasicMaterial color={strokeColor} transparent opacity={0.025} side={THREE.BackSide} depthWrite={false} />
          </mesh>
        )}

        {/* Equatorial ring for root nodes */}
        {isDone && node.level === 0 && (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[r * 2.4, 0.014, 8, 48]} />
            <meshBasicMaterial color={strokeColor} transparent opacity={0.32} />
          </mesh>
        )}

        {/* Assoc highlight ring — pulsing pink ring around selected pair */}
        {isAssocHighlight && isDone && (
          <mesh rotation={[Math.PI / 3, 0, 0]}>
            <torusGeometry args={[r * 3.2, 0.022, 8, 56]} />
            <meshBasicMaterial color="#fb7185" transparent opacity={0.7} />
          </mesh>
        )}

        {/* Main sphere (clickable) */}
        <mesh
          ref={meshRef}
          onClick={handleClick}
          onPointerOver={e => { e.stopPropagation(); setHovered(true); document.body.style.cursor = assocMode ? 'crosshair' : 'pointer' }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default' }}
        >
          {isLoad
            ? <icosahedronGeometry args={[r, 1]} />
            : node.level === 0
              ? <dodecahedronGeometry args={[r, 0]} />
              : <sphereGeometry args={[r, 40, 40]} />
          }
          <meshStandardMaterial
            color={isPend ? new THREE.Color('#111') : strokeColor}
            emissive={strokeColor}
            emissiveIntensity={emissiveIntensity}
            wireframe={isLoad}
            transparent opacity={isPend ? 0.08 : 1}
            roughness={0.04} metalness={0.9}
          />
        </mesh>

        {/* Sparkles around root node */}
        {isDone && node.level === 0 && (
          <Sparkles count={20} scale={r * 7} size={0.55} speed={0.45} color={strokeHex} opacity={0.55} />
        )}

        {/* Concept badge above root — lives inside floatGroup so it tracks the floating sphere */}
        {isDone && node.level === 0 && (
          <Html center position={[0, r + 0.72, 0]} zIndexRange={[5, 5]} style={{ pointerEvents: 'none' }}>
            <div style={{
              padding: '2px 10px',
              borderRadius: 20,
              border: `1px solid ${strokeHex}55`,
              background: `${strokeHex}12`,
              color: strokeHex,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: '-apple-system,sans-serif',
              whiteSpace: 'nowrap',
              letterSpacing: '.04em',
              userSelect: 'none',
              textShadow: '0 0 12px #000',
            }}>✦ {node.label}</div>
          </Html>
        )}

        {/* Label (non-root nodes only — root already has the badge above) */}
        {!isPend && node.level !== 0 && (
          <Html center position={[0, -(r + 0.48), 0]} style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[0, 0]}>
            <span style={{
              display: 'block',
              fontSize: node.level === 1 ? 12 : 11,
              fontWeight: 400,
              color: isLoad ? strokeHex : c.text,
              whiteSpace: 'nowrap',
              fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
              textShadow: '0 0 8px #000, 0 0 18px #000',
              opacity: isLoad ? 0.7 : 1,
            }}>
              {node.label.length > 9 ? node.label.slice(0, 8) + '…' : node.label}
            </span>
          </Html>
        )}

        {/* Expand "+" */}
        {canExp && (
          <Html center position={[0, -(r + 0.88), 0]} zIndexRange={[10, 10]}>
            <div
              onClick={e => { e.stopPropagation(); onExpand?.(node.id) }}
              style={{ width:20, height:20, borderRadius:'50%', background:`${c.fill}ee`, border:`1px solid ${strokeHex}`, color:strokeHex, fontSize:16, lineHeight:'19px', textAlign:'center', cursor:'pointer', userSelect:'none', boxShadow:`0 0 10px ${strokeHex}55`, transition:'box-shadow .15s' }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 22px ${strokeHex}bb` }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 0 10px ${strokeHex}55` }}
            >+</div>
          </Html>
        )}
      </group>
    </group>
  )
}

// ── EdgeLine ──────────────────────────────────────────────────────

function EdgeLine({ from, to, fromPos, toPos }) {
  const c      = LEVEL_COLORS[Math.min(to.level, LEVEL_COLORS.length - 1)]
  const active = to.status !== 'pending'

  const points = useMemo(() => {
    const raw1 = fromPos.clone(), raw2 = toPos.clone()
    const dir  = raw2.clone().sub(raw1)
    const dist = dir.length()
    if (dist < 0.001) return [raw1, raw2]
    dir.divideScalar(dist)

    // Start and end at sphere surfaces so lines don't pierce node interiors
    const r1 = NODE_RADII[Math.min(from.level, 4)] + 0.04
    const r2 = NODE_RADII[Math.min(to.level,   4)] + 0.04
    const p1 = raw1.clone().addScaledVector(dir,  r1)
    const p2 = raw2.clone().addScaledVector(dir, -r2)

    const t1 = p1.clone().lerp(p2, 0.3); t1.y = p1.y - 0.45
    const t2 = p1.clone().lerp(p2, 0.7); t2.y = p2.y + 0.45
    return new THREE.CubicBezierCurve3(p1, t1, t2, p2).getPoints(30)
  }, [fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z])

  return (
    <Line points={points} color={active ? c.stroke : '#1e1e2e'} lineWidth={active ? 1.3 : 0.5} transparent opacity={active ? 0.4 : 0.12} />
  )
}

// ── Cross-tree edge with flowing particle ─────────────────────────

function FlowingCrossEdge({ fromPos, toPos, strength, color }) {
  const tRef   = useRef(0)
  const dotRef = useRef()
  const opacity = 0.18 + (strength / 10) * 0.4

  const curve = useMemo(() => {
    const p1 = fromPos.clone(), p2 = toPos.clone()
    const mid = p1.clone().lerp(p2, 0.5); mid.y += 2.8
    return new THREE.QuadraticBezierCurve3(p1, mid, p2)
  }, [fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z])

  useFrame((_, delta) => {
    tRef.current = (tRef.current + delta * 0.18) % 1
    if (dotRef.current) dotRef.current.position.copy(curve.getPoint(tRef.current))
  })

  const segPoints = useMemo(() => {
    const pts = curve.getPoints(48)
    const segs = []
    for (let i = 0; i < pts.length - 2; i += 4)
      segs.push([pts[i], pts[Math.min(i + 2, pts.length - 1)]])
    return segs
  }, [curve])

  const threeColor = useMemo(() => new THREE.Color(color || '#8b5cf6'), [color])

  return (
    <>
      {segPoints.map((seg, i) => (
        <Line key={i} points={seg} color={threeColor} lineWidth={0.9} transparent opacity={opacity} />
      ))}
      <mesh ref={dotRef}>
        <sphereGeometry args={[0.07, 6, 6]} />
        <meshBasicMaterial color={threeColor} transparent opacity={0.95} />
      </mesh>
    </>
  )
}

// ── Camera auto-fit ───────────────────────────────────────────────

function CameraRig({ allPositions }) {
  const { camera } = useThree()
  const prevLen    = useRef(0)

  useEffect(() => {
    if (!allPositions.length || allPositions.length === prevLen.current) return
    prevLen.current = allPositions.length
    const xs = allPositions.map(p => p.x), ys = allPositions.map(p => p.y), zs = allPositions.map(p => p.z)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2
    const span = Math.max(Math.max(...xs) - Math.min(...xs) + 4, Math.abs(Math.max(...ys) - Math.min(...ys)) + 2, Math.max(...zs) - Math.min(...zs) + 4)
    const dist = (span / 2) / Math.tan((50 * Math.PI / 180) / 2) * 1.25
    camera.position.set(cx + dist * 0.35, cy + dist * 0.3, cz + dist)
    camera.lookAt(cx, cy, cz)
  }, [allPositions.length])

  return null
}

// ── Nebula cloud ──────────────────────────────────────────────────

function NebulaCloud({ position, color }) {
  const ref = useRef()
  useFrame(state => {
    if (!ref.current) return
    const t = state.clock.elapsedTime
    ref.current.rotation.y += 0.0008
    ref.current.rotation.z += 0.0005
    ref.current.scale.setScalar(1 + 0.04 * Math.sin(t * 0.28))
  })
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[2.2, 8, 8]} />
      <meshBasicMaterial color={color} transparent opacity={0.016} side={THREE.BackSide} depthWrite={false} />
    </mesh>
  )
}

// ── Main component ────────────────────────────────────────────────

export function TreeCanvas3D({ nodes: _n, edges: _e, roots = [], crossEdges = [], selectedNode, assocNodeIds = new Set(), assocMode = false, onNodeSelect, onNodeExpand }) {
  const [bursts, setBursts] = useState([]) // [{id, pos, color}]

  const handleClickBurst = useCallback((pos, color) => {
    const id = Date.now() + Math.random()
    setBursts(prev => [...prev, { id, pos, color }])
  }, [])

  const removeBurst = useCallback(id => {
    setBursts(prev => prev.filter(b => b.id !== id))
  }, [])

  const posMap = useMemo(() => {
    if (roots.length) return computeMultiLayout(roots)
    return computeTreeLayout(_n || [], _e || [])
  }, [roots.length, roots.map(r => r.nodes.length + '').join(','), roots.map(r => r.edges.length + '').join(',')])

  const allNodes = useMemo(() =>
    roots.length
      ? roots.flatMap((r, i) => r.nodes.map(n => ({ ...n, _rootId: r.id, _treeIdx: i })))
      : (_n || [])
  , [roots, _n])

  const allEdges = useMemo(() =>
    roots.length ? roots.flatMap(r => r.edges || []) : (_e || [])
  , [roots, _e])

  const allPositions = useMemo(() => Array.from(posMap.values()), [posMap])

  return (
    <div style={{ flex:1, position:'relative', background:'#07070d' }}>
      <Canvas
        camera={{ position:[8, 4, 14], fov:50, near:0.01, far:1000 }}
        gl={{ antialias:true, alpha:false, powerPreference:'high-performance' }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#07070d']} />

        <ambientLight intensity={0.05} />
        <pointLight position={[8,  6,  8]}  intensity={0.9}  color="#f59e0b" />
        <pointLight position={[-8,-4,  6]}  intensity={0.55} color="#8b5cf6" />
        <pointLight position={[4,  2, -8]}  intensity={0.35} color="#06b6d4" />
        <pointLight position={[-4, 8,  0]}  intensity={0.25} color="#fb7185" />

        <Stars radius={120} depth={60} count={7000} factor={4} fade speed={0.3} />

        {roots.map((r, i) => (
          <NebulaCloud key={r.id} position={new THREE.Vector3(i * TREE_X_GAP, -2, -2)} color={ROOT_THEME_COLORS[i % ROOT_THEME_COLORS.length]} />
        ))}
        {!roots.length && <NebulaCloud position={new THREE.Vector3(0, -2, -2)} color="#f59e0b" />}

        <OrbitControls enableDamping dampingFactor={0.06} minDistance={1} maxDistance={120} enablePan panSpeed={0.7} rotateSpeed={0.45} zoomSpeed={0.9} />

        {!allNodes.length && (
          <Html center style={{ pointerEvents:'none' }}>
            <span style={{ fontSize:13, color:'#282836', userSelect:'none' }}>输入概念，构建知识图谱</span>
          </Html>
        )}

        {/* Tree edges */}
        {allEdges.map(([a, b], i) => {
          const fp = posMap.get(a.id), tp = posMap.get(b.id)
          if (!fp || !tp) return null
          return <EdgeLine key={`e-${i}`} from={a} to={b} fromPos={fp} toPos={tp} />
        })}

        {/* Assoc pair edge — glowing pink line between the two selected nodes */}
        {assocNodeIds.size === 2 && (() => {
          const [idA, idB] = [...assocNodeIds];
          const pA = posMap.get(idA), pB = posMap.get(idB);
          if (!pA || !pB) return null;
          return <FlowingCrossEdge key="assoc-pair" fromPos={pA} toPos={pB} strength={10} color="#fb7185" />;
        })()}

        {/* Cross-tree edges */}
        {crossEdges.map((ce, i) => {
          const fp = posMap.get(ce.fromNodeId), tp = posMap.get(ce.toNodeId)
          if (!fp || !tp) return null
          const fromRoot = roots.find(r => r.id === ce.fromRootId)
          const color    = fromRoot ? ROOT_THEME_COLORS[roots.indexOf(fromRoot) % ROOT_THEME_COLORS.length] : '#8b5cf6'
          return <FlowingCrossEdge key={`cx-${i}`} fromPos={fp} toPos={tp} strength={ce.strength || 6} color={color} />
        })}

        {/* Nodes */}
        {allNodes.map(n => {
          const p = posMap.get(n.id)
          if (!p) return null
          const treeIdx   = n._treeIdx ?? 0
          const themeColor = ROOT_THEME_COLORS[treeIdx % ROOT_THEME_COLORS.length]
          return (
            <NodeMesh
              key={n.id}
              node={n}
              pos={p}
              selected={selectedNode?.id === n.id}
              isAssocHighlight={assocNodeIds.has(n.id)}
              assocMode={assocMode}
              onSelect={onNodeSelect}
              onExpand={onNodeExpand}
              themeColor={themeColor}
              onClickBurst={handleClickBurst}
            />
          )
        })}

        {/* Click bursts */}
        {bursts.map(b => (
          <ClickBurst key={b.id} position={b.pos} color={b.color} onDone={() => removeBurst(b.id)} />
        ))}

        <CameraRig allPositions={allPositions} />

        <EffectComposer>
          <Bloom luminanceThreshold={0.06} luminanceSmoothing={0.92} intensity={2.6} height={480} />
          <ChromaticAberration offset={[0.0004, 0.0004]} />
        </EffectComposer>
      </Canvas>

      {allNodes.length > 0 && (
        <div style={{ position:'absolute', bottom:16, left:16, fontSize:11, color:'#2a2a4a', userSelect:'none', pointerEvents:'none' }}>
          拖拽旋转 · 滚轮缩放 · 右键平移
        </div>
      )}
      {allNodes.some(n => n.status==='done' && !n.children.length && n.hasStrongRelations !== false) && (
        <div style={{ position:'absolute', bottom:16, right:16, fontSize:11, color:'#2a2a4a', userSelect:'none', pointerEvents:'none' }}>
          点击 + 深度探索
        </div>
      )}
      {crossEdges.length > 0 && (
        <div style={{ position:'absolute', top:12, left:'50%', transform:'translateX(-50%)', fontSize:11, color:'#8b5cf6', opacity:0.6, userSelect:'none', pointerEvents:'none', padding:'3px 10px', border:'1px solid rgba(139,92,246,.25)', borderRadius:20, background:'rgba(139,92,246,.05)' }}>
          {crossEdges.length} 条跨树关联（虚线）
        </div>
      )}
    </div>
  )
}
