import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Suspense, useEffect, useState } from 'react'
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'

interface AvatarViewerProps {
  avatarUrl: string
}

interface CustomGLTF extends GLTF {
  userData: {
    vrm: VRM
  }
}

function Model({ url }: { url: string }) {
  const [vrm, setVrm] = useState<VRM | null>(null)

  useEffect(() => {
    const loader = new GLTFLoader()
    loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser))

    loader.load(
      url,
      (gltf: GLTF) => {
        const customGltf = gltf as CustomGLTF
        VRMUtils.removeUnnecessaryJoints(customGltf.scene)
        VRMUtils.removeUnnecessaryVertices(customGltf.scene)
        const loadedVrm = customGltf.userData.vrm
        setVrm(loadedVrm)
      },
      (progress: ProgressEvent) => console.log('Loading model...', 100.0 * (progress.loaded / progress.total), '%'),
      (error: unknown) => console.error(error)
    )
  }, [url])

  return vrm ? <primitive object={vrm.scene} /> : null
}

export function AvatarViewer({ avatarUrl }: AvatarViewerProps) {
  return (
    <div className="w-full h-[70vh] bg-gray-800 rounded">
      <Canvas camera={{ position: [0, 1.5, 1.5], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[2.5, 8, 5]} intensity={1} />
        <Suspense fallback={null}>
          <Model url={avatarUrl} />
        </Suspense>
        <OrbitControls target={[0, 1.5, 0]} />
      </Canvas>
    </div>
  )
} 