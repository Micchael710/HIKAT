import { commonTypeDefs } from "./common"
import { userTypeDefs } from "./user"
import { healthTypeDefs } from "./health"
import { adminTypeDefs } from "./admin"

export * from "./common"
export * from "./user"
export * from "./health"
export * from "./admin"

export const typeDefs = [
  commonTypeDefs,
  healthTypeDefs,
  userTypeDefs,
  adminTypeDefs,
].join("\n\n")

