import * as THREE from 'three'

import { System } from './viewer'
import { debounce, throttle } from 'lodash-es'

const DEBUG = true

const IDLE_EMOTE = '/emote-idlebreathing.glb'

const idleQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 180 * THREE.MathUtils.DEG2RAD, 0, 'YXZ'))

export class Env extends System {
  constructor(world) {
    super(world)
    this.scenes = {} // id => { id, origin, mesh }
    this.id = null
    this.markRetarget = throttle(
      () => {
        this.needsRetarget = true
      },
      100,
      { leading: false, trailing: true }
    )
  }

  async init() {
    // showroom
    {
      this.world.loader.load('model', '/lab7b.glb').then(glb => {
        const node = glb.toNodes()
        node.rotation.y -= 40 * THREE.MathUtils.DEG2RAD
        node.activate({ world: this.world })
        this.lab = node
      })
    }
    // avatar
    {
      this.world.loader.load('avatar', '/character-hyperbot.vrm').then(glb => {
        const avatar = glb.toNodes().get('avatar')
        avatar.parent.remove(avatar)
        avatar.quaternion.copy(idleQuaternion)
        avatar.emote = IDLE_EMOTE
        avatar.active = false
        avatar.onLoad = () => {
          this.markRetarget()
          // const height = avatar.getHeight()
          // console.log('avatar onLoad')
          // // // need to ensure our scene is atleast this high right?
          // // if (this.id) {
          // //   const scene = this.scenes[this.id]
          // //   if (scene.originalY) {
          // //     scene.mesh.scale.y = scene.originalY
          // //   }
          // //   if (scene.mesh.scale.y < height) {
          // //     scene.originalY = scene.mesh.scale.y
          // //     scene.mesh.scale.y = height
          // //     console.log('set scene y', height)
          // //   }
          // //   this.retarget()
          // // }
        }
        avatar.activate({ world: this.world })
        this.avatar = avatar
      })
    }
    // play stage
    {
      const material = new THREE.MeshStandardMaterial({ color: 'red', transparent: true, opacity: 0.7 })
      const geometry = new THREE.BoxGeometry(1, 1, 1)
      geometry.translate(0.5, 0.5, 0.5)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.scale.set(1, 1.7, 0.5)
      mesh.position.set(-0.5, 0, -0.25)
      mesh.rotation.reorder('YXZ').set(0, 0, 0)
      console.log('set scene y', mesh.scale.y)
      // mesh.rotation.y = -45 * THREE.MathUtils.DEG2RAD
      const origin = new THREE.Vector3(0, 1.3, 3)
      const id = 'play'
      this.scenes[id] = { id, origin, mesh }
      // this.world.stage.scene.add(mesh)
    }
    // vault stage
    {
      const material = new THREE.MeshStandardMaterial({ color: 'red', transparent: true, opacity: 0.7 })
      const geometry = new THREE.BoxGeometry(1, 1, 1)
      geometry.translate(0.5, 0.5, 0.5)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.scale.set(1, 1.7, 0.5)
      mesh.position.set(-0.5, 0, -0.25)
      mesh.rotation.reorder('YXZ').set(0, 0, 0)
      // mesh.rotation.y = -45 * THREE.MathUtils.DEG2RAD
      const origin = new THREE.Vector3(1, 1.3, 4)
      const id = 'vault'
      this.scenes[id] = { id, origin, mesh }
      // this.world.stage.scene.add(mesh)
    }
    this.control = this.world.controls.bind({
      priority: 100,
    })
    console.log('init finished')
  }

  start() {
    this.camera = this.world.camera
    this.world.stage.scene.add(this.camera)
    this.target = new THREE.PerspectiveCamera(70, 0, 0.2, 1200) // this.camera.clone()
    this.world.stage.scene.add(this.target)
    this.started = true
    this.retarget()
    console.log('start', this.started)
    window.addEventListener('resize', this.onResize)
  }

