import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, SpotLight, useAnimations } from '@react-three/drei'
import type { VRM } from '@pixiv/three-vrm'
import { Suspense, useEffect, useState, useRef, useCallback } from 'react'
import { useVRMloader } from '@/hooks/useVrmloader'
import { useClips } from '@/hooks/useClips'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

interface AvatarViewerProps {
  avatarUrl: string
}

interface ModelProps {
  url: string
  onHeadPositionKnown: (headPosition: THREE.Vector3) => void
}

function Model({ url, onHeadPositionKnown }: ModelProps) {
  const vrm = useVRMloader(url)
  const clips = useClips(vrm)
  const { mixer, actions } = useAnimations(clips, vrm.scene)

  useEffect(() => {
    if (vrm && actions.idle) {
      actions.idle.setEffectiveTimeScale(0.5)
      actions.idle.play()
    } else if (vrm && !actions.idle) {
      console.error('No idle animation found')
    }
  }, [vrm, actions])

  useEffect(() => {
    if (vrm && vrm.humanoid) {
      const headBone = vrm.humanoid.getNormalizedBoneNode('head')
      if (headBone) {
        const headPosition = new THREE.Vector3()
        headBone.getWorldPosition(headPosition)
        onHeadPositionKnown(headPosition)
      } else {
        console.warn('Head bone not found in VRM. Falling back to hips or default.')
        let fallbackPosition: THREE.Vector3
        const hipsBone = vrm.humanoid.getNormalizedBoneNode('hips')
        if (hipsBone) {
          fallbackPosition = new THREE.Vector3()
          hipsBone.getWorldPosition(fallbackPosition)
          // Adjust Y if needed, hips are usually lower than desired target
          fallbackPosition.y += 0.8 // Example adjustment to approximate head height
        } else {
          // Absolute fallback if no hips either
          fallbackPosition = new THREE.Vector3(0, 1.0, 0) // Default Y an assumption
        }
        onHeadPositionKnown(fallbackPosition)
      }
    } else if (vrm) {
      // VRM loaded but no humanoid data, or still processing.
      console.warn('VRM loaded, but humanoid data not (yet) available. Using default target.')
      onHeadPositionKnown(new THREE.Vector3(0, 1.0, 0))
    }
    // If vrm is null (still loading, or failed), this effect won't call onHeadPositionKnown here.
    // The initial state of orbitTarget in AvatarViewer handles the pre-load scenario.
  }, [vrm, onHeadPositionKnown])

  useFrame((_, delta) => {
    if (vrm) {
      vrm.update(delta)
    }
    if (mixer) {
      mixer.update(delta)
    }
  })

  if (!vrm) {
    return null
  }

  return (
    <>
      <group position={[0, 0, 0]} rotation={[0, 0, 0]}>
        <primitive object={vrm.scene} />
      </group>
    </>
  )
}

export function AvatarViewer({ avatarUrl }: AvatarViewerProps) {
  const [orbitTarget, setOrbitTarget] = useState<THREE.Vector3>(() => new THREE.Vector3(0, 1.5, 0))
  const [isInitialCameraSetupDone, setIsInitialCameraSetupDone] = useState(false)
  const cameraRef = useRef<THREE.PerspectiveCamera>(null)
  const controlsRef = useRef<OrbitControlsImpl>(null)

  const handleHeadPositionKnown = useCallback((newLookAtTarget: THREE.Vector3) => {
    setOrbitTarget(newLookAtTarget)
  }, [setOrbitTarget])

  // Effect to position camera once head position is known and camera is available
  useEffect(() => {
    if (cameraRef.current && orbitTarget && !isInitialCameraSetupDone) {
      const newCameraPos = orbitTarget.clone().add(new THREE.Vector3(0, 0.05, 0.85))
      cameraRef.current.position.copy(newCameraPos)
      cameraRef.current.up.set(0, 1, 0)
      cameraRef.current.lookAt(orbitTarget)
      
      if (controlsRef.current) {
        controlsRef.current.target.copy(orbitTarget);
        controlsRef.current.update()
      }
      setIsInitialCameraSetupDone(true)
    }
  }, [orbitTarget, isInitialCameraSetupDone])

  // Reset camera setup flag when avatarUrl changes, to allow repositioning for new avatar
  useEffect(() => {
    setIsInitialCameraSetupDone(false)
  }, [avatarUrl])

  return (
    <div className="w-full h-[70vh] bg-gray-800 rounded">
      <Canvas
        camera={{ position: [0, 1.5, 1.8], fov: 50 }}
        onCreated={({ camera }) => {
          cameraRef.current = camera as THREE.PerspectiveCamera
          // If head position is already known by this point (fast model load),
          // the useEffect listening to orbitTarget will handle the positioning.
        }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[2.5, 8, 5]} intensity={1} />
        <Suspense fallback={null}>
          <Model
            key={avatarUrl}
            url={avatarUrl}
            onHeadPositionKnown={handleHeadPositionKnown}
          />
        </Suspense>
        <OrbitControls
          ref={controlsRef}
          target={orbitTarget.toArray() as [number, number, number]} // Controlled target
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>
    </div>
  )
} 