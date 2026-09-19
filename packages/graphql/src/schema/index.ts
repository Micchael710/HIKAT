import { commonTypeDefs } from "./common"
import { userTypeDefs } from "./user"
import { healthTypeDefs } from "./health"
import { adminTypeDefs } from "./admin"
import { contentTypeDefs } from "./content"
import { serverTypeDefs } from "./server"
import { dashboardTypeDefs } from "./dashboard"
import { skinsTypeDefs } from "./skins"
import { gameTypeDefs } from "./game"
import { settingsTypeDefs } from "./settings"
import { launcherTypeDefs } from "./launcher"

export * from "./common"
export * from "./user"
export * from "./health"
export * from "./admin"
export * from "./content"
export * from "./server"
export * from "./dashboard"
export * from "./skins"
export * from "./game"
export * from "./settings"
export * from "./launcher"

export const typeDefs = [
  commonTypeDefs,
  healthTypeDefs,
  userTypeDefs,
  adminTypeDefs,
  contentTypeDefs,
  serverTypeDefs,
  dashboardTypeDefs,
  skinsTypeDefs,
  gameTypeDefs,
  settingsTypeDefs,
  launcherTypeDefs,
].join("\n\n")