  setScene(id) {
    console.log(this)
    console.log('set', id, this.id, this.started)
    if (this.id === id) return
    this.id = id
    if (!this.started) return
    this.retarget()
    // if (DEBUG) {
    //   this.world.stage.scene.add(this.current.mesh)
    // }
  }

  setVRM(vrmUrl) {
    this.newVrmUrl = vrmUrl
  }

  setEmote(url) {
    if (!this.avatar) return
    url = this.avatar.emote === url ? IDLE_EMOTE : url || IDLE_EMOTE
    this.avatar.emote = url
  }

  tempScreenshot() {
    this.lab.active = false
    this.world.stage.scene.background = new THREE.Color('blue')
  }

  update(delta) {
    if (this.newVrmUrl && this.avatar) {
      this.avatar.src = this.newVrmUrl
      this.avatar.active = !!this.newVrmUrl
      this.newVrmUrl = null
    }
    if (this.needsRetarget) {
      this.retarget()
      this.needsRetarget = false
    }
    if (this.avatar) {
      if (this.control.mouseLeft.pressed) {
        this.turn = {
          y: this.avatar.rotation.y,
        }
        console.log('press')
      }
      if (this.control.mouseLeft.released) {
        this.turn = null
        console.log('release')
      }
      if (this.turn) {
        this.turn.y += this.control.pointer.delta.x * 0.5 * delta
        this.avatar.rotation.y = this.turn.y
      } else {
        this.avatar.quaternion.slerp(idleQuaternion, 5 * delta)
      }
    }

    // console.log('update', this.target.position.toArray())
    const lerpFactor = 0.05
    this.camera.position.lerp(this.target.position, lerpFactor)
    this.camera.quaternion.slerp(this.target.quaternion, lerpFactor)
    // this.camera.updateProjectionMatrix()
  }

