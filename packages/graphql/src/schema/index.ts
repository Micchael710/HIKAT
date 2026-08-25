import { commonTypeDefs } from "./common"
import { userTypeDefs } from "./user"
import { healthTypeDefs } from "./health"

export * from "./common"
export * from "./user"
export * from "./health"

export const typeDefs = [commonTypeDefs, userTypeDefs, healthTypeDefs].join(
  "\n\n",
)
