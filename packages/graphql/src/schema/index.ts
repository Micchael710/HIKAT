import { commonTypeDefs } from "./common"

import { userTypeDefs } from "./user"

import { healthTypeDefs } from "./health"

import { adminTypeDefs } from "./admin"

import { contentTypeDefs } from "./content"

export * from "./common"

export * from "./user"

export * from "./health"

export * from "./admin"

export * from "./content"

export const typeDefs = [
  commonTypeDefs,

  healthTypeDefs,

  userTypeDefs,

  adminTypeDefs,

  contentTypeDefs,
].join("\n\n")