  retarget() {
    const scene = this.scenes[this.id]
    if (!scene) return console.error('no scene found', this.id)
    const origin = scene.origin
    const mesh = scene.mesh
    const camera = this.camera
    const target = this.target
    const maxIterations = 5

    // min avatar height
    const avatarHeight = this.avatar?.getHeight() || 0
    if (scene.originalY) {
      scene.mesh.scale.y = scene.originalY
    }
    if (scene.mesh.scale.y < avatarHeight) {
      scene.originalY = scene.mesh.scale.y
      scene.mesh.scale.y = avatarHeight
      // console.log('set scene y', height)
    }

    // get vertex positions
    mesh.updateMatrixWorld(true)
    const positions = mesh.geometry.attributes.position
    const tempVec = new THREE.Vector3()
    const pointsWorld = []
    for (let i = 0; i < positions.count; i++) {
      tempVec.fromBufferAttribute(positions, i)
      mesh.localToWorld(tempVec)
      pointsWorld.push(tempVec.clone())
    }

    // find center of mesh
    const center = new THREE.Vector3()
    for (let i = 0; i < pointsWorld.length; i++) {
      center.add(pointsWorld[i])
    }
    center.multiplyScalar(1 / pointsWorld.length)

    // move and look at mesh center
    target.position.copy(origin)
    target.aspect = camera.aspect
    target.fov = camera.fov
    target.lookAt(center)
    target.updateProjectionMatrix()

    // target.updateMatrixWorld(true)
    // mesh.updateMatrixWorld(true)

    const left = 0
    const right = 0
    const top = 200
    const bottom = 0
    const width = this.world.graphics.width
    const height = this.world.graphics.height

    for (let i = 0; i < maxIterations; i++) {
      // Get the bounding rect of the mesh in screen space
      const rect = getMeshScreenRect(target, mesh, width, height)
      // The total available area (width/height) once we account for dead zones
      const canvasSize = new THREE.Vector2(width, height)
      const availableWidth = canvasSize.x - (left + right)
      const availableHeight = canvasSize.y - (top + bottom)
      const rectWidth = rect.maxX - rect.minX
      const rectHeight = rect.maxY - rect.minY
      // If the mesh is bigger than available space, we need to move the camera away.
      // If the mesh is smaller, we could consider moving the camera in.
      // We'll calculate a ratio for each dimension.
      const ratioW = rectWidth === 0 ? 1 : rectWidth / availableWidth
      const ratioH = rectHeight === 0 ? 1 : rectHeight / availableHeight
      const ratio = Math.max(ratioW, ratioH)
      if (ratio !== 1.0) {
        // We are too close; move away
        moveCameraDistance(target, ratio, center)
      } else {
        // Perfect fit
        break
      }
    }

    // TODO: vertical and horizontal padding ends up being centered because we are looking at the center of the mesh so instead of their beign 117px padding at the top as requested, we actually end up with some padding above and some padding below.
    // Now adjust the look-at point to account for asymmetric padding
    // Calculate the desired visual center offset based on padding
    // const horizontalOffset = (right - left) / width // Normalized offset (-1 to 1)
    // const verticalOffset = (top - bottom) / height // Normalized offset (-1 to 1)

    // // We need to calculate how much to offset the center in world coordinates
    // // This depends on the distance from camera to center and the field of view
    // const distanceToCenter = target.position.distanceTo(center)

    // // Calculate the visible height at the center distance
    // // tan(fov/2) * distance * 2 gives us the height of the view frustum at that distance
    // const fovRadians = target.fov * THREE.MathUtils.DEG2RAD
    // const visibleHeight = 2 * Math.tan(fovRadians / 2) * distanceToCenter

    // // Calculate the visible width based on the aspect ratio
    // const visibleWidth = visibleHeight * target.aspect

    // // Calculate the world-space offsets
    // const worldOffsetX = horizontalOffset * visibleWidth
    // const worldOffsetY = verticalOffset * visibleHeight

    // // Calculate the right and up vectors of the camera
    // const forward = new THREE.Vector3()
    // target.getWorldDirection(forward)
    // forward.negate() // Camera looks down the negative z-axis

    // const right2 = new THREE.Vector3(1, 0, 0)
    // right2.applyQuaternion(target.quaternion)

    // const up = new THREE.Vector3(0, 1, 0)
    // up.applyQuaternion(target.quaternion)

    // // Create an adjusted center
    // const adjustedCenter = center.clone()
    // adjustedCenter.addScaledVector(right2, worldOffsetX)
    // adjustedCenter.addScaledVector(up, worldOffsetY)

    // // Aim the camera at the adjusted center
    // target.lookAt(adjustedCenter)
    // target.updateProjectionMatrix()
  }

  // retarget_og() {
  //   const stage = this.scenes[this.id]
  //   if (!stage) return console.error('no stage found', this.id)
  //   console.time('retarget')
  //   console.log('retarget', stage)
  //   const origin = stage.origin
  //   const mesh = stage.mesh
  //   const camera = this.camera
  //   const target = this.target
  //   const minDistance = 0.1
  //   const maxDistance = 100
  //   const precision = 0.001
  //   const padding = { left: 0, right: 0, top: 0, bottom: 0 }
  //   const width = this.world.graphics.width
  //   const height = this.world.graphics.height

  //   // this.world.stage.scene.add(camera)
  //   target.position.copy(origin)

  //   target.aspect = camera.aspect
  //   target.fov = camera.fov
  //   target.updateProjectionMatrix()

  //   // 1. Extract all vertices in world space
  //   mesh.updateMatrixWorld(true)
  //   const positions = mesh.geometry.attributes.position
  //   const tempVec = new THREE.Vector3()
  //   const pointsWorld = []
  //   for (let i = 0; i < positions.count; i++) {
  //     tempVec.fromBufferAttribute(positions, i)
  //     mesh.localToWorld(tempVec)
  //     pointsWorld.push(tempVec.clone())
  //   }

