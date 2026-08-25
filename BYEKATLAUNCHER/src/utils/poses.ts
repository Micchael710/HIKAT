import type { SkinViewer } from "skinview3d"

export interface SkinPose {
  id: string
  name: string
  isCapeRecommended?: boolean
  apply: (viewer: SkinViewer) => void
}

const resetPlayerJoints = (viewer: SkinViewer) => {
  try {
    const player = viewer.playerObject
    player.rotation.set(0, 0, 0)
    player.position.set(0, 0, 0)
    player.skin.resetJoints()
    player.cape.rotation.set(0.1, 0, 0)
  } catch (_) {}
}

/**
 * Carefully calibrated 3D poses for Minecraft characters in skinview3d.
 * Ordered in a specific sequence starting with standard default neutral pose.
 */
export const SKIN_POSES: SkinPose[] = [
  {
    id: "default",
    name: "Por Defecto",
    apply: (viewer: SkinViewer) => {
      resetPlayerJoints(viewer)
      const player = viewer.playerObject
      player.rotation.set(0, 0.25, 0)
      player.skin.head.rotation.set(0, 0, 0)
      player.skin.leftArm.rotation.set(0, 0, 0.05)
      player.skin.rightArm.rotation.set(0, 0, -0.05)
      player.skin.leftLeg.rotation.set(0, 0, 0)
      player.skin.rightLeg.rotation.set(0, 0, 0)
      player.cape.rotation.set(0.12, 0, 0)
    },
  },
  {
    id: "heroic",
    name: "Heroica",
    apply: (viewer: SkinViewer) => {
      resetPlayerJoints(viewer)
      const player = viewer.playerObject
      player.rotation.set(0, 0.45, 0)
      player.skin.head.rotation.set(-0.08, -0.2, 0.05)
      player.skin.leftArm.rotation.set(0.15, 0, 0.2)
      player.skin.rightArm.rotation.set(-0.15, 0, -0.2)
      player.skin.leftLeg.rotation.set(-0.06, 0, 0.06)
      player.skin.rightLeg.rotation.set(0.06, 0, -0.06)
      player.cape.rotation.set(0.22, 0, 0)
    },
  },
  {
    id: "action_walk",
    name: "Aventura",
    apply: (viewer: SkinViewer) => {
      resetPlayerJoints(viewer)
      const player = viewer.playerObject
      player.rotation.set(0, -0.45, 0)
      player.skin.head.rotation.set(-0.05, 0.3, 0)
      player.skin.leftArm.rotation.set(0.55, 0, 0.15)
      player.skin.rightArm.rotation.set(-0.55, 0, -0.15)
      player.skin.leftLeg.rotation.set(-0.45, 0, 0.05)
      player.skin.rightLeg.rotation.set(0.45, 0, -0.05)
      player.cape.rotation.set(0.35, 0, 0)
    },
  },
  {
    id: "wave_greeting",
    name: "Saludo",
    apply: (viewer: SkinViewer) => {
      resetPlayerJoints(viewer)
      const player = viewer.playerObject
      player.rotation.set(0, 0.22, 0)
      player.skin.head.rotation.set(-0.08, -0.15, -0.06)
      player.skin.rightArm.rotation.set(-0.35, 0.1, -2.1)
      player.skin.leftArm.rotation.set(0.1, 0, 0.2)
      player.skin.leftLeg.rotation.set(0, 0, 0.05)
      player.skin.rightLeg.rotation.set(0, 0, -0.05)
      player.cape.rotation.set(0.18, 0, 0)
    },
  },
  {
    id: "confident_akimbo",
    name: "Confiado",
    apply: (viewer: SkinViewer) => {
      resetPlayerJoints(viewer)
      const player = viewer.playerObject
      player.rotation.set(0, 0.35, 0)
      player.skin.head.rotation.set(0.06, -0.2, 0)
      player.skin.body.rotation.set(-0.04, 0, 0)
      player.skin.rightArm.rotation.set(0.3, -0.15, -0.55)
      player.skin.leftArm.rotation.set(0.3, 0.15, 0.55)
      player.skin.leftLeg.rotation.set(-0.06, 0, 0.08)
      player.skin.rightLeg.rotation.set(0.06, 0, -0.08)
      player.cape.rotation.set(0.25, 0, 0)
    },
  },
  {
    id: "thinker",
    name: "Pensativo",
    apply: (viewer: SkinViewer) => {
      resetPlayerJoints(viewer)
      const player = viewer.playerObject
      player.rotation.set(0, -0.38, 0)
      player.skin.head.rotation.set(-0.15, 0.35, 0.08)
      player.skin.rightArm.rotation.set(-1.25, -0.35, -0.25)
      player.skin.leftArm.rotation.set(-0.3, 0.25, 0.4)
      player.skin.leftLeg.rotation.set(-0.08, 0, 0.05)
      player.skin.rightLeg.rotation.set(0.12, 0, -0.05)
      player.cape.rotation.set(0.2, 0, 0)
    },
  },
  {
    id: "battle_ready",
    name: "En Guardia",
    apply: (viewer: SkinViewer) => {
      resetPlayerJoints(viewer)
      const player = viewer.playerObject
      player.rotation.set(0, 0.55, 0)
      player.skin.head.rotation.set(-0.12, -0.4, 0)
      player.skin.rightArm.rotation.set(-0.75, -0.25, -0.2)
      player.skin.leftArm.rotation.set(-0.5, 0.35, 0.25)
      player.skin.rightLeg.rotation.set(0.3, 0, -0.08)
      player.skin.leftLeg.rotation.set(-0.25, 0, 0.08)
      player.cape.rotation.set(0.3, 0, 0)
    },
  },
  {
    id: "relaxed_casual",
    name: "Relajado",
    apply: (viewer: SkinViewer) => {
      resetPlayerJoints(viewer)
      const player = viewer.playerObject
      player.rotation.set(0, -0.25, 0)
      player.skin.head.rotation.set(-0.05, 0.18, -0.05)
      player.skin.leftArm.rotation.set(-0.2, 0, 0.25)
      player.skin.rightArm.rotation.set(-0.2, 0, -0.25)
      player.skin.leftLeg.rotation.set(-0.05, 0, 0.06)
      player.skin.rightLeg.rotation.set(-0.06, 0, -0.06)
      player.cape.rotation.set(0.22, 0, 0)
    },
  },
  {
    id: "cape_showcase",
    name: "Exhibición de Capa",
    isCapeRecommended: true,
    apply: (viewer: SkinViewer) => {
      resetPlayerJoints(viewer)
      const player = viewer.playerObject
      player.rotation.set(-0.05, 2.65, 0)
      player.skin.head.rotation.set(-0.08, 0.85, 0)
      player.skin.leftArm.rotation.set(-0.25, 0, 0.3)
      player.skin.rightArm.rotation.set(-0.25, 0, -0.3)
      player.skin.leftLeg.rotation.set(-0.05, 0, 0.06)
      player.skin.rightLeg.rotation.set(-0.06, 0, -0.06)
      player.cape.rotation.set(0.38, 0, 0)
    },
  },
]

/**
 * Returns the next pose in the specific ordered sequence.
 */
export function getNextPose(currentId?: string, isCapeMode?: boolean): SkinPose {
  const pool = isCapeMode
    ? SKIN_POSES.filter((p) => p.isCapeRecommended || p.id === "default" || p.id === "heroic" || p.id === "action_walk")
    : SKIN_POSES

  const currentIdx = pool.findIndex((p) => p.id === currentId)
  const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % pool.length : 0
  return pool[nextIdx]
}
