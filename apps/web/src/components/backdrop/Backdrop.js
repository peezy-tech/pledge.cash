// import * as THREE from 'three'

// import { createViewerWorld } from './viewer'
// import { Focus } from './Focus'
// import { loadPhysX } from './loadPhysX'

// export class Backdrop {
//   constructor() {
//     this.world = null
//     this.viewport = null
//     this.initPromise = new Promise(resolve => {
//         this.markInit = resolve
//     })
//   }

//   async init({ viewport }) {
//     console.log('init')
//     this.world = createViewerWorld()
//     this.world.register('stages', Stages)
//     this.viewport = viewport
//     const baseEnvironment = {
//       model: null,
//       // bg: '/day2-2k.jpg',
//       hdr: '/day2.hdr',
//       sunDirection: new THREE.Vector3(-1, -2, -2).normalize(),
//       sunIntensity: 1,
//       sunColor: 0xffffff,
//       fogNear: null,
//       fogFar: null,
//       fogColor: null,
//     }
//     await this.world.init({ viewport, loadPhysX, baseEnvironment })
//     // showroom
//     {
//       this.world.loader.load('model', '/showroom.glb').then(glb => {
//         const node = glb.toNodes()
//         node.activate({ world: this.world })
//       })
//     }
//     // avatar
//     {
//       this.world.loader.load('avatar', '/hyperbot.vrm').then(glb => {
//         const avatar = glb.toNodes().get('avatar')
//         avatar.position.y = 0.1
//         avatar.rotation.y = 180 * THREE.MathUtils.DEG2RAD
//         avatar.emote = '/idle-breathing.glb'
//         avatar.activate({ world: this.world })
//       })
//     }
//     // play stage
//     {
//       const material = new THREE.MeshStandardMaterial({ color: 'red', transparent: true, opacity: 0.7 })
//       const geometry = new THREE.BoxGeometry(1, 1, 1)
//       geometry.translate(0.5, 0.5, 0.5)
//       const mesh = new THREE.Mesh(geometry, material)
//       // mesh.position.copy(min)
//       // mesh.scale.set(max.x - min.x, max.y - min.y, max.z - min.z)
//       mesh.position.set(-0.5, 0.3, -0.25)
//       mesh.scale.set(1, 1.7, 0.5)
//       mesh.rotation.reorder('YXZ')
//       // mesh.rotation.y = -45 * THREE.MathUtils.DEG2RAD
//       // mesh.scale.set(1, 2, 1)
//       const origin = new THREE.Vector3(0, 1.1, 3)
//       this.world.stages.add('play', origin, mesh)
//     }
//     console.log('init:finish')
//     this.markInit()
//   }

//   async setStage(stage) {
//     await this.initPromise
//     this.world.stages.set(stage)
//   }
// }