  //   // 2. Compute center of all points
  //   const center = new THREE.Vector3()
  //   for (let i = 0; i < pointsWorld.length; i++) {
  //     center.add(pointsWorld[i])
  //   }
  //   center.multiplyScalar(1 / pointsWorld.length)

  //   // 4. Make camera look at center
  //   target.lookAt(center)
  //   // target.updateProjectionMatrix()

  //   // 5. Direction from center to camera
  //   const dir = new THREE.Vector3().subVectors(target.position, center).normalize()

  //   // --- Convert pixel padding to NDC ---
  //   const ndcPaddingLeft = (2 * padding.left) / width
  //   const ndcPaddingRight = (2 * padding.right) / width
  //   const ndcPaddingTop = (2 * padding.top) / height
  //   const ndcPaddingBottom = (2 * padding.bottom) / height

  //   // 6. Binary search
  //   let low = minDistance
  //   let high = maxDistance
  //   let bestDist = high

  //   while (high - low > precision) {
  //     const mid = 0.5 * (low + high)

  //     // Move camera to center + dir * mid
  //     target.position.copy(center).addScaledVector(dir, mid)
  //     target.lookAt(center)
  //     // target.updateProjectionMatrix()

  //     // Check if all points fit within the adjusted [-1,1] range
  //     let allInside = true
  //     for (let i = 0; i < pointsWorld.length; i++) {
  //       tempVec.copy(pointsWorld[i]).project(target)

  //       if (
  //         tempVec.x < -1 + ndcPaddingLeft ||
  //         tempVec.x > 1 - ndcPaddingRight ||
  //         tempVec.y < -1 + ndcPaddingBottom ||
  //         tempVec.y > 1 - ndcPaddingTop
  //       ) {
  //         allInside = false
  //         break
  //       }
  //     }

  //     if (allInside) {
  //       // We can try to move closer
  //       bestDist = mid
  //       high = mid
  //     } else {
  //       // Too close, move farther
  //       low = mid
  //     }
  //   }

  //   // 7. Final position at bestDist
  //   target.position.copy(center).addScaledVector(dir, bestDist)
  //   target.lookAt(center)
  //   // target.updateProjectionMatrix()

  //   console.log('retarget', target.position.toArray())
  //   console.timeEnd('retarget')
  // }

  onResize = () => {
    this.markRetarget()
  }

  destroy() {
    window.removeEventListener('resize', this.onResize)
  }
}

function getMeshScreenRect(camera, mesh, width, height) {
  const geometry = mesh.geometry
  if (!geometry.isBufferGeometry) {
    throw new Error('getMeshScreenRect only supports BufferGeometry')
  }
  const positions = geometry.attributes.position
  const tempVector = new THREE.Vector3()
  let minX = +Infinity,
    maxX = -Infinity,
    minY = +Infinity,
    maxY = -Infinity
  const canvasSize = new THREE.Vector2(width, height)
  const worldMatrix = mesh.matrixWorld
  for (let i = 0; i < positions.count; i++) {
    tempVector.set(positions.getX(i), positions.getY(i), positions.getZ(i))
    tempVector.applyMatrix4(worldMatrix)
    tempVector.project(camera)
    const screenX = (tempVector.x + 1) * 0.5 * canvasSize.x
    const screenY = (1 - tempVector.y) * 0.5 * canvasSize.y
    if (screenX < minX) minX = screenX
    if (screenX > maxX) maxX = screenX
    if (screenY < minY) minY = screenY
    if (screenY > maxY) maxY = screenY
  }
  return { minX, maxX, minY, maxY }
}

function moveCameraDistance(camera, factor, pivot) {
  // We want to move the camera so that pivot stays in the center of the view.
  // So we take the vector from pivot -> camera, scale it, and reapply.
  const dir = new THREE.Vector3().subVectors(camera.position, pivot)
  dir.multiplyScalar(factor)

  // Reposition the camera around that pivot
  camera.position.copy(pivot).add(dir)

  // Keep looking at the pivot
  camera.lookAt(pivot)
  camera.updateMatrixWorld(true)
}
